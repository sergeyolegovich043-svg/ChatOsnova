import { describe, expect, it } from "vitest";
import { isAllowedOrigin, isSafePushEndpoint, normalizedOrigin } from "../server/security.js";

describe("request origin validation", () => {
  it("accepts only the configured or actual application origin", () => {
    expect(isAllowedOrigin("https://chat.example.com", "http://127.0.0.1:3000", "https://chat.example.com")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3000", "http://127.0.0.1:3000", "https://chat.example.com")).toBe(true);
    expect(isAllowedOrigin("https://evil.example", "http://127.0.0.1:3000", "https://chat.example.com")).toBe(false);
    expect(isAllowedOrigin(undefined, "http://127.0.0.1:3000", "https://chat.example.com")).toBe(false);
    expect(normalizedOrigin("https://chat.example.com/path")).toBe("https://chat.example.com");
  });
});

describe("push endpoint validation", () => {
  it("allows public HTTPS push services", () => {
    expect(isSafePushEndpoint("https://fcm.googleapis.com/fcm/send/example")).toBe(true);
    expect(isSafePushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/example")).toBe(true);
  });

  it("blocks local, private and non-HTTPS endpoints", () => {
    expect(isSafePushEndpoint("http://push.example.com/endpoint")).toBe(false);
    expect(isSafePushEndpoint("https://localhost/endpoint")).toBe(false);
    expect(isSafePushEndpoint("https://127.0.0.1/endpoint")).toBe(false);
    expect(isSafePushEndpoint("https://192.168.1.10/endpoint")).toBe(false);
    expect(isSafePushEndpoint("https://[::1]/endpoint")).toBe(false);
  });
});
