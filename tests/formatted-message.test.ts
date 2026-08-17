import { describe, expect, it } from "vitest";
import { mentionsUsername } from "../src/components/FormattedMessage.js";

describe("message mentions", () => {
  it("matches a complete username without partial false positives", () => {
    expect(mentionsUsername("Привет, @barsik!", "barsik")).toBe(true);
    expect(mentionsUsername("@barsik проверь сообщение", "barsik")).toBe(true);
    expect(mentionsUsername("@barsik_team", "barsik")).toBe(false);
  });
});
