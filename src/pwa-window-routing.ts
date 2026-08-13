export type AppWindowState = {
  url: string;
  visibilityState: "hidden" | "visible" | "prerender";
  focused: boolean;
};

export function conversationIdFromUrl(url: string) {
  try {
    return new URL(url).searchParams.get("chat");
  } catch {
    return null;
  }
}

export function isConversationActivelyViewed(windows: readonly AppWindowState[], conversationId?: string | null) {
  if (!conversationId) return false;
  return windows.some((client) =>
    client.focused
    && client.visibilityState === "visible"
    && conversationIdFromUrl(client.url) === conversationId
  );
}

export function selectNotificationWindow<T extends AppWindowState>(windows: readonly T[], conversationId?: string | null) {
  return [...windows].sort((left, right) => {
    const score = (client: AppWindowState) =>
      (conversationId && conversationIdFromUrl(client.url) === conversationId ? 100 : 0)
      + (client.focused ? 20 : 0)
      + (client.visibilityState === "visible" ? 10 : 0);
    return score(right) - score(left);
  })[0];
}
