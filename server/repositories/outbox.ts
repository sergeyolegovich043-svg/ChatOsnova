import { transaction } from "../db.js";

export type OutboxEvent = {
  id: string;
  eventType: "message.created" | "message.updated" | "message.deleted" | "attachment.ready" | "member.removed" | "conversation.deleted";
  aggregateId: string;
  payload: Record<string, string>;
  attempts: number;
};

export async function claimOutboxEvents(limit = 25) {
  return transaction(async (client) => {
    const result = await client.query<OutboxEvent>(
      `WITH candidates AS (
         SELECT id
           FROM outbox_events
          WHERE processed_at IS NULL
            AND available_at <= now()
            AND (locked_until IS NULL OR locked_until < now())
          ORDER BY created_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE outbox_events event
          SET locked_until = now() + interval '2 minutes', attempts = attempts + 1
         FROM candidates
        WHERE event.id = candidates.id
       RETURNING event.id,
                 event.event_type AS "eventType",
                 event.aggregate_id AS "aggregateId",
                 event.payload,
                 event.attempts`,
      [limit]
    );
    return result.rows;
  });
}

export async function completeOutboxEvent(id: string) {
  await transaction(async (client) => {
    await client.query(
      "UPDATE outbox_events SET processed_at = now(), locked_until = NULL, last_error = NULL WHERE id = $1",
      [id]
    );
    await client.query(
      `INSERT INTO ai_index_jobs (outbox_event_id, status, attempts, updated_at)
       VALUES ($1, 'completed', 1, now())
       ON CONFLICT (outbox_event_id) DO UPDATE
         SET status = 'completed', updated_at = now(), last_error = NULL`,
      [id]
    );
  });
}

export async function failOutboxEvent(id: string, error: string, attempts: number) {
  const terminal = attempts >= 8;
  await transaction(async (client) => {
    await client.query(
      `UPDATE outbox_events
          SET locked_until = NULL,
              available_at = now() + make_interval(secs => LEAST(3600, $3)),
              last_error = $2,
              processed_at = CASE WHEN $4 THEN now() ELSE NULL END
        WHERE id = $1`,
      [id, error.slice(0, 500), 15 * 2 ** Math.min(attempts, 8), terminal]
    );
    await client.query(
      `INSERT INTO ai_index_jobs (outbox_event_id, status, attempts, last_error, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (outbox_event_id) DO UPDATE
         SET status = EXCLUDED.status, attempts = EXCLUDED.attempts,
             last_error = EXCLUDED.last_error, updated_at = now()`,
      [id, terminal ? "failed" : "pending", attempts, error.slice(0, 500)]
    );
  });
}
