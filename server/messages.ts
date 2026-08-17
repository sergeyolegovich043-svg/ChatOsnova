import type { PoolClient } from "pg";
import { query } from "./db.js";

const messageSelect = `
  SELECT m.id,
         m.conversation_id AS "conversationId",
         m.body,
         m.reply_to_id AS "replyToId",
         m.client_id AS "clientId",
         m.forwarded_from_id AS "forwardedFromId",
         m.edited_at AS "editedAt",
         m.deleted_at AS "deletedAt",
         m.silent,
         m.scheduled_at AS "scheduledAt",
         m.published_at AS "publishedAt",
         m.expire_seconds AS "expireSeconds",
         m.expires_at AS "expiresAt",
         m.view_once AS "viewOnce",
         m.created_at AS "createdAt",
         jsonb_build_object(
           'id', u.id,
           'username', u.username,
           'displayName', u.display_name,
           'avatarColor', u.avatar_color,
           'avatarUrl', CASE
             WHEN u.avatar_storage_name IS NULL THEN NULL
             ELSE '/api/users/' || u.id || '/avatar?v=' || (extract(epoch FROM u.avatar_updated_at) * 1000)::bigint
           END
         ) AS sender,
         CASE WHEN rm.id IS NULL THEN NULL ELSE jsonb_build_object(
           'id', rm.id,
           'body', CASE WHEN rm.deleted_at IS NULL THEN rm.body ELSE '' END,
           'deletedAt', rm.deleted_at,
           'senderName', ru.display_name,
           'senderId', ru.id
         ) END AS reply,
         CASE WHEN fm.id IS NULL THEN NULL ELSE jsonb_build_object(
           'messageId', fm.id,
           'senderName', fu.display_name
         ) END AS forwarded,
         COALESCE(
           jsonb_agg(
             DISTINCT jsonb_build_object(
               'id', a.id,
               'name', a.original_name,
               'mimeType', a.mime_type,
               'size', a.size_bytes,
               'url', '/api/files/' || a.id,
               'kind', a.media_kind,
               'durationMs', a.duration_ms
             )
           ) FILTER (WHERE a.id IS NOT NULL),
           '[]'::jsonb
         ) AS attachments,
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'emoji', grouped.emoji,
                 'count', grouped.reaction_count,
                 'userIds', grouped.user_ids
               ) ORDER BY grouped.first_reaction
             )
             FROM (
               SELECT mr.emoji,
                      count(*)::int AS reaction_count,
                      array_agg(mr.user_id ORDER BY mr.created_at) AS user_ids,
                      min(mr.created_at) AS first_reaction
                 FROM message_reactions mr
                WHERE mr.message_id = m.id
                GROUP BY mr.emoji
             ) grouped
           ),
           '[]'::jsonb
         ) AS reactions,
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object('userId', reader.user_id, 'readAt', reader.last_read_at)
               ORDER BY reader.last_read_at
             )
             FROM conversation_members reader
             WHERE reader.conversation_id = m.conversation_id
               AND reader.user_id <> m.sender_id
               AND reader.last_read_at >= m.created_at
           ),
           '[]'::jsonb
         ) AS "readBy"
         ,COALESCE(
           (SELECT jsonb_agg(viewer.user_id ORDER BY viewer.viewed_at)
              FROM message_views viewer WHERE viewer.message_id = m.id),
           '[]'::jsonb
         ) AS "viewedBy"
         ,(SELECT pin.pinned_at FROM conversation_message_pins pin WHERE pin.message_id = m.id) AS "pinnedAt"
         ,(SELECT pin.pinned_by FROM conversation_message_pins pin WHERE pin.message_id = m.id) AS "pinnedBy"
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN messages rm ON rm.id = m.reply_to_id
    LEFT JOIN users ru ON ru.id = rm.sender_id
    LEFT JOIN messages fm ON fm.id = m.forwarded_from_id
    LEFT JOIN users fu ON fu.id = fm.sender_id
    LEFT JOIN attachments a ON a.message_id = m.id
`;

const messageGroup = `
  GROUP BY m.id, u.id, rm.id, ru.id, fm.id, fu.id
`;

export async function getMessage(messageId: string, client?: PoolClient) {
  const sql = `${messageSelect} WHERE m.id = $1 ${messageGroup}`;
  const result = client ? await client.query(sql, [messageId]) : await query(sql, [messageId]);
  return result.rows[0] ?? null;
}

export async function getConversationMessages(
  conversationId: string,
  userId: string,
  before?: string,
  limit = 50
) {
  const values: unknown[] = [conversationId, userId, limit];
  const beforeClause = before ? `AND m.created_at < $4` : "";
  if (before) values.push(before);
  const result = await query(
    `${messageSelect}
      WHERE m.conversation_id = $1
        AND (m.published_at IS NOT NULL OR m.sender_id = $2)
        AND (m.expires_at IS NULL OR m.expires_at > now())
        AND NOT EXISTS (
          SELECT 1 FROM message_hidden_users hidden
           WHERE hidden.message_id = m.id AND hidden.user_id = $2
        )
        ${beforeClause}
      ${messageGroup}
      ORDER BY m.created_at DESC
      LIMIT $3`,
    values
  );
  return result.rows.reverse();
}

export type MessageSearchInput = {
  query?: string;
  conversationId?: string;
  senderId?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: "all" | "text" | "files" | "image" | "video" | "audio" | "voice" | "video_circle";
  limit?: number;
};

export async function searchMessages(userId: string, input: MessageSearchInput) {
  const values: unknown[] = [userId];
  const clauses = [
    `m.deleted_at IS NULL`,
    `m.published_at IS NOT NULL`,
    `(m.expires_at IS NULL OR m.expires_at > now())`,
    `NOT EXISTS (
       SELECT 1 FROM message_hidden_users hidden
        WHERE hidden.message_id = m.id AND hidden.user_id = $1
     )`,
    `EXISTS (
       SELECT 1 FROM conversation_members access_member
        WHERE access_member.conversation_id = m.conversation_id
          AND access_member.user_id = $1
          AND access_member.hidden_at IS NULL
     )`
  ];
  const addValue = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  const searchQuery = input.query?.trim();
  if (searchQuery) {
    const placeholder = addValue(searchQuery);
    clauses.push(`(
      to_tsvector('simple', coalesce(m.body, '')) @@ plainto_tsquery('simple', ${placeholder})
      OR m.body ILIKE '%' || ${placeholder} || '%'
      OR EXISTS (
        SELECT 1 FROM attachments searched_attachment
         WHERE searched_attachment.message_id = m.id
           AND searched_attachment.original_name ILIKE '%' || ${placeholder} || '%'
      )
    )`);
  }
  if (input.conversationId) clauses.push(`m.conversation_id = ${addValue(input.conversationId)}`);
  if (input.senderId) clauses.push(`m.sender_id = ${addValue(input.senderId)}`);
  if (input.dateFrom) clauses.push(`m.created_at >= ${addValue(input.dateFrom)}`);
  if (input.dateTo) clauses.push(`m.created_at < (${addValue(input.dateTo)}::date + interval '1 day')`);

  switch (input.type) {
    case "text":
      clauses.push(`length(trim(m.body)) > 0`);
      break;
    case "files":
      clauses.push(`EXISTS (SELECT 1 FROM attachments typed_attachment WHERE typed_attachment.message_id = m.id)`);
      break;
    case "image":
    case "video":
    case "audio":
      clauses.push(`EXISTS (
        SELECT 1 FROM attachments typed_attachment
         WHERE typed_attachment.message_id = m.id
           AND typed_attachment.mime_type ILIKE '${input.type}/%'
      )`);
      break;
    case "voice":
    case "video_circle":
      clauses.push(`EXISTS (
        SELECT 1 FROM attachments typed_attachment
         WHERE typed_attachment.message_id = m.id
           AND typed_attachment.media_kind = '${input.type}'
      )`);
      break;
  }

  const limitPlaceholder = addValue(Math.min(100, Math.max(1, input.limit ?? 50)));
  const result = await query(
    `${messageSelect}
      WHERE ${clauses.join(" AND ")}
      ${messageGroup}
      ORDER BY m.created_at DESC
      LIMIT ${limitPlaceholder}`,
    values
  );
  return result.rows;
}

export async function getMessageContext(messageId: string, userId: string, radius = 25) {
  const target = await query<{ conversation_id: string; created_at: Date }>(
    `SELECT m.conversation_id, m.created_at
       FROM messages m
       JOIN conversation_members cm
         ON cm.conversation_id = m.conversation_id AND cm.user_id = $2
      WHERE m.id = $1
        AND cm.hidden_at IS NULL
        AND (m.published_at IS NOT NULL OR m.sender_id = $2)
        AND (m.expires_at IS NULL OR m.expires_at > now())
        AND NOT EXISTS (
          SELECT 1 FROM message_hidden_users hidden
           WHERE hidden.message_id = m.id AND hidden.user_id = $2
        )`,
    [messageId, userId]
  );
  const item = target.rows[0];
  if (!item) return null;

  const ids = await query<{ id: string; created_at: Date }>(
    `(SELECT id, created_at FROM messages
       WHERE conversation_id = $1 AND created_at <= $2
         AND (published_at IS NOT NULL OR sender_id = $3)
         AND (expires_at IS NULL OR expires_at > now())
         AND NOT EXISTS (SELECT 1 FROM message_hidden_users h WHERE h.message_id = messages.id AND h.user_id = $3)
       ORDER BY created_at DESC LIMIT $4)
     UNION ALL
     (SELECT id, created_at FROM messages
       WHERE conversation_id = $1 AND created_at > $2
         AND (published_at IS NOT NULL OR sender_id = $3)
         AND (expires_at IS NULL OR expires_at > now())
         AND NOT EXISTS (SELECT 1 FROM message_hidden_users h WHERE h.message_id = messages.id AND h.user_id = $3)
       ORDER BY created_at ASC LIMIT $4)`,
    [item.conversation_id, item.created_at, userId, radius]
  );
  const messageIds = [...new Set(ids.rows.map((row) => row.id))];
  if (!messageIds.length) return { conversationId: item.conversation_id, messages: [] };
  const result = await query(
    `${messageSelect}
      WHERE m.id = ANY($1::uuid[])
      ${messageGroup}
      ORDER BY m.created_at`,
    [messageIds]
  );
  return { conversationId: item.conversation_id, messages: result.rows };
}

export async function getPinnedMessages(conversationId: string, userId: string) {
  const result = await query(
    `${messageSelect}
      WHERE m.conversation_id = $1
        AND m.published_at IS NOT NULL
        AND m.deleted_at IS NULL
        AND (m.expires_at IS NULL OR m.expires_at > now())
        AND EXISTS (
          SELECT 1 FROM conversation_message_pins pin
           WHERE pin.message_id = m.id AND pin.conversation_id = $1
        )
        AND NOT EXISTS (
          SELECT 1 FROM message_hidden_users hidden
           WHERE hidden.message_id = m.id AND hidden.user_id = $2
        )
      ${messageGroup}
      ORDER BY "pinnedAt" DESC
      LIMIT 50`,
    [conversationId, userId]
  );
  return result.rows;
}
