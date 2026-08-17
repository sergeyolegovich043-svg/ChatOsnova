import { describe, expect, it } from "vitest";
import { applyReadReceipt, messageDeliveryState, shouldShowPopup, upsertMessage } from "../src/message-state.js";
import type { Message } from "../src/types.js";

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    conversationId: "c1",
    body: "Привет",
    silent: false,
    scheduledAt: null,
    publishedAt: "2026-08-17T10:00:00.000Z",
    expireSeconds: null,
    expiresAt: null,
    viewOnce: false,
    viewedBy: [],
    pinnedAt: null,
    pinnedBy: null,
    createdAt: "2026-08-17T10:00:00.000Z",
    sender: {
      id: "me", username: "me", displayName: "Я", avatarColor: "#000", avatarUrl: null, lastSeenAt: ""
    },
    attachments: [],
    reactions: [],
    readBy: [],
    ...overrides
  };
}

describe("message delivery state", () => {
  it("keeps pending and error states", () => {
    expect(messageDeliveryState(message({ deliveryState: "sending" }))).toBe("sending");
    expect(messageDeliveryState(message({ deliveryState: "error" }))).toBe("error");
  });

  it("uses real read receipts", () => {
    expect(messageDeliveryState(message())).toBe("delivered");
    expect(messageDeliveryState(message({ readBy: [{ userId: "colleague", readAt: "2026-08-17T10:01:00Z" }] }))).toBe("read");
  });

  it("keeps a future message in the scheduled state until publication", () => {
    expect(messageDeliveryState(message({
      scheduledAt: "2026-08-17T11:00:00.000Z",
      publishedAt: null
    }))).toBe("scheduled");
  });

  it("replaces an optimistic message by clientId", () => {
    const pending = message({ id: "pending:client", clientId: "client", deliveryState: "sending" });
    const delivered = message({ id: "server-id", clientId: "client", deliveryState: undefined });
    const result = upsertMessage([pending], delivered);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("server-id");
    expect(messageDeliveryState(result[0])).toBe("delivered");
  });

  it("marks only own messages before readAt", () => {
    const result = applyReadReceipt(
      [message(), message({ id: "m2", createdAt: "2026-08-17T10:02:00Z" })],
      "me",
      { userId: "colleague", readAt: "2026-08-17T10:01:00Z" }
    );
    expect(result[0].readBy).toHaveLength(1);
    expect(result[1].readBy).toHaveLength(0);
  });
});

describe("popup preference", () => {
  it("supports mentions and temporary mute expiry", () => {
    expect(shouldShowPopup("mentions", null, "Привет, @barsik!", "barsik")).toBe(true);
    expect(shouldShowPopup("mentions", null, "Привет всем", "barsik")).toBe(false);
    expect(shouldShowPopup("muted", "2026-08-17T09:00:00Z", "", "barsik", Date.parse("2026-08-17T10:00:00Z"))).toBe(true);
    expect(shouldShowPopup("muted", null, "", "barsik")).toBe(false);
  });
});
