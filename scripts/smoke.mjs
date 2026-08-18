import { readFile } from "node:fs/promises";
import { io } from "socket.io-client";

const baseUrl = process.env.SMOKE_URL ?? "http://127.0.0.1:3000";
const origin = process.env.SMOKE_ORIGIN ?? "http://localhost:3000";
const rejectUnauthorized = process.env.SMOKE_INSECURE_TLS !== "1";
const suffix = Date.now().toString(36);

function sessionCookie(response) {
  const setCookieHeaders = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  for (const name of ["__Host-barsik_session", "cs_session"]) {
    const pattern = new RegExp(`(?:^|,\\s*)${name}=([^;,]*)`);
    for (const header of setCookieHeaders) {
      const value = header.match(pattern)?.[1];
      if (value) return `${name}=${value}`;
    }
  }
  return undefined;
}

async function request(path, { cookie, method = "GET", body, form } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: form ?? (body ? JSON.stringify(body) : undefined)
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return { payload, cookie: sessionCookie(response) };
}

async function register(label, displayName) {
  const result = await request("/api/auth/register", {
    method: "POST",
    body: {
      email: `${label}.${suffix}@example.test`,
      username: `${label}_${suffix}`,
      displayName,
      password: "StrongPass!123"
    }
  });
  if (!result.cookie) throw new Error("Registration did not return a session cookie");
  return result;
}

const alice = await register("alice", "Алиса Проверка");
const bob = await register("bob", "Борис Проверка");
const icon = await readFile(new URL("../public/icon-192.png", import.meta.url));
const avatarForm = new FormData();
avatarForm.append("avatar", new Blob([icon], { type: "image/png" }), "аватар.png");
const avatarUpload = await request("/api/profile/avatar", { method: "POST", cookie: alice.cookie, form: avatarForm });
const avatarResponse = await fetch(`${baseUrl}${avatarUpload.payload.user.avatarUrl}`, {
  headers: { Cookie: bob.cookie }
});
const direct = await request("/api/conversations/direct", {
  method: "POST",
  cookie: alice.cookie,
  body: { userId: bob.payload.user.id }
});
const conversationId = direct.payload.conversation.id;
const group = await request("/api/conversations/group", {
  method: "POST",
  cookie: alice.cookie,
  body: { title: `Forward test ${suffix}`, memberIds: [bob.payload.user.id] }
});
const groupId = group.payload.conversation.id;

const bobSocket = io(baseUrl, {
  transports: ["websocket"],
  rejectUnauthorized,
  extraHeaders: { Cookie: bob.cookie, Origin: origin }
});

const receivedMessage = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("WebSocket message timeout")), 8_000);
  bobSocket.once("connect_error", reject);
  bobSocket.once("message:new", (message) => {
    clearTimeout(timeout);
    resolve(message);
  });
});

await new Promise((resolve, reject) => {
  if (bobSocket.connected) return resolve();
  bobSocket.once("connect", resolve);
  bobSocket.once("connect_error", reject);
});

const wrongOriginSocket = io(baseUrl, {
  transports: ["websocket"],
  reconnection: false,
  rejectUnauthorized,
  extraHeaders: { Cookie: bob.cookie, Origin: "https://evil.example" }
});
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Wrong-origin WebSocket was not rejected")), 5_000);
  wrongOriginSocket.once("connect", () => {
    clearTimeout(timeout);
    reject(new Error("Wrong-origin WebSocket connected"));
  });
  wrongOriginSocket.once("connect_error", () => {
    clearTimeout(timeout);
    resolve();
  });
});
wrongOriginSocket.disconnect();

const form = new FormData();
form.append("files", new Blob([icon], { type: "image/png" }), "проверка.png");
const uploaded = await request("/api/uploads", { method: "POST", cookie: alice.cookie, form });

const sent = await request(`/api/conversations/${conversationId}/messages`, {
  method: "POST",
  cookie: alice.cookie,
  body: {
    body: "Привет! Проверяем доставку без потери кириллицы.",
    clientId: crypto.randomUUID(),
    attachmentIds: uploaded.payload.attachments.map((attachment) => attachment.id)
  }
});

const archiveForm = new FormData();
archiveForm.append("files", new Blob(["PK-barsikchat-zip"], { type: "application/zip" }), "barsikchat-test.zip");
archiveForm.append("files", new Blob(["Rar!-barsikchat-rar"], { type: "application/vnd.rar" }), "barsikchat-test.rar");
const archiveUpload = await request("/api/uploads", { method: "POST", cookie: alice.cookie, form: archiveForm });
const archiveMessage = await request(`/api/conversations/${conversationId}/messages`, {
  method: "POST",
  cookie: alice.cookie,
  body: {
    body: "Archives",
    clientId: crypto.randomUUID(),
    attachmentIds: archiveUpload.payload.attachments.map((attachment) => attachment.id)
  }
});
const archiveDownloads = await Promise.all(archiveMessage.payload.message.attachments.map((attachment) =>
  fetch(`${baseUrl}${attachment.url}`, { headers: { Cookie: bob.cookie } })
));
const deletedArchiveUrl = archiveMessage.payload.message.attachments[0].url;
await request(`/api/messages/${archiveMessage.payload.message.id}`, { method: "DELETE", cookie: alice.cookie });
const deletedArchiveDownload = await fetch(`${baseUrl}${deletedArchiveUrl}`, { headers: { Cookie: bob.cookie } });

const forwarded = await request(`/api/messages/${sent.payload.message.id}/forward`, {
  method: "POST",
  cookie: alice.cookie,
  body: { targetConversationId: groupId }
});
const forwardedDownload = await fetch(`${baseUrl}${forwarded.payload.message.attachments[0].url}`, {
  headers: { Cookie: bob.cookie }
});

const realtimeMessage = await receivedMessage;
const history = await request(`/api/conversations/${conversationId}/messages`, { cookie: bob.cookie });
const attachmentResponse = await fetch(`${baseUrl}${sent.payload.message.attachments[0].url}`, {
  headers: { Cookie: bob.cookie }
});

const reactionReceived = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("WebSocket reaction timeout")), 8_000);
  bobSocket.on("message:updated", (message) => {
    if (message.id !== sent.payload.message.id || !message.reactions?.some((reaction) => reaction.emoji === "🔥")) return;
    clearTimeout(timeout);
    resolve(message);
  });
});

const reacted = await request(`/api/messages/${sent.payload.message.id}/reactions`, {
  method: "POST",
  cookie: alice.cookie,
  body: { emoji: "🔥" }
});
const realtimeReaction = await reactionReceived;

async function sendRecordedFixture(kind, mimeType, durationMs) {
  const mediaForm = new FormData();
  mediaForm.append("files", new Blob([`barsikchat-${kind}`], { type: mimeType }), `${kind}.webm`);
  mediaForm.append("mediaKind", kind);
  mediaForm.append("durationMs", String(durationMs));
  const mediaUpload = await request("/api/uploads", { method: "POST", cookie: alice.cookie, form: mediaForm });
  return request(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    cookie: alice.cookie,
    body: {
      body: "",
      clientId: crypto.randomUUID(),
      attachmentIds: mediaUpload.payload.attachments.map((attachment) => attachment.id)
    }
  });
}

const voice = await sendRecordedFixture("voice", "audio/webm", 1_250);
const videoCircle = await sendRecordedFixture("video_circle", "text/plain", 2_500);
const unreadBeforeRead = await request("/api/conversations", { cookie: bob.cookie });
const unreadConversation = unreadBeforeRead.payload.conversations.find((conversation) => conversation.id === conversationId);
await request(`/api/conversations/${conversationId}/read`, { method: "POST", cookie: bob.cookie });
const unreadAfterRead = await request("/api/conversations", { cookie: bob.cookie });
const readConversation = unreadAfterRead.payload.conversations.find((conversation) => conversation.id === conversationId);

await request(`/api/conversations/${groupId}/pin`, {
  method: "PATCH",
  cookie: bob.cookie,
  body: { pinned: true }
});
const pinnedList = await request("/api/conversations", { cookie: bob.cookie });
const pinnedConversation = pinnedList.payload.conversations.find((conversation) => conversation.id === groupId);

const bobGroupMessage = await request(`/api/conversations/${groupId}/messages`, {
  method: "POST",
  cookie: bob.cookie,
  body: { body: "Message before leaving", clientId: crypto.randomUUID(), attachmentIds: [] }
});

await request(`/api/conversations/${conversationId}`, { method: "DELETE", cookie: bob.cookie });
const hiddenList = await request("/api/conversations", { cookie: bob.cookie });
const hiddenDirect = hiddenList.payload.conversations.find((conversation) => conversation.id === conversationId);
await request(`/api/conversations/${conversationId}/messages`, {
  method: "POST",
  cookie: alice.cookie,
  body: { body: "Restore hidden chat", clientId: crypto.randomUUID(), attachmentIds: [] }
});
const restoredList = await request("/api/conversations", { cookie: bob.cookie });
const restoredDirect = restoredList.payload.conversations.find((conversation) => conversation.id === conversationId);
await request(`/api/conversations/${conversationId}`, { method: "DELETE", cookie: bob.cookie });

await request(`/api/conversations/${groupId}/leave`, { method: "POST", cookie: bob.cookie });
const afterLeave = await request("/api/conversations", { cookie: bob.cookie });
const leftGroup = afterLeave.payload.conversations.find((conversation) => conversation.id === groupId);
let leakedAfterLeave = false;
bobSocket.on("message:new", (message) => {
  if (message.conversationId === groupId && message.body === "Must not leak after leave") leakedAfterLeave = true;
});
const postLeaveMessage = await request(`/api/conversations/${groupId}/messages`, {
  method: "POST",
  cookie: alice.cookie,
  body: { body: "Must not leak after leave", clientId: crypto.randomUUID(), attachmentIds: [] }
});
await new Promise((resolve) => setTimeout(resolve, 300));
const editAfterLeave = await fetch(`${baseUrl}/api/messages/${bobGroupMessage.payload.message.id}`, {
  method: "PATCH",
  headers: { Origin: origin, Cookie: bob.cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ body: "Unauthorized edit" })
});
await request(`/api/conversations/${groupId}`, { method: "DELETE", cookie: alice.cookie });
bobSocket.disconnect();

if (realtimeMessage.body !== sent.payload.message.body) throw new Error("WebSocket payload mismatch");
if (history.payload.messages.find((message) => message.id === sent.payload.message.id)?.body !== sent.payload.message.body) throw new Error("History payload mismatch");
if (!attachmentResponse.ok) throw new Error(`Attachment download failed: ${attachmentResponse.status}`);
if (archiveMessage.payload.message.attachments.map((attachment) => attachment.name).sort().join(",") !== "barsikchat-test.rar,barsikchat-test.zip") throw new Error("ZIP/RAR upload mismatch");
if (archiveDownloads.some((response) => !response.ok || !response.headers.get("content-disposition")?.includes("attachment"))) throw new Error("Archive download mismatch");
if (deletedArchiveDownload.status !== 404) throw new Error(`Deleted attachment is still downloadable: ${deletedArchiveDownload.status}`);
if (!forwarded.payload.message.forwarded || forwarded.payload.message.attachments.length !== sent.payload.message.attachments.length) throw new Error("Forwarded message mismatch");
if (!forwardedDownload.ok) throw new Error("Forwarded attachment download failed");
if (!avatarUpload.payload.user.avatarUrl || !avatarResponse.ok) throw new Error("Avatar upload or download failed");
if (!direct.payload.conversation.members.some((member) => member.id === alice.payload.user.id && member.avatarUrl)) throw new Error("Conversation avatar metadata mismatch");
if (reacted.payload.message.reactions[0]?.emoji !== "🔥") throw new Error("Reaction API mismatch");
if (realtimeReaction.reactions[0]?.emoji !== "🔥") throw new Error("Reaction realtime mismatch");
if (voice.payload.message.attachments[0]?.kind !== "voice") throw new Error("Voice metadata mismatch");
if (voice.payload.message.attachments[0]?.durationMs !== 1_250) throw new Error("Voice duration mismatch");
if (videoCircle.payload.message.attachments[0]?.kind !== "video_circle") throw new Error("Video circle metadata mismatch");
if (videoCircle.payload.message.attachments[0]?.durationMs !== 2_500) throw new Error("Video circle duration mismatch");
if (videoCircle.payload.message.attachments[0]?.mimeType !== "video/webm") throw new Error("Video circle MIME normalization mismatch");
if ((unreadConversation?.unreadCount ?? 0) < 3) throw new Error("Unread counter did not increase");
if (readConversation?.unreadCount !== 0) throw new Error("Unread counter did not clear after reading");
if (!pinnedConversation?.pinned || pinnedList.payload.conversations[0]?.id !== groupId) throw new Error("Pinned conversation ordering mismatch");
if (hiddenDirect) throw new Error("Deleted direct conversation is still visible");
if (!restoredDirect) throw new Error("Hidden direct conversation was not restored by a new message");
if (leftGroup) throw new Error("Left group is still visible");
if (leakedAfterLeave) throw new Error("WebSocket still received group messages after leaving");
if (editAfterLeave.status !== 404) throw new Error(`Former member edited a group message: ${editAfterLeave.status}`);
const removedAvatar = await request("/api/profile/avatar", { method: "DELETE", cookie: alice.cookie });
if (removedAvatar.payload.user.avatarUrl !== null) throw new Error("Avatar deletion mismatch");

console.log(JSON.stringify({
  ok: true,
  auth: true,
  directChat: true,
  websocket: true,
  websocketOriginProtection: true,
  unicode: true,
  attachment: true,
  archives: true,
  forwarding: true,
  pinnedChats: true,
  deleteChat: true,
  deleteGroup: true,
  revokedGroupAccess: true,
  avatar: true,
  avatarDelete: true,
  reactions: true,
  unreadReceipts: true,
  voice: true,
  videoCircle: true,
  conversationId,
  testUserIds: [alice.payload.user.id, bob.payload.user.id]
}));
