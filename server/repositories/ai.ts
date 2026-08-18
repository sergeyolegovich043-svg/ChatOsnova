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
}

export async function findAccessibleChunks(input: {
  userId: string;
  search: string;
  conversationId?: string;
  limit?: number;
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
        AND ($3::uuid IS NOT NULL OR chunk.access_scope <> 'private')
      ORDER BY
        CASE WHEN trim($2) = '' THEN 0
          ELSE ts_rank_cd(to_tsvector('simple', chunk.content), websearch_to_tsquery('simple', $2)) END DESC,
        message.created_at DESC
      LIMIT $4`,
    [input.userId, input.search, input.conversationId ?? null, input.limit ?? 12]
  );
  return result.rows;
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
