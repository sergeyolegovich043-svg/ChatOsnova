import { describe, expect, it } from "vitest";
import { extensionForMimeType, formatMediaDuration, normalizeRecordedMimeType, pickSupportedMimeType, recordedFileName } from "../src/media";

describe("recorded media helpers", () => {
  it("selects the first recorder format supported by the browser", () => {
    expect(pickSupportedMimeType("voice", (type) => type === "audio/ogg;codecs=opus")).toBe("audio/ogg;codecs=opus");
    expect(pickSupportedMimeType("video_circle", (type) => type === "video/webm")).toBe("video/webm");
    expect(pickSupportedMimeType("voice", () => false)).toBe("");
  });

  it("formats durations and safe recorded filenames", () => {
    expect(formatMediaDuration(0)).toBe("0:00");
    expect(formatMediaDuration(65_900)).toBe("1:05");
    expect(extensionForMimeType("audio/mp4")).toBe("mp4");
    expect(recordedFileName("voice", "audio/ogg", 123)).toBe("voice-message-123.ogg");
    expect(recordedFileName("video_circle", "video/webm", 456)).toBe("video-circle-456.webm");
  });

  it("normalizes unexpected recorder MIME types", () => {
    expect(normalizeRecordedMimeType("voice", "audio/ogg;codecs=opus")).toBe("audio/ogg;codecs=opus");
    expect(normalizeRecordedMimeType("video_circle", "text/plain")).toBe("video/webm");
    expect(normalizeRecordedMimeType("voice", "")).toBe("audio/webm");
  });
});
