import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowBendUpRight as Forward,
  ArrowDown,
  ArrowLeft,
  Archive,
  Checks as CheckCheck,
  DownloadSimple as Download,
  File,
  Folder,
  FolderPlus,
  Star,
  Image as ImageIcon,
  Info,
  ChatCircleDots as MessageCircleMore,
  NotePencil,
  PaperPlaneTilt,
  PencilSimple as Pencil,
  PushPin,
  PushPinSlash,
  ArrowBendUpLeft as Reply,
  Check,
  CheckSquare,
  Copy,
  LinkSimple,
  CalendarBlank,
  Eye,
  EyeSlash,
  SpeakerSlash,
  Timer,
  Clock,
  MagnifyingGlass as Search,
  Smiley as SmilePlus,
  Trash as Trash2,
  SignOut,
  WarningCircle,
  X
} from "@phosphor-icons/react";
import { io, type Socket } from "socket.io-client";
import { api } from "../api";
import { featureFlags } from "../features";
import { applyReadReceipt, messageDeliveryState, shouldShowPopup, upsertMessage } from "../message-state";
import {
  hasNativePetBridge,
  notifyNativePet,
  readPetEnabled,
  savePetEnabled,
  syncNativePetActivity,
  syncNativePet,
  type PetActivity,
  type PetNotification,
  type PetReaction
} from "../pet";
import type { Attachment, ChatFolder, ColorTheme, Conversation, Member, Message, MessageSearchResult, User } from "../types";
import type { RecordedMediaKind } from "../media";
import { Avatar } from "./Avatar";
import { BrandLogo } from "./BrandLogo";
import { EmojiPicker } from "./EmojiPicker";
import { VideoCircleMessage, VoiceMessage } from "./MediaMessage";
import { MessageComposer } from "./MessageComposer";
import { NewChatModal } from "./NewChatModal";
import { ProfileModal } from "./ProfileModal";
import { ChatDetailsModal } from "./ChatDetailsModal";
import { ForwardMessageModal } from "./ForwardMessageModal";
import { FormattedMessage, mentionsUsername } from "./FormattedMessage";

const PetCompanion = featureFlags.petCompanion
  ? lazy(() => import("./PetCompanion").then((module) => ({ default: module.PetCompanion })))
  : null;

type MessengerProps = {
  user: User;
  setUser: (user: User) => void;
  onLogout: () => void;
  canInstall: boolean;
  installApp: () => Promise<boolean>;
  theme: ColorTheme;
  onThemeChange: (theme: ColorTheme) => void;
};

type TypingPerson = { conversationId: string; userId: string; displayName: string };

type MessagePopup = {
  id: string;
  conversationId: string;
  title: string;
  subtitle: string;
  body: string;
  avatarColor: string;
  avatarUrl: string | null;
};

type MessageMenu = {
  messageId: string;
  x: number;
  y: number;
};

type ChatMenu = {
  conversationId: string;
  x: number;
  y: number;
};

type SendOptions = {
  silent: boolean;
  scheduleAt: string;
  expireSeconds: number | null;
  viewOnce: boolean;
};

type FolderEditor = {
  id: string | null;
  title: string;
  conversationIds: Set<string>;
};

const timeFormatter = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const weekdayFormatter = new Intl.DateTimeFormat("ru-RU", { weekday: "short" });
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function listTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date();
  if (isSameDay(date, today)) return timeFormatter.format(date);
  if (today.getTime() - date.getTime() < 6 * 24 * 60 * 60 * 1000) return weekdayFormatter.format(date);
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(date);
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, today)) return "Сегодня";
  if (isSameDay(date, yesterday)) return "Вчера";
  return dateFormatter.format(date);
}

function lastSeenText(value?: string, online?: boolean) {
  if (online) return "в сети";
  if (!value) return "не в сети";
  const date = new Date(value);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 2) return "был(а) только что";
  if (minutes < 60) return `был(а) ${minutes} мин. назад`;
  if (isSameDay(date, new Date())) return `был(а) сегодня в ${timeFormatter.format(date)}`;
  return `был(а) ${dateFormatter.format(date)}`;
}

function fileSize(size: number) {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

function conversationPreview(conversation: Conversation, currentUserId: string) {
  const message = conversation.lastMessage;
  if (!message) return "Чат создан — напишите первым";
  if (message.deletedAt) return "Сообщение удалено";
  const prefix = message.senderId === currentUserId ? "Вы: " : conversation.kind === "group" ? `${message.senderName}: ` : "";
  const attachmentLabel = message.attachmentKind === "voice"
    ? "🎙 Голосовое сообщение"
    : message.attachmentKind === "video_circle"
      ? "◉ Видеосообщение"
      : message.attachmentCount > 1
        ? `${message.attachmentCount} вложения`
        : "Вложение";
  return `${prefix}${message.body || attachmentLabel}`;
}

function realtimeMessagePreview(message: Message) {
  if (message.deletedAt) return "Сообщение удалено";
  if (message.body.trim()) return message.body.trim();
  const attachment = message.attachments[0];
  if (attachment?.kind === "voice") return "Голосовое сообщение";
  if (attachment?.kind === "video_circle") return "Видеосообщение";
  if (message.attachments.length > 1) return `${message.attachments.length} вложения`;
  return "Вложение";
}

function realtimeLastMessage(message: Message): NonNullable<Conversation["lastMessage"]> {
  return {
    id: message.id,
    body: message.deletedAt ? "" : message.body,
    createdAt: message.createdAt,
    deletedAt: message.deletedAt,
    senderId: message.sender.id,
    senderName: message.sender.displayName,
    attachmentCount: message.attachments.length,
    attachmentKind: message.attachments[0]?.kind ?? null
  };
}

export function Messenger({ user, setUser, onLogout, canInstall, installApp, theme, onThemeChange }: MessengerProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState("all");
  const [folderEditor, setFolderEditor] = useState<FolderEditor | null>(null);
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState(() => new URLSearchParams(window.location.search).get("chat"));
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [globalSearchResults, setGlobalSearchResults] = useState<MessageSearchResult[]>([]);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchError, setGlobalSearchError] = useState("");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadingFileNames, setUploadingFileNames] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [typingPeople, setTypingPeople] = useState<TypingPerson[]>([]);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("message"));
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const [messageMenu, setMessageMenu] = useState<MessageMenu | null>(null);
  const [forwardingMessages, setForwardingMessages] = useState<Message[]>([]);
  const [chatMenuFor, setChatMenuFor] = useState<ChatMenu | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [deleteTargets, setDeleteTargets] = useState<Message[]>([]);
  const [pinnedMessages, setPinnedMessages] = useState<Record<string, Message[]>>({});
  const [sendOptionsOpen, setSendOptionsOpen] = useState(false);
  const [sendOptions, setSendOptions] = useState<SendOptions>({ silent: false, scheduleAt: "", expireSeconds: null, viewOnce: false });
  const [viewOnceRevealed, setViewOnceRevealed] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState("");
  const [messagePopups, setMessagePopups] = useState<MessagePopup[]>([]);
  const [petEnabled, setPetEnabled] = useState(() => readPetEnabled(featureFlags.petCompanion));
  const [petNotification, setPetNotification] = useState<PetNotification | null>(null);
  const [petReaction, setPetReaction] = useState<PetReaction | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const activeIdRef = useRef<string | null>(activeId);
  const conversationsRef = useRef<Conversation[]>([]);
  const popupTimersRef = useRef(new Map<string, number>());
  const readRequestsRef = useRef(new Set<string>());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const petEnabledRef = useRef(petEnabled);
  const petReactionTimerRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeConversation = conversations.find((conversation) => conversation.id === activeId) ?? null;
  const activeMessages = activeId ? messages[activeId] ?? [] : [];
  const totalUnreadCount = useMemo(() => conversations.reduce((total, conversation) => total + conversation.unreadCount, 0), [conversations]);
  const petActivity: PetActivity | null = globalSearchLoading
    ? { type: "searching", source: "messages", label: "Ищу по перепискам" }
    : null;

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    petEnabledRef.current = petEnabled;
    savePetEnabled(petEnabled);
    void syncNativePet(petEnabled);
    if (!petEnabled) {
      setPetNotification(null);
      setPetReaction(null);
    }
  }, [petEnabled]);

  useEffect(() => {
    const nextActivity = petEnabled ? petActivity : null;
    void syncNativePetActivity(nextActivity);
    return () => {
      if (nextActivity) void syncNativePetActivity(null);
    };
  }, [globalSearchLoading, petEnabled]);

  useEffect(() => () => {
    popupTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    popupTimersRef.current.clear();
    window.clearTimeout(petReactionTimerRef.current);
  }, []);

  const triggerPetReaction = useCallback((nextReaction: PetReaction) => {
    if (!featureFlags.petCompanion || !petEnabledRef.current) return;
    window.clearTimeout(petReactionTimerRef.current);
    setPetReaction(nextReaction);
    petReactionTimerRef.current = window.setTimeout(() => setPetReaction(null), 5_000);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const result = await api.conversations();
      conversationsRef.current = result.conversations;
      setConversations(result.conversations);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось загрузить чаты");
    } finally {
      setConversationsLoading(false);
    }
  }, [showToast]);

  const loadFolders = useCallback(async () => {
    try {
      const result = await api.folders();
      setFolders(result.folders);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось загрузить папки");
    }
  }, [showToast]);

  const markConversationRead = useCallback((conversationId: string) => {
    setConversations((current) => current.map((conversation) =>
      conversation.id === conversationId && conversation.unreadCount > 0
        ? { ...conversation, unreadCount: 0, manualUnread: false }
        : conversation
    ));
    if (readRequestsRef.current.has(conversationId)) return;
    readRequestsRef.current.add(conversationId);
    void api.read(conversationId)
      .catch(() => void loadConversations())
      .finally(() => readRequestsRef.current.delete(conversationId));
  }, [loadConversations]);

  const dismissMessagePopup = useCallback((popupId: string) => {
    const timer = popupTimersRef.current.get(popupId);
    if (timer) window.clearTimeout(timer);
    popupTimersRef.current.delete(popupId);
    setMessagePopups((current) => current.filter((popup) => popup.id !== popupId));
  }, []);

  const queueMessagePopup = useCallback((message: Message, conversation?: Conversation) => {
    if (message.silent) return;
    if (conversation && !shouldShowPopup(
      conversation.notificationMode ?? "all",
      conversation.muteUntil ?? null,
      message.body,
      user.username
    )) return;
    const isGroup = conversation?.kind === "group";
    const popup: MessagePopup = {
      id: message.id,
      conversationId: message.conversationId,
      title: isGroup ? conversation.title : message.sender.displayName,
      subtitle: isGroup ? message.sender.displayName : "Новое сообщение",
      body: realtimeMessagePreview(message),
      avatarColor: isGroup ? conversation.avatarColor : message.sender.avatarColor,
      avatarUrl: isGroup ? conversation.avatarUrl : message.sender.avatarUrl
    };
    setMessagePopups((current) => [popup, ...current.filter((item) => item.id !== popup.id)].slice(0, 3));
    if (featureFlags.petCompanion && petEnabledRef.current) {
      const notification: PetNotification = {
        id: popup.id,
        conversationId: popup.conversationId,
        title: popup.title,
        subtitle: popup.subtitle,
        body: popup.body
      };
      setPetNotification(notification);
      void notifyNativePet(notification);
    }
    const previousTimer = popupTimersRef.current.get(popup.id);
    if (previousTimer) window.clearTimeout(previousTimer);
    popupTimersRef.current.set(popup.id, window.setTimeout(() => {
      popupTimersRef.current.delete(popup.id);
      setMessagePopups((current) => current.filter((item) => item.id !== popup.id));
    }, 6200));
  }, [user.username]);

  useEffect(() => {
    void loadConversations();
    void loadFolders();
  }, [loadConversations, loadFolders]);

  useEffect(() => {
    const socket = io({ withCredentials: true });
    socketRef.current = socket;

    socket.on("message:new", (message: Message) => {
      const isOwnMessage = message.sender.id === user.id;
      const isActiveAndVisible = activeIdRef.current === message.conversationId
        && document.visibilityState === "visible"
        && document.hasFocus();
      const conversationAtArrival = conversationsRef.current.find((conversation) => conversation.id === message.conversationId);
      if (!isOwnMessage && message.reply?.senderId === user.id) {
        triggerPetReaction({ id: `incoming-reply:${message.id}`, type: "reply" });
      }
      setMessages((current) => ({
        ...current,
        [message.conversationId]: upsertMessage(current[message.conversationId] ?? [], message)
      }));
      setConversations((current) => {
        const existing = current.find((conversation) => conversation.id === message.conversationId);
        if (!existing) return current;
        const updated: Conversation = {
          ...existing,
          archived: false,
          updatedAt: message.createdAt,
          lastMessage: realtimeLastMessage(message),
          unreadCount: !isOwnMessage && !isActiveAndVisible
            ? existing.unreadCount + 1
            : isActiveAndVisible ? 0 : existing.unreadCount
        };
        return [updated, ...current.filter((conversation) => conversation.id !== message.conversationId)];
      });
      if (!conversationAtArrival) void loadConversations();
      if (!isOwnMessage && isActiveAndVisible) {
        markConversationRead(message.conversationId);
      } else if (!isOwnMessage) {
        queueMessagePopup(message, conversationAtArrival);
      }
    });
    socket.on("message:updated", (message: Message) => {
      setMessages((current) => ({
        ...current,
        [message.conversationId]: upsertMessage(current[message.conversationId] ?? [], message)
      }));
      setConversations((current) => current.map((conversation) =>
        conversation.id === message.conversationId && conversation.lastMessage?.id === message.id
          ? { ...conversation, lastMessage: realtimeLastMessage(message) }
          : conversation
      ));
      setPinnedMessages((current) => ({
        ...current,
        [message.conversationId]: message.pinnedAt && !message.deletedAt
          ? upsertMessage(current[message.conversationId] ?? [], message)
          : (current[message.conversationId] ?? []).filter((item) => item.id !== message.id)
      }));
    });
    const removeMessage = (payload: { conversationId: string; messageId: string }) => {
      setMessages((current) => ({
        ...current,
        [payload.conversationId]: (current[payload.conversationId] ?? []).filter((message) => message.id !== payload.messageId)
      }));
      setPinnedMessages((current) => ({
        ...current,
        [payload.conversationId]: (current[payload.conversationId] ?? []).filter((message) => message.id !== payload.messageId)
      }));
    };
    socket.on("message:hidden", removeMessage);
    socket.on("message:expired", removeMessage);
    socket.on("conversation:unread", (payload: { conversationId: string }) => {
      setConversations((current) => current.map((conversation) =>
        conversation.id === payload.conversationId ? { ...conversation, manualUnread: true, unreadCount: Math.max(1, conversation.unreadCount) } : conversation
      ));
    });
    socket.on("conversation:new", () => void loadConversations());
    socket.on("conversation:updated", (payload: { conversationId: string }) => {
      void loadConversations();
    });
    socket.on("read:update", (payload: { conversationId: string; userId: string; readAt: string }) => {
      if (payload.userId === user.id) {
        setConversations((current) => current.map((conversation) =>
          conversation.id === payload.conversationId ? { ...conversation, unreadCount: 0 } : conversation
        ));
        return;
      }
      setMessages((current) => ({
        ...current,
        [payload.conversationId]: applyReadReceipt(current[payload.conversationId] ?? [], user.id, payload)
      }));
    });
    socket.on("conversation:pinned", (payload: { conversationId: string; pinned: boolean }) => {
      setConversations((current) => {
        const updated = current.map((conversation) => conversation.id === payload.conversationId
          ? { ...conversation, pinned: payload.pinned }
          : conversation
        );
        return [...updated].sort((left, right) => Number(right.pinned) - Number(left.pinned) || +new Date(right.updatedAt) - +new Date(left.updatedAt));
      });
    });
    socket.on("conversation:archived", (payload: { conversationId: string; archived: boolean }) => {
      setConversations((current) => current.map((conversation) => conversation.id === payload.conversationId
        ? { ...conversation, archived: payload.archived, pinned: payload.archived ? false : conversation.pinned }
        : conversation
      ));
    });
    socket.on("conversation:removed", (payload: { conversationId: string }) => {
      setConversations((current) => current.filter((conversation) => conversation.id !== payload.conversationId));
      setMessages((current) => {
        const next = { ...current };
        delete next[payload.conversationId];
        return next;
      });
      if (activeIdRef.current === payload.conversationId) {
        activeIdRef.current = null;
        setActiveId(null);
        const url = new URL(window.location.href);
        url.searchParams.delete("chat");
        window.history.replaceState({}, "", url);
      }
    });
    socket.on("typing:update", (payload: { conversationId: string; user: { id: string; displayName: string }; typing: boolean }) => {
      if (payload.user.id === user.id) return;
      setTypingPeople((current) => {
        const withoutUser = current.filter(
          (person) => !(person.conversationId === payload.conversationId && person.userId === payload.user.id)
        );
        return payload.typing
          ? [...withoutUser, { conversationId: payload.conversationId, userId: payload.user.id, displayName: payload.user.displayName }]
          : withoutUser;
      });
    });
    socket.on("presence:update", (payload: { userId: string; online: boolean; lastSeenAt?: string }) => {
      setConversations((current) =>
        current.map((conversation) => ({
          ...conversation,
          members: conversation.members.map((member) =>
            member.id === payload.userId
              ? { ...member, online: payload.online, lastSeenAt: payload.lastSeenAt ?? member.lastSeenAt }
              : member
          )
        }))
      );
    });
    socket.on("profile:updated", (profile: Member) => {
      setConversations((current) => current.map((conversation) => ({
        ...conversation,
        title: conversation.kind === "direct" && conversation.members.some((member) => member.id === profile.id) && profile.id !== user.id
          ? profile.displayName
          : conversation.title,
        avatarColor: conversation.kind === "direct" && conversation.members.some((member) => member.id === profile.id) && profile.id !== user.id
          ? profile.avatarColor
          : conversation.avatarColor,
        avatarUrl: conversation.kind === "direct" && conversation.members.some((member) => member.id === profile.id) && profile.id !== user.id
          ? profile.avatarUrl
          : conversation.avatarUrl,
        members: conversation.members.map((member) => member.id === profile.id ? { ...member, ...profile } : member)
      })));
      setMessages((current) => Object.fromEntries(
        Object.entries(current).map(([conversationId, list]) => [
          conversationId,
          list.map((message) => message.sender.id === profile.id ? { ...message, sender: { ...message.sender, ...profile } } : message)
        ])
      ));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [loadConversations, markConversationRead, queueMessagePopup, triggerPetReaction, user.id]);

  useEffect(() => {
    const readVisibleConversation = () => {
      const conversationId = activeIdRef.current;
      if (!conversationId || document.visibilityState !== "visible" || !document.hasFocus()) return;
      markConversationRead(conversationId);
    };
    document.addEventListener("visibilitychange", readVisibleConversation);
    window.addEventListener("focus", readVisibleConversation);
    return () => {
      document.removeEventListener("visibilitychange", readVisibleConversation);
      window.removeEventListener("focus", readVisibleConversation);
    };
  }, [markConversationRead]);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    markConversationRead(activeId);
    setMessagesLoading(!messages[activeId]);
    socketRef.current?.emit("conversation:join", activeId);
    api.messages(activeId)
      .then((result) => {
        if (cancelled) return;
        setMessages((current) => {
          const live = current[activeId] ?? [];
          return { ...current, [activeId]: result.messages.reduce(upsertMessage, live) };
        });
        setHasMore((current) => ({ ...current, [activeId]: result.hasMore }));
      })
      .catch((caught) => showToast(caught instanceof Error ? caught.message : "Не удалось загрузить сообщения"))
      .finally(() => !cancelled && setMessagesLoading(false));
    return () => { cancelled = true; };
    // Loading is intentionally keyed only by the selected chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, markConversationRead, showToast]);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    api.pinnedMessages(activeId)
      .then(({ messages: pinned }) => !cancelled && setPinnedMessages((current) => ({ ...current, [activeId]: pinned })))
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeId]);

  useEffect(() => {
    if (!activeId || messagesLoading || olderLoading) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeId, activeMessages.length, messagesLoading, olderLoading]);

  useEffect(() => {
    if (!highlightedMessageId || messagesLoading) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`message-${highlightedMessageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    const clear = window.setTimeout(() => setHighlightedMessageId(null), 2600);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clear);
    };
  }, [activeId, activeMessages.length, highlightedMessageId, messagesLoading]);

  useEffect(() => {
    setDraft("");
    setAttachments([]);
    setReplyTo(null);
    setEditing(null);
    setDetailsOpen(false);
    setReactionPickerFor(null);
    setMessageMenu(null);
    setChatMenuFor(null);
    setSelectedMessageIds(new Set());
    setSendOptionsOpen(false);
    setSendOptions({ silent: false, scheduleAt: "", expireSeconds: null, viewOnce: false });
  }, [activeId]);

  useEffect(() => {
    if (!messageMenu && !reactionPickerFor && !chatMenuFor) return;
    const dismissMenus = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-message-menu], [data-chat-menu], .message-reaction-picker")) return;
      setMessageMenu(null);
      setReactionPickerFor(null);
      setChatMenuFor(null);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMessageMenu(null);
      setReactionPickerFor(null);
      setChatMenuFor(null);
    };
    document.addEventListener("pointerdown", dismissMenus);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissMenus);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [chatMenuFor, messageMenu, reactionPickerFor]);

  function openMessageMenu(messageId: string, own: boolean, x: number, y: number) {
    const width = 226;
    const height = own ? 440 : 360;
    setReactionPickerFor(null);
    setMessageMenu({
      messageId,
      x: Math.max(10, Math.min(x + 4, window.innerWidth - width - 10)),
      y: Math.max(10, Math.min(y + 4, window.innerHeight - height - 10))
    });
  }

  function openChatMenu(conversationId: string, x: number, y: number) {
    const width = 180;
    const height = 250;
    setMessageMenu(null);
    setReactionPickerFor(null);
    setChatMenuFor({
      conversationId,
      x: Math.max(10, Math.min(x + 4, window.innerWidth - width - 10)),
      y: Math.max(10, Math.min(y + 4, window.innerHeight - height - 10))
    });
  }

  const hasGlobalSearch = search.trim().length > 0;
  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query) {
      return conversations.filter((conversation) => conversation.title.toLowerCase().includes(query)
        || conversationPreview(conversation, user.id).toLowerCase().includes(query));
    }
    const customFolder = folders.find((folder) => folder.id === activeFolder);
    return conversations.filter((conversation) => {
      const inFolder = activeFolder === "archive"
        ? conversation.archived
        : activeFolder === "unread"
          ? !conversation.archived && conversation.unreadCount > 0
          : activeFolder === "saved"
            ? conversation.isSaved
            : customFolder
              ? !conversation.archived && customFolder.conversationIds.includes(conversation.id)
              : !conversation.archived;
      return inFolder;
    });
  }, [activeFolder, conversations, folders, search, user.id]);

  useEffect(() => {
    const query = search.trim();
    if (!query) {
      setGlobalSearchResults([]);
      setGlobalSearchLoading(false);
      setGlobalSearchError("");
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setGlobalSearchLoading(true);
      setGlobalSearchError("");
      api.searchMessages({ q: query, limit: 40 })
        .then(({ results }) => {
          if (!cancelled) setGlobalSearchResults(results);
        })
        .catch((caught) => {
          if (!cancelled) {
            setGlobalSearchResults([]);
            setGlobalSearchError(caught instanceof Error ? caught.message : "Не удалось выполнить поиск");
          }
        })
        .finally(() => {
          if (!cancelled) setGlobalSearchLoading(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  const activeTyping = typingPeople.filter((person) => person.conversationId === activeId);
  const activePinnedMessage = activeId ? pinnedMessages[activeId]?.[0] ?? null : null;
  const selectedMessages = activeMessages.filter((message) => selectedMessageIds.has(message.id));

  function openConversation(conversationId: string, messageId?: string) {
    markConversationRead(conversationId);
    setActiveId(conversationId);
    const url = new URL(window.location.href);
    url.searchParams.set("chat", conversationId);
    if (messageId) {
      url.searchParams.set("message", messageId);
      setHighlightedMessageId(messageId);
    } else url.searchParams.delete("message");
    window.history.replaceState({}, "", url);
  }

  function updateConversation(updated: Conversation) {
    setConversations((current) => current.map((conversation) =>
      conversation.id === updated.id ? updated : conversation
    ));
  }

  async function openSearchResult(result: MessageSearchResult) {
    try {
      const context = await api.messageContext(result.message.id);
      setConversations((current) => current.some((conversation) => conversation.id === result.conversation.id)
        ? current.map((conversation) => conversation.id === result.conversation.id ? result.conversation : conversation)
        : [result.conversation, ...current]
      );
      setMessages((current) => ({
        ...current,
        [context.conversationId]: context.messages.reduce(upsertMessage, current[context.conversationId] ?? [])
      }));
      openConversation(context.conversationId, result.message.id);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось открыть найденное сообщение");
    }
  }

  useEffect(() => {
    const messageId = new URLSearchParams(window.location.search).get("message");
    if (!messageId) return;
    api.messageContext(messageId).then((context) => {
      setMessages((current) => ({
        ...current,
        [context.conversationId]: context.messages.reduce(upsertMessage, current[context.conversationId] ?? [])
      }));
      setActiveId(context.conversationId);
      setHighlightedMessageId(messageId);
    }).catch(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("message");
      window.history.replaceState({}, "", url);
    });
  }, []);

  function closeMobileConversation() {
    setActiveId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("chat");
    url.searchParams.delete("message");
    window.history.replaceState({}, "", url);
  }

  function focusGlobalSearch() {
    if (window.matchMedia("(max-width: 760px)").matches) closeMobileConversation();
    window.requestAnimationFrame(() => globalSearchInputRef.current?.focus());
  }

  async function loadOlder() {
    if (!activeId || !activeMessages.length) return;
    setOlderLoading(true);
    try {
      const result = await api.messages(activeId, activeMessages[0].createdAt);
      setMessages((current) => ({
        ...current,
        [activeId]: [...result.messages, ...(current[activeId] ?? [])].filter(
          (message, index, list) => list.findIndex((candidate) => candidate.id === message.id) === index
        )
      }));
      setHasMore((current) => ({ ...current, [activeId]: result.hasMore }));
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось загрузить историю");
    } finally {
      setOlderLoading(false);
    }
  }

  async function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;
    setUploading(true);
    setUploadingFileNames(files.map((file) => file.name));
    try {
      const result = await api.upload(files);
      setAttachments((current) => [...current, ...result.attachments].slice(0, 5));
      inputRef.current?.focus();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось загрузить файл");
    } finally {
      setUploading(false);
      setUploadingFileNames([]);
    }
  }

  function createPendingMessage(
    conversationId: string,
    body: string,
    pendingAttachments: Attachment[],
    reply: Message | null,
    clientId: string,
    options: SendOptions = sendOptions
  ): Message {
    const scheduledAt = options.scheduleAt ? new Date(options.scheduleAt).toISOString() : null;
    return {
      id: `pending:${clientId}`,
      conversationId,
      body,
      clientId,
      replyToId: reply?.id ?? null,
      silent: options.silent,
      scheduledAt,
      publishedAt: scheduledAt ? null : new Date().toISOString(),
      expireSeconds: options.expireSeconds,
      expiresAt: null,
      viewOnce: options.viewOnce,
      viewedBy: [],
      pinnedAt: null,
      pinnedBy: null,
      createdAt: scheduledAt ?? new Date().toISOString(),
      sender: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        avatarColor: user.avatarColor,
        avatarUrl: user.avatarUrl,
        lastSeenAt: user.lastSeenAt,
        role: activeConversation?.members.find((member) => member.id === user.id)?.role
      },
      reply: reply ? {
        id: reply.id,
        body: reply.body,
        deletedAt: reply.deletedAt,
        senderName: reply.sender.displayName,
        senderId: reply.sender.id
      } : null,
      attachments: pendingAttachments,
      reactions: [],
      readBy: [],
      deliveryState: scheduledAt ? "scheduled" : "sending"
    };
  }

  async function deliverPendingMessage(pending: Message) {
    try {
      const { message } = await api.sendMessage(pending.conversationId, {
        body: pending.body,
        replyToId: pending.replyToId,
        clientId: pending.clientId!,
        attachmentIds: pending.attachments.map((attachment) => attachment.id)
        ,silent: pending.silent
        ,scheduleAt: pending.scheduledAt
        ,expireSeconds: pending.expireSeconds
        ,viewOnce: pending.viewOnce
      });
      setMessages((current) => ({
        ...current,
        [pending.conversationId]: upsertMessage(current[pending.conversationId] ?? [], message)
      }));
      return message;
    } catch (caught) {
      setMessages((current) => ({
        ...current,
        [pending.conversationId]: (current[pending.conversationId] ?? []).map((message) =>
          message.clientId === pending.clientId ? { ...message, deliveryState: "error" } : message
        )
      }));
      throw caught;
    }
  }

  async function retryMessage(message: Message) {
    if (!message.clientId || message.deliveryState !== "error") return;
    const pending = { ...message, deliveryState: "sending" as const };
    setMessages((current) => ({
      ...current,
      [message.conversationId]: upsertMessage(current[message.conversationId] ?? [], pending)
    }));
    try {
      await deliverPendingMessage(pending);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось отправить сообщение повторно");
    }
  }

  async function submitMessage() {
    if (!activeId || sending || uploading) return;
    const body = draft.trim();
    if (editing) {
      const sameAttachments = attachments.map((item) => item.id).join() === editing.attachments.map((item) => item.id).join();
      if ((!body && !attachments.length) || (body === editing.body && sameAttachments)) {
        setEditing(null);
        setDraft("");
        setAttachments([]);
        return;
      }
      setSending(true);
      try {
        const { message } = await api.editMessage(editing.id, body, attachments.map((attachment) => attachment.id));
        setMessages((current) => ({ ...current, [activeId]: upsertMessage(current[activeId] ?? [], message) }));
        setEditing(null);
        setDraft("");
        setAttachments([]);
      } catch (caught) {
        showToast(caught instanceof Error ? caught.message : "Не удалось изменить сообщение");
      } finally {
        setSending(false);
      }
      return;
    }
    if (!body && !attachments.length) return;
    if (sendOptions.viewOnce && !attachments.length) {
      showToast("Для одноразового просмотра добавьте вложение");
      return;
    }
    const conversationId = activeId;
    const clientId = crypto.randomUUID();
    const pending = createPendingMessage(conversationId, body, attachments, replyTo, clientId);
    setSending(true);
    socketRef.current?.emit("typing:stop", activeId);
    setMessages((current) => ({
      ...current,
      [conversationId]: upsertMessage(current[conversationId] ?? [], pending)
    }));
    setDraft("");
    setAttachments([]);
    setReplyTo(null);
    setSendOptionsOpen(false);
    setSendOptions({ silent: false, scheduleAt: "", expireSeconds: null, viewOnce: false });
    inputRef.current?.focus();
    try {
      await deliverPendingMessage(pending);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось отправить сообщение");
    } finally {
      setSending(false);
    }
  }

  function updateDraft(value: string) {
    setDraft(value);
    if (!activeId || editing) return;
    socketRef.current?.emit("typing:start", activeId);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => socketRef.current?.emit("typing:stop", activeId), 1200);
  }

  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  }

  function beginEdit(message: Message) {
    setEditing(message);
    setReplyTo(null);
    setDraft(message.body);
    setAttachments(message.attachments);
    inputRef.current?.focus();
  }

  function beginReply(message: Message) {
    setMessageMenu(null);
    setReplyTo(message);
    setEditing(null);
    triggerPetReaction({ id: `compose-reply:${message.id}:${Date.now()}`, type: "reply" });
    inputRef.current?.focus();
  }

  async function deleteMessages(targets: Message[], scope: "self" | "everyone") {
    try {
      for (const message of targets) {
        const result = await api.deleteMessage(message.id, scope);
        setMessages((current) => ({
          ...current,
          [message.conversationId]: scope === "self"
            ? (current[message.conversationId] ?? []).filter((item) => item.id !== message.id)
            : result && "message" in result
              ? upsertMessage(current[message.conversationId] ?? [], result.message)
              : current[message.conversationId] ?? []
        }));
      }
      setSelectedMessageIds(new Set());
      setDeleteTargets([]);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось удалить сообщение");
    }
  }

  function toggleMessageSelection(messageId: string) {
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId); else next.add(messageId);
      return next;
    });
  }

  async function copyMessageText(targets: Message[]) {
    const text = targets.map((message) => message.body).filter(Boolean).join("\n\n");
    if (!text) return showToast("В выбранных сообщениях нет текста");
    await navigator.clipboard.writeText(text);
    showToast("Текст скопирован");
  }

  async function copyMessageLink(message: Message) {
    const url = new URL(window.location.href);
    url.searchParams.set("chat", message.conversationId);
    url.searchParams.set("message", message.id);
    await navigator.clipboard.writeText(url.toString());
    showToast("Ссылка на сообщение скопирована");
  }

  async function toggleMessagePin(message: Message) {
    try {
      const { message: updated } = message.pinnedAt ? await api.unpinMessage(message.id) : await api.pinMessage(message.id);
      setMessages((current) => ({ ...current, [message.conversationId]: upsertMessage(current[message.conversationId] ?? [], updated) }));
      const { messages: pinned } = await api.pinnedMessages(message.conversationId);
      setPinnedMessages((current) => ({ ...current, [message.conversationId]: pinned }));
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось изменить закрепление сообщения");
    }
  }

  async function toggleReaction(message: Message, emoji: string) {
    setReactionPickerFor(null);
    try {
      const { message: updated } = await api.toggleReaction(message.id, emoji);
      setMessages((current) => ({
        ...current,
        [message.conversationId]: upsertMessage(current[message.conversationId] ?? [], updated)
      }));
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось поставить реакцию");
    }
  }

  async function togglePinned(conversation: Conversation) {
    setChatMenuFor(null);
    const pinned = !conversation.pinned;
    try {
      await api.pinConversation(conversation.id, pinned);
      setConversations((current) => {
        const updated = current.map((item) => item.id === conversation.id ? { ...item, pinned } : item);
        return [...updated].sort((left, right) => Number(right.pinned) - Number(left.pinned) || +new Date(right.updatedAt) - +new Date(left.updatedAt));
      });
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось изменить закрепление");
    }
  }

  async function setArchived(targets: Conversation[], archived: boolean) {
    try {
      for (const conversation of targets) await api.archiveConversation(conversation.id, archived);
      setConversations((current) => current.map((conversation) => targets.some((target) => target.id === conversation.id)
        ? { ...conversation, archived, pinned: archived ? false : conversation.pinned }
        : conversation
      ));
      setSelectedConversationIds(new Set());
      setChatMenuFor(null);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось изменить архив");
    }
  }

  function toggleConversationSelection(conversationId: string) {
    setChatMenuFor(null);
    setSelectedConversationIds((current) => {
      const next = new Set(current);
      if (next.has(conversationId)) next.delete(conversationId); else next.add(conversationId);
      return next;
    });
  }

  async function bulkPin(targets: Conversation[], pinned: boolean) {
    try {
      for (const conversation of targets) await api.pinConversation(conversation.id, pinned);
      setConversations((current) => current.map((conversation) => targets.some((target) => target.id === conversation.id)
        ? { ...conversation, pinned }
        : conversation
      ));
      setSelectedConversationIds(new Set());
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось изменить закрепление чатов");
    }
  }

  async function openSavedMessages() {
    const existing = conversations.find((conversation) => conversation.isSaved);
    if (existing) return openConversation(existing.id);
    try {
      const { conversation } = await api.savedConversation();
      setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
      openConversation(conversation.id);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось открыть Избранное");
    }
  }

  async function saveFolderEditor() {
    if (!folderEditor?.title.trim()) return;
    try {
      let folderId = folderEditor.id;
      if (folderId) await api.updateFolder(folderId, folderEditor.title.trim());
      else folderId = (await api.createFolder(folderEditor.title.trim())).folder.id;
      await api.updateFolderItems(folderId, [...folderEditor.conversationIds]);
      setFolderEditor(null);
      await loadFolders();
      setActiveFolder(folderId);
      setSelectedConversationIds(new Set());
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось сохранить папку");
    }
  }

  async function removeFolder(folderId: string) {
    try {
      await api.deleteFolder(folderId);
      setFolderEditor(null);
      setActiveFolder("all");
      await loadFolders();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось удалить папку");
    }
  }

  async function removeConversation(conversation: Conversation) {
    setChatMenuFor(null);
    const ownRole = conversation.members.find((member) => member.id === user.id)?.role;
    const isLeaving = conversation.kind === "group" && ownRole !== "owner";
    const question = conversation.kind === "direct"
      ? `Удалить чат «${conversation.title}» из вашего списка?`
      : isLeaving
        ? `Выйти из группы «${conversation.title}»?`
        : `Удалить группу «${conversation.title}» для всех участников?`;
    if (!window.confirm(question)) return;
    try {
      if (isLeaving) await api.leaveConversation(conversation.id);
      else await api.deleteConversation(conversation.id);
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      if (activeIdRef.current === conversation.id) closeMobileConversation();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось удалить чат");
    }
  }

  async function forwardMessage(targetConversationId: string) {
    if (!forwardingMessages.length) return;
    try {
      for (const message of forwardingMessages) await api.forwardMessage(message.id, targetConversationId);
      setForwardingMessages([]);
      setSelectedMessageIds(new Set());
      showToast(forwardingMessages.length > 1 ? `Переслано сообщений: ${forwardingMessages.length}` : "Сообщение переслано");
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось переслать сообщение");
      throw caught;
    }
  }

  async function markUnread(conversation: Conversation) {
    setChatMenuFor(null);
    try {
      await api.markUnread(conversation.id);
      setConversations((current) => current.map((item) => item.id === conversation.id
        ? { ...item, manualUnread: true, unreadCount: Math.max(1, item.unreadCount) }
        : item
      ));
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось отметить чат непрочитанным");
    }
  }

  async function revealViewOnce(message: Message) {
    try {
      const { message: updated } = await api.viewOnce(message.id);
      setMessages((current) => ({ ...current, [message.conversationId]: upsertMessage(current[message.conversationId] ?? [], updated) }));
      setViewOnceRevealed((current) => new Set(current).add(message.id));
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Одноразовое вложение уже просмотрено");
    }
  }

  async function sendRecordedMedia(file: File, kind: RecordedMediaKind, durationMs: number) {
    if (!activeId || sending || uploading) return;
    setUploading(true);
    setSending(true);
    try {
      const uploaded = await api.upload([file], { kind, durationMs });
      const pending = createPendingMessage(activeId, "", uploaded.attachments, replyTo, crypto.randomUUID());
      setMessages((current) => ({ ...current, [activeId]: upsertMessage(current[activeId] ?? [], pending) }));
      setReplyTo(null);
      await deliverPendingMessage(pending);
    } catch (caught) {
      throw caught;
    } finally {
      setUploading(false);
      setSending(false);
    }
  }

  async function logout() {
    try {
      await api.logout();
    } finally {
      onLogout();
    }
  }

  function updateCurrentUser(updated: User) {
    setUser(updated);
    const memberProfile: Member = {
      id: updated.id,
      username: updated.username,
      displayName: updated.displayName,
      bio: updated.bio,
      avatarColor: updated.avatarColor,
      avatarUrl: updated.avatarUrl,
      lastSeenAt: updated.lastSeenAt
    };
    setConversations((current) => current.map((conversation) => ({
      ...conversation,
      members: conversation.members.map((member) => member.id === updated.id ? { ...member, ...memberProfile } : member)
    })));
    setMessages((current) => Object.fromEntries(
      Object.entries(current).map(([conversationId, list]) => [
        conversationId,
        list.map((message) => message.sender.id === updated.id ? { ...message, sender: { ...message.sender, ...memberProfile } } : message)
      ])
    ));
  }

  const otherMember = activeConversation?.kind === "direct"
    ? activeConversation.members.find((member) => member.id !== user.id)
    : undefined;

  return (
    <main className={`messenger-shell ${activeId ? "chat-open" : ""}`}>
      <aside className="chat-sidebar">
        <header className="sidebar-header">
          <button className="profile-trigger" onClick={() => setProfileOpen(true)} aria-label="Открыть профиль">
            <Avatar label={user.displayName} color={user.avatarColor} imageUrl={user.avatarUrl} size="sm" online />
          </button>
          <div className="brand sidebar-brand"><BrandLogo size="sm" /><span>Barsik<span>Chat</span></span></div>
          <button className="compose-button" onClick={() => setNewChatOpen(true)} aria-label="Новый чат"><NotePencil size={20} /></button>
        </header>

        <div className="sidebar-search-wrap">
          <div className="search-field">
            <Search size={18} />
            <input ref={globalSearchInputRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск" aria-label="Глобальный поиск" autoComplete="off" />
            {search && <button onClick={() => setSearch("")} aria-label="Очистить поиск"><X size={16} weight="bold" /></button>}
          </div>
        </div>

        {!hasGlobalSearch && <nav className="chat-folder-tabs" aria-label="Папки чатов">
          <button className={activeFolder === "all" ? "active" : ""} type="button" onClick={() => setActiveFolder("all")}>Все</button>
          <button className={activeFolder === "unread" ? "active" : ""} type="button" onClick={() => setActiveFolder("unread")}><MessageCircleMore size={14} />Непрочитанные</button>
          <button className={activeFolder === "saved" ? "active" : ""} type="button" onClick={() => { setActiveFolder("saved"); void openSavedMessages(); }}><Star size={14} />Избранное</button>
          <button className={activeFolder === "archive" ? "active" : ""} type="button" onClick={() => setActiveFolder("archive")}><Archive size={14} />Архив</button>
          {folders.map((folder) => <button className={activeFolder === folder.id ? "active" : ""} type="button" key={folder.id} onClick={() => setActiveFolder(folder.id)}><Folder size={14} />{folder.title}</button>)}
          <button className="folder-add" type="button" onClick={() => setFolderEditor({ id: null, title: "", conversationIds: new Set() })} aria-label="Создать папку"><FolderPlus size={15} /></button>
        </nav>}
        {!hasGlobalSearch && folders.some((folder) => folder.id === activeFolder) && (
          <button className="manage-active-folder" type="button" onClick={() => { const folder = folders.find((item) => item.id === activeFolder)!; setFolderEditor({ id: folder.id, title: folder.title, conversationIds: new Set(folder.conversationIds) }); }}><Pencil size={13} />Настроить папку</button>
        )}

        {selectedConversationIds.size > 0 && (
          <div className="chat-bulk-bar">
            <button type="button" onClick={() => setSelectedConversationIds(new Set())} aria-label="Отменить выбор чатов"><X size={17} /></button>
            <strong>{selectedConversationIds.size}</strong>
            <button type="button" onClick={() => void bulkPin(conversations.filter((item) => selectedConversationIds.has(item.id)), true)}><PushPin size={16} />Закрепить</button>
            <button type="button" onClick={() => void setArchived(conversations.filter((item) => selectedConversationIds.has(item.id)), activeFolder !== "archive")}><Archive size={16} />{activeFolder === "archive" ? "Вернуть" : "В архив"}</button>
            <button type="button" onClick={() => setFolderEditor({ id: null, title: "", conversationIds: new Set(selectedConversationIds) })}><FolderPlus size={16} />В папку</button>
          </div>
        )}

        <div className="conversation-list" aria-live="polite">
          {conversationsLoading && [...Array(5)].map((_, index) => <div className="conversation-skeleton" key={index}><i /><span><b /><b /></span></div>)}
          {!conversationsLoading && !hasGlobalSearch && !filteredConversations.length && (
            <div className="empty-sidebar">
              <span className="empty-icon"><MessageCircleMore size={26} /></span>
              <strong>{activeFolder === "archive" ? "Архив пуст" : activeFolder === "unread" ? "Всё прочитано" : "Пока нет чатов"}</strong>
              <p>{folders.some((folder) => folder.id === activeFolder) ? "Добавьте чаты через настройку папки" : "Начните разговор с коллегой"}</p>
              <button className="secondary-button" onClick={() => setNewChatOpen(true)}>Новый чат</button>
            </div>
          )}
          {hasGlobalSearch && filteredConversations.length > 0 && <div className="global-search-heading">Чаты</div>}
          {filteredConversations.map((conversation) => {
            const directMember = conversation.kind === "direct"
              ? conversation.members.find((member) => member.id !== user.id)
              : undefined;
            const ownRole = conversation.members.find((member) => member.id === user.id)?.role;
            const removalLabel = conversation.kind === "direct"
              ? "Удалить чат"
              : ownRole === "owner" ? "Удалить группу" : "Выйти из группы";
            return (
              <div className="conversation-row-wrap" key={conversation.id}>
                <button
                  className={`conversation-row ${activeId === conversation.id ? "active" : ""} ${conversation.unreadCount > 0 ? "unread" : ""} ${selectedConversationIds.has(conversation.id) ? "selected" : ""}`}
                  onClick={() => {
                    setChatMenuFor(null);
                    if (selectedConversationIds.size) toggleConversationSelection(conversation.id);
                    else {
                      openConversation(conversation.id);
                      if (hasGlobalSearch) setSearch("");
                    }
                  }}
                  aria-haspopup="menu"
                  aria-expanded={chatMenuFor?.conversationId === conversation.id}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openChatMenu(conversation.id, event.clientX, event.clientY);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    openChatMenu(conversation.id, rect.right, rect.top + 24);
                  }}
                >
                  <Avatar
                    user={directMember}
                    label={conversation.title}
                    color={conversation.avatarColor}
                    imageUrl={conversation.avatarUrl}
                    online={directMember?.online}
                    size="lg"
                  />
                  <span className="conversation-copy">
                    <span className="conversation-title-line"><strong>{conversation.pinned && <PushPin size={12} weight="fill" />}{conversation.title}</strong><time>{listTime(conversation.lastMessage?.createdAt ?? conversation.updatedAt)}</time></span>
                    <span className="conversation-preview-line">
                      <span>{conversationPreview(conversation, user.id)}</span>
                      {conversation.unreadCount > 0 && (
                        <b className="unread-badge" aria-label={`Непрочитанных сообщений: ${conversation.unreadCount}`}>
                          <MessageCircleMore size={12} weight="fill" />
                          <span>{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</span>
                        </b>
                      )}
                    </span>
                  </span>
                </button>
                {chatMenuFor?.conversationId === conversation.id && createPortal(
                  <div className="conversation-actions-menu" data-chat-menu role="menu" aria-label={`Действия с чатом ${conversation.title}`} style={{ left: chatMenuFor.x, top: chatMenuFor.y }}>
                    <button type="button" role="menuitem" onClick={() => void markUnread(conversation)}>
                      <MessageCircleMore size={16} /> Отметить непрочитанным
                    </button>
                    <button type="button" role="menuitem" onClick={() => void togglePinned(conversation)}>
                      {conversation.pinned ? <PushPinSlash size={16} /> : <PushPin size={16} />}
                      {conversation.pinned ? "Открепить" : "Закрепить"}
                    </button>
                    <button type="button" role="menuitem" onClick={() => void setArchived([conversation], !conversation.archived)}><Archive size={16} />{conversation.archived ? "Вернуть из архива" : "В архив"}</button>
                    <button type="button" role="menuitem" onClick={() => setFolderEditor({ id: null, title: "", conversationIds: new Set([conversation.id]) })}><FolderPlus size={16} />Добавить в папку</button>
                    <button type="button" role="menuitem" onClick={() => toggleConversationSelection(conversation.id)}><CheckSquare size={16} />Выбрать</button>
                    <button className="danger" type="button" role="menuitem" onClick={() => void removeConversation(conversation)}>
                      {conversation.kind === "group" && ownRole !== "owner" ? <SignOut size={16} /> : <Trash2 size={16} />}
                      {removalLabel}
                    </button>
                  </div>,
                  document.body
                )}
              </div>
            );
          })}
          {hasGlobalSearch && (
            <section className="global-message-results" aria-label="Найденные сообщения">
              <div className="global-search-heading">Сообщения</div>
              {globalSearchLoading && <div className="global-search-state"><span className="loader" />Ищем…</div>}
              {!globalSearchLoading && globalSearchError && <div className="global-search-state error">{globalSearchError}</div>}
              {!globalSearchLoading && !globalSearchError && globalSearchResults.map((result) => (
                <button
                  className="global-message-result"
                  type="button"
                  key={result.message.id}
                  onClick={() => {
                    setSearch("");
                    void openSearchResult(result);
                  }}
                >
                  <Avatar user={result.message.sender} size="sm" />
                  <span className="global-message-result-copy">
                    <span>
                      <strong>{result.conversation.title}</strong>
                      <time>{listTime(result.message.createdAt)}</time>
                    </span>
                    <small>{result.message.sender.id === user.id ? "Вы" : result.message.sender.displayName}</small>
                    <p>{result.message.body || result.message.attachments.map((attachment) => attachment.name).join(", ") || "Вложение"}</p>
                  </span>
                </button>
              ))}
            </section>
          )}
          {!conversationsLoading && hasGlobalSearch && !globalSearchLoading && !globalSearchError && !filteredConversations.length && !globalSearchResults.length && (
            <div className="empty-sidebar global-search-empty">
              <span className="empty-icon"><Search size={24} /></span>
              <strong>Ничего не найдено</strong>
              <p>Попробуйте изменить запрос</p>
            </div>
          )}
        </div>

        {canInstall && (
          <button className="install-strip" onClick={installApp}>
            <Download size={18} /><span><strong>Установить BarsikChat</strong><small>Нативные уведомления и быстрый запуск</small></span>
          </button>
        )}
      </aside>

      <section className="chat-stage">
        {!activeConversation ? (
          <div className="welcome-pane">
            <BrandLogo size="xl" className="welcome-mark" />
            <span className="welcome-kicker">Добро пожаловать в BarsikChat</span>
            <h1>Всё важное —<br />в одном пространстве</h1>
            <p>Выберите чат слева или начните новый разговор. Барсик уже ждёт.</p>
            <button className="primary-button" onClick={() => setNewChatOpen(true)}><NotePencil size={18} /> Новый чат</button>
          </div>
        ) : (
          <>
            <header className="chat-header">
              <button className="icon-button mobile-back" onClick={closeMobileConversation} aria-label="Назад к чатам"><ArrowLeft size={21} /></button>
              <button className="chat-person" onClick={() => setDetailsOpen(true)}>
                <Avatar user={otherMember} label={activeConversation.title} color={activeConversation.avatarColor} imageUrl={activeConversation.avatarUrl} online={otherMember?.online} />
                <span>
                  <strong>{activeConversation.title}</strong>
                  <small>
                    {activeConversation.isSaved
                      ? "Личные заметки и файлы"
                      : activeTyping.length
                      ? `${activeTyping.map((person) => person.displayName).join(", ")} печатает…`
                      : activeConversation.kind === "group"
                        ? `${activeConversation.members.length} участников`
                        : lastSeenText(otherMember?.lastSeenAt, otherMember?.online)}
                  </small>
                </span>
              </button>
              <div className="chat-header-actions">
                <button className="icon-button" onClick={focusGlobalSearch} aria-label="Глобальный поиск"><Search size={20} /></button>
                <button className="icon-button" onClick={() => setDetailsOpen(true)} aria-label="Информация о чате"><Info size={20} weight="regular" /></button>
              </div>
            </header>

            {activePinnedMessage && (
              <div className="pinned-message-bar">
                <button type="button" onClick={() => openConversation(activeConversation.id, activePinnedMessage.id)}>
                  <PushPin size={17} weight="fill" />
                  <span><strong>Закреплённое сообщение</strong><small>{activePinnedMessage.body || "Вложение"}</small></span>
                </button>
                <button type="button" onClick={() => void toggleMessagePin(activePinnedMessage)} aria-label="Открепить сообщение"><X size={16} /></button>
              </div>
            )}

            <div className="message-area">
              {messagesLoading && <div className="center-loader"><span className="loader" />Загружаем сообщения…</div>}
              {!messagesLoading && hasMore[activeConversation.id] && (
                <button className="load-older" onClick={loadOlder} disabled={olderLoading}><ArrowDown size={15} />{olderLoading ? "Загрузка…" : "Показать предыдущие"}</button>
              )}
              {!messagesLoading && !activeMessages.length && (
                <div className="conversation-start">
                  <Avatar user={otherMember} label={activeConversation.title} color={activeConversation.avatarColor} imageUrl={activeConversation.avatarUrl} size="xl" />
                  <h2>{activeConversation.title}</h2>
                  <p>{activeConversation.isSaved ? "Сохраняйте здесь заметки, файлы и важные сообщения." : activeConversation.kind === "group" ? "Группа создана. Начните обсуждение." : "Это начало вашей переписки. Поздоровайтесь!"}</p>
                </div>
              )}
              <div className="messages-list">
                {activeMessages.map((message, index) => {
                  const own = message.sender.id === user.id;
                  const previous = activeMessages[index - 1];
                  const showDate = !previous || !isSameDay(new Date(previous.createdAt), new Date(message.createdAt));
                  const grouped = previous && previous.sender.id === message.sender.id && !showDate && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;
                  const hasReactions = (message.reactions?.length ?? 0) > 0;
                  const deliveryState = own ? messageDeliveryState(message) : null;
                  const selected = selectedMessageIds.has(message.id);
                  const attention = !own && (
                    mentionsUsername(message.body, user.username) || message.reply?.senderId === user.id
                  );
                  const viewOnceConsumed = message.viewOnce && !own && message.viewedBy.includes(user.id) && !viewOnceRevealed.has(message.id);
                  return (
                    <div key={message.id}>
                      {showDate && <div className="date-divider"><span>{dayLabel(message.createdAt)}</span></div>}
                      <article
                        className={`message-row ${own ? "own" : ""} ${grouped ? "grouped" : ""} ${hasReactions ? "has-reactions" : ""} ${highlightedMessageId === message.id ? "search-highlight" : ""} ${selected ? "selected" : ""} ${attention ? "message-attention" : ""}`}
                        onClick={selectedMessageIds.size ? () => toggleMessageSelection(message.id) : undefined}
                      >
                        {selectedMessageIds.size > 0 && <span className="message-select-indicator"><CheckSquare size={20} weight={selected ? "fill" : "regular"} /></span>}
                        {!own && !grouped && <Avatar user={message.sender} size="sm" />}
                        {!own && grouped && <span className="avatar-spacer" />}
                        <div className="message-stack">
                          <div
                            className={`message-bubble ${message.deletedAt ? "deleted" : ""}`}
                            tabIndex={0}
                            aria-haspopup={message.deletedAt ? undefined : "menu"}
                            aria-expanded={messageMenu?.messageId === message.id}
                            onContextMenu={(event) => {
                              if (message.deletedAt || message.id.startsWith("pending:")) return;
                              event.preventDefault();
                              openMessageMenu(message.id, own, event.clientX, event.clientY);
                            }}
                            onKeyDown={(event) => {
                              if (message.deletedAt || (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))) return;
                              event.preventDefault();
                              const rect = event.currentTarget.getBoundingClientRect();
                              openMessageMenu(message.id, own, own ? rect.right : rect.left, rect.bottom);
                            }}
                          >
                          {!own && activeConversation.kind === "group" && !grouped && <strong className="message-sender" style={{ color: message.sender.avatarColor }}>{message.sender.displayName}</strong>}
                          {message.reply && (
                            <button className="reply-quote" onClick={() => document.getElementById(`message-${message.reply?.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                              <strong>{message.reply.senderName}</strong>
                              <span>{message.reply.deletedAt ? "Сообщение удалено" : message.reply.body || "Вложение"}</span>
                            </button>
                          )}
                          {message.forwarded && (
                            <span className="forwarded-label"><PaperPlaneTilt size={13} weight="fill" /> Переслано от {message.forwarded.senderName}</span>
                          )}
                          <div id={`message-${message.id}`}>
                            {message.deletedAt ? <em className="deleted-copy">Сообщение удалено</em> : (
                              <>
                                {message.viewOnce && !own && !viewOnceRevealed.has(message.id) ? (
                                  <button className={`view-once-card ${viewOnceConsumed ? "consumed" : ""}`} type="button" disabled={viewOnceConsumed} onClick={() => void revealViewOnce(message)}>
                                    {viewOnceConsumed ? <EyeSlash size={20} /> : <Eye size={20} />}
                                    <span><strong>{viewOnceConsumed ? "Вложение просмотрено" : "Открыть один раз"}</strong><small>{viewOnceConsumed ? "Повторный просмотр недоступен" : "После закрытия открыть снова нельзя"}</small></span>
                                  </button>
                                ) : message.attachments.length > 0 && <AttachmentGrid attachments={message.attachments} />}
                                {message.body && <FormattedMessage body={message.body} currentUsername={user.username} />}
                              </>
                            )}
                          </div>
                          <span className="message-meta">
                            {message.editedAt && <span>изменено</span>}
                            {message.silent && <SpeakerSlash size={13} aria-label="Отправлено без звука" />}
                            {message.expiresAt && <Timer size={13} aria-label="Исчезающее сообщение" />}
                            <time>{timeFormatter.format(new Date(message.createdAt))}</time>
                            {deliveryState === "sending" && <span className="message-state-label"><Clock className="delivery-sending" size={14} />отправка</span>}
                            {deliveryState === "scheduled" && <span className="message-state-label"><CalendarBlank size={14} />запланировано</span>}
                            {deliveryState === "error" && <button className="delivery-error" type="button" onClick={() => void retryMessage(message)} title="Ошибка отправки. Нажмите, чтобы повторить"><WarningCircle size={15} weight="fill" /><span>Повторить</span></button>}
                            {deliveryState === "delivered" && <Check size={15} aria-label="Доставлено" />}
                            {deliveryState === "read" && <CheckCheck size={15} weight="bold" aria-label="Прочитано" />}
                          </span>
                          {reactionPickerFor === message.id && (
                            <div className={`message-reaction-picker ${own ? "align-right" : ""}`}>
                              <EmojiPicker compact title="Быстрые реакции" onSelect={(emoji) => void toggleReaction(message, emoji)} />
                            </div>
                          )}
                          {messageMenu?.messageId === message.id && createPortal(
                            <div
                              className="message-context-menu"
                              data-message-menu
                              role="menu"
                              aria-label="Действия с сообщением"
                              style={{ left: messageMenu.x, top: messageMenu.y }}
                            >
                              <button type="button" role="menuitem" onClick={() => { setMessageMenu(null); setReactionPickerFor(message.id); }}><SmilePlus size={19} weight="regular" /><span>Добавить реакцию</span></button>
                              <button type="button" role="menuitem" onClick={() => beginReply(message)}><Reply size={19} weight="regular" /><span>Ответить</span></button>
                              <button type="button" role="menuitem" onClick={() => { setMessageMenu(null); setForwardingMessages([message]); }}><Forward size={19} weight="regular" /><span>Переслать</span></button>
                              <button type="button" role="menuitem" onClick={() => { setMessageMenu(null); void copyMessageText([message]); }}><Copy size={19} /><span>Копировать текст</span></button>
                              <button type="button" role="menuitem" onClick={() => { setMessageMenu(null); void copyMessageLink(message); }}><LinkSimple size={19} /><span>Копировать ссылку</span></button>
                              <button type="button" role="menuitem" onClick={() => { setMessageMenu(null); void toggleMessagePin(message); }}><PushPin size={19} /><span>{message.pinnedAt ? "Открепить" : "Закрепить"}</span></button>
                              <button type="button" role="menuitem" onClick={() => { setMessageMenu(null); toggleMessageSelection(message.id); }}><CheckSquare size={19} /><span>Выбрать</span></button>
                              {own && <button type="button" role="menuitem" onClick={() => { setMessageMenu(null); beginEdit(message); }}><Pencil size={19} weight="regular" /><span>Изменить</span></button>}
                              <button className="danger" type="button" role="menuitem" onClick={() => { setMessageMenu(null); setDeleteTargets([message]); }}><Trash2 size={19} weight="regular" /><span>Удалить</span></button>
                            </div>,
                            document.body
                          )}
                          </div>
                          {hasReactions && (
                            <div className="message-reactions" aria-label="Реакции на сообщение">
                              {(message.reactions ?? []).map((reaction) => (
                                <button
                                  type="button"
                                  key={reaction.emoji}
                                  className={reaction.userIds.includes(user.id) ? "active" : ""}
                                  onClick={() => void toggleReaction(message, reaction.emoji)}
                                  aria-label={`${reaction.emoji}, реакций: ${reaction.count}`}
                                >
                                  <span>{reaction.emoji}</span><b>{reaction.count}</b>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </article>
                    </div>
                  );
                })}
                {uploadingFileNames.length > 0 && (
                  <article className="message-row own upload-message-row" aria-live="polite">
                    <div className="message-stack">
                      <div className="message-bubble">
                        <div className="message-upload-progress"><span className="mini-loader" /><span><strong>Загружаем {uploadingFileNames.length > 1 ? `${uploadingFileNames.length} файла` : uploadingFileNames[0]}</strong><small>Подготавливаем вложение к отправке</small></span></div>
                        <span className="message-meta"><Clock className="delivery-sending" size={14} /> загрузка</span>
                      </div>
                    </div>
                  </article>
                )}
              </div>
              <div ref={messagesEndRef} />
            </div>

            <footer className="composer-wrap">
              {selectedMessages.length > 0 && (
                <div className="message-selection-bar">
                  <button className="icon-button" type="button" onClick={() => setSelectedMessageIds(new Set())} aria-label="Отменить выбор"><X size={20} /></button>
                  <strong>Выбрано: {selectedMessages.length}</strong>
                  <span>
                    <button type="button" onClick={() => void copyMessageText(selectedMessages)}><Copy size={18} />Копировать</button>
                    <button type="button" onClick={() => setForwardingMessages(selectedMessages)}><Forward size={18} />Переслать</button>
                    <button className="danger" type="button" onClick={() => setDeleteTargets(selectedMessages)}><Trash2 size={18} />Удалить</button>
                  </span>
                </div>
              )}
              {selectedMessages.length === 0 && (replyTo || editing) && (
                <div className="composer-context">
                  <span className="context-icon">{editing ? <Pencil size={17} /> : <Reply size={17} />}</span>
                  <span><strong>{editing ? "Редактирование" : `Ответ для ${replyTo?.sender.displayName}`}</strong><small>{editing?.body ?? replyTo?.body ?? "Вложение"}</small></span>
                  <button onClick={() => { setReplyTo(null); setEditing(null); setDraft(""); setAttachments([]); }} aria-label="Отменить"><X size={18} weight="bold" /></button>
                </div>
              )}
              {selectedMessages.length === 0 && (attachments.length > 0 || uploading) && (
                <div className="attachment-drafts">
                  {attachments.map((attachment) => (
                    <span key={attachment.id}><File size={16} /><span>{attachment.name}</span><button onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}><X size={14} weight="bold" /></button></span>
                  ))}
                  {uploading && <span className="upload-chip"><span className="mini-loader" />Загрузка…</span>}
                </div>
              )}
              <input ref={fileInputRef} type="file" multiple hidden onChange={chooseFiles} />
              {selectedMessages.length === 0 && (
                <>
                  {sendOptionsOpen && !editing && (
                    <div className="send-options-popover">
                      <label><SpeakerSlash size={18} /><span><strong>Без звука</strong><small>Без push и всплывающего уведомления</small></span><input type="checkbox" checked={sendOptions.silent} onChange={(event) => setSendOptions((current) => ({ ...current, silent: event.target.checked }))} /></label>
                      <label><CalendarBlank size={18} /><span><strong>Отправить позже</strong><small>Дата и время</small></span><input type="datetime-local" value={sendOptions.scheduleAt} onInput={(event) => { const scheduleAt = event.currentTarget.value; setSendOptions((current) => ({ ...current, scheduleAt })); }} /></label>
                      <label><Timer size={18} /><span><strong>Исчезнет после</strong><small>Срок отсчитывается с отправки</small></span><select value={sendOptions.expireSeconds ?? ""} onChange={(event) => setSendOptions((current) => ({ ...current, expireSeconds: event.target.value ? Number(event.target.value) : null }))}><option value="">Не исчезает</option><option value="3600">1 часа</option><option value="86400">24 часов</option><option value="604800">7 дней</option></select></label>
                      <label className={!attachments.length ? "disabled" : ""}><Eye size={18} /><span><strong>Открыть один раз</strong><small>Только для вложений</small></span><input type="checkbox" disabled={!attachments.length} checked={sendOptions.viewOnce && attachments.length > 0} onChange={(event) => setSendOptions((current) => ({ ...current, viewOnce: event.target.checked }))} /></label>
                    </div>
                  )}
                  <MessageComposer
                    chatId={activeConversation.id}
                    draft={draft}
                    inputRef={inputRef}
                    uploading={uploading}
                    sending={sending}
                    hasAttachments={attachments.length > 0}
                    editing={editing !== null}
                    mentionUsers={activeConversation.members.filter((member) => member.id !== user.id)}
                    sendOptionsActive={sendOptions.silent || Boolean(sendOptions.scheduleAt) || Boolean(sendOptions.expireSeconds) || sendOptions.viewOnce}
                    onDraftChange={updateDraft}
                    onKeyDown={composerKeyDown}
                    onAttach={() => fileInputRef.current?.click()}
                    onSend={() => void submitMessage()}
                    onOpenSendOptions={() => setSendOptionsOpen((open) => !open)}
                    onRecorded={sendRecordedMedia}
                    onError={showToast}
                  />
                </>
              )}
            </footer>

          </>
        )}
      </section>

      {newChatOpen && <NewChatModal onClose={() => setNewChatOpen(false)} onCreated={(conversation) => { setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]); setNewChatOpen(false); openConversation(conversation.id); }} />}
      {forwardingMessages.length > 0 && <ForwardMessageModal messages={forwardingMessages} conversations={conversations} currentUser={user} onForward={forwardMessage} onClose={() => setForwardingMessages([])} />}
      {deleteTargets.length > 0 && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDeleteTargets([])}>
          <section className="modal-card delete-message-modal" role="dialog" aria-modal="true" aria-labelledby="delete-message-title">
            <header className="modal-header"><div><span className="modal-kicker">Удаление</span><h2 id="delete-message-title">Удалить {deleteTargets.length > 1 ? `${deleteTargets.length} сообщений` : "сообщение"}?</h2></div><button className="icon-button" type="button" onClick={() => setDeleteTargets([])}><X size={20} /></button></header>
            <p>Выберите, у кого сообщение исчезнет. Действие «у всех» нельзя отменить.</p>
            <div className="delete-message-actions">
              <button className="secondary-button" type="button" onClick={() => void deleteMessages(deleteTargets, "self")}><EyeSlash size={18} />Только у меня</button>
              {deleteTargets.every((message) => message.sender.id === user.id || (activeConversation?.kind === "group" && ["owner", "admin"].includes(activeConversation.members.find((member) => member.id === user.id)?.role ?? ""))) && (
                <button className="danger-button" type="button" onClick={() => void deleteMessages(deleteTargets, "everyone")}><Trash2 size={18} />У всех</button>
              )}
            </div>
          </section>
        </div>
      )}
      {folderEditor && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setFolderEditor(null)}>
          <section className="modal-card folder-editor-modal" role="dialog" aria-modal="true" aria-labelledby="folder-editor-title">
            <header className="modal-header"><div><span className="modal-kicker">Организация чатов</span><h2 id="folder-editor-title">{folderEditor.id ? "Настроить папку" : "Новая папка"}</h2></div><button className="icon-button" type="button" onClick={() => setFolderEditor(null)} aria-label="Закрыть"><X size={20} /></button></header>
            <div className="folder-editor-body">
              <label><span>Название</span><input value={folderEditor.title} maxLength={40} autoFocus placeholder="Например, Работа" onChange={(event) => setFolderEditor((current) => current ? { ...current, title: event.target.value } : current)} /></label>
              <strong>Чаты в папке</strong>
              <div className="folder-chat-picker">
                {conversations.filter((conversation) => !conversation.archived).map((conversation) => (
                  <label key={conversation.id}>
                    <input type="checkbox" checked={folderEditor.conversationIds.has(conversation.id)} onChange={() => setFolderEditor((current) => {
                      if (!current) return current;
                      const next = new Set(current.conversationIds);
                      if (next.has(conversation.id)) next.delete(conversation.id); else next.add(conversation.id);
                      return { ...current, conversationIds: next };
                    })} />
                    <Avatar label={conversation.title} color={conversation.avatarColor} imageUrl={conversation.avatarUrl} size="sm" />
                    <span><strong>{conversation.title}</strong><small>{conversationPreview(conversation, user.id)}</small></span>
                  </label>
                ))}
              </div>
            </div>
            <div className="folder-editor-actions">
              {folderEditor.id && <button className="folder-delete-button" type="button" onClick={() => void removeFolder(folderEditor.id!)}><Trash2 size={17} />Удалить папку</button>}
              <button className="primary-button" type="button" disabled={!folderEditor.title.trim()} onClick={() => void saveFolderEditor()}><Check size={18} />Сохранить</button>
            </div>
          </section>
        </div>
      )}
      {detailsOpen && activeConversation && <ChatDetailsModal conversation={activeConversation} currentUser={user} onConversationChange={updateConversation} onError={showToast} onClose={() => setDetailsOpen(false)} />}
      {profileOpen && (
        <ProfileModal
          user={user}
          canInstall={canInstall}
          installApp={installApp}
          theme={theme}
          onThemeChange={onThemeChange}
          petAvailable={featureFlags.petCompanion}
          petEnabled={petEnabled}
          onPetEnabledChange={setPetEnabled}
          onUserChange={updateCurrentUser}
          onLogout={logout}
          onClose={() => setProfileOpen(false)}
        />
      )}
      {messagePopups.length > 0 && (
        <aside className="message-popup-stack" aria-live="polite" aria-label="Новые сообщения">
          {messagePopups.map((popup) => (
            <article className="message-popup" key={popup.id}>
              <button className="message-popup-main" type="button" onClick={() => { dismissMessagePopup(popup.id); openConversation(popup.conversationId); }}>
                <Avatar label={popup.title} color={popup.avatarColor} imageUrl={popup.avatarUrl} size="sm" />
                <span className="message-popup-copy">
                  <span><strong>{popup.title}</strong><small>{popup.subtitle}</small></span>
                  <p>{popup.body}</p>
                </span>
              </button>
              <button className="message-popup-close" type="button" onClick={() => dismissMessagePopup(popup.id)} aria-label="Закрыть уведомление">
                <X size={14} weight="bold" />
              </button>
            </article>
          ))}
        </aside>
      )}
      {PetCompanion && featureFlags.petCompanion && petEnabled && !hasNativePetBridge() && (
        <Suspense fallback={null}>
          <PetCompanion
            activity={petActivity}
            notification={petNotification}
            reaction={petReaction}
            unreadCount={totalUnreadCount}
            onOpenConversation={openConversation}
            onDisable={() => setPetEnabled(false)}
          />
        </Suspense>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function AttachmentGrid({ attachments }: { attachments: Attachment[] }) {
  const voices = attachments.filter((attachment) => attachment.kind === "voice" || attachment.mimeType.startsWith("audio/"));
  const circles = attachments.filter((attachment) => attachment.kind === "video_circle");
  const images = attachments.filter((attachment) => attachment.kind !== "video_circle" && attachment.mimeType.startsWith("image/"));
  const mediaIds = new Set([...voices, ...circles, ...images].map((attachment) => attachment.id));
  const files = attachments.filter((attachment) => !mediaIds.has(attachment.id));
  return (
    <div className="attachment-grid-wrap">
      {voices.map((attachment) => <VoiceMessage key={attachment.id} attachment={attachment} />)}
      {circles.map((attachment) => <VideoCircleMessage key={attachment.id} attachment={attachment} />)}
      {images.length > 0 && (
        <div className={`image-grid images-${Math.min(images.length, 4)}`}>
          {images.map((attachment) => (
            <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" aria-label={`Открыть ${attachment.name}`}>
              <img src={attachment.url} alt={attachment.name} loading="lazy" />
              <span><ImageIcon size={14} />{attachment.name}</span>
            </a>
          ))}
        </div>
      )}
      {files.map((attachment) => (
        <a className="file-attachment" key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer">
          <span className="file-icon"><File size={20} /></span>
          <span><strong>{attachment.name}</strong><small>{fileSize(attachment.size)}</small></span>
          <Download size={17} />
        </a>
      ))}
    </div>
  );
}
