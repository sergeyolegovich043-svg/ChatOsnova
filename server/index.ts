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
import { getConversationMessages, getMessage } from "./messages.js";
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

const app = express();
const server = createServer(app);
createRealtimeServer(server);

if (config.isProduction) app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", "ws:", "wss:"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
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
    config.isProduction &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
    request.path.startsWith("/api/")
  ) {
    const origin = request.get("origin");
    const requestOrigin = `${request.protocol}://${request.get("host")}`;
    if (!isAllowedOrigin(origin, requestOrigin, config.appOrigin)) {
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
const messageSchema = z
  .object({
    body: z.string().trim().max(4000).default(""),
    replyToId: z.string().uuid().nullable().optional(),
    clientId: z.string().uuid(),
    attachmentIds: z.array(z.string().uuid()).max(5).default([])
  })
  .refine((value) => value.body.length > 0 || value.attachmentIds.length > 0, {
    message: "Сообщение не может быть пустым"
  });

const allowedReactions = new Set([
  "👍", "❤️", "🔥", "😂", "😍", "😮", "😢", "👏", "🎉", "🤝", "💯", "👀", "🙏", "🤔", "😎", "🐈"
]);

const reactionSchema = z.object({
  emoji: z.string().min(1).max(8).refine((emoji) => allowedReactions.has(emoji), "Эта реакция не поддерживается")
});

const pinConversationSchema = z.object({ pinned: z.boolean() });
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

type ConversationRow = {
  id: string;
  kind: "direct" | "group";
  title: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  muted: boolean;
  pinned: boolean;
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
            (self_member.pinned_at IS NOT NULL) AS pinned,
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
            ) AS "unreadCount"
       FROM conversations c
       JOIN conversation_members self_member
         ON self_member.conversation_id = c.id AND self_member.user_id = $1
       JOIN conversation_members cm ON cm.conversation_id = c.id
       JOIN users u ON u.id = cm.user_id
      WHERE self_member.hidden_at IS NULL ${onlyConversation}
      GROUP BY c.id, self_member.muted, self_member.pinned_at, self_member.last_read_at
      ORDER BY self_member.pinned_at DESC NULLS LAST, c.updated_at DESC`,
    values
  );

  const online = new Set(onlineUserIds());
  return result.rows.map((row) => {
    const members = row.members.map((member) => ({ ...member, online: online.has(member.id) }));
    const other = members.find((member) => member.id !== userId);
    return {
      ...row,
      title: row.kind === "direct" ? other?.displayName ?? "Сохранённые сообщения" : row.title,
      avatarColor: row.kind === "direct" ? other?.avatarColor ?? "#0f766e" : "#334155",
      avatarUrl: row.kind === "direct" ? other?.avatarUrl ?? null : null,
      members,
      unreadCount: Number(row.unreadCount)
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
        WHERE m.conversation_id = $1`,
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
    const messages = await getConversationMessages(conversationId, before, limit);
    response.json({ messages, hasMore: messages.length === limit });
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
    response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
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
    }>(
      `SELECT a.storage_name, a.original_name, a.mime_type, a.uploaded_by, a.message_id, m.conversation_id
         FROM attachments a
         LEFT JOIN messages m ON m.id = a.message_id
        WHERE a.id = $1`,
      [request.params.attachmentId]
    );
    const file = result.rows[0];
    const userId = authRequest(request).user.id;
    const allowed =
      file &&
      ((file.message_id === null && file.uploaded_by === userId) ||
        (file.conversation_id && (await isMember(file.conversation_id, userId))));
    if (!allowed) {
      response.status(404).json({ error: "Файл не найден" });
      return;
    }
    response.type(file.mime_type);
    response.setHeader("Cache-Control", "private, max-age=86400");
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
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO messages (id, conversation_id, sender_id, body, reply_to_id, client_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (sender_id, client_id) DO UPDATE SET body = messages.body
         RETURNING id`,
        [randomUUID(), conversationId, user.id, input.body, input.replyToId ?? null, input.clientId]
      );
      const messageId = inserted.rows[0].id;
      if (input.attachmentIds.length) {
        const attached = await client.query(
          `UPDATE attachments SET message_id = $1
            WHERE id = ANY($2::uuid[]) AND uploaded_by = $3 AND message_id IS NULL
            RETURNING id`,
          [messageId, input.attachmentIds, user.id]
        );
        if (attached.rows.length !== input.attachmentIds.length) throw new Error("ATTACHMENT_NOT_FOUND");
      }
      await client.query("UPDATE conversations SET updated_at = now() WHERE id = $1", [conversationId]);
      await client.query(
        "UPDATE conversation_members SET hidden_at = NULL WHERE conversation_id = $1",
        [conversationId]
      );
      return getMessage(messageId, client);
    });

    emitToConversation(conversationId, "message:new", message);
    emitToConversation(conversationId, "conversation:updated", { conversationId });
    const [conversation] = await conversationsForUser(user.id, conversationId);
    const primaryAttachment = message.attachments?.[0] as { kind?: string } | undefined;
    const notificationBody = input.body || (
      primaryAttachment?.kind === "voice"
        ? "🎙 Голосовое сообщение"
        : primaryAttachment?.kind === "video_circle"
          ? "◉ Видеосообщение"
          : "Вложение"
    );
    void sendMessagePush({
      conversationId,
      senderId: user.id,
      senderName: user.displayName,
      title: conversation?.kind === "group" ? conversation.title ?? "Новая группа" : user.displayName,
      body: notificationBody
    });
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
        "UPDATE conversation_members SET hidden_at = NULL WHERE conversation_id = $1",
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
    const input = z.object({ body: z.string().trim().min(1).max(4000) }).parse(request.body);
    const result = await query<{ id: string; conversation_id: string }>(
      `UPDATE messages m SET body = $1, edited_at = now()
         FROM conversation_members cm
        WHERE m.id = $2
          AND m.sender_id = $3
          AND m.deleted_at IS NULL
          AND cm.conversation_id = m.conversation_id
          AND cm.user_id = $3
        RETURNING m.id, m.conversation_id`,
      [input.body, request.params.messageId, authRequest(request).user.id]
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Сообщение не найдено" });
      return;
    }
    const message = await getMessage(result.rows[0].id);
    emitToConversation(result.rows[0].conversation_id, "message:updated", message);
    response.json({ message });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/messages/:messageId", requireAuth, async (request, response, next) => {
  try {
    const deleted = await transaction(async (client) => {
      const result = await client.query<{ id: string; conversation_id: string }>(
        `UPDATE messages m SET body = '', deleted_at = now(), edited_at = NULL
           FROM conversation_members cm
          WHERE m.id = $1
            AND m.sender_id = $2
            AND m.deleted_at IS NULL
            AND cm.conversation_id = m.conversation_id
            AND cm.user_id = $2
          RETURNING m.id, m.conversation_id`,
        [request.params.messageId, authRequest(request).user.id]
      );
      if (!result.rowCount) return null;
      const files = await client.query<{ storage_name: string }>(
        "DELETE FROM attachments WHERE message_id = $1 RETURNING storage_name",
        [result.rows[0].id]
      );
      await client.query("DELETE FROM message_reactions WHERE message_id = $1", [result.rows[0].id]);
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
    const result = await query(
      `UPDATE conversation_members SET last_read_at = now()
        WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId]
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Чат не найден" });
      return;
    }
    emitToConversation(conversationId, "read:update", {
      conversationId,
      userId,
      readAt: new Date().toISOString()
    });
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
app.use(express.static(webRoot, { index: false, maxAge: config.isProduction ? "1d" : 0 }));
app.use(async (request, response, next) => {
  if (request.path.startsWith("/api/") || request.path.startsWith("/socket.io/")) return next();
  try {
    const html = await fs.readFile(path.join(webRoot, "index.html"), "utf8");
    const requestOrigin = `${request.protocol}://${request.get("host")}`;
    const publicOrigin = config.isProduction ? config.appOrigin : requestOrigin;
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
          ? `Файл превышает ${request.path.includes("/profile/avatar") ? 5 : config.maxUploadMb} МБ`
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
  server.listen(config.port, "0.0.0.0", () => {
    console.info(`BarsikChat is listening on http://0.0.0.0:${config.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start BarsikChat", error);
  process.exit(1);
});

async function shutdown() {
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
