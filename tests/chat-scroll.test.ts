import { describe, expect, it } from "vitest";
import { chatDistanceFromBottom, isChatNearBottom, scrollTopAfterPrepend } from "../src/chat-scroll";

describe("mobile chat scrolling", () => {
  it("keeps the chat attached to the latest message within the bottom threshold", () => {
    expect(isChatNearBottom({ scrollHeight: 1200, scrollTop: 540, clientHeight: 600 })).toBe(true);
    expect(isChatNearBottom({ scrollHeight: 1200, scrollTop: 450, clientHeight: 600 })).toBe(false);
  });

  it("never returns a negative distance from the bottom", () => {
    expect(chatDistanceFromBottom({ scrollHeight: 500, scrollTop: 40, clientHeight: 500 })).toBe(0);
  });

  it("preserves the visible message when older history is prepended", () => {
    expect(scrollTopAfterPrepend(120, 900, 1350)).toBe(570);
    expect(scrollTopAfterPrepend(120, 900, 850)).toBe(120);
  });
});
