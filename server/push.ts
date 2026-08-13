import webpush from "web-push";
import { config } from "./config.js";
import { query } from "./db.js";

const enabled = Boolean(config.vapidPublicKey && config.vapidPrivateKey);

if (enabled) {
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
}

export const publicVapidKey = enabled ? config.vapidPublicKey : null;

export async function sendMessagePush(input: {
  conversationId: string;
  senderId: string;
  senderName: string;
  title: string;
  body: string;
}) {
  if (!enabled) return;
  const result = await query<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>(
    `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN conversation_members cm ON cm.user_id = ps.user_id
      WHERE cm.conversation_id = $1 AND ps.user_id <> $2 AND cm.muted = false`,
    [input.conversationId, input.senderId]
  );

  const payload = JSON.stringify({
    title: input.title,
    body: `${input.senderName}: ${input.body || "Вложение"}`,
    conversationId: input.conversationId,
    url: `/?chat=${input.conversationId}`
  });

  await Promise.all(
    result.rows.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth }
          },
          payload,
          { TTL: 60 * 60 }
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await query("DELETE FROM push_subscriptions WHERE id = $1", [subscription.id]);
        } else {
          console.warn("Push delivery failed", statusCode ?? error);
        }
      }
    })
  );
}
