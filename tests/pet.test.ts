import { describe, expect, it, vi } from "vitest";
import {
  clampPetPosition,
  clampPetX,
  clampPetY,
  dragPetPosition,
  isPetQuiet,
  PET_ENABLED_KEY,
  PET_ONBOARDING_SEEN_KEY,
  PET_PREFERENCES_KEY,
  queuePetReaction,
  readPetEnabled,
  readPetOnboardingSeen,
  readPetPreferences,
  savePetEnabled,
  savePetOnboardingSeen,
  savePetPreferences,
  shouldAnimateUnreadStack
} from "../src/pet";

describe("pet preference", () => {
  it("is unavailable when the feature flag is off", () => {
    const storage = { getItem: vi.fn(() => "1") };
    expect(readPetEnabled(false, storage)).toBe(false);
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it("persists the preference per device", () => {
    const storage = { setItem: vi.fn() };
    savePetEnabled(true, storage);
    expect(storage.setItem).toHaveBeenCalledWith(PET_ENABLED_KEY, "1");
    savePetEnabled(false, storage);
    expect(storage.setItem).toHaveBeenLastCalledWith(PET_ENABLED_KEY, "0");
  });

  it("shows onboarding once and stores completion", () => {
    const storage = { getItem: vi.fn(() => null as string | null), setItem: vi.fn() };
    expect(readPetOnboardingSeen(storage)).toBe(false);
    savePetOnboardingSeen(storage);
    expect(storage.setItem).toHaveBeenCalledWith(PET_ONBOARDING_SEEN_KEY, "1");
    storage.getItem.mockReturnValue("1");
    expect(readPetOnboardingSeen(storage)).toBe(true);
  });

  it("starts the unread stack only when crossing the threshold", () => {
    expect(shouldAnimateUnreadStack(4, 5)).toBe(true);
    expect(shouldAnimateUnreadStack(0, 12)).toBe(true);
    expect(shouldAnimateUnreadStack(5, 6)).toBe(false);
    expect(shouldAnimateUnreadStack(8, 2)).toBe(false);
  });

  it("stores privacy and quiet-mode preferences safely", () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ showMessagePreview: false, quietUntil: 20_000 })),
      setItem: vi.fn()
    };
    const preferences = readPetPreferences(storage);
    expect(preferences).toEqual({ showMessagePreview: false, quietUntil: 20_000 });
    expect(isPetQuiet(preferences, 10_000)).toBe(true);
    expect(isPetQuiet(preferences, 30_000)).toBe(false);
    savePetPreferences(preferences, storage);
    expect(storage.setItem).toHaveBeenCalledWith(PET_PREFERENCES_KEY, JSON.stringify(preferences));
    storage.getItem.mockReturnValue("not-json");
    expect(readPetPreferences(storage)).toEqual({ showMessagePreview: true, quietUntil: null });
  });

  it("deduplicates reaction types and keeps higher-priority actions first", () => {
    const unread = { id: "unread:1", type: "unread-stack" as const };
    const oldReply = { id: "reply:1", type: "reply" as const, conversationId: "chat", messageId: "old" };
    const newReply = { id: "reply:2", type: "reply" as const, conversationId: "chat", messageId: "new" };
    const onboarding = { id: "onboarding", type: "onboarding" as const };
    expect(queuePetReaction([unread, oldReply], newReply)).toEqual([newReply, unread]);
    expect(queuePetReaction([unread, newReply], onboarding)).toEqual([onboarding, newReply, unread]);
    expect(queuePetReaction([newReply], newReply)).toEqual([newReply]);
  });

  it("keeps the pet inside the viewport", () => {
    expect(clampPetX(-300, 1280)).toBe(12);
    expect(clampPetX(500, 1280)).toBe(500);
    expect(clampPetX(2_000, 1280)).toBe(1_120);
    expect(clampPetX(40, 120)).toBe(12);
    expect(clampPetY(-100, 800, 178)).toBe(12);
    expect(clampPetY(2_000, 800, 178)).toBe(610);
    expect(clampPetPosition({ x: 2_000, y: -50 }, 1_280, 800, 167, 178)).toEqual({ x: 1_101, y: 12 });
  });

  it("moves the pet freely on both axes and clamps diagonal drags", () => {
    expect(dragPetPosition(
      { x: 900, y: 500 },
      { x: 1_000, y: 600 },
      { x: 320, y: 180 },
      1_280,
      800,
      167,
      178
    )).toEqual({ x: 220, y: 80 });

    expect(dragPetPosition(
      { x: 220, y: 80 },
      { x: 320, y: 180 },
      { x: 2_000, y: 2_000 },
      1_280,
      800,
      167,
      178
    )).toEqual({ x: 1_101, y: 610 });
  });
});
