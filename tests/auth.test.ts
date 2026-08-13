import { describe, expect, it } from "vitest";
import { hashPassword, tokenHash, verifyPassword } from "../server/auth.js";

describe("authentication primitives", () => {
  it("hashes and verifies a password without storing the original", async () => {
    const password = "Надёжный пароль 2026";
    const hash = await hashPassword(password);

    expect(hash).not.toContain(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("creates stable, non-reversible session hashes", () => {
    expect(tokenHash("session-token")).toHaveLength(64);
    expect(tokenHash("session-token")).toBe(tokenHash("session-token"));
    expect(tokenHash("session-token")).not.toBe(tokenHash("another-token"));
  });
});
