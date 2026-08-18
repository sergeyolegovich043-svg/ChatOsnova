import { describe, expect, it } from "vitest";
import { messageMentionsUsername, shouldNotifyRecipient } from "../server/notification-policy.js";

describe("notification policy", () => {
  it("matches a complete username mention", () => {
    expect(messageMentionsUsername("Коллеги, @sergey готово", "sergey")).toBe(true);
    expect(messageMentionsUsername("@sergey2", "sergey")).toBe(false);
  });

  it("handles all mute modes", () => {
    const now = new Date("2026-08-17T10:00:00Z");
    expect(shouldNotifyRecipient({ username: "u", notificationMode: "all", muteUntil: null }, "", now)).toBe(true);
    expect(shouldNotifyRecipient({ username: "u", notificationMode: "mentions", muteUntil: null }, "@u привет", now)).toBe(true);
    expect(shouldNotifyRecipient({ username: "u", notificationMode: "muted", muteUntil: null }, "@u", now)).toBe(false);
    expect(shouldNotifyRecipient({ username: "u", notificationMode: "muted", muteUntil: "2026-08-17T09:00:00Z" }, "", now)).toBe(true);
  });
});
