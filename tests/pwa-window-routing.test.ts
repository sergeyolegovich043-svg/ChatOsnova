import { describe, expect, it } from "vitest";
import {
  conversationIdFromUrl,
  isConversationActivelyViewed,
  selectNotificationWindow,
  type AppWindowState
} from "../src/pwa-window-routing";

const windowState = (chat: string, focused: boolean, visibilityState: AppWindowState["visibilityState"]): AppWindowState => ({
  url: `https://chat.example/?chat=${chat}`,
  focused,
  visibilityState
});

describe("PWA notification window routing", () => {
  it("recognizes only a focused visible window with the target chat as actively viewed", () => {
    const windows = [windowState("general", true, "visible"), windowState("support", false, "hidden")];

    expect(isConversationActivelyViewed(windows, "general")).toBe(true);
    expect(isConversationActivelyViewed(windows, "support")).toBe(false);
  });

  it("prefers the minimized window that already contains the notification chat", () => {
    const activeOtherChat = windowState("general", true, "visible");
    const minimizedTargetChat = windowState("support", false, "hidden");

    expect(selectNotificationWindow([activeOtherChat, minimizedTargetChat], "support")).toBe(minimizedTargetChat);
  });

  it("falls back to the focused app window when the target chat is not open", () => {
    const activeWindow = windowState("general", true, "visible");
    const hiddenWindow = windowState("random", false, "hidden");

    expect(selectNotificationWindow([hiddenWindow, activeWindow], "support")).toBe(activeWindow);
    expect(conversationIdFromUrl("not a url")).toBeNull();
  });
});
