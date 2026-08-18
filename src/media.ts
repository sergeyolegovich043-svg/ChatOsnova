import type { Attachment } from "./types";

export type RecordedMediaKind = "voice" | "video_circle";

const recorderTypes: Record<RecordedMediaKind, string[]> = {
  voice: ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"],
  video_circle: [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/mp4;codecs=h264,aac",
    "video/webm"
  ]
};

export function pickSupportedMimeType(
  kind: RecordedMediaKind,
  supports: (mimeType: string) => boolean = (mimeType) => MediaRecorder.isTypeSupported(mimeType)
) {
  return recorderTypes[kind].find((mimeType) => supports(mimeType)) ?? "";
}

export function normalizeRecordedMimeType(kind: RecordedMediaKind, mimeType: string) {
  const expectedPrefix = kind === "voice" ? "audio/" : "video/";
  return mimeType.startsWith(expectedPrefix) ? mimeType : `${expectedPrefix}webm`;
}

export function extensionForMimeType(mimeType: string) {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

export function recordedFileName(kind: RecordedMediaKind, mimeType: string, timestamp = Date.now()) {
  const prefix = kind === "voice" ? "voice-message" : "video-circle";
  return `${prefix}-${timestamp}.${extensionForMimeType(mimeType)}`;
}

export function formatMediaDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function attachmentPresentation(attachment: Attachment) {
  if (attachment.kind === "voice" || attachment.mimeType.startsWith("audio/")) return "voice";
  if (attachment.kind === "video_circle") return "video_circle";
  if (attachment.mimeType.startsWith("image/")) return "image";
  return "file";
}
