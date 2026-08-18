import webpush from "web-push";
import { config } from "./config.js";
import { query } from "./db.js";
import { shouldNotifyRecipient } from "./notification-policy.js";

const enabled = Boolean(config.vapidPublicKey && config.vapidPrivateKey);

if (enabled) {
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
}

export const publicVapidKey = enabled ? config.vapidPublicKey : null;
export const pushEnabled = enabled;

type StoredPushSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

async function deliverPush(subscription: StoredPushSubscription, payload: string) {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth }
      },
      payload,
      { TTL: 60 * 60, urgency: "high" }
    );
    return true;
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      await query("DELETE FROM push_subscriptions WHERE id = $1", [subscription.id]);
    } else {
      console.warn("Push delivery failed", statusCode ?? error);
    }
    return false;
  }
}

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
    username: string;
    notificationMode: "all" | "mentions" | "muted";
    muteUntil: Date | null;
  }>(
    `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth,
            u.username,
            cm.notification_mode AS "notificationMode",
            cm.mute_until AS "muteUntil"
       FROM push_subscriptions ps
       JOIN conversation_members cm ON cm.user_id = ps.user_id
       JOIN users u ON u.id = ps.user_id
      WHERE cm.conversation_id = $1 AND ps.user_id <> $2`,
    [input.conversationId, input.senderId]
  );

  const payload = JSON.stringify({
    title: input.title,
    body: `${input.senderName}: ${input.body || "Вложение"}`,
    conversationId: input.conversationId,
    url: `/?chat=${input.conversationId}`
  });

  await Promise.all(
    result.rows
      .filter((subscription) => shouldNotifyRecipient(subscription, input.body))
      .map((subscription) => deliverPush(subscription, payload))
  );
}

export async function sendTestPush(userId: string) {
  if (!enabled) return 0;
  const subscriptions = await query<StoredPushSubscription>(
    "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1",
    [userId]
  );
  const payload = JSON.stringify({
    title: "BarsikChat",
    body: "Готово — push-уведомления и звук работают",
    url: "/"
  });
  const results = await Promise.all(subscriptions.rows.map((subscription) => deliverPush(subscription, payload)));
  return results.filter(Boolean).length;
}
