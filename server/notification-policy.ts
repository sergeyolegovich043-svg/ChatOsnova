export type NotificationPreference = {
  username: string;
  notificationMode: "all" | "mentions" | "muted";
  muteUntil: Date | string | null;
};

export function messageMentionsUsername(body: string, username: string) {
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-zA-Z0-9_])@${escaped}(?![a-zA-Z0-9_])`, "i").test(body);
}

export function shouldNotifyRecipient(
  preference: NotificationPreference,
  body: string,
  now = new Date()
) {
  if (preference.notificationMode === "all") return true;
  if (preference.notificationMode === "mentions") {
    return messageMentionsUsername(body, preference.username);
  }
  if (!preference.muteUntil) return false;
  return new Date(preference.muteUntil).getTime() <= now.getTime();
}
