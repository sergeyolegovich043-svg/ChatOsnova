import { MagnifyingGlass, PaperPlaneTilt, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { Conversation, Message, User } from "../types";
import { Avatar } from "./Avatar";

type ForwardMessageModalProps = {
  message: Message;
  conversations: Conversation[];
  currentUser: User;
  onForward: (conversationId: string) => Promise<void>;
  onClose: () => void;
};

export function ForwardMessageModal({ message, conversations, currentUser, onForward, onClose }: ForwardMessageModalProps) {
  const [search, setSearch] = useState("");
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations.filter((conversation) => !query || conversation.title.toLowerCase().includes(query));
  }, [conversations, search]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function forward(conversationId: string) {
    if (sendingTo) return;
    setSendingTo(conversationId);
    try {
      await onForward(conversationId);
    } finally {
      setSendingTo(null);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card forward-modal" role="dialog" aria-modal="true" aria-labelledby="forward-title">
        <header className="modal-header">
          <div><span className="modal-kicker">Пересылка</span><h2 id="forward-title">Выберите чат</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть"><X size={20} /></button>
        </header>

        <div className="forward-preview">
          <PaperPlaneTilt size={18} weight="duotone" />
          <span><strong>Пересылаем сообщение</strong><small>{message.body || `${message.attachments.length} вложение`}</small></span>
        </div>

        <div className="search-field modal-search">
          <MagnifyingGlass size={17} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти чат" autoFocus />
        </div>

        <div className="forward-list">
          {filtered.map((conversation) => {
            const directMember = conversation.kind === "direct"
              ? conversation.members.find((member) => member.id !== currentUser.id)
              : undefined;
            return (
              <button type="button" key={conversation.id} onClick={() => void forward(conversation.id)} disabled={Boolean(sendingTo)}>
                <Avatar user={directMember} label={conversation.title} color={conversation.avatarColor} imageUrl={conversation.avatarUrl} size="sm" />
                <span><strong>{conversation.title}</strong><small>{conversation.kind === "group" ? `${conversation.members.length} участников` : `@${directMember?.username ?? "chat"}`}</small></span>
                <PaperPlaneTilt size={18} weight={sendingTo === conversation.id ? "fill" : "duotone"} />
              </button>
            );
          })}
          {!filtered.length && <div className="empty-mini">Чаты не найдены</div>}
        </div>
      </section>
    </div>
  );
}
