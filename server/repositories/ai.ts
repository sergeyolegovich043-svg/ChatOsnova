import { createHash } from "node:crypto";
import { query } from "../db.js";
import type { RetrievedChunk } from "../ai/context.js";

type IndexableMessage = {
  id: string;
  conversationId: string;
  conversationKind: "direct" | "group";
  body: string;
  deletedAt: Date | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  viewOnce: boolean;
};

type IndexableAttachment = {
  id: string;
  messageId: string;
  conversationId: string;
  conversationKind: "direct" | "group";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  deletedAt: Date | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  viewOnce: boolean;
};

export function hashContent(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function readIndexableMessage(id: string) {
  const result = await query<IndexableMessage>(
    `SELECT m.id, m.conversation_id AS "conversationId", c.kind AS "conversationKind",
            m.body, m.deleted_at AS "deletedAt", m.published_at AS "publishedAt",
            m.expires_at AS "expiresAt", m.view_once AS "viewOnce"
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function readIndexableAttachment(id: string) {
  const result = await query<IndexableAttachment>(
    `SELECT a.id, a.message_id AS "messageId", m.conversation_id AS "conversationId",
            c.kind AS "conversationKind", a.original_name AS "originalName",
            a.mime_type AS "mimeType", a.size_bytes AS "sizeBytes",
            m.deleted_at AS "deletedAt", m.published_at AS "publishedAt",
            m.expires_at AS "expiresAt", m.view_once AS "viewOnce"
       FROM attachments a
       JOIN messages m ON m.id = a.message_id
       JOIN conversations c ON c.id = m.conversation_id
      WHERE a.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export function isIndexableMessage(message: IndexableMessage | IndexableAttachment | null) {
  return Boolean(
    message &&
    !message.deletedAt &&
    message.publishedAt &&
    !message.viewOnce &&
    (!message.expiresAt || new Date(message.expiresAt).getTime() > Date.now())
  );
}

export async function upsertAiChunk(input: {
  conversationId: string;
  sourceKind: "message" | "attachment";
  sourceId: string;
  sourceMessageId: string;
  private: boolean;
  content: string;
}) {
  const result = await query<{ id: string }>(
    `INSERT INTO ai_chunks (
       conversation_id, source_kind, source_id, source_message_id, access_scope, content, content_hash
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (source_kind, source_id) DO UPDATE
       SET conversation_id = EXCLUDED.conversation_id,
           source_message_id = EXCLUDED.source_message_id,
           access_scope = EXCLUDED.access_scope,
           content = EXCLUDED.content,
           content_hash = EXCLUDED.content_hash,
           updated_at = now()
     RETURNING id`,
    [
      input.conversationId,
      input.sourceKind,
      input.sourceId,
      input.sourceMessageId,
      input.private ? "private" : "conversation",
      input.content,
      hashContent(input.content)
    ]
  );
  return result.rows[0].id;
}

export async function saveEmbedding(chunkId: string, model: string, embedding: number[]) {
  const vector = `[${embedding.join(",")}]`;
  await query(
    `INSERT INTO ai_embeddings (chunk_id, model, embedding)
     VALUES ($1, $2, $3::vector)
     ON CONFLICT (chunk_id) DO UPDATE
       SET model = EXCLUDED.model, embedding = EXCLUDED.embedding, created_at = now()`,
    [chunkId, model, vector]
  );
}

export async function findChunksMissingEmbeddings(limit = 20) {
  const result = await query<{ id: string; content: string }>(
    `SELECT chunk.id, chunk.content
       FROM ai_chunks chunk
       LEFT JOIN ai_embeddings embedding ON embedding.chunk_id = chunk.id
      WHERE embedding.chunk_id IS NULL
      ORDER BY chunk.updated_at
      LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function deleteAiSource(sourceKind: "message" | "attachment", sourceId: string) {
  await query("DELETE FROM ai_chunks WHERE source_kind = $1 AND source_id = $2", [sourceKind, sourceId]);
}

export async function deleteAiConversation(conversationId: string) {
  await query("DELETE FROM ai_chunks WHERE conversation_id = $1", [conversationId]);
}

export async function deleteAiUserConversation(userId: string, conversationId: string) {
  await query("DELETE FROM ai_conversations WHERE user_id = $1 AND conversation_id = $2", [userId, conversationId]);
  await query("DELETE FROM ai_notification_queue WHERE user_id = $1 AND conversation_id = $2", [userId, conversationId]);
}

export async function findAccessibleChunks(input: {
  userId: string;
  search: string;
  conversationId?: string;
  limit?: number;
  since?: Date;
  pendingNotificationsOnly?: boolean;
  includePrivate?: boolean;
}): Promise<RetrievedChunk[]> {
  const result = await query<RetrievedChunk>(
    `SELECT chunk.id,
            message.id AS "sourceId",
            chunk.source_kind AS "sourceKind",
            chunk.conversation_id AS "conversationId",
            CASE WHEN conversation.kind = 'group'
              THEN COALESCE(conversation.title, 'Группа') ELSE 'Личный чат' END AS "conversationTitle",
            author.display_name AS "authorName",
            chunk.content,
            message.created_at AS "createdAt"
       FROM ai_chunks chunk
       JOIN conversations conversation ON conversation.id = chunk.conversation_id
       JOIN conversation_members member
         ON member.conversation_id = chunk.conversation_id
        AND member.user_id = $1
        AND member.hidden_at IS NULL
       JOIN messages message ON message.id = chunk.source_message_id
       JOIN users author ON author.id = message.sender_id
      WHERE message.deleted_at IS NULL
        AND message.published_at IS NOT NULL
        AND (message.expires_at IS NULL OR message.expires_at > now())
        AND message.view_once = false
        AND NOT EXISTS (
          SELECT 1 FROM message_hidden_users hidden
           WHERE hidden.message_id = message.id AND hidden.user_id = $1
        )
        AND ($3::uuid IS NULL OR chunk.conversation_id = $3)
        AND ($3::uuid IS NOT NULL OR chunk.access_scope <> 'private' OR $7::boolean)
        AND ($5::timestamptz IS NULL OR message.created_at >= $5)
        AND (
          NOT $6::boolean OR (
            message.created_at > member.last_read_at
            AND EXISTS (
              SELECT 1
                FROM ai_notification_queue notification
               WHERE notification.user_id = $1
                 AND notification.message_id = message.id
                 AND notification.consumed_at IS NULL
            )
          )
        )
      ORDER BY
        CASE WHEN trim($2) = '' THEN 0
          ELSE ts_rank_cd(to_tsvector('simple', chunk.content), websearch_to_tsquery('simple', $2)) END DESC,
        message.created_at DESC
      LIMIT $4`,
    [
      input.userId,
      input.search,
      input.conversationId ?? null,
      input.limit ?? 12,
      input.since ?? null,
      input.pendingNotificationsOnly ?? false,
      input.includePrivate ?? false
    ]
  );
  return result.rows;
}

export type AiPersonalTask = {
  id: string;
  clientId: string;
  conversationId: string | null;
  sourceMessageId: string | null;
  title: string;
  details: string;
  assignee: string | null;
  dueAt: Date | null;
  status: "open" | "done" | "dismissed";
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

const taskSelect = `
  task.id,
  task.client_id AS "clientId",
  task.conversation_id AS "conversationId",
  task.source_message_id AS "sourceMessageId",
  task.title,
  task.details,
  task.assignee_name AS assignee,
  task.due_at AS "dueAt",
  task.status,
  task.created_at AS "createdAt",
  task.updated_at AS "updatedAt",
  task.completed_at AS "completedAt"`;

export async function createAiPersonalTask(input: {
  userId: string;
  clientId: string;
  conversationId?: string;
  sourceMessageId?: string;
  title: string;
  details: string;
  assignee?: string | null;
  dueAt?: Date | null;
}) {
  let conversationId = input.conversationId ?? null;
  if (input.sourceMessageId) {
    const source = await query<{ conversationId: string }>(
      `SELECT message.conversation_id AS "conversationId"
         FROM messages message
         JOIN conversation_members member
           ON member.conversation_id = message.conversation_id
          AND member.user_id = $2
          AND member.hidden_at IS NULL
        WHERE message.id = $1
          AND message.deleted_at IS NULL
          AND message.published_at IS NOT NULL
          AND (message.expires_at IS NULL OR message.expires_at > now())
          AND message.view_once = false
          AND NOT EXISTS (
            SELECT 1 FROM message_hidden_users hidden
             WHERE hidden.message_id = message.id AND hidden.user_id = $2
          )`,
      [input.sourceMessageId, input.userId]
    );
    if (!source.rows[0]) throw new Error("Источник задачи недоступен");
    if (conversationId && conversationId !== source.rows[0].conversationId) throw new Error("Источник не относится к выбранному чату");
    conversationId = source.rows[0].conversationId;
  } else if (conversationId) {
    const membership = await query(
      "SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2 AND hidden_at IS NULL",
      [conversationId, input.userId]
    );
    if (!membership.rowCount) throw new Error("Чат недоступен");
  }

  const result = await query<AiPersonalTask>(
    `INSERT INTO ai_personal_tasks (
       client_id, user_id, conversation_id, source_message_id,
       title, details, assignee_name, due_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (user_id, client_id) DO UPDATE SET updated_at = ai_personal_tasks.updated_at
     RETURNING ${taskSelect.replaceAll("task.", "ai_personal_tasks.")}`,
    [
      input.clientId,
      input.userId,
      conversationId,
      input.sourceMessageId ?? null,
      input.title,
      input.details,
      input.assignee ?? null,
      input.dueAt ?? null
    ]
  );
  return result.rows[0];
}

export async function listAiPersonalTasks(userId: string, status?: "open" | "done" | "dismissed") {
  const result = await query<AiPersonalTask>(
    `SELECT ${taskSelect}
       FROM ai_personal_tasks task
      WHERE task.user_id = $1
        AND ($2::text IS NULL OR task.status = $2)
      ORDER BY (task.status = 'open') DESC, task.due_at NULLS LAST, task.created_at DESC
      LIMIT 200`,
    [userId, status ?? null]
  );
  return result.rows;
}

export async function updateAiPersonalTaskStatus(
  userId: string,
  taskId: string,
  status: "open" | "done" | "dismissed"
) {
  const result = await query<AiPersonalTask>(
    `UPDATE ai_personal_tasks task
        SET status = $3::varchar,
            updated_at = now(),
            completed_at = CASE WHEN $3::varchar = 'done' THEN now() ELSE NULL END
      WHERE task.id = $1 AND task.user_id = $2
      RETURNING ${taskSelect}`,
    [taskId, userId, status]
  );
  return result.rows[0] ?? null;
}

export async function deleteAiPersonalTask(userId: string, taskId: string) {
  const result = await query("DELETE FROM ai_personal_tasks WHERE id = $1 AND user_id = $2", [taskId, userId]);
  return Boolean(result.rowCount);
}

export async function enqueueAiNotifications(messageId: string) {
  await query(
    `WITH recipients AS (
       SELECT member.user_id,
              message.id AS message_id,
              message.conversation_id,
              member.notification_mode,
              member.mute_until,
              (message.body ~* ('(^|[^a-zA-Z0-9_])@' || recipient.username || '([^a-zA-Z0-9_]|$)')) AS mentioned,
              (
                message.body ~* ('(^|[^a-zA-Z0-9_])@' || recipient.username || '([^a-zA-Z0-9_]|$)')
                OR message.body LIKE '%?%'
                OR lower(message.body) ~ '(соглас|подтверд|ответ|срок|нужно|жду|важно)'
              ) AS needs_attention
         FROM messages message
         JOIN conversation_members member ON member.conversation_id = message.conversation_id
         JOIN users recipient ON recipient.id = member.user_id
        WHERE message.id = $1
          AND member.user_id <> message.sender_id
          AND member.hidden_at IS NULL
          AND message.created_at > member.last_read_at
          AND message.deleted_at IS NULL
          AND message.published_at IS NOT NULL
          AND (message.expires_at IS NULL OR message.expires_at > now())
          AND message.view_once = false
          AND message.silent = false
     )
     INSERT INTO ai_notification_queue (
       user_id, message_id, conversation_id, mentioned, needs_attention, created_at
     )
     SELECT user_id, message_id, conversation_id, mentioned, needs_attention, now()
       FROM recipients
      WHERE notification_mode = 'all'
         OR (notification_mode = 'mentions' AND mentioned)
         OR (notification_mode = 'muted' AND mute_until IS NOT NULL AND mute_until <= now())
     ON CONFLICT (user_id, message_id) DO UPDATE
       SET mentioned = EXCLUDED.mentioned,
           needs_attention = EXCLUDED.needs_attention`,
    [messageId]
  );
}

export async function removeAiNotificationsForMessage(messageId: string) {
  await query("DELETE FROM ai_notification_queue WHERE message_id = $1", [messageId]);
}

export type AiNotificationGroup = {
  conversationId: string;
  title: string;
  messageCount: number;
  mentionCount: number;
  needsAttention: boolean;
  latestAt: Date;
  latestMessageId: string;
  preview: string;
};

export async function listPendingAiNotificationGroups(userId: string, since?: Date) {
  const result = await query<AiNotificationGroup>(
    `SELECT queue.conversation_id AS "conversationId",
            CASE WHEN conversation.kind = 'group' THEN COALESCE(conversation.title, 'Группа')
              ELSE COALESCE((
                SELECT other_user.display_name
                  FROM conversation_members other_member
                  JOIN users other_user ON other_user.id = other_member.user_id
                 WHERE other_member.conversation_id = conversation.id
                   AND other_member.user_id <> $1
                 ORDER BY other_member.joined_at
                 LIMIT 1
              ), 'Личный чат') END AS title,
            count(*)::int AS "messageCount",
            count(*) FILTER (WHERE queue.mentioned)::int AS "mentionCount",
            bool_or(queue.needs_attention) AS "needsAttention",
            max(message.created_at) AS "latestAt",
            (array_agg(message.id ORDER BY message.created_at DESC))[1] AS "latestMessageId",
            (array_agg(
              CASE WHEN message.body <> '' THEN left(message.body, 180) ELSE 'Вложение' END
              ORDER BY message.created_at DESC
            ))[1] AS preview
       FROM ai_notification_queue queue
       JOIN conversations conversation ON conversation.id = queue.conversation_id
       JOIN conversation_members membership
         ON membership.conversation_id = queue.conversation_id
        AND membership.user_id = $1
        AND membership.hidden_at IS NULL
       JOIN messages message ON message.id = queue.message_id
      WHERE queue.user_id = $1
        AND queue.consumed_at IS NULL
        AND ($2::timestamptz IS NULL OR queue.created_at >= $2)
        AND message.deleted_at IS NULL
        AND message.published_at IS NOT NULL
        AND (message.expires_at IS NULL OR message.expires_at > now())
        AND message.created_at > membership.last_read_at
      GROUP BY queue.conversation_id, conversation.id, conversation.kind, conversation.title
      ORDER BY bool_or(queue.needs_attention) DESC, max(message.created_at) DESC`,
    [userId, since ?? null]
  );
  return result.rows;
}

export async function acknowledgeAiNotifications(input: {
  userId: string;
  conversationId?: string;
  messageIds?: string[];
}) {
  const result = await query(
    `UPDATE ai_notification_queue
        SET consumed_at = now()
      WHERE user_id = $1
        AND consumed_at IS NULL
        AND ($2::uuid IS NULL OR conversation_id = $2)
        AND ($3::uuid[] IS NULL OR message_id = ANY($3::uuid[]))`,
    [input.userId, input.conversationId ?? null, input.messageIds?.length ? input.messageIds : null]
  );
  return result.rowCount ?? 0;
}

export async function monthlyAiSpend(userId: string) {
  const result = await query<{ spent: string; customBudget: string | null }>(
    `SELECT COALESCE((
       SELECT sum(cost_usd) FROM ai_usage
        WHERE user_id = $1 AND created_at >= date_trunc('month', now())
     ), 0)::text AS spent,
     (SELECT monthly_budget_usd::text FROM ai_user_settings WHERE user_id = $1) AS "customBudget"`,
    [userId]
  );
  return {
    spent: Number(result.rows[0]?.spent ?? 0),
    customBudget: result.rows[0]?.customBudget == null ? null : Number(result.rows[0].customBudget)
  };
}

export async function recordAiUsage(input: {
  userId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}) {
  await query(
    `INSERT INTO ai_usage (user_id, provider, model, input_tokens, output_tokens, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.userId, input.provider, input.model, input.inputTokens, input.outputTokens, input.costUsd]
  );
}

export async function recordAiAudit(input: {
  userId: string;
  requestHash: string;
  action: string;
  status: string;
  provider?: string;
  model?: string;
  sourceIds?: string[];
  inputTokens?: number;
  outputTokens?: number;
  errorCode?: string;
}) {
  await query(
    `INSERT INTO ai_audit_log (
       user_id, request_hash, action, status, provider, model, source_ids,
       input_tokens, output_tokens, error_code
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.userId, input.requestHash, input.action, input.status,
      input.provider ?? null, input.model ?? null, input.sourceIds ?? [],
      input.inputTokens ?? 0, input.outputTokens ?? 0, input.errorCode ?? null
    ]
  );
}
