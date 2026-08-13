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

export type Message = {
  id: string;
  conversationId: string;
  body: string;
  clientId?: string;
  replyToId?: string | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  sender: Member;
  reply?: {
    id: string;
    body: string;
    deletedAt?: string | null;
    senderName: string;
  } | null;
  forwarded?: {
    messageId: string;
    senderName: string;
  } | null;
  attachments: Attachment[];
  reactions: MessageReaction[];
};

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

export type DirectoryUser = Member;
