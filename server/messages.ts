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
           'senderName', ru.display_name
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
         ) AS reactions
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
  before?: string,
  limit = 50
) {
  const values: unknown[] = [conversationId, limit];
  const beforeClause = before ? `AND m.created_at < $3` : "";
  if (before) values.push(before);
  const result = await query(
    `${messageSelect}
      WHERE m.conversation_id = $1 ${beforeClause}
      ${messageGroup}
      ORDER BY m.created_at DESC
      LIMIT $2`,
    values
  );
  return result.rows.reverse();
}
