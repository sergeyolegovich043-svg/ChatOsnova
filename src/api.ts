import type {
  Attachment,
  ChatFolder,
  Conversation,
  DirectoryUser,
  Message,
  MessageSearchFilters,
  MessageSearchResult,
  NotificationMode,
  User
} from "./types";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(payload?.error ?? "Не удалось выполнить запрос", response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  me: () => request<{ user: User }>("/api/auth/me"),
  login: (input: { login: string; password: string }) =>
    request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify(input) }),
  register: (input: { email: string; username: string; displayName: string; password: string }) =>
    request<{ user: User }>("/api/auth/register", { method: "POST", body: JSON.stringify(input) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  updateProfile: (input: { displayName: string; bio: string }) =>
    request<{ user: User }>("/api/profile", { method: "PATCH", body: JSON.stringify(input) }),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append("avatar", file);
    return request<{ user: User }>("/api/profile/avatar", { method: "POST", body: form });
  },
  deleteAvatar: () => request<{ user: User }>("/api/profile/avatar", { method: "DELETE" }),
  conversations: () => request<{ conversations: Conversation[] }>("/api/conversations"),
  folders: () => request<{ folders: ChatFolder[] }>("/api/folders"),
  createFolder: (title: string) => request<{ folder: ChatFolder }>("/api/folders", { method: "POST", body: JSON.stringify({ title }) }),
  updateFolder: (folderId: string, title: string) => request<{ folder: ChatFolder }>(`/api/folders/${folderId}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  updateFolderItems: (folderId: string, conversationIds: string[]) => request<void>(`/api/folders/${folderId}/items`, { method: "PUT", body: JSON.stringify({ conversationIds }) }),
  deleteFolder: (folderId: string) => request<void>(`/api/folders/${folderId}`, { method: "DELETE" }),
  savedConversation: () => request<{ conversation: Conversation }>("/api/conversations/saved", { method: "POST" }),
  users: (search = "") =>
    request<{ users: DirectoryUser[] }>(`/api/users?search=${encodeURIComponent(search)}`),
  createDirect: (userId: string) =>
    request<{ conversation: Conversation }>("/api/conversations/direct", {
      method: "POST",
      body: JSON.stringify({ userId })
    }),
  createGroup: (title: string, memberIds: string[]) =>
    request<{ conversation: Conversation }>("/api/conversations/group", {
      method: "POST",
      body: JSON.stringify({ title, memberIds })
    }),
  updateGroup: (conversationId: string, title: string) =>
    request<{ conversation: Conversation }>(`/api/conversations/${conversationId}/group`, {
      method: "PATCH",
      body: JSON.stringify({ title })
    }),
  addGroupMembers: (conversationId: string, userIds: string[]) =>
    request<{ conversation: Conversation }>(`/api/conversations/${conversationId}/members`, {
      method: "POST",
      body: JSON.stringify({ userIds })
    }),
  removeGroupMember: (conversationId: string, userId: string) =>
    request<{ conversation: Conversation }>(`/api/conversations/${conversationId}/members/${userId}`, {
      method: "DELETE"
    }),
  setGroupMemberRole: (conversationId: string, userId: string, role: "admin" | "member") =>
    request<{ conversation: Conversation }>(`/api/conversations/${conversationId}/members/${userId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role })
    }),
  uploadGroupAvatar: (conversationId: string, file: File) => {
    const form = new FormData();
    form.append("avatar", file);
    return request<{ conversation: Conversation }>(`/api/conversations/${conversationId}/avatar`, {
      method: "POST",
      body: form
    });
  },
  deleteGroupAvatar: (conversationId: string) =>
    request<{ conversation: Conversation }>(`/api/conversations/${conversationId}/avatar`, { method: "DELETE" }),
  updateNotifications: (conversationId: string, mode: NotificationMode, muteUntil?: string | null) =>
    request<{ conversation: Conversation }>(`/api/conversations/${conversationId}/notifications`, {
      method: "PATCH",
      body: JSON.stringify({ mode, muteUntil: muteUntil ?? null })
    }),
  pinConversation: (conversationId: string, pinned: boolean) =>
    request<{ pinned: boolean }>(`/api/conversations/${conversationId}/pin`, {
      method: "PATCH",
      body: JSON.stringify({ pinned })
    }),
  archiveConversation: (conversationId: string, archived: boolean) =>
    request<{ archived: boolean }>(`/api/conversations/${conversationId}/archive`, {
      method: "PATCH",
      body: JSON.stringify({ archived })
    }),
  deleteConversation: (conversationId: string) =>
    request<void>(`/api/conversations/${conversationId}`, { method: "DELETE" }),
  leaveConversation: (conversationId: string) =>
    request<void>(`/api/conversations/${conversationId}/leave`, { method: "POST" }),
  messages: (conversationId: string, before?: string) =>
    request<{ messages: Message[]; hasMore: boolean }>(
      `/api/conversations/${conversationId}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`
    ),
  searchMessages: (filters: MessageSearchFilters) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== "") params.set(key, String(value));
    });
    return request<{ results: MessageSearchResult[] }>(`/api/messages/search?${params}`);
  },
  messageContext: (messageId: string) =>
    request<{ conversationId: string; messages: Message[] }>(`/api/messages/${messageId}/context`),
  pinnedMessages: (conversationId: string) =>
    request<{ messages: Message[] }>(`/api/conversations/${conversationId}/pins`),
  sendMessage: (
    conversationId: string,
    input: {
      body: string;
      replyToId?: string | null;
      clientId: string;
      attachmentIds: string[];
      silent?: boolean;
      scheduleAt?: string | null;
      expireSeconds?: number | null;
      viewOnce?: boolean;
    }
  ) =>
    request<{ message: Message }>(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  editMessage: (messageId: string, body: string, attachmentIds: string[]) =>
    request<{ message: Message }>(`/api/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ body, attachmentIds })
    }),
  deleteMessage: (messageId: string, scope: "self" | "everyone") =>
    request<{ message: Message } | void>(`/api/messages/${messageId}?scope=${scope}`, { method: "DELETE" }),
  pinMessage: (messageId: string) =>
    request<{ message: Message }>(`/api/messages/${messageId}/pin`, { method: "POST" }),
  unpinMessage: (messageId: string) =>
    request<{ message: Message }>(`/api/messages/${messageId}/pin`, { method: "DELETE" }),
  viewOnce: (messageId: string) =>
    request<{ message: Message }>(`/api/messages/${messageId}/view-once`, { method: "POST" }),
  forwardMessage: (messageId: string, targetConversationId: string) =>
    request<{ message: Message }>(`/api/messages/${messageId}/forward`, {
      method: "POST",
      body: JSON.stringify({ targetConversationId })
    }),
  read: (conversationId: string) =>
    request<void>(`/api/conversations/${conversationId}/read`, { method: "POST" }),
  markUnread: (conversationId: string) =>
    request<void>(`/api/conversations/${conversationId}/unread`, { method: "POST" }),
  upload: async (
    files: File[],
    metadata?: { kind: "voice" | "video_circle"; durationMs: number }
  ) => {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    if (metadata) {
      form.append("mediaKind", metadata.kind);
      form.append("durationMs", String(metadata.durationMs));
    }
    return request<{ attachments: Attachment[] }>("/api/uploads", { method: "POST", body: form });
  },
  toggleReaction: (messageId: string, emoji: string) =>
    request<{ message: Message }>(`/api/messages/${messageId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji })
    }),
  pushPublicKey: () => request<{ publicKey: string | null }>("/api/push/public-key"),
  subscribePush: (subscription: PushSubscriptionJSON) =>
    request<{ ok: true }>("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(subscription)
    }),
  testPush: () => request<{ delivered: number }>("/api/push/test", { method: "POST" })
};
