import { At, Info, UsersThree, X } from "@phosphor-icons/react";
import { useEffect } from "react";
import type { Conversation, User } from "../types";
import { Avatar } from "./Avatar";

type ChatDetailsModalProps = {
  conversation: Conversation;
  currentUser: User;
  onClose: () => void;
};

export function ChatDetailsModal({ conversation, currentUser, onClose }: ChatDetailsModalProps) {
  const otherMember = conversation.kind === "direct"
    ? conversation.members.find((member) => member.id !== currentUser.id)
    : undefined;
  const visibleMembers = conversation.kind === "group"
    ? conversation.members
    : otherMember ? [otherMember] : [];

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop chat-details-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card chat-details-modal" role="dialog" aria-modal="true" aria-labelledby="chat-details-title">
        <header className="modal-header chat-details-header">
          <div><span className="modal-kicker">Карточка чата</span><h2 id="chat-details-title">Информация</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть"><X size={20} weight="bold" /></button>
        </header>

        <div className="chat-details-hero">
          <span className="details-avatar-glow" aria-hidden="true" />
          <Avatar
            user={otherMember}
            label={conversation.title}
            color={conversation.avatarColor}
            imageUrl={conversation.avatarUrl}
            size="xl"
            online={otherMember?.online}
          />
          <h3>{conversation.title}</h3>
          <span className={`details-status ${otherMember?.online ? "online" : ""}`}>
            {conversation.kind === "group" ? <UsersThree size={15} /> : <span />}
            {conversation.kind === "group" ? `${conversation.members.length} участников` : otherMember?.online ? "В сети" : "Не в сети"}
          </span>
          {conversation.kind === "direct" && otherMember?.bio && <p>{otherMember.bio}</p>}
        </div>

        {conversation.kind === "direct" ? (
          <div className="details-facts">
            <div><span className="details-fact-icon"><At size={19} /></span><span><small>Имя пользователя</small><strong>@{otherMember?.username}</strong></span></div>
            <div><span className="details-fact-icon"><Info size={19} weight="regular" /></span><span><small>Формат</small><strong>Личный диалог</strong></span></div>
          </div>
        ) : (
          <div className="details-members">
            <div className="details-section-title"><span>Участники</span><b>{visibleMembers.length}</b></div>
            <div className="details-members-list">
              {visibleMembers.map((member) => (
                <div className="member-row" key={member.id}>
                  <Avatar user={member} size="sm" online={member.online} />
                  <span><strong>{member.displayName}</strong><small>{member.online ? "в сети" : `@${member.username}`}</small></span>
                  {member.role === "owner" && <em>владелец</em>}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
