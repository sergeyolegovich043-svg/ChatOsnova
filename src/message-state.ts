import type { Message, MessageDeliveryState } from "./types";

export function upsertMessage(list: Message[], message: Message) {
  const index = list.findIndex((candidate) =>
    candidate.id === message.id || Boolean(message.clientId && candidate.clientId === message.clientId)
  );
  if (index === -1) return [...list, message].sort((left, right) => +new Date(left.createdAt) - +new Date(right.createdAt));
  const next = [...list];
  next[index] = message;
  return next;
}

export function messageDeliveryState(message: Message): MessageDeliveryState {
  if (message.deliveryState === "sending" || message.deliveryState === "error") return message.deliveryState;
  if (message.scheduledAt && !message.publishedAt) return "scheduled";
  return message.readBy.length > 0 ? "read" : "delivered";
}

export function applyReadReceipt(
  messages: Message[],
  currentUserId: string,
  receipt: { userId: string; readAt: string }
) {
  if (receipt.userId === currentUserId) return messages;
  const readTime = new Date(receipt.readAt).getTime();
  return messages.map((message) => {
    if (message.sender.id !== currentUserId || new Date(message.createdAt).getTime() > readTime) return message;
    if (message.readBy.some((item) => item.userId === receipt.userId)) return message;
    return { ...message, readBy: [...message.readBy, receipt], deliveryState: "read" as const };
  });
}

export function shouldShowPopup(
  mode: "all" | "mentions" | "muted",
  muteUntil: string | null,
  body: string,
  username: string,
  now = Date.now()
) {
  if (mode === "all") return true;
  if (mode === "mentions") {
    const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-zA-Z0-9_])@${escaped}(?![a-zA-Z0-9_])`, "i").test(body);
  }
  return Boolean(muteUntil && new Date(muteUntil).getTime() <= now);
}
