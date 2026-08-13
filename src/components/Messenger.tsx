import {
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
  Checks as CheckCheck,
  DownloadSimple as Download,
  File,
  Image as ImageIcon,
  Info,
  ChatCircleDots as MessageCircleMore,
  DotsThree as MoreHorizontal,
  NotePencil,
  PaperPlaneTilt,
  PencilSimple as Pencil,
  PushPin,
  PushPinSlash,
  ArrowBendUpLeft as Reply,
  MagnifyingGlass as Search,
  Smiley as SmilePlus,
  Trash as Trash2,
  SignOut,
  X
} from "@phosphor-icons/react";
import { io, type Socket } from "socket.io-client";
import { api } from "../api";
import type { Attachment, ColorTheme, Conversation, Member, Message, User } from "../types";
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

function upsertMessage(list: Message[], message: Message) {
  const index = list.findIndex((candidate) => candidate.id === message.id);
  if (index === -1) return [...list, message].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const next = [...list];
  next[index] = message;
  return next;
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
  const [activeId, setActiveId] = useState(() => new URLSearchParams(window.location.search).get("chat"));
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [typingPeople, setTypingPeople] = useState<TypingPerson[]>([]);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const [messageMenu, setMessageMenu] = useState<MessageMenu | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [chatMenuFor, setChatMenuFor] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [messagePopups, setMessagePopups] = useState<MessagePopup[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const activeIdRef = useRef<string | null>(activeId);
  const conversationsRef = useRef<Conversation[]>([]);
  const popupTimersRef = useRef(new Map<string, number>());
  const readRequestsRef = useRef(new Set<string>());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeConversation = conversations.find((conversation) => conversation.id === activeId) ?? null;
  const activeMessages = activeId ? messages[activeId] ?? [] : [];

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => () => {
    popupTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    popupTimersRef.current.clear();
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

  const markConversationRead = useCallback((conversationId: string) => {
    setConversations((current) => current.map((conversation) =>
      conversation.id === conversationId && conversation.unreadCount > 0
        ? { ...conversation, unreadCount: 0 }
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
    const previousTimer = popupTimersRef.current.get(popup.id);
    if (previousTimer) window.clearTimeout(previousTimer);
    popupTimersRef.current.set(popup.id, window.setTimeout(() => {
      popupTimersRef.current.delete(popup.id);
      setMessagePopups((current) => current.filter((item) => item.id !== popup.id));
    }, 6200));
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const socket = io({ withCredentials: true });
    socketRef.current = socket;

    socket.on("message:new", (message: Message) => {
      const isOwnMessage = message.sender.id === user.id;
      const isActiveAndVisible = activeIdRef.current === message.conversationId
        && document.visibilityState === "visible"
        && document.hasFocus();
      const conversationAtArrival = conversationsRef.current.find((conversation) => conversation.id === message.conversationId);
      setMessages((current) => ({
        ...current,
        [message.conversationId]: upsertMessage(current[message.conversationId] ?? [], message)
      }));
      setConversations((current) => {
        const existing = current.find((conversation) => conversation.id === message.conversationId);
        if (!existing) return current;
        const updated: Conversation = {
          ...existing,
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
    });
    socket.on("conversation:new", () => void loadConversations());
    socket.on("conversation:updated", (payload: { conversationId: string }) => {
      if (!conversationsRef.current.some((conversation) => conversation.id === payload.conversationId)) {
        void loadConversations();
      }
    });
    socket.on("read:update", (payload: { conversationId: string; userId: string }) => {
      if (payload.userId !== user.id) return;
      setConversations((current) => current.map((conversation) =>
        conversation.id === payload.conversationId ? { ...conversation, unreadCount: 0 } : conversation
      ));
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
  }, [loadConversations, markConversationRead, queueMessagePopup, user.id]);

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
    if (!activeId || messagesLoading || olderLoading) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeId, activeMessages.length, messagesLoading, olderLoading]);

  useEffect(() => {
    setDraft("");
    setAttachments([]);
    setReplyTo(null);
    setEditing(null);
    setDetailsOpen(false);
    setReactionPickerFor(null);
    setMessageMenu(null);
    setChatMenuFor(null);
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
    const width = 206;
    const height = own ? 222 : 134;
    setReactionPickerFor(null);
    setMessageMenu({
      messageId,
      x: Math.max(10, Math.min(x + 4, window.innerWidth - width - 10)),
      y: Math.max(10, Math.min(y + 4, window.innerHeight - height - 10))
    });
  }

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter(
      (conversation) =>
        conversation.title.toLowerCase().includes(query) ||
        conversationPreview(conversation, user.id).toLowerCase().includes(query)
    );
  }, [conversations, search, user.id]);

  const activeTyping = typingPeople.filter((person) => person.conversationId === activeId);

  function openConversation(conversationId: string) {
    markConversationRead(conversationId);
    setActiveId(conversationId);
    const url = new URL(window.location.href);
    url.searchParams.set("chat", conversationId);
    window.history.replaceState({}, "", url);
  }

  function closeMobileConversation() {
    setActiveId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("chat");
    window.history.replaceState({}, "", url);
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
    try {
      const result = await api.upload(files);
      setAttachments((current) => [...current, ...result.attachments].slice(0, 5));
      inputRef.current?.focus();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось загрузить файл");
    } finally {
      setUploading(false);
    }
  }

  async function submitMessage() {
    if (!activeId || sending || uploading) return;
    const body = draft.trim();
    if (editing) {
      if (!body || body === editing.body) {
        setEditing(null);
        setDraft("");
        return;
      }
      setSending(true);
      try {
        const { message } = await api.editMessage(editing.id, body);
        setMessages((current) => ({ ...current, [activeId]: upsertMessage(current[activeId] ?? [], message) }));
        setEditing(null);
        setDraft("");
      } catch (caught) {
        showToast(caught instanceof Error ? caught.message : "Не удалось изменить сообщение");
      } finally {
        setSending(false);
      }
      return;
    }
    if (!body && !attachments.length) return;
    setSending(true);
    socketRef.current?.emit("typing:stop", activeId);
    try {
      const { message } = await api.sendMessage(activeId, {
        body,
        replyToId: replyTo?.id,
        clientId: crypto.randomUUID(),
        attachmentIds: attachments.map((attachment) => attachment.id)
      });
      setMessages((current) => ({ ...current, [activeId]: upsertMessage(current[activeId] ?? [], message) }));
      setDraft("");
      setAttachments([]);
      setReplyTo(null);
      inputRef.current?.focus();
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
    inputRef.current?.focus();
  }

  async function deleteMessage(message: Message) {
    if (!window.confirm("Удалить это сообщение?")) return;
    try {
      const { message: updated } = await api.deleteMessage(message.id);
      setMessages((current) => ({
        ...current,
        [message.conversationId]: upsertMessage(current[message.conversationId] ?? [], updated)
      }));
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось удалить сообщение");
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
    if (!forwardingMessage) return;
    try {
      await api.forwardMessage(forwardingMessage.id, targetConversationId);
      setForwardingMessage(null);
      showToast("Сообщение переслано");
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Не удалось переслать сообщение");
      throw caught;
    }
  }

  async function sendRecordedMedia(file: File, kind: RecordedMediaKind, durationMs: number) {
    if (!activeId || sending || uploading) return;
    setUploading(true);
    setSending(true);
    try {
      const uploaded = await api.upload([file], { kind, durationMs });
      const { message } = await api.sendMessage(activeId, {
        body: "",
        replyToId: replyTo?.id,
        clientId: crypto.randomUUID(),
        attachmentIds: uploaded.attachments.map((attachment) => attachment.id)
      });
      setMessages((current) => ({ ...current, [activeId]: upsertMessage(current[activeId] ?? [], message) }));
      setReplyTo(null);
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
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по чатам" aria-label="Поиск по чатам" />
            {search && <button onClick={() => setSearch("")} aria-label="Очистить поиск"><X size={16} weight="bold" /></button>}
          </div>
        </div>

        <div className="conversation-list" aria-live="polite">
          {conversationsLoading && [...Array(5)].map((_, index) => <div className="conversation-skeleton" key={index}><i /><span><b /><b /></span></div>)}
          {!conversationsLoading && !filteredConversations.length && (
            <div className="empty-sidebar">
              <span className="empty-icon"><MessageCircleMore size={26} /></span>
              <strong>{search ? "Ничего не найдено" : "Пока нет чатов"}</strong>
              <p>{search ? "Попробуйте другой запрос" : "Начните разговор с коллегой"}</p>
              {!search && <button className="secondary-button" onClick={() => setNewChatOpen(true)}>Новый чат</button>}
            </div>
          )}
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
                  className={`conversation-row ${activeId === conversation.id ? "active" : ""} ${conversation.unreadCount > 0 ? "unread" : ""}`}
                  onClick={() => { setChatMenuFor(null); openConversation(conversation.id); }}
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
                <button className="conversation-actions-trigger" data-chat-menu type="button" onClick={() => setChatMenuFor((current) => current === conversation.id ? null : conversation.id)} aria-label={`Действия с чатом ${conversation.title}`}>
                  <MoreHorizontal size={17} weight="bold" />
                </button>
                {chatMenuFor === conversation.id && (
                  <div className="conversation-actions-menu" data-chat-menu>
                    <button type="button" onClick={() => void togglePinned(conversation)}>
                      {conversation.pinned ? <PushPinSlash size={16} /> : <PushPin size={16} />}
                      {conversation.pinned ? "Открепить" : "Закрепить"}
                    </button>
                    <button className="danger" type="button" onClick={() => void removeConversation(conversation)}>
                      {conversation.kind === "group" && ownRole !== "owner" ? <SignOut size={16} /> : <Trash2 size={16} />}
                      {removalLabel}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
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
                    {activeTyping.length
                      ? `${activeTyping.map((person) => person.displayName).join(", ")} печатает…`
                      : activeConversation.kind === "group"
                        ? `${activeConversation.members.length} участников`
                        : lastSeenText(otherMember?.lastSeenAt, otherMember?.online)}
                  </small>
                </span>
              </button>
              <div className="chat-header-actions">
                <button className="icon-button" onClick={() => setDetailsOpen(true)} aria-label="Информация о чате"><Info size={20} weight="regular" /></button>
                <button className="icon-button menu-placeholder" onClick={() => setDetailsOpen(true)} aria-label="Меню чата"><MoreHorizontal size={23} weight="bold" /></button>
              </div>
            </header>

            <div className="message-area">
              {messagesLoading && <div className="center-loader"><span className="loader" />Загружаем сообщения…</div>}
              {!messagesLoading && hasMore[activeConversation.id] && (
                <button className="load-older" onClick={loadOlder} disabled={olderLoading}><ArrowDown size={15} />{olderLoading ? "Загрузка…" : "Показать предыдущие"}</button>
              )}
              {!messagesLoading && !activeMessages.length && (
                <div className="conversation-start">
                  <Avatar user={otherMember} label={activeConversation.title} color={activeConversation.avatarColor} imageUrl={activeConversation.avatarUrl} size="xl" />
                  <h2>{activeConversation.title}</h2>
                  <p>{activeConversation.kind === "group" ? "Группа создана. Начните обсуждение." : "Это начало вашей переписки. Поздоровайтесь!"}</p>
                </div>
              )}
              <div className="messages-list">
                {activeMessages.map((message, index) => {
                  const own = message.sender.id === user.id;
                  const previous = activeMessages[index - 1];
                  const showDate = !previous || !isSameDay(new Date(previous.createdAt), new Date(message.createdAt));
                  const grouped = previous && previous.sender.id === message.sender.id && !showDate && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;
                  const hasReactions = (message.reactions?.length ?? 0) > 0;
                  return (
                    <div key={message.id}>
                      {showDate && <div className="date-divider"><span>{dayLabel(message.createdAt)}</span></div>}
                      <article className={`message-row ${own ? "own" : ""} ${grouped ? "grouped" : ""} ${hasReactions ? "has-reactions" : ""}`}>
                        {!own && !grouped && <Avatar user={message.sender} size="sm" />}
                        {!own && grouped && <span className="avatar-spacer" />}
                        <div
                          className={`message-bubble ${message.deletedAt ? "deleted" : ""}`}
                          tabIndex={0}
                          aria-haspopup={message.deletedAt ? undefined : "menu"}
                          aria-expanded={messageMenu?.messageId === message.id}
                          onContextMenu={(event) => {
                            if (message.deletedAt) return;
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
                                {message.attachments.length > 0 && <AttachmentGrid attachments={message.attachments} />}
                                {message.body && <p className="message-text">{message.body}</p>}
                              </>
                            )}
                          </div>
                          <span className="message-meta">
                            {message.editedAt && <span>изменено</span>}
                            <time>{timeFormatter.format(new Date(message.createdAt))}</time>
                            {own && <CheckCheck size={15} />}
                          </span>
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
                              <button type="button" role="menuitem" onClick={() => { setMessageMenu(null); setReplyTo(message); setEditing(null); inputRef.current?.focus(); }}><Reply size={19} weight="regular" /><span>Ответить</span></button>
                              <button type="button" role="menuitem" onClick={() => { setMessageMenu(null); setForwardingMessage(message); }}><Forward size={19} weight="regular" /><span>Переслать</span></button>
                              {own && <button type="button" role="menuitem" onClick={() => { setMessageMenu(null); beginEdit(message); }}><Pencil size={19} weight="regular" /><span>Изменить</span></button>}
                              {own && <button className="danger" type="button" role="menuitem" onClick={() => { setMessageMenu(null); void deleteMessage(message); }}><Trash2 size={19} weight="regular" /><span>Удалить</span></button>}
                            </div>,
                            document.body
                          )}
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>
              <div ref={messagesEndRef} />
            </div>

            <footer className="composer-wrap">
              {(replyTo || editing) && (
                <div className="composer-context">
                  <span className="context-icon">{editing ? <Pencil size={17} /> : <Reply size={17} />}</span>
                  <span><strong>{editing ? "Редактирование" : `Ответ для ${replyTo?.sender.displayName}`}</strong><small>{editing?.body ?? replyTo?.body ?? "Вложение"}</small></span>
                  <button onClick={() => { setReplyTo(null); setEditing(null); setDraft(""); }} aria-label="Отменить"><X size={18} weight="bold" /></button>
                </div>
              )}
              {(attachments.length > 0 || uploading) && (
                <div className="attachment-drafts">
                  {attachments.map((attachment) => (
                    <span key={attachment.id}><File size={16} /><span>{attachment.name}</span><button onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}><X size={14} weight="bold" /></button></span>
                  ))}
                  {uploading && <span className="upload-chip"><span className="mini-loader" />Загрузка…</span>}
                </div>
              )}
              <input ref={fileInputRef} type="file" multiple hidden onChange={chooseFiles} />
              <MessageComposer
                chatId={activeConversation.id}
                draft={draft}
                inputRef={inputRef}
                uploading={uploading}
                sending={sending}
                hasAttachments={attachments.length > 0}
                editing={editing !== null}
                onDraftChange={updateDraft}
                onKeyDown={composerKeyDown}
                onAttach={() => fileInputRef.current?.click()}
                onSend={() => void submitMessage()}
                onRecorded={sendRecordedMedia}
                onError={showToast}
              />
            </footer>

          </>
        )}
      </section>

      {newChatOpen && <NewChatModal onClose={() => setNewChatOpen(false)} onCreated={(conversation) => { setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]); setNewChatOpen(false); openConversation(conversation.id); }} />}
      {forwardingMessage && <ForwardMessageModal message={forwardingMessage} conversations={conversations} currentUser={user} onForward={forwardMessage} onClose={() => setForwardingMessage(null)} />}
      {detailsOpen && activeConversation && <ChatDetailsModal conversation={activeConversation} currentUser={user} onClose={() => setDetailsOpen(false)} />}
      {profileOpen && <ProfileModal user={user} canInstall={canInstall} installApp={installApp} theme={theme} onThemeChange={onThemeChange} onUserChange={updateCurrentUser} onLogout={logout} onClose={() => setProfileOpen(false)} />}
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
