import "./config.js";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { z, ZodError } from "zod";
import { config } from "./config.js";
import { pool, query, runMigrations, transaction } from "./db.js";
import {
  clearSessionCookie,
  createSession,
  hashPassword,
  publicUser,
  readSessionToken,
  requireAuth,
  tokenHash,
  verifyPassword,
  type AuthenticatedRequest
} from "./auth.js";
import { getConversationMessages, getMessage, getMessageContext, getPinnedMessages, searchMessages } from "./messages.js";
import { publicVapidKey, sendMessagePush } from "./push.js";
import {
  createRealtimeServer,
  emitToConversation,
  emitToUser,
  joinUserToConversation,
  leaveUserFromConversation,
  onlineUserIds
} from "./realtime.js";
import { isAllowedOrigin, isSafePushEndpoint } from "./security.js";
import { createAiRouter } from "./routes/ai.js";
import { acknowledgeAiNotifications } from "./repositories/ai.js";

const app = express();
const server = createServer(app);
createRealtimeServer(server);

if (config.isProduction) app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", config.appOrigin.replace(/^http/, "ws")],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        workerSrc: ["'self'", "blob:"]
      }
    },
    crossOriginResourcePolicy: { policy: "same-origin" }
  })
);
app.use(express.json({ limit: "1mb" }));
app.use("/api", (_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  next();
});

app.use((request, response, next) => {
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
    request.path.startsWith("/api/")
  ) {
    const origin = request.get("origin");
    if (!isAllowedOrigin(origin, config.appOrigin)) {
      response.status(403).json({ error: "Недопустимый источник запроса" });
      return;
    }
  }
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много попыток. Попробуйте позже" }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов. Подождите минуту" }
});

app.use("/api", apiLimiter);

// AI is intentionally absent from the production route graph during the pilot.
if (config.ai.availableInEnvironment) app.use("/api/ai", createAiRouter());

const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, "Логин может содержать буквы, цифры и подчёркивание"),
  displayName: z.string().trim().min(2).max(80),
  password: z.string().min(8).max(128)
});

const loginSchema = z.object({
  login: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(128)
});

const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  bio: z.string().trim().max(180).default("")
});

const directSchema = z.object({ userId: z.string().uuid() });
const groupSchema = z.object({
  title: z.string().trim().min(2).max(100),
  memberIds: z.array(z.string().uuid()).min(1).max(99)
});
const groupTitleSchema = z.object({ title: z.string().trim().min(2).max(100) });
const groupMembersSchema = z.object({ userIds: z.array(z.string().uuid()).min(1).max(99) });
const groupRoleSchema = z.object({ role: z.enum(["admin", "member"]) });
const notificationSchema = z.object({
  mode: z.enum(["all", "mentions", "muted"]),
  muteUntil: z.string().datetime().nullable().optional()
});
const messageSearchSchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  conversationId: z.string().uuid().optional(),
  senderId: z.string().uuid().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.enum(["all", "text", "files", "image", "video", "audio", "voice", "video_circle"]).optional().default("all"),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50)
}).refine((value) => Boolean(value.q || value.conversationId || value.senderId || value.dateFrom || value.dateTo || value.type !== "all"), {
  message: "Введите запрос или выберите фильтр"
});
const messageSchema = z
  .object({
    body: z.string().trim().max(4000).default(""),
    replyToId: z.string().uuid().nullable().optional(),
    clientId: z.string().uuid(),
    attachmentIds: z.array(z.string().uuid()).max(5).default([]),
    silent: z.boolean().default(false),
    scheduleAt: z.string().datetime().nullable().optional(),
    expireSeconds: z.number().int().min(60).max(604800).nullable().optional(),
    viewOnce: z.boolean().default(false)
  })
  .refine((value) => value.body.length > 0 || value.attachmentIds.length > 0, {
    message: "Сообщение не может быть пустым"
  })
  .refine((value) => !value.viewOnce || value.attachmentIds.length > 0, {
    message: "Одноразовое сообщение должно содержать вложение"
  })
  .refine((value) => !value.scheduleAt || new Date(value.scheduleAt).getTime() > Date.now() + 5_000, {
    message: "Время запланированной отправки должно быть в будущем"
  });

const editMessageSchema = z.object({
  body: z.string().trim().max(4000).default(""),
  attachmentIds: z.array(z.string().uuid()).max(5).default([])
}).refine((value) => value.body.length > 0 || value.attachmentIds.length > 0, {
  message: "Сообщение не может быть пустым"
});

const allowedReactions = new Set([
  "👍", "❤️", "🔥", "😂", "😍", "😮", "😢", "👏", "🎉", "🤝", "💯", "👀", "🙏", "🤔", "😎", "🐈"
]);

const reactionSchema = z.object({
  emoji: z.string().min(1).max(8).refine((emoji) => allowedReactions.has(emoji), "Эта реакция не поддерживается")
});

const pinConversationSchema = z.object({ pinned: z.boolean() });
const archiveConversationSchema = z.object({ archived: z.boolean() });
const folderSchema = z.object({ title: z.string().trim().min(1).max(40) });
const folderItemsSchema = z.object({ conversationIds: z.array(z.string().uuid()).max(200) });
const forwardMessageSchema = z.object({ targetConversationId: z.string().uuid() });

const uploadMetadataSchema = z.object({
  mediaKind: z.enum(["file", "voice", "video_circle"]).default("file"),
  durationMs: z.coerce.number().int().min(0).max(600_000).optional()
});

const pushSchema = z.object({
  endpoint: z.string().url().max(2000).refine(isSafePushEndpoint, "Недопустимый адрес push-сервиса"),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512)
  })
});

const DUMMY_PASSWORD_HASH = "scrypt$QmFyc2lrQ2hhdER1bW15MQ==$13viN/n0/gEWGXIpyQkrdtyMG7aEjH7joceAOMwbdr0lrOyUCPCpvQJGiOCRF5RlKt0+2XHmTghTSzVHTdKw2Q==";

const avatarColors = ["#0f766e", "#2563eb", "#7c3aed", "#c2410c", "#be123c", "#047857"];

function randomAvatarColor() {
  return avatarColors[Math.floor(Math.random() * avatarColors.length)];
}

function authRequest(request: Request) {
  return request as AuthenticatedRequest;
}

function routeParam(request: Request, name: string) {
  const value = request.params[name];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

async function isMember(conversationId: string, userId: string) {
  const membership = await query(
    "SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2",
    [conversationId, userId]
  );
  return Boolean(membership.rowCount);
}

async function getConversationMembership(conversationId: string, userId: string) {
  const result = await query<{ kind: "direct" | "group"; role: "owner" | "admin" | "member" }>(
    `SELECT c.kind, cm.role
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
      WHERE c.id = $1 AND cm.user_id = $2`,
    [conversationId, userId]
  );
  return result.rows[0] ?? null;
}

async function broadcastProfileUpdate(user: ReturnType<typeof publicUser>) {
  try {
    const memberships = await query<{ conversation_id: string }>(
      "SELECT conversation_id FROM conversation_members WHERE user_id = $1",
      [user.id]
    );
    const payload = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      avatarColor: user.avatarColor,
      avatarUrl: user.avatarUrl,
      lastSeenAt: user.lastSeenAt
    };
    memberships.rows.forEach(({ conversation_id }) => {
      emitToConversation(conversation_id, "profile:updated", payload);
    });
  } catch (error) {
    console.warn("Failed to broadcast profile update", error);
  }
}

async function broadcastPublishedMessage(message: any) {
  if (!message) return;
  const conversationId = message.conversationId as string;
  emitToConversation(conversationId, "message:new", message);
  emitToConversation(conversationId, "conversation:updated", { conversationId });
  if (message.silent) return;
  const [conversation] = await conversationsForUser(message.sender.id, conversationId);
  const primaryAttachment = message.attachments?.[0] as { kind?: string } | undefined;
  const body = message.body || (
    primaryAttachment?.kind === "voice"
      ? "🎙 Голосовое сообщение"
      : primaryAttachment?.kind === "video_circle"
        ? "◉ Видеосообщение"
        : message.viewOnce ? "Одноразовое вложение" : "Вложение"
  );
  void sendMessagePush({
    conversationId,
    senderId: message.sender.id,
    senderName: message.sender.displayName,
    title: conversation?.kind === "group" ? conversation.title ?? "Новая группа" : message.sender.displayName,
    body
  });
}

let maintenanceTimer: NodeJS.Timeout | null = null;
let maintenanceRunning = false;

async function runMessageMaintenance() {
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  try {
    const published = await query<{ id: string }>(
      `UPDATE messages
          SET published_at = now(),
              expires_at = CASE WHEN expire_seconds IS NULL THEN NULL ELSE now() + make_interval(secs => expire_seconds) END
        WHERE id IN (
          SELECT id FROM messages
           WHERE published_at IS NULL AND deleted_at IS NULL AND scheduled_at <= now()
           ORDER BY scheduled_at
           LIMIT 100
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id`
    );
    for (const row of published.rows) {
      const message = await getMessage(row.id);
      if (message) {
        await query("UPDATE conversations SET updated_at = now() WHERE id = $1", [message.conversationId]);
        await broadcastPublishedMessage(message);
      }
    }

    const expired = await transaction(async (client) => {
      const messages = await client.query<{ id: string; conversation_id: string }>(
        `UPDATE messages SET body = '', deleted_at = now(), edited_at = NULL
          WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= now()
          RETURNING id, conversation_id`
      );
      const storageNames: string[] = [];
      for (const row of messages.rows) {
        const files = await client.query<{ storage_name: string }>(
          "DELETE FROM attachments WHERE message_id = $1 RETURNING storage_name",
          [row.id]
        );
        storageNames.push(...files.rows.map((file) => file.storage_name));
        await client.query("DELETE FROM message_reactions WHERE message_id = $1", [row.id]);
        await client.query("DELETE FROM conversation_message_pins WHERE message_id = $1", [row.id]);
      }
      return { messages: messages.rows, storageNames: [...new Set(storageNames)] };
    });
    for (const storageName of expired.storageNames) {
      const stillUsed = await query("SELECT 1 FROM attachments WHERE storage_name = $1 LIMIT 1", [storageName]);
      if (!stillUsed.rowCount) await fs.unlink(path.join(config.dataDir, "uploads", storageName)).catch(() => undefined);
    }
    for (const row of expired.messages) {
      emitToConversation(row.conversation_id, "message:expired", {
        conversationId: row.conversation_id,
        messageId: row.id
      });
      emitToConversation(row.conversation_id, "conversation:updated", { conversationId: row.conversation_id });
    }
  } catch (error) {
    console.error("Message maintenance failed", error);
  } finally {
    maintenanceRunning = false;
  }
}

type ConversationRow = {
  id: string;
  kind: "direct" | "group";
  title: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  muted: boolean;
  notificationMode: "all" | "mentions" | "muted";
  muteUntil: Date | null;
  avatarStorageName: string | null;
  avatarUpdatedAt: Date | null;
  pinned: boolean;
  manualUnread: boolean;
  archived: boolean;
  isSaved: boolean;
  lastReadAt: Date;
  members: Array<{
    id: string;
    username: string;
    displayName: string;
    avatarColor: string;
    avatarUrl: string | null;
    lastSeenAt: string;
    role: string;
  }>;
  lastMessage: null | {
    id: string;
    body: string;
    createdAt: string;
    deletedAt: string | null;
    senderId: string;
    senderName: string;
    attachmentCount: number;
  };
  unreadCount: string;
};

async function conversationsForUser(userId: string, conversationId?: string) {
  const values: unknown[] = [userId];
  const onlyConversation = conversationId ? "AND c.id = $2" : "";
  if (conversationId) values.push(conversationId);

  const result = await query<ConversationRow>(
    `SELECT c.id,
            c.kind,
            c.title,
            c.created_by AS "createdBy",
            c.created_at AS "createdAt",
            c.updated_at AS "updatedAt",
            self_member.muted,
            self_member.notification_mode AS "notificationMode",
            self_member.mute_until AS "muteUntil",
            c.avatar_storage_name AS "avatarStorageName",
            c.avatar_updated_at AS "avatarUpdatedAt",
            (self_member.pinned_at IS NOT NULL) AS pinned,
            self_member.manual_unread AS "manualUnread",
            (self_member.archived_at IS NOT NULL) AS archived,
            (c.direct_key = 'saved:' || $1) AS "isSaved",
            self_member.last_read_at AS "lastReadAt",
            jsonb_agg(
              jsonb_build_object(
                'id', u.id,
                'username', u.username,
                'displayName', u.display_name,
                'avatarColor', u.avatar_color,
                'avatarUrl', CASE
                  WHEN u.avatar_storage_name IS NULL THEN NULL
                  ELSE '/api/users/' || u.id || '/avatar?v=' || (extract(epoch FROM u.avatar_updated_at) * 1000)::bigint
                END,
                'lastSeenAt', u.last_seen_at,
                'role', cm.role
              ) ORDER BY u.display_name
            ) AS members,
            (
              SELECT jsonb_build_object(
                'id', lm.id,
                'body', CASE WHEN lm.deleted_at IS NULL THEN lm.body ELSE '' END,
                'createdAt', lm.created_at,
                'deletedAt', lm.deleted_at,
                'senderId', lm.sender_id,
                'senderName', lu.display_name,
                'attachmentCount', (SELECT count(*)::int FROM attachments la WHERE la.message_id = lm.id),
                'attachmentKind', (SELECT la.media_kind FROM attachments la WHERE la.message_id = lm.id ORDER BY la.created_at LIMIT 1)
              )
              FROM messages lm
              JOIN users lu ON lu.id = lm.sender_id
              WHERE lm.conversation_id = c.id
                AND lm.published_at IS NOT NULL
                AND (lm.expires_at IS NULL OR lm.expires_at > now())
                AND NOT EXISTS (
                  SELECT 1 FROM message_hidden_users hidden
                   WHERE hidden.message_id = lm.id AND hidden.user_id = $1
                )
              ORDER BY lm.created_at DESC
              LIMIT 1
            ) AS "lastMessage",
            (
              SELECT count(*)
              FROM messages unread
              WHERE unread.conversation_id = c.id
                AND unread.created_at > self_member.last_read_at
                AND unread.sender_id <> $1
                AND unread.deleted_at IS NULL
                AND unread.published_at IS NOT NULL
                AND (unread.expires_at IS NULL OR unread.expires_at > now())
                AND NOT EXISTS (
                  SELECT 1 FROM message_hidden_users hidden
                   WHERE hidden.message_id = unread.id AND hidden.user_id = $1
                )
            ) AS "unreadCount"
       FROM conversations c
       JOIN conversation_members self_member
         ON self_member.conversation_id = c.id AND self_member.user_id = $1
       JOIN conversation_members cm ON cm.conversation_id = c.id
       JOIN users u ON u.id = cm.user_id
      WHERE self_member.hidden_at IS NULL ${onlyConversation}
      GROUP BY c.id, self_member.muted, self_member.notification_mode, self_member.mute_until,
               self_member.pinned_at, self_member.manual_unread, self_member.archived_at,
               self_member.last_read_at
      ORDER BY self_member.pinned_at DESC NULLS LAST, c.updated_at DESC`,
    values
  );

  const online = new Set(onlineUserIds());
  return result.rows.map((row) => {
    const members = row.members.map((member) => ({ ...member, online: online.has(member.id) }));
    const other = members.find((member) => member.id !== userId);
    const muteExpired = row.notificationMode === "muted"
      && Boolean(row.muteUntil)
      && new Date(row.muteUntil!).getTime() <= Date.now();
    const { avatarStorageName, avatarUpdatedAt, lastReadAt: _lastReadAt, ...publicRow } = row;
    return {
      ...publicRow,
      title: row.kind === "direct" ? other?.displayName ?? "Сохранённые сообщения" : row.title,
      avatarColor: row.kind === "direct" ? other?.avatarColor ?? "#0f766e" : "#6d4aff",
      avatarUrl: row.kind === "direct"
        ? other?.avatarUrl ?? null
        : avatarStorageName && avatarUpdatedAt
          ? `/api/conversations/${row.id}/avatar?v=${new Date(avatarUpdatedAt).getTime()}`
          : null,
      notificationMode: muteExpired ? "all" as const : row.notificationMode,
      muteUntil: muteExpired ? null : row.muteUntil,
      muted: row.notificationMode === "muted" && !muteExpired,
      members,
      unreadCount: Math.max(Number(row.unreadCount), row.manualUnread ? 1 : 0)
    };
  });
}

app.get("/api/health", async (_request, response, next) => {
  try {
    await query("SELECT 1");
    response.json({ status: "ok" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/register", authLimiter, async (request, response, next) => {
  try {
    const input = registerSchema.parse(request.body);
    const userCount = await query<{ count: string }>("SELECT count(*) FROM users");
    if (Number(userCount.rows[0].count) >= config.maxUsers) {
      response.status(403).json({ error: "В рабочем пространстве достигнут лимит аккаунтов" });
      return;
    }
    const email = input.email.toLowerCase();
    const username = input.username.toLowerCase();
    const passwordHash = await hashPassword(input.password);
    const result = await query<{
      id: string;
      email: string;
      username: string;
      display_name: string;
      bio: string;
      avatar_color: string;
      avatar_storage_name: string | null;
      avatar_updated_at: Date | null;
      last_seen_at: Date;
      created_at: Date;
    }>(
      `INSERT INTO users (id, email, username, display_name, password_hash, avatar_color)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, username, display_name, bio, avatar_color,
                 avatar_storage_name, avatar_updated_at, last_seen_at, created_at`,
      [randomUUID(), email, username, input.displayName, passwordHash, randomAvatarColor()]
    );
    await createSession(result.rows[0].id, request, response);
    response.status(201).json({ user: publicUser(result.rows[0]) });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      response.status(409).json({ error: "Email или логин уже используются" });
      return;
    }
    next(error);
  }
});

app.post("/api/auth/login", authLimiter, async (request, response, next) => {
  try {
    const input = loginSchema.parse(request.body);
    const login = input.login.toLowerCase();
    const result = await query<{
      id: string;
      email: string;
      username: string;
      display_name: string;
      password_hash: string;
      bio: string;
      avatar_color: string;
      avatar_storage_name: string | null;
      avatar_updated_at: Date | null;
      last_seen_at: Date;
      created_at: Date;
    }>(
      `SELECT id, email, username, display_name, password_hash, bio, avatar_color,
              avatar_storage_name, avatar_updated_at, last_seen_at, created_at
         FROM users WHERE email = $1 OR username = $1`,
      [login]
    );
    const user = result.rows[0];
    const passwordValid = await verifyPassword(input.password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!user || !passwordValid) {
      response.status(401).json({ error: "Неверный логин или пароль" });
      return;
    }
    await createSession(user.id, request, response);
    response.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", requireAuth, async (request, response, next) => {
  try {
    await query("DELETE FROM sessions WHERE token_hash = $1", [authRequest(request).sessionHash]);
    clearSessionCookie(response);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", requireAuth, (request, response) => {
  response.json({ user: authRequest(request).user });
});

app.patch("/api/profile", requireAuth, async (request, response, next) => {
  try {
    const input = profileSchema.parse(request.body);
    const result = await query<{
      id: string;
      email: string;
      username: string;
      display_name: string;
      bio: string;
      avatar_color: string;
      avatar_storage_name: string | null;
      avatar_updated_at: Date | null;
      last_seen_at: Date;
      created_at: Date;
    }>(
      `UPDATE users SET display_name = $1, bio = $2 WHERE id = $3
       RETURNING id, email, username, display_name, bio, avatar_color,
                 avatar_storage_name, avatar_updated_at, last_seen_at, created_at`,
      [input.displayName, input.bio, authRequest(request).user.id]
    );
    const user = publicUser(result.rows[0]);
    await broadcastProfileUpdate(user);
    response.json({ user });
  } catch (error) {
    next(error);
  }
});

app.get("/api/users", requireAuth, async (request, response, next) => {
  try {
    const userId = authRequest(request).user.id;
    const search = String(request.query.search ?? "").trim().toLowerCase();
    const result = await query(
      `SELECT id, username, display_name AS "displayName", bio,
              avatar_color AS "avatarColor",
              CASE
                WHEN avatar_storage_name IS NULL THEN NULL
                ELSE '/api/users/' || id || '/avatar?v=' || (extract(epoch FROM avatar_updated_at) * 1000)::bigint
              END AS "avatarUrl",
              last_seen_at AS "lastSeenAt"
         FROM users
        WHERE id <> $1
          AND ($2 = '' OR username ILIKE '%' || $2 || '%' OR display_name ILIKE '%' || $2 || '%')
        ORDER BY display_name
        LIMIT 50`,
      [userId, search]
    );
    const online = new Set(onlineUserIds());
    response.json({ users: result.rows.map((user) => ({ ...user, online: online.has(user.id) })) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/conversations", requireAuth, async (request, response, next) => {
  try {
    response.json({ conversations: await conversationsForUser(authRequest(request).user.id) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/folders", requireAuth, async (request, response, next) => {
  try {
    const result = await query(
      `SELECT folder.id, folder.title,
              COALESCE(jsonb_agg(item.conversation_id ORDER BY item.added_at)
                FILTER (WHERE item.conversation_id IS NOT NULL), '[]'::jsonb) AS "conversationIds"
         FROM chat_folders folder
         LEFT JOIN chat_folder_items item ON item.folder_id = folder.id
        WHERE folder.user_id = $1
        GROUP BY folder.id
        ORDER BY folder.position, folder.created_at`,
      [authRequest(request).user.id]
    );
    response.json({ folders: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post("/api/folders", requireAuth, async (request, response, next) => {
  try {
    const { title } = folderSchema.parse(request.body);
    const result = await query(
      `INSERT INTO chat_folders (id, user_id, title, position)
       VALUES ($1, $2, $3, (SELECT count(*) FROM chat_folders WHERE user_id = $2))
       RETURNING id, title, '[]'::jsonb AS "conversationIds"`,
      [randomUUID(), authRequest(request).user.id, title]
    );
    response.status(201).json({ folder: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/folders/:folderId", requireAuth, async (request, response, next) => {
  try {
    const { title } = folderSchema.parse(request.body);
    const result = await query(
      "UPDATE chat_folders SET title = $1 WHERE id = $2 AND user_id = $3 RETURNING id, title",
      [title, routeParam(request, "folderId"), authRequest(request).user.id]
    );
    if (!result.rowCount) return void response.status(404).json({ error: "Папка не найдена" });
    response.json({ folder: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.put("/api/folders/:folderId/items", requireAuth, async (request, response, next) => {
  try {
    const { conversationIds } = folderItemsSchema.parse(request.body);
    const userId = authRequest(request).user.id;
    const folderId = routeParam(request, "folderId");
    const updated = await transaction(async (client) => {
      const folder = await client.query("SELECT 1 FROM chat_folders WHERE id = $1 AND user_id = $2", [folderId, userId]);
      if (!folder.rowCount) return false;
      const accessible = conversationIds.length ? await client.query<{ id: string }>(
        `SELECT conversation_id AS id FROM conversation_members
          WHERE user_id = $1 AND conversation_id = ANY($2::uuid[])`,
        [userId, conversationIds]
      ) : { rows: [] };
      if (accessible.rows.length !== conversationIds.length) throw new Error("FOLDER_CONVERSATION_NOT_FOUND");
      await client.query("DELETE FROM chat_folder_items WHERE folder_id = $1", [folderId]);
      if (conversationIds.length) {
        await client.query(
          `INSERT INTO chat_folder_items (folder_id, conversation_id)
           SELECT $1, unnest($2::uuid[])`,
          [folderId, conversationIds]
        );
      }
      return true;
    });
    if (!updated) return void response.status(404).json({ error: "Папка не найдена" });
    response.status(204).end();
  } catch (error) {
    if ((error as Error).message === "FOLDER_CONVERSATION_NOT_FOUND") {
      response.status(400).json({ error: "Один из чатов недоступен" });
      return;
    }
    next(error);
  }
});

app.delete("/api/folders/:folderId", requireAuth, async (request, response, next) => {
  try {
    const result = await query("DELETE FROM chat_folders WHERE id = $1 AND user_id = $2", [
      routeParam(request, "folderId"), authRequest(request).user.id
    ]);
    if (!result.rowCount) return void response.status(404).json({ error: "Папка не найдена" });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/conversations/saved", requireAuth, async (request, response, next) => {
  try {
    const userId = authRequest(request).user.id;
    const conversationId = await transaction(async (client) => {
      const created = await client.query<{ id: string }>(
        `INSERT INTO conversations (id, kind, direct_key, created_by)
         VALUES ($1, 'direct', $2, $3)
         ON CONFLICT (direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key
         RETURNING id`,
        [randomUUID(), `saved:${userId}`, userId]
      );
      await client.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
        [created.rows[0].id, userId]
      );
      return created.rows[0].id;
    });
    const [conversation] = await conversationsForUser(userId, conversationId);
    response.status(201).json({ conversation });
  } catch (error) {
    next(error);
  }
});

app.post("/api/conversations/direct", requireAuth, async (request, response, next) => {
  try {
    const { userId: otherUserId } = directSchema.parse(request.body);
    const userId = authRequest(request).user.id;
    if (otherUserId === userId) {
      response.status(400).json({ error: "Нельзя создать диалог с самим собой" });
      return;
    }
    const otherExists = await query("SELECT 1 FROM users WHERE id = $1", [otherUserId]);
    if (!otherExists.rowCount) {
      response.status(404).json({ error: "Пользователь не найден" });
      return;
    }

    const directKey = [userId, otherUserId].sort().join(":");
    const conversationId = await transaction(async (client) => {
      const created = await client.query<{ id: string }>(
        `INSERT INTO conversations (id, kind, direct_key, created_by)
         VALUES ($1, 'direct', $2, $3)
         ON CONFLICT (direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key
         RETURNING id`,
        [randomUUID(), directKey, userId]
      );
      const id = created.rows[0].id;
      await client.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, 'owner'), ($1, $3, 'member')
         ON CONFLICT DO NOTHING`,
        [id, userId, otherUserId]
      );
      await client.query(
        "UPDATE conversation_members SET hidden_at = NULL WHERE conversation_id = $1 AND user_id = $2",
        [id, userId]
      );
      return id;
    });

    joinUserToConversation(userId, conversationId);
    joinUserToConversation(otherUserId, conversationId);
    const [conversation] = await conversationsForUser(userId, conversationId);
    emitToUser(otherUserId, "conversation:new", { conversationId });
    response.status(201).json({ conversation });
  } catch (error) {
    next(error);
  }
});

app.post("/api/conversations/group", requireAuth, async (request, response, next) => {
  try {
    const input = groupSchema.parse(request.body);
    const userId = authRequest(request).user.id;
    const memberIds = [...new Set([userId, ...input.memberIds])];
    if (memberIds.length > 100) {
      response.status(400).json({ error: "В группе может быть не более 100 участников" });
      return;
    }
    const validUsers = await query<{ id: string }>("SELECT id FROM users WHERE id = ANY($1::uuid[])", [memberIds]);
    if (validUsers.rows.length !== memberIds.length) {
      response.status(400).json({ error: "Один из участников не найден" });
      return;
    }

    const conversationId = randomUUID();
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO conversations (id, kind, title, created_by) VALUES ($1, 'group', $2, $3)`,
        [conversationId, input.title, userId]
      );
      for (const memberId of memberIds) {
        await client.query(
          `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, $3)`,
          [conversationId, memberId, memberId === userId ? "owner" : "member"]
        );
      }
    });

    memberIds.forEach((memberId) => {
      joinUserToConversation(memberId, conversationId);
      if (memberId !== userId) emitToUser(memberId, "conversation:new", { conversationId });
    });
    const [conversation] = await conversationsForUser(userId, conversationId);
    response.status(201).json({ conversation });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/conversations/:conversationId/group", requireAuth, async (request, response, next) => {
  try {
    const conversationId = routeParam(request, "conversationId");
    const userId = authRequest(request).user.id;
    const { title } = groupTitleSchema.parse(request.body);
    const membership = await getConversationMembership(conversationId, userId);
    if (!membership || membership.kind !== "group") {
      response.status(404).json({ error: "Группа не найдена" });
      return;
    }
    if (!['owner', 'admin'].includes(membership.role)) {
      response.status(403).json({ error: "Изменять группу могут только администраторы" });
      return;
    }
    await query("UPDATE conversations SET title = $1, updated_at = now() WHERE id = $2", [title, conversationId]);
    emitToConversation(conversationId, "conversation:updated", { conversationId });
    const [conversation] = await conversationsForUser(userId, conversationId);
    response.json({ conversation });
  } catch (error) {
    next(error);
  }
});

app.post("/api/conversations/:conversationId/members", requireAuth, async (request, response, next) => {
  try {
    const conversationId = routeParam(request, "conversationId");
    const userId = authRequest(request).user.id;
    const { userIds } = groupMembersSchema.parse(request.body);
    const membership = await getConversationMembership(conversationId, userId);
    if (!membership || membership.kind !== "group") {
      response.status(404).json({ error: "Группа не найдена" });
      return;
    }
    if (!['owner', 'admin'].includes(membership.role)) {
      response.status(403).json({ error: "Добавлять участников могут только администраторы" });
      return;
    }
    const uniqueIds = [...new Set(userIds)].filter((id) => id !== userId);
    const countResult = await query<{ count: string }>(
      "SELECT count(*) FROM conversation_members WHERE conversation_id = $1",
      [conversationId]
    );
    const alreadyMembers = await query<{ user_id: string }>(
      "SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id = ANY($2::uuid[])",
      [conversationId, uniqueIds]
    );
    if (Number(countResult.rows[0].count) + uniqueIds.length - alreadyMembers.rows.length > 100) {
      response.status(400).json({ error: "В группе может быть не более 100 участников" });
      return;
    }
    const valid = await query<{ id: string }>("SELECT id FROM users WHERE id = ANY($1::uuid[])", [uniqueIds]);
    if (valid.rows.length !== uniqueIds.length) {
      response.status(400).json({ error: "Один из пользователей не найден" });
      return;
    }
    const added = await query<{ user_id: string }>(
      `INSERT INTO conversation_members (conversation_id, user_id, role)
       SELECT $1, unnest($2::uuid[]), 'member'
       ON CONFLICT (conversation_id, user_id) DO UPDATE SET hidden_at = NULL
       RETURNING user_id`,
      [conversationId, uniqueIds]
    );
    added.rows.forEach(({ user_id }) => {
      joinUserToConversation(user_id, conversationId);
      emitToUser(user_id, "conversation:new", { conversationId });
    });
    emitToConversation(conversationId, "conversation:updated", { conversationId });
    const [conversation] = await conversationsForUser(userId, conversationId);
    response.status(201).json({ conversation });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/conversations/:conversationId/members/:userId", requireAuth, async (request, response, next) => {
  try {
    const conversationId = routeParam(request, "conversationId");
    const actorId = authRequest(request).user.id;
    const targetId = routeParam(request, "userId");
    const membership = await getConversationMembership(conversationId, actorId);
    if (!membership || membership.kind !== "group") {
      response.status(404).json({ error: "Группа не найдена" });
      return;
    }
    if (!['owner', 'admin'].includes(membership.role)) {
      response.status(403).json({ error: "Удалять участников могут только администраторы" });
      return;
    }
    if (actorId === targetId) {
      response.status(400).json({ error: "Для выхода из группы используйте действие «Выйти»" });
      return;
    }
    const target = await query<{ role: "owner" | "admin" | "member" }>(
      "SELECT role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2",
      [conversationId, targetId]
    );
    const targetRole = target.rows[0]?.role;
    if (!targetRole) {
      response.status(404).json({ error: "Участник не найден" });
      return;
    }
    if (targetRole === "owner" || (membership.role === "admin" && targetRole === "admin")) {
      response.status(403).json({ error: "Недостаточно прав для удаления этого участника" });
      return;
    }
    await query("DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2", [conversationId, targetId]);
    emitToUser(targetId, "conversation:removed", { conversationId });
    leaveUserFromConversation(targetId, conversationId);
    emitToConversation(conversationId, "conversation:updated", { conversationId });
    const [conversation] = await conversationsForUser(actorId, conversationId);
    response.json({ conversation });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/conversations/:conversationId/members/:userId/role", requireAuth, async (request, response, next) => {
  try {
    const conversationId = routeParam(request, "conversationId");
    const actorId = authRequest(request).user.id;
    const targetId = routeParam(request, "userId");
    const { role } = groupRoleSchema.parse(request.body);
    const membership = await getConversationMembership(conversationId, actorId);
    if (!membership || membership.kind !== "group") {
      response.status(404).json({ error: "Группа не найдена" });
      return;
    }
    if (membership.role !== "owner") {
      response.status(403).json({ error: "Назначать администраторов может только владелец" });
      return;
    }
    const updated = await query(
      `UPDATE conversation_members SET role = $3
        WHERE conversation_id = $1 AND user_id = $2 AND role <> 'owner'`,
      [conversationId, targetId, role]
    );
    if (!updated.rowCount) {
      response.status(404).json({ error: "Участник не найден или является владельцем" });
      return;
    }
    emitToConversation(conversationId, "conversation:updated", { conversationId });
    const [conversation] = await conversationsForUser(actorId, conversationId);
    response.json({ conversation });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/conversations/:conversationId/notifications", requireAuth, async (request, response, next) => {
  try {
    const conversationId = routeParam(request, "conversationId");
    const userId = authRequest(request).user.id;
    const { mode, muteUntil } = notificationSchema.parse(request.body);
    if (mode === "muted" && muteUntil && new Date(muteUntil).getTime() <= Date.now()) {
      response.status(400).json({ error: "Время отключения уведомлений уже прошло" });
      return;
    }
    const result = await query(
      `UPDATE conversation_members
          SET notification_mode = $3::varchar,
              mute_until = CASE WHEN $3::varchar = 'muted' THEN $4::timestamptz ELSE NULL END,
              muted = ($3::varchar <> 'all')
        WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId, mode, muteUntil ?? null]
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Чат не найден" });
      return;
    }
    const [conversation] = await conversationsForUser(userId, conversationId);
    response.json({ conversation });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/conversations/:conversationId/pin", requireAuth, async (request, response, next) => {
  try {
    const conversationId = routeParam(request, "conversationId");
    const userId = authRequest(request).user.id;
    const { pinned } = pinConversationSchema.parse(request.body);
    const result = await query(
      `UPDATE conversation_members
          SET pinned_at = CASE WHEN $3 THEN now() ELSE NULL END,
              hidden_at = NULL
        WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId, pinned]
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Чат не найден" });
      return;
    }
    emitToUser(userId, "conversation:pinned", { conversationId, pinned });
    response.json({ pinned });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/conversations/:conversationId/archive", requireAuth, async (request, response, next) => {
  try {
    const conversationId = routeParam(request, "conversationId");
    const userId = authRequest(request).user.id;
    const { archived } = archiveConversationSchema.parse(request.body);
    const result = await query(
      `UPDATE conversation_members
          SET archived_at = CASE WHEN $3 THEN now() ELSE NULL END,
              pinned_at = CASE WHEN $3 THEN NULL ELSE pinned_at END
        WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId, archived]
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Чат не найден" });
      return;
    }
    emitToUser(userId, "conversation:archived", { conversationId, archived });
    response.json({ archived });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/conversations/:conversationId", requireAuth, async (request, response, next) => {
  try {
    const conversationId = routeParam(request, "conversationId");
    const userId = authRequest(request).user.id;
    const membership = await query<{ kind: "direct" | "group"; role: string }>(
      `SELECT c.kind, cm.role
         FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id = c.id
        WHERE c.id = $1 AND cm.user_id = $2`,
      [conversationId, userId]
    );
    const item = membership.rows[0];
    if (!item) {
      response.status(404).json({ error: "Чат не найден" });
      return;
    }

    if (item.kind === "direct") {
      await query(
        `UPDATE conversation_members
            SET hidden_at = now(), pinned_at = NULL, last_read_at = now()
          WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, userId]
      );
      emitToUser(userId, "conversation:removed", { conversationId });
      response.status(204).end();
      return;
    }

    if (item.role !== "owner") {
      response.status(403).json({ error: "Удалить группу может только владелец" });
      return;
    }

    const files = await query<{ storage_name: string }>(
      `SELECT DISTINCT a.storage_name
         FROM attachments a
         JOIN messages m ON m.id = a.message_id
        WHERE m.conversation_id = $1
       UNION
       SELECT avatar_storage_name AS storage_name
         FROM conversations
        WHERE id = $1 AND avatar_storage_name IS NOT NULL`,
      [conversationId]
    );
    emitToConversation(conversationId, "conversation:removed", { conversationId });
    await query("DELETE FROM conversations WHERE id = $1", [conversationId]);
    for (const { storage_name } of files.rows) {
      const stillUsed = await query("SELECT 1 FROM attachments WHERE storage_name = $1 LIMIT 1", [storage_name]);
      if (!stillUsed.rowCount) {
        await fs.unlink(path.join(config.dataDir, "uploads", storage_name)).catch(() => undefined);
      }
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/conversations/:conversationId/leave", requireAuth, async (request, response, next) => {
  try {
    const conversationId = routeParam(request, "conversationId");
    const userId = authRequest(request).user.id;
    const result = await query(
      `DELETE FROM conversation_members cm
        USING conversations c
        WHERE cm.conversation_id = c.id
          AND cm.conversation_id = $1
          AND cm.user_id = $2
          AND c.kind = 'group'
          AND cm.role <> 'owner'`,
      [conversationId, userId]
    );
    if (!result.rowCount) {
      response.status(403).json({ error: "Владелец должен удалить группу целиком" });
      return;
    }
    emitToUser(userId, "conversation:removed", { conversationId });
    leaveUserFromConversation(userId, conversationId);
    emitToConversation(conversationId, "conversation:updated", { conversationId });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/conversations/:conversationId/messages", requireAuth, async (request, response, next) => {
  try {
    const conversationId = routeParam(request, "conversationId");
    const userId = authRequest(request).user.id;
    if (!(await isMember(conversationId, userId))) {
      response.status(404).json({ error: "Чат не найден" });
      return;
    }
    const before = typeof request.query.before === "string" ? request.query.before : undefined;
    const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 50));
    const messages = await getConversationMessages(conversationId, userId, before, limit);
    response.json({ messages, hasMore: messages.length === limit });
  } catch (error) {
    next(error);
  }
});

app.get("/api/messages/search", requireAuth, async (request, response, next) => {
  try {
    const input = messageSearchSchema.parse(request.query);
    const userId = authRequest(request).user.id;
    const found = await searchMessages(userId, {
      query: input.q,
      conversationId: input.conversationId,
      senderId: input.senderId,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      type: input.type,
      limit: input.limit
    });
    const conversations = await conversationsForUser(userId);
    const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));
    response.json({
      results: found.flatMap((message) => {
        const conversation = byId.get(message.conversationId);
        return conversation ? [{ message, conversation }] : [];
      })
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/messages/:messageId/context", requireAuth, async (request, response, next) => {
  try {
    const context = await getMessageContext(routeParam(request, "messageId"), authRequest(request).user.id);
    if (!context) {
      response.status(404).json({ error: "Сообщение не найдено" });
      return;
    }
    response.json(context);
  } catch (error) {
    next(error);
  }
});

app.get("/api/conversations/:conversationId/pins", requireAuth, async (request, response, next) => {
  try {
    const conversationId = routeParam(request, "conversationId");
    const userId = authRequest(request).user.id;
    if (!(await isMember(conversationId, userId))) {
      response.status(404).json({ error: "Чат не найден" });
      return;
    }
    response.json({ messages: await getPinnedMessages(conversationId, userId) });
  } catch (error) {
    next(error);
  }
});

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(config.dataDir, "uploads"),
    filename: (_request, file, callback) => {
      const safeExtension = path.extname(file.originalname).slice(0, 12).replace(/[^.a-zA-Z0-9]/g, "");
      callback(null, `${randomUUID()}${safeExtension}`);
    }
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 5 }
});

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: path.join(config.dataDir, "uploads"),
    filename: (_request, _file, callback) => callback(null, `avatar-${randomUUID()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

async function detectAvatarMime(filePath: string) {
  const handle = await fs.open(filePath, "r");
  try {
    const signature = Buffer.alloc(16);
    await handle.read(signature, 0, signature.length, 0);
    if (signature.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff) return "image/jpeg";
    if (signature.subarray(0, 4).toString("ascii") === "RIFF" && signature.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
    if (["GIF87a", "GIF89a"].includes(signature.subarray(0, 6).toString("ascii"))) return "image/gif";
    return null;
  } finally {
    await handle.close();
  }
}

function normalizeUploadName(value: string) {
  const decoded = Buffer.from(value, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? value : decoded;
}

app.get("/api/conversations/:conversationId/avatar", requireAuth, async (request, response, next) => {
  try {
    const conversationId = routeParam(request, "conversationId");
    const userId = authRequest(request).user.id;
    if (!(await isMember(conversationId, userId))) {
      response.status(404).end();
      return;
    }
    const result = await query<{ avatar_storage_name: string | null; avatar_mime_type: string | null }>(
      "SELECT avatar_storage_name, avatar_mime_type FROM conversations WHERE id = $1 AND kind = 'group'",
      [conversationId]
    );
    const avatar = result.rows[0];
    if (!avatar?.avatar_storage_name || !avatar.avatar_mime_type) {
      response.status(404).end();
      return;
    }
    response.type(avatar.avatar_mime_type);
    response.setHeader("Cache-Control", "private, no-store");
    response.sendFile(path.join(config.dataDir, "uploads", avatar.avatar_storage_name));
  } catch (error) {
    next(error);
  }
});

app.post("/api/conversations/:conversationId/avatar", requireAuth, avatarUpload.single("avatar"), async (request, response, next) => {
  const file = request.file;
  try {
    const conversationId = routeParam(request, "conversationId");
    const userId = authRequest(request).user.id;
    const membership = await getConversationMembership(conversationId, userId);
    if (!membership || membership.kind !== "group") {
      if (file) await fs.unlink(file.path).catch(() => undefined);
      response.status(404).json({ error: "Группа не найдена" });
      return;
    }
    if (!['owner', 'admin'].includes(membership.role)) {
      if (file) await fs.unlink(file.path).catch(() => undefined);
      response.status(403).json({ error: "Изменять аватар могут только администраторы" });
      return;
    }
    if (!file) {
      response.status(400).json({ error: "Выберите изображение" });
      return;
    }
    const mimeType = await detectAvatarMime(file.path);
    if (!mimeType) {
      await fs.unlink(file.path).catch(() => undefined);
      response.status(415).json({ error: "Поддерживаются PNG, JPEG, WebP и GIF" });
      return;
    }
    const previous = await query<{ avatar_storage_name: string | null }>(
      `WITH previous AS (
         SELECT avatar_storage_name FROM conversations WHERE id = $3
       ), updated AS (
         UPDATE conversations
            SET avatar_storage_name = $1, avatar_mime_type = $2, avatar_updated_at = now(), updated_at = now()
          WHERE id = $3
          RETURNING id
       )
       SELECT previous.avatar_storage_name FROM previous CROSS JOIN updated`,
      [file.filename, mimeType, conversationId]
    );
    const previousName = previous.rows[0]?.avatar_storage_name;
    if (previousName && previousName !== file.filename) {
      await fs.unlink(path.join(config.dataDir, "uploads", previousName)).catch(() => undefined);
    }
    emitToConversation(conversationId, "conversation:updated", { conversationId });
    const [conversation] = await conversationsForUser(userId, conversationId);
    response.status(201).json({ conversation });
  } catch (error) {
    if (file) await fs.unlink(file.path).catch(() => undefined);
    next(error);
  }
});

app.delete("/api/conversations/:conversationId/avatar", requireAuth, async (request, response, next) => {
  try {
    const conversationId = routeParam(request, "conversationId");
    const userId = authRequest(request).user.id;
    const membership = await getConversationMembership(conversationId, userId);
    if (!membership || membership.kind !== "group") {
      response.status(404).json({ error: "Группа не найдена" });
      return;
    }
    if (!['owner', 'admin'].includes(membership.role)) {
      response.status(403).json({ error: "Изменять аватар могут только администраторы" });
      return;
    }
    const result = await query<{ avatar_storage_name: string | null }>(
      `WITH previous AS (
         SELECT avatar_storage_name FROM conversations WHERE id = $1
       ), updated AS (
         UPDATE conversations
            SET avatar_storage_name = NULL, avatar_mime_type = NULL, avatar_updated_at = now(), updated_at = now()
          WHERE id = $1
          RETURNING id
       )
       SELECT previous.avatar_storage_name FROM previous CROSS JOIN updated`,
      [conversationId]
    );
    const previousName = result.rows[0]?.avatar_storage_name;
    if (previousName) await fs.unlink(path.join(config.dataDir, "uploads", previousName)).catch(() => undefined);
    emitToConversation(conversationId, "conversation:updated", { conversationId });
    const [conversation] = await conversationsForUser(userId, conversationId);
    response.json({ conversation });
  } catch (error) {
    next(error);
  }
});

app.get("/api/users/:userId/avatar", requireAuth, async (request, response, next) => {
  try {
    const result = await query<{ avatar_storage_name: string | null; avatar_mime_type: string | null }>(
      "SELECT avatar_storage_name, avatar_mime_type FROM users WHERE id = $1",
      [routeParam(request, "userId")]
    );
    const avatar = result.rows[0];
    if (!avatar?.avatar_storage_name || !avatar.avatar_mime_type) {
      response.status(404).end();
      return;
    }
    response.type(avatar.avatar_mime_type);
    response.setHeader("Cache-Control", "private, no-store");
    response.sendFile(path.join(config.dataDir, "uploads", avatar.avatar_storage_name));
  } catch (error) {
    next(error);
  }
});

app.post("/api/profile/avatar", requireAuth, avatarUpload.single("avatar"), async (request, response, next) => {
  const file = request.file;
  try {
    if (!file) {
      response.status(400).json({ error: "Выберите изображение" });
      return;
    }
    const mimeType = await detectAvatarMime(file.path);
    if (!mimeType) {
      await fs.unlink(file.path).catch(() => undefined);
      response.status(415).json({ error: "Поддерживаются PNG, JPEG, WebP и GIF" });
      return;
    }
    const result = await query<{
      id: string;
      email: string;
      username: string;
      display_name: string;
      bio: string;
      avatar_color: string;
      avatar_storage_name: string | null;
      avatar_updated_at: Date | null;
      last_seen_at: Date;
      created_at: Date;
      previous_avatar_storage_name: string | null;
    }>(
      `WITH previous AS (
         SELECT avatar_storage_name FROM users WHERE id = $3
       ), updated AS (
         UPDATE users
            SET avatar_storage_name = $1,
                avatar_mime_type = $2,
                avatar_updated_at = now()
          WHERE id = $3
          RETURNING id, email, username, display_name, bio, avatar_color,
                    avatar_storage_name, avatar_updated_at, last_seen_at, created_at
       )
       SELECT updated.*, previous.avatar_storage_name AS previous_avatar_storage_name
         FROM updated CROSS JOIN previous`,
      [file.filename, mimeType, authRequest(request).user.id]
    );
    const row = result.rows[0];
    if (row.previous_avatar_storage_name && row.previous_avatar_storage_name !== file.filename) {
      await fs.unlink(path.join(config.dataDir, "uploads", row.previous_avatar_storage_name)).catch(() => undefined);
    }
    const user = publicUser(row);
    await broadcastProfileUpdate(user);
    response.status(201).json({ user });
  } catch (error) {
    if (file) await fs.unlink(file.path).catch(() => undefined);
    next(error);
  }
});

app.delete("/api/profile/avatar", requireAuth, async (request, response, next) => {
  try {
    const result = await query<{
      id: string;
      email: string;
      username: string;
      display_name: string;
      bio: string;
      avatar_color: string;
      avatar_storage_name: string | null;
      avatar_updated_at: Date | null;
      last_seen_at: Date;
      created_at: Date;
      previous_avatar_storage_name: string | null;
    }>(
      `WITH previous AS (
         SELECT avatar_storage_name FROM users WHERE id = $1
       )
       UPDATE users
          SET avatar_storage_name = NULL,
              avatar_mime_type = NULL,
              avatar_updated_at = now()
        WHERE id = $1
        RETURNING id, email, username, display_name, bio, avatar_color,
                  avatar_storage_name, avatar_updated_at, last_seen_at, created_at,
                  (SELECT avatar_storage_name FROM previous) AS previous_avatar_storage_name`,
      [authRequest(request).user.id]
    );
    const row = result.rows[0];
    if (row.previous_avatar_storage_name) {
      await fs.unlink(path.join(config.dataDir, "uploads", row.previous_avatar_storage_name)).catch(() => undefined);
    }
    const user = publicUser(row);
    await broadcastProfileUpdate(user);
    response.json({ user });
  } catch (error) {
    next(error);
  }
});

app.post("/api/uploads", requireAuth, upload.array("files", 5), async (request, response, next) => {
  try {
    const files = (request.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) {
      response.status(400).json({ error: "Файл не выбран" });
      return;
    }
    const parsedMetadata = uploadMetadataSchema.safeParse(request.body);
    if (!parsedMetadata.success) {
      await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)));
      response.status(400).json({ error: "Некорректные параметры медиасообщения" });
      return;
    }
    const metadata = parsedMetadata.data;
    const durationMs = metadata.mediaKind === "file" ? null : metadata.durationMs ?? null;
    if (metadata.mediaKind !== "file" && files.length !== 1) {
      await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)));
      response.status(400).json({ error: "Медиасообщение должно содержать одну запись" });
      return;
    }
    const recordedFile = files[0];
    if (metadata.mediaKind !== "file" && durationMs === null) {
      await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)));
      response.status(415).json({ error: "Некорректный формат медиасообщения" });
      return;
    }
    if (metadata.mediaKind === "video_circle" && (durationMs ?? 0) > 60_000) {
      await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)));
      response.status(400).json({ error: "Кружок не может быть длиннее 60 секунд" });
      return;
    }
    const hasBlockedMime = files.some((file) =>
      /^(text\/html|image\/svg\+xml|application\/(javascript|xhtml\+xml|xml))$/i.test(file.mimetype)
    );
    if (hasBlockedMime) {
      await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)));
      response.status(415).json({ error: "Этот тип файла запрещён из соображений безопасности" });
      return;
    }
    const storage = await query<{ bytes: string }>(
      "SELECT COALESCE(sum(size_bytes), 0)::text AS bytes FROM attachments WHERE uploaded_by = $1",
      [authRequest(request).user.id]
    );
    const incomingBytes = files.reduce((total, file) => total + file.size, 0);
    const quotaBytes = config.maxUserStorageMb * 1024 * 1024;
    if (Number(storage.rows[0]?.bytes ?? 0) + incomingBytes > quotaBytes) {
      await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)));
      response.status(413).json({ error: `Личная квота файлов ${config.maxUserStorageMb} МБ исчерпана` });
      return;
    }
    const uploaded = [];

    for (const file of files) {
      const id = randomUUID();
      const storageName = file.filename;
      const originalName = normalizeUploadName(file.originalname);
      const mimeType = metadata.mediaKind === "voice"
        ? (file.mimetype.startsWith("audio/") ? file.mimetype : "audio/webm")
        : metadata.mediaKind === "video_circle"
          ? (file.mimetype.startsWith("video/") ? file.mimetype : "video/webm")
          : file.mimetype;
      if (metadata.mediaKind !== "file" && mimeType !== file.mimetype) {
        console.warn("Normalized recorded-media MIME type", {
          mediaKind: metadata.mediaKind,
          received: file.mimetype,
          normalized: mimeType
        });
      }
      try {
        await query(
          `INSERT INTO attachments (
             id, uploaded_by, storage_name, original_name, mime_type, size_bytes, media_kind, duration_ms
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            authRequest(request).user.id,
            storageName,
            originalName.slice(0, 255),
            mimeType.slice(0, 150),
            file.size,
            metadata.mediaKind,
            durationMs
          ]
        );
      } catch (error) {
        await fs.unlink(file.path).catch(() => undefined);
        throw error;
      }
      uploaded.push({
        id,
        name: originalName,
        mimeType,
        size: file.size,
        url: `/api/files/${id}`,
        kind: metadata.mediaKind,
        durationMs
      });
    }
    response.status(201).json({ attachments: uploaded });
  } catch (error) {
    next(error);
  }
});

app.get("/api/files/:attachmentId", requireAuth, async (request, response, next) => {
  try {
    const result = await query<{
      storage_name: string;
      original_name: string;
      mime_type: string;
      uploaded_by: string;
      message_id: string | null;
      conversation_id: string | null;
      sender_id: string | null;
      view_once: boolean | null;
      view_allowed: boolean;
    }>(
      `SELECT a.storage_name, a.original_name, a.mime_type, a.uploaded_by, a.message_id,
              m.conversation_id, m.sender_id, m.view_once,
              EXISTS (
                SELECT 1 FROM message_views viewed
                 WHERE viewed.message_id = m.id AND viewed.user_id = $2
                   AND viewed.viewed_at > now() - interval '10 minutes'
              ) AS view_allowed
         FROM attachments a
         LEFT JOIN messages m ON m.id = a.message_id
        WHERE a.id = $1
          AND (m.id IS NULL OR (m.deleted_at IS NULL AND m.published_at IS NOT NULL
            AND (m.expires_at IS NULL OR m.expires_at > now())))`,
      [request.params.attachmentId, authRequest(request).user.id]
    );
    const file = result.rows[0];
    const userId = authRequest(request).user.id;
    const allowed =
      file &&
      ((file.message_id === null && file.uploaded_by === userId) ||
        (file.conversation_id && (await isMember(file.conversation_id, userId))
          && (!file.view_once || file.sender_id === userId || file.view_allowed)));
    if (!allowed) {
      response.status(404).json({ error: "Файл не найден" });
      return;
    }
    response.type(file.mime_type);
    response.setHeader("Cache-Control", "private, no-store");
    const safeInline = /^(image\/(png|jpe?g|gif|webp)|video\/(mp4|webm)|audio\/(mpeg|ogg|wav|webm))$/i.test(file.mime_type);
    if (!safeInline) {
      response.type("application/octet-stream");
      response.attachment(file.original_name);
    }
    response.sendFile(path.join(config.dataDir, "uploads", file.storage_name));
  } catch (error) {
    next(error);
  }
});

app.post("/api/conversations/:conversationId/messages", requireAuth, async (request, response, next) => {
  try {
    const input = messageSchema.parse(request.body);
    const conversationId = routeParam(request, "conversationId");
    const user = authRequest(request).user;
    if (!(await isMember(conversationId, user.id))) {
      response.status(404).json({ error: "Чат не найден" });
      return;
    }

    const message = await transaction(async (client) => {
      if (input.replyToId) {
        const reply = await client.query(
          "SELECT 1 FROM messages WHERE id = $1 AND conversation_id = $2",
          [input.replyToId, conversationId]
        );
        if (!reply.rowCount) throw new Error("REPLY_NOT_FOUND");
      }
      const scheduleAt = input.scheduleAt ? new Date(input.scheduleAt) : null;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO messages (
           id, conversation_id, sender_id, body, reply_to_id, client_id,
           silent, scheduled_at, published_at, expire_seconds, expires_at, view_once, created_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, CASE WHEN $8::timestamptz IS NULL THEN now() ELSE NULL END,
           $9, CASE WHEN $8::timestamptz IS NULL AND $9::integer IS NOT NULL THEN now() + make_interval(secs => $9) ELSE NULL END,
           $10, COALESCE($8::timestamptz, now())
         )
         ON CONFLICT (sender_id, client_id) DO UPDATE SET body = messages.body
         RETURNING id`,
        [
          randomUUID(), conversationId, user.id, input.body, input.replyToId ?? null, input.clientId,
          input.silent, scheduleAt, input.expireSeconds ?? null, input.viewOnce
        ]
      );
      const messageId = inserted.rows[0].id;
      if (input.attachmentIds.length) {
        const attached = await client.query(
          `UPDATE attachments SET message_id = $1
            WHERE id = ANY($2::uuid[]) AND uploaded_by = $3
              AND (message_id IS NULL OR message_id = $1)
            RETURNING id`,
          [messageId, input.attachmentIds, user.id]
        );
        if (attached.rows.length !== input.attachmentIds.length) throw new Error("ATTACHMENT_NOT_FOUND");
      }
      if (!scheduleAt) {
        await client.query("UPDATE conversations SET updated_at = now() WHERE id = $1", [conversationId]);
      }
      await client.query(
        "UPDATE conversation_members SET hidden_at = NULL, archived_at = NULL WHERE conversation_id = $1",
        [conversationId]
      );
      return getMessage(messageId, client);
    });

    if (message.publishedAt) await broadcastPublishedMessage(message);
    else emitToUser(user.id, "message:updated", message);
    response.status(201).json({ message });
  } catch (error) {
    if ((error as Error).message === "REPLY_NOT_FOUND") {
      response.status(400).json({ error: "Исходное сообщение не найдено" });
      return;
    }
    if ((error as Error).message === "ATTACHMENT_NOT_FOUND") {
      response.status(400).json({ error: "Одно из вложений недоступно" });
      return;
    }
    next(error);
  }
});

app.post("/api/messages/:messageId/forward", requireAuth, async (request, response, next) => {
  try {
    const sourceMessageId = routeParam(request, "messageId");
    const { targetConversationId } = forwardMessageSchema.parse(request.body);
    const user = authRequest(request).user;

    const message = await transaction(async (client) => {
      const source = await client.query<{
        body: string;
        conversation_id: string;
        deleted_at: Date | null;
      }>(
        `SELECT m.body, m.conversation_id, m.deleted_at
           FROM messages m
           JOIN conversation_members source_member
             ON source_member.conversation_id = m.conversation_id AND source_member.user_id = $2
          WHERE m.id = $1`,
        [sourceMessageId, user.id]
      );
      const sourceMessage = source.rows[0];
      if (!sourceMessage || sourceMessage.deleted_at) throw new Error("FORWARD_SOURCE_NOT_FOUND");

      const targetMembership = await client.query(
        "SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2",
        [targetConversationId, user.id]
      );
      if (!targetMembership.rowCount) throw new Error("FORWARD_TARGET_NOT_FOUND");

      const sourceAttachments = await client.query<{
        storage_name: string;
        original_name: string;
        mime_type: string;
        size_bytes: number;
        media_kind: "file" | "voice" | "video_circle";
        duration_ms: number | null;
      }>(
        `SELECT storage_name, original_name, mime_type, size_bytes, media_kind, duration_ms
           FROM attachments
          WHERE message_id = $1
          ORDER BY created_at`,
        [sourceMessageId]
      );

      const forwardedId = randomUUID();
      await client.query(
        `INSERT INTO messages (id, conversation_id, sender_id, body, client_id, forwarded_from_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [forwardedId, targetConversationId, user.id, sourceMessage.body, randomUUID(), sourceMessageId]
      );
      for (const attachment of sourceAttachments.rows) {
        await client.query(
          `INSERT INTO attachments (
             id, message_id, uploaded_by, storage_name, original_name, mime_type,
             size_bytes, media_kind, duration_ms
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            randomUUID(), forwardedId, user.id, attachment.storage_name, attachment.original_name,
            attachment.mime_type, attachment.size_bytes, attachment.media_kind, attachment.duration_ms
          ]
        );
      }
      await client.query("UPDATE conversations SET updated_at = now() WHERE id = $1", [targetConversationId]);
      await client.query(
        "UPDATE conversation_members SET hidden_at = NULL, archived_at = NULL WHERE conversation_id = $1",
        [targetConversationId]
      );
      return getMessage(forwardedId, client);
    });

    emitToConversation(targetConversationId, "message:new", message);
    emitToConversation(targetConversationId, "conversation:updated", { conversationId: targetConversationId });
    const [conversation] = await conversationsForUser(user.id, targetConversationId);
    const firstAttachment = message.attachments?.[0] as { kind?: string } | undefined;
    const notificationBody = message.body || (
      firstAttachment?.kind === "voice" ? "Голосовое сообщение"
        : firstAttachment?.kind === "video_circle" ? "Видеосообщение"
          : "Вложение"
    );
    void sendMessagePush({
      conversationId: targetConversationId,
      senderId: user.id,
      senderName: user.displayName,
      title: conversation?.kind === "group" ? conversation.title ?? "Группа" : user.displayName,
      body: `Переслано: ${notificationBody}`
    });
    response.status(201).json({ message });
  } catch (error) {
    if ((error as Error).message === "FORWARD_SOURCE_NOT_FOUND") {
      response.status(404).json({ error: "Сообщение для пересылки не найдено" });
      return;
    }
    if ((error as Error).message === "FORWARD_TARGET_NOT_FOUND") {
      response.status(404).json({ error: "Чат для пересылки не найден" });
      return;
    }
    next(error);
  }
});

app.patch("/api/messages/:messageId", requireAuth, async (request, response, next) => {
  try {
    const input = editMessageSchema.parse(request.body);
    const userId = authRequest(request).user.id;
    const edited = await transaction(async (client) => {
      const result = await client.query<{ id: string; conversation_id: string }>(
        `UPDATE messages m SET body = $1, edited_at = now()
           FROM conversation_members cm
          WHERE m.id = $2
            AND m.sender_id = $3
            AND m.deleted_at IS NULL
            AND m.published_at IS NOT NULL
            AND cm.conversation_id = m.conversation_id
            AND cm.user_id = $3
          RETURNING m.id, m.conversation_id`,
        [input.body, request.params.messageId, userId]
      );
      if (!result.rowCount) return null;
      if (input.attachmentIds.length) {
        const attached = await client.query(
          `UPDATE attachments SET message_id = $1
            WHERE id = ANY($2::uuid[]) AND uploaded_by = $3
              AND (message_id IS NULL OR message_id = $1)
            RETURNING id`,
          [result.rows[0].id, input.attachmentIds, userId]
        );
        if (attached.rowCount !== input.attachmentIds.length) throw new Error("ATTACHMENT_NOT_FOUND");
      }
      const removed = await client.query<{ storage_name: string }>(
        `DELETE FROM attachments
          WHERE message_id = $1 AND NOT (id = ANY($2::uuid[]))
          RETURNING storage_name`,
        [result.rows[0].id, input.attachmentIds]
      );
      return {
        conversationId: result.rows[0].conversation_id,
        storageNames: [...new Set(removed.rows.map((file) => file.storage_name))],
        message: await getMessage(result.rows[0].id, client)
      };
    });
    if (!edited) {
      response.status(404).json({ error: "Сообщение не найдено" });
      return;
    }
    for (const storageName of edited.storageNames) {
      const stillUsed = await query("SELECT 1 FROM attachments WHERE storage_name = $1 LIMIT 1", [storageName]);
      if (!stillUsed.rowCount) await fs.unlink(path.join(config.dataDir, "uploads", storageName)).catch(() => undefined);
    }
    emitToConversation(edited.conversationId, "message:updated", edited.message);
    response.json({ message: edited.message });
  } catch (error) {
    if ((error as Error).message === "ATTACHMENT_NOT_FOUND") {
      response.status(400).json({ error: "Одно из вложений недоступно" });
      return;
    }
    next(error);
  }
});

app.delete("/api/messages/:messageId", requireAuth, async (request, response, next) => {
  try {
    const scope = z.enum(["self", "everyone"]).default("everyone").parse(request.query.scope);
    const userId = authRequest(request).user.id;
    const messageId = routeParam(request, "messageId");
    if (scope === "self") {
      const hidden = await query<{ conversation_id: string }>(
        `INSERT INTO message_hidden_users (message_id, user_id)
         SELECT m.id, $2
           FROM messages m
           JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $2
          WHERE m.id = $1
         ON CONFLICT DO NOTHING
         RETURNING (SELECT conversation_id FROM messages WHERE id = $1) AS conversation_id`,
        [messageId, userId]
      );
      if (!hidden.rowCount) {
        response.status(404).json({ error: "Сообщение не найдено" });
        return;
      }
      emitToUser(userId, "message:hidden", { conversationId: hidden.rows[0].conversation_id, messageId });
      response.status(204).end();
      return;
    }
    const deleted = await transaction(async (client) => {
      const result = await client.query<{ id: string; conversation_id: string }>(
        `UPDATE messages m SET body = '', deleted_at = now(), edited_at = NULL
           FROM conversation_members cm
           JOIN conversations c ON c.id = cm.conversation_id
          WHERE m.id = $1
            AND (m.sender_id = $2 OR (c.kind = 'group' AND cm.role IN ('owner', 'admin')))
            AND m.deleted_at IS NULL
            AND cm.conversation_id = m.conversation_id
            AND cm.user_id = $2
          RETURNING m.id, m.conversation_id`,
        [messageId, userId]
      );
      if (!result.rowCount) return null;
      const files = await client.query<{ storage_name: string }>(
        "DELETE FROM attachments WHERE message_id = $1 RETURNING storage_name",
        [result.rows[0].id]
      );
      await client.query("DELETE FROM message_reactions WHERE message_id = $1", [result.rows[0].id]);
      await client.query("DELETE FROM conversation_message_pins WHERE message_id = $1", [result.rows[0].id]);
      return {
        conversationId: result.rows[0].conversation_id,
        storageNames: [...new Set(files.rows.map((file) => file.storage_name))],
        message: await getMessage(result.rows[0].id, client)
      };
    });
    if (!deleted) {
      response.status(404).json({ error: "Сообщение не найдено" });
      return;
    }
    for (const storageName of deleted.storageNames) {
      const stillUsed = await query("SELECT 1 FROM attachments WHERE storage_name = $1 LIMIT 1", [storageName]);
      if (!stillUsed.rowCount) {
        await fs.unlink(path.join(config.dataDir, "uploads", storageName)).catch(() => undefined);
      }
    }
    emitToConversation(deleted.conversationId, "message:updated", deleted.message);
    response.json({ message: deleted.message });
  } catch (error) {
    next(error);
  }
});

app.post("/api/messages/:messageId/pin", requireAuth, async (request, response, next) => {
  try {
    const messageId = routeParam(request, "messageId");
    const userId = authRequest(request).user.id;
    const result = await query<{ conversation_id: string }>(
      `INSERT INTO conversation_message_pins (message_id, conversation_id, pinned_by)
       SELECT m.id, m.conversation_id, $2
         FROM messages m
         JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $2
        WHERE m.id = $1 AND m.deleted_at IS NULL AND m.published_at IS NOT NULL
       ON CONFLICT (message_id) DO UPDATE SET pinned_by = EXCLUDED.pinned_by, pinned_at = now()
       RETURNING conversation_id`,
      [messageId, userId]
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Сообщение не найдено" });
      return;
    }
    const message = await getMessage(messageId);
    emitToConversation(result.rows[0].conversation_id, "message:updated", message);
    response.json({ message });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/messages/:messageId/pin", requireAuth, async (request, response, next) => {
  try {
    const messageId = routeParam(request, "messageId");
    const userId = authRequest(request).user.id;
    const result = await query<{ conversation_id: string }>(
      `DELETE FROM conversation_message_pins pin
        USING conversation_members cm
        WHERE pin.message_id = $1
          AND cm.conversation_id = pin.conversation_id
          AND cm.user_id = $2
        RETURNING pin.conversation_id`,
      [messageId, userId]
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Закреплённое сообщение не найдено" });
      return;
    }
    const message = await getMessage(messageId);
    emitToConversation(result.rows[0].conversation_id, "message:updated", message);
    response.json({ message });
  } catch (error) {
    next(error);
  }
});

app.post("/api/messages/:messageId/view-once", requireAuth, async (request, response, next) => {
  try {
    const messageId = routeParam(request, "messageId");
    const userId = authRequest(request).user.id;
    const info = await query<{ sender_id: string; conversation_id: string; view_once: boolean }>(
      `SELECT m.sender_id, m.conversation_id, m.view_once
         FROM messages m
         JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $2
        WHERE m.id = $1 AND m.deleted_at IS NULL AND m.published_at IS NOT NULL
          AND (m.expires_at IS NULL OR m.expires_at > now())`,
      [messageId, userId]
    );
    const item = info.rows[0];
    if (!item?.view_once) {
      response.status(404).json({ error: "Одноразовое сообщение не найдено" });
      return;
    }
    if (item.sender_id !== userId) {
      const consumed = await query(
        `INSERT INTO message_views (message_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING message_id`,
        [messageId, userId]
      );
      if (!consumed.rowCount) {
        response.status(410).json({ error: "Вложение уже просмотрено" });
        return;
      }
    }
    const message = await getMessage(messageId);
    emitToConversation(item.conversation_id, "message:updated", message);
    response.json({ message });
  } catch (error) {
    next(error);
  }
});

app.post("/api/messages/:messageId/reactions", requireAuth, async (request, response, next) => {
  try {
    const { emoji } = reactionSchema.parse(request.body);
    const messageId = routeParam(request, "messageId");
    const userId = authRequest(request).user.id;
    const messageInfo = await query<{ conversation_id: string }>(
      `SELECT m.conversation_id
         FROM messages m
         JOIN conversation_members cm
           ON cm.conversation_id = m.conversation_id AND cm.user_id = $2
        WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [messageId, userId]
    );
    const conversationId = messageInfo.rows[0]?.conversation_id;
    if (!conversationId) {
      response.status(404).json({ error: "Сообщение не найдено" });
      return;
    }

    await transaction(async (client) => {
      const removed = await client.query(
        "DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3 RETURNING message_id",
        [messageId, userId, emoji]
      );
      if (!removed.rowCount) {
        await client.query(
          `INSERT INTO message_reactions (message_id, user_id, emoji)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [messageId, userId, emoji]
        );
      }
    });

    const message = await getMessage(messageId);
    emitToConversation(conversationId, "message:updated", message);
    response.json({ message });
  } catch (error) {
    next(error);
  }
});

app.post("/api/conversations/:conversationId/read", requireAuth, async (request, response, next) => {
  try {
    const conversationId = routeParam(request, "conversationId");
    const userId = authRequest(request).user.id;
    const result = await query<{ last_read_at: Date }>(
      `UPDATE conversation_members SET last_read_at = now(), manual_unread = false
        WHERE conversation_id = $1 AND user_id = $2
        RETURNING last_read_at`,
      [conversationId, userId]
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Чат не найден" });
      return;
    }
    if (config.ai.availableInEnvironment) {
      await acknowledgeAiNotifications({ userId, conversationId });
    }
    emitToConversation(conversationId, "read:update", {
      conversationId,
      userId,
      readAt: result.rows[0].last_read_at.toISOString()
    });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/conversations/:conversationId/unread", requireAuth, async (request, response, next) => {
  try {
    const conversationId = routeParam(request, "conversationId");
    const userId = authRequest(request).user.id;
    const result = await query(
      `UPDATE conversation_members SET manual_unread = true
        WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId]
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Чат не найден" });
      return;
    }
    emitToUser(userId, "conversation:unread", { conversationId });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/push/public-key", requireAuth, (_request, response) => {
  response.json({ publicKey: publicVapidKey });
});

app.post("/api/push/subscribe", requireAuth, async (request, response, next) => {
  try {
    const input = pushSchema.parse(request.body);
    await query(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth`,
      [randomUUID(), authRequest(request).user.id, input.endpoint, input.keys.p256dh, input.keys.auth]
    );
    response.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/push/subscribe", requireAuth, async (request, response, next) => {
  try {
    const input = z.object({
      endpoint: z.string().url().max(2000).refine(isSafePushEndpoint, "Недопустимый адрес push-сервиса")
    }).parse(request.body);
    await query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2", [
      input.endpoint,
      authRequest(request).user.id
    ]);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

const webRoot = path.resolve(process.cwd(), "dist");
app.use(express.static(webRoot, {
  index: false,
  maxAge: config.isProduction ? "1d" : 0,
  setHeaders: (response, filePath) => {
    if (["service-worker.js", "manifest.webmanifest"].includes(path.basename(filePath))) {
      response.setHeader("Cache-Control", "no-cache");
    }
  }
}));
app.use(async (request, response, next) => {
  if (request.path.startsWith("/api/") || request.path.startsWith("/socket.io/")) return next();
  try {
    const html = await fs.readFile(path.join(webRoot, "index.html"), "utf8");
    const requestOrigin = `${request.protocol}://${request.get("host")}`;
    const publicOrigin = config.isProduction ? config.appOrigin : requestOrigin;
    response.setHeader("Cache-Control", "no-cache");
    response.type("html").send(html.replaceAll("__APP_ORIGIN__", publicOrigin));
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    response.status(400).json({ error: error.issues[0]?.message ?? "Проверьте введённые данные" });
    return;
  }
  if (error instanceof multer.MulterError) {
    response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error:
        error.code === "LIMIT_FILE_SIZE"
          ? `Файл превышает ${request.path.includes("/avatar") ? 5 : config.maxUploadMb} МБ`
          : "Не удалось загрузить файл"
    });
    return;
  }
  console.error(error);
  response.status(500).json({ error: "Внутренняя ошибка сервера" });
});

async function start() {
  await fs.mkdir(path.join(config.dataDir, "uploads"), { recursive: true });
  await runMigrations();
  await query("DELETE FROM sessions WHERE expires_at <= now()");
  const orphaned = await query<{ storage_name: string }>(
    "DELETE FROM attachments WHERE message_id IS NULL AND created_at < now() - interval '24 hours' RETURNING storage_name"
  );
  await Promise.all(
    orphaned.rows.map(({ storage_name }) =>
      fs.unlink(path.join(config.dataDir, "uploads", storage_name)).catch(() => undefined)
    )
  );
  await runMessageMaintenance();
  maintenanceTimer = setInterval(() => void runMessageMaintenance(), 5_000);
  server.listen(config.port, "0.0.0.0", () => {
    console.info(`BarsikChat is listening on http://0.0.0.0:${config.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start BarsikChat", error);
  process.exit(1);
});

async function shutdown() {
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
