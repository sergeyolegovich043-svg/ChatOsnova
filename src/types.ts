export type ColorTheme = "dark" | "light";

export type User = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  bio: string;
  avatarColor: string;
  avatarUrl: string | null;
  lastSeenAt: string;
  createdAt: string;
};

export type Member = {
  id: string;
  username: string;
  displayName: string;
  bio?: string;
  avatarColor: string;
  avatarUrl: string | null;
  lastSeenAt: string;
  role?: "owner" | "admin" | "member";
  online?: boolean;
};

export type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  kind: "file" | "voice" | "video_circle";
  durationMs?: number | null;
};

export type MessageReaction = {
  emoji: string;
  count: number;
  userIds: string[];
};

export type MessageReadReceipt = {
  userId: string;
  readAt: string;
};

export type MessageDeliveryState = "sending" | "error" | "scheduled" | "delivered" | "read";

export type Message = {
  id: string;
  conversationId: string;
  body: string;
  clientId?: string;
  replyToId?: string | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  silent: boolean;
  scheduledAt: string | null;
  publishedAt: string | null;
  expireSeconds: number | null;
  expiresAt: string | null;
  viewOnce: boolean;
  viewedBy: string[];
  pinnedAt: string | null;
  pinnedBy: string | null;
  createdAt: string;
  sender: Member;
  reply?: {
    id: string;
    body: string;
    deletedAt?: string | null;
    senderName: string;
    senderId: string;
  } | null;
  forwarded?: {
    messageId: string;
    senderName: string;
  } | null;
  attachments: Attachment[];
  reactions: MessageReaction[];
  readBy: MessageReadReceipt[];
  deliveryState?: MessageDeliveryState;
};

export type NotificationMode = "all" | "mentions" | "muted";

export type Conversation = {
  id: string;
  kind: "direct" | "group";
  title: string;
  avatarColor: string;
  avatarUrl: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  muted: boolean;
  manualUnread: boolean;
  archived: boolean;
  isSaved: boolean;
  notificationMode: NotificationMode;
  muteUntil: string | null;
  pinned: boolean;
  unreadCount: number;
  members: Member[];
  lastMessage: null | {
    id: string;
    body: string;
    createdAt: string;
    deletedAt?: string | null;
    senderId: string;
    senderName: string;
    attachmentCount: number;
    attachmentKind?: "file" | "voice" | "video_circle" | null;
  };
};

export type ChatFolder = {
  id: string;
  title: string;
  conversationIds: string[];
};

export type DirectoryUser = Member;

export type MessageSearchMediaType = "all" | "text" | "files" | "image" | "video" | "audio" | "voice" | "video_circle";

export type MessageSearchFilters = {
  q?: string;
  conversationId?: string;
  senderId?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: MessageSearchMediaType;
  limit?: number;
};

export type MessageSearchResult = {
  message: Message;
  conversation: Conversation;
};

export type AiMode = "search" | "summary" | "draft";

export type AiCitation = {
  sourceId: string;
  label: string;
};

export type AiAnswer = {
  answer: string;
  citations: AiCitation[];
};

export type AiStreamEvent =
  | { type: "status"; stage: "retrieval" | "generation" | "moderation" }
  | { type: "progress"; generatedChars: number }
  | { type: "result"; result: AiAnswer };
