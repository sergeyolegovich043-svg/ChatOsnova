import { useEffect, useMemo, useState } from "react";
import { Check, MagnifyingGlass as Search, UsersThree as Users, X } from "@phosphor-icons/react";
import { api } from "../api";
import type { Conversation, DirectoryUser } from "../types";
import { Avatar } from "./Avatar";

type NewChatModalProps = {
  onClose: () => void;
  onCreated: (conversation: Conversation) => void;
};

export function NewChatModal({ onClose, onCreated }: NewChatModalProps) {
  const [mode, setMode] = useState<"direct" | "group">("direct");
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.users()
      .then(({ users: directory }) => setUsers(directory))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Не удалось загрузить коллег"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const query = search.toLowerCase().trim();
    return users.filter(
      (candidate) =>
        !query ||
        candidate.displayName.toLowerCase().includes(query) ||
        candidate.username.toLowerCase().includes(query)
    );
  }, [search, users]);

  function toggle(userId: string) {
    setSelected((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    );
  }

  async function createDirect(userId: string) {
    setSubmitting(true);
    setError("");
    try {
      const { conversation } = await api.createDirect(userId);
      onCreated(conversation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось создать чат");
      setSubmitting(false);
    }
  }

  async function createGroup() {
    if (title.trim().length < 2 || !selected.length) return;
    setSubmitting(true);
    setError("");
    try {
      const { conversation } = await api.createGroup(title.trim(), selected);
      onCreated(conversation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось создать группу");
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card new-chat-modal" role="dialog" aria-modal="true" aria-labelledby="new-chat-title">
        <header className="modal-header">
          <div>
            <h2 id="new-chat-title">Новый чат</h2>
            <p>Выберите коллегу или создайте группу</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={20} weight="bold" /></button>
        </header>

        <div className="segmented-control">
          <button className={mode === "direct" ? "active" : ""} onClick={() => { setMode("direct"); setSelected([]); }}>Личный</button>
          <button className={mode === "group" ? "active" : ""} onClick={() => setMode("group")}><Users size={16} /> Группа</button>
        </div>

        {mode === "group" && (
          <label className="stacked-label">
            <span>Название группы</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="Например, Команда продукта" autoFocus />
          </label>
        )}

        <div className="search-field modal-search">
          <Search size={18} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти по имени или логину" autoFocus={mode === "direct"} />
        </div>

        {error && <div className="form-error">{error}</div>}
        <div className="directory-list">
          {loading && <div className="list-placeholder">Загружаем список…</div>}
          {!loading && !filtered.length && <div className="empty-mini"><Users size={25} /><span>Других аккаунтов пока нет</span></div>}
          {filtered.map((candidate) => {
            const isSelected = selected.includes(candidate.id);
            return (
              <button
                key={candidate.id}
                className="directory-row"
                disabled={submitting}
                onClick={() => mode === "direct" ? createDirect(candidate.id) : toggle(candidate.id)}
              >
                <Avatar user={candidate} online={candidate.online} />
                <span className="directory-person">
                  <strong>{candidate.displayName}</strong>
                  <small>{candidate.online ? "в сети" : `@${candidate.username}`}</small>
                </span>
                {mode === "group" && <span className={`check-circle ${isSelected ? "selected" : ""}`}>{isSelected && <Check size={15} />}</span>}
              </button>
            );
          })}
        </div>

        {mode === "group" && (
          <footer className="modal-footer">
            <span>{selected.length ? `Выбрано: ${selected.length}` : "Выберите участников"}</span>
            <button className="primary-button" disabled={submitting || !selected.length || title.trim().length < 2} onClick={createGroup}>
              {submitting ? "Создаём…" : "Создать группу"}
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}
