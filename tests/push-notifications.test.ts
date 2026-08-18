import { describe, expect, it } from "vitest";
import { pushKeysMatch } from "../src/push-notifications";

describe("push subscription repair", () => {
  it("recognizes the current VAPID application key", () => {
    const current = Uint8Array.from([4, 12, 25, 44]).buffer;
    expect(pushKeysMatch(current, Uint8Array.from([4, 12, 25, 44]))).toBe(true);
  });

  it("forces resubscription after a VAPID key change", () => {
    const current = Uint8Array.from([4, 12, 25, 44]).buffer;
    expect(pushKeysMatch(current, Uint8Array.from([4, 12, 25, 45]))).toBe(false);
    expect(pushKeysMatch(null, Uint8Array.from([4, 12, 25, 44]))).toBe(false);
  });
});
