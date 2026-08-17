import { describe, expect, it, vi } from "vitest";
import { clampPetX, PET_ENABLED_KEY, readPetEnabled, savePetEnabled } from "../src/pet";

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

  it("keeps the pet inside the viewport", () => {
    expect(clampPetX(-300, 1280)).toBe(12);
    expect(clampPetX(500, 1280)).toBe(500);
    expect(clampPetX(2_000, 1280)).toBe(1_120);
    expect(clampPetX(40, 120)).toBe(12);
  });
});
