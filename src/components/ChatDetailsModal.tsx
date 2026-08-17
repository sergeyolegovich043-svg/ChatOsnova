import {
  At, Bell, BellRinging, BellSlash, Camera, Crown, Info, MagnifyingGlass,
  Plus, ShieldCheck, Trash, UserMinus, UsersThree, X
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { api } from "../api";
import type { Conversation, DirectoryUser, NotificationMode, User } from "../types";
import { Avatar } from "./Avatar";

type ChatDetailsModalProps = {
  conversation: Conversation;
  currentUser: User;
  onConversationChange: (conversation: Conversation) => void;
  onError: (message: string) => void;
  onClose: () => void;
};

function tomorrowStart() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

export function ChatDetailsModal({ conversation, currentUser, onConversationChange, onError, onClose }: ChatDetailsModalProps) {
  const otherMember = conversation.kind === "direct"
    ? conversation.members.find((member) => member.id !== currentUser.id)
    : undefined;
  const ownRole = conversation.members.find((member) => member.id === currentUser.id)?.role ?? "member";
  const canManage = conversation.kind === "group" && (ownRole === "owner" || ownRole === "admin");
  const [title, setTitle] = useState(conversation.title);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const avatarInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => setTitle(conversation.title), [conversation.id, conversation.title]);

  useEffect(() => {
    if (!adding) return;
    const timer = window.setTimeout(() => {
      api.users(memberSearch)
        .then((result) => setDirectory(result.users))
        .catch((error) => onError(error instanceof Error ? error.message : "Не удалось загрузить пользователей"));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [adding, memberSearch, onError]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const availableUsers = useMemo(() => {
    const memberIds = new Set(conversation.members.map((member) => member.id));
    return directory.filter((user) => !memberIds.has(user.id));
  }, [conversation.members, directory]);

  async function updateWith(action: Promise<{ conversation: Conversation }>, fallback: string) {
    setBusy(true);
    try {
      const result = await action;
      onConversationChange(result.conversation);
      return result.conversation;
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : fallback);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveTitle() {
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === conversation.title) return;
    await updateWith(api.updateGroup(conversation.id, nextTitle), "Не удалось изменить название");
  }

  async function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await updateWith(api.uploadGroupAvatar(conversation.id, file), "Не удалось обновить аватар");
  }

  async function setNotifications(mode: NotificationMode, muteUntil: string | null = null) {
    await updateWith(api.updateNotifications(conversation.id, mode, muteUntil), "Не удалось изменить уведомления");
  }

  async function addMember(userId: string) {
    const updated = await updateWith(api.addGroupMembers(conversation.id, [userId]), "Не удалось добавить участника");
    if (updated) setDirectory((current) => current.filter((user) => user.id !== userId));
  }

  async function removeMember(userId: string, name: string) {
    if (!window.confirm(`Удалить ${name} из группы?`)) return;
    await updateWith(api.removeGroupMember(conversation.id, userId), "Не удалось удалить участника");
  }

  async function changeRole(userId: string, role: "admin" | "member") {
    await updateWith(api.setGroupMemberRole(conversation.id, userId, role), "Не удалось изменить роль");
  }

  const notificationLabel = conversation.notificationMode === "mentions"
    ? "Только упоминания"
    : conversation.notificationMode === "muted"
      ? conversation.muteUntil
        ? `Выключены до ${new Date(conversation.muteUntil).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
        : "Выключены навсегда"
      : "Все сообщения";

  return (
    <div className="modal-backdrop chat-details-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card chat-details-modal" role="dialog" aria-modal="true" aria-labelledby="chat-details-title">
        <header className="modal-header chat-details-header">
          <div><span className="modal-kicker">Настройки чата</span><h2 id="chat-details-title">Информация</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть"><X size={20} weight="bold" /></button>
        </header>

        <div className="chat-details-scroll">
          <div className="chat-details-hero">
            <span className="details-avatar-glow" aria-hidden="true" />
            <div className="details-avatar-control">
              <Avatar user={otherMember} label={conversation.title} color={conversation.avatarColor} imageUrl={conversation.avatarUrl} size="xl" online={otherMember?.online} />
              {canManage && <button type="button" onClick={() => avatarInput.current?.click()} aria-label="Изменить аватар"><Camera size={18} weight="fill" /></button>}
              <input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={chooseAvatar} />
            </div>
            {canManage ? (
              <div className="details-title-editor"><input value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} /><button type="button" disabled={busy || !title.trim() || title.trim() === conversation.title} onClick={() => void saveTitle()}>Сохранить</button></div>
            ) : <h3>{conversation.title}</h3>}
            <span className={`details-status ${otherMember?.online ? "online" : ""}`}>
              {conversation.kind === "group" ? <UsersThree size={15} /> : <span />}
              {conversation.kind === "group" ? `${conversation.members.length} участников` : otherMember?.online ? "В сети" : "Не в сети"}
            </span>
            {canManage && conversation.avatarUrl && <button className="details-remove-avatar" type="button" disabled={busy} onClick={() => void updateWith(api.deleteGroupAvatar(conversation.id), "Не удалось удалить аватар")}><Trash size={14} /> Удалить аватар</button>}
            {conversation.kind === "direct" && otherMember?.bio && <p>{otherMember.bio}</p>}
          </div>

          <section className="details-notifications">
            <div className="details-section-title"><span><BellRinging size={17} /> Уведомления</span><b>{notificationLabel}</b></div>
            <div className="notification-presets">
              <button className={conversation.notificationMode === "all" ? "active" : ""} type="button" disabled={busy} onClick={() => void setNotifications("all")}><Bell size={17} />Все</button>
              <button type="button" disabled={busy} onClick={() => void setNotifications("muted", new Date(Date.now() + 60 * 60 * 1000).toISOString())}><BellSlash size={17} />На час</button>
              <button type="button" disabled={busy} onClick={() => void setNotifications("muted", tomorrowStart())}><BellSlash size={17} />До завтра</button>
              <button className={conversation.notificationMode === "mentions" ? "active" : ""} type="button" disabled={busy} onClick={() => void setNotifications("mentions")}><At size={17} />Упоминания</button>
              <button className={conversation.notificationMode === "muted" && !conversation.muteUntil ? "active" : ""} type="button" disabled={busy} onClick={() => void setNotifications("muted")}><BellSlash size={17} />Навсегда</button>
            </div>
          </section>

          {conversation.kind === "direct" ? (
            <div className="details-facts">
              <div><span className="details-fact-icon"><At size={19} /></span><span><small>Имя пользователя</small><strong>@{otherMember?.username}</strong></span></div>
              <div><span className="details-fact-icon"><Info size={19} /></span><span><small>Формат</small><strong>Личный диалог</strong></span></div>
            </div>
          ) : (
            <div className="details-members">
              <div className="details-section-title"><span>Участники</span><span className="details-member-actions"><b>{conversation.members.length}</b>{canManage && <button type="button" onClick={() => setAdding((value) => !value)}><Plus size={16} />Добавить</button>}</span></div>
              {adding && (
                <div className="member-picker">
                  <label><MagnifyingGlass size={17} /><input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Имя или @username" /></label>
                  <div>{availableUsers.slice(0, 8).map((member) => <button type="button" key={member.id} disabled={busy} onClick={() => void addMember(member.id)}><Avatar user={member} size="sm" /><span><strong>{member.displayName}</strong><small>@{member.username}</small></span><Plus size={17} /></button>)}{!availableUsers.length && <p>Нет пользователей для добавления</p>}</div>
                </div>
              )}
              <div className="details-members-list">
                {conversation.members.map((member) => {
                  const canRemove = member.role !== "owner" && member.id !== currentUser.id && (ownRole === "owner" || (ownRole === "admin" && member.role === "member"));
                  return (
                    <div className="member-row" key={member.id}>
                      <Avatar user={member} size="sm" online={member.online} />
                      <span><strong>{member.id === currentUser.id ? `${member.displayName} (вы)` : member.displayName}</strong><small>{member.online ? "в сети" : `@${member.username}`}</small></span>
                      <span className="member-role">
                        {member.role === "owner" && <em><Crown size={13} weight="fill" />владелец</em>}
                        {ownRole === "owner" && member.role !== "owner" ? <select value={member.role} disabled={busy} onChange={(event) => void changeRole(member.id, event.target.value as "admin" | "member")}><option value="member">участник</option><option value="admin">администратор</option></select> : member.role === "admin" && <em><ShieldCheck size={13} />администратор</em>}
                        {canRemove && <button type="button" disabled={busy} onClick={() => void removeMember(member.id, member.displayName)} aria-label={`Удалить ${member.displayName}`}><UserMinus size={17} /></button>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
