import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { FileText, MagnifyingGlass, NotePencil, PaperPlaneTilt, Sparkle, Stop, X } from "@phosphor-icons/react";
import { api } from "../api";
import { announcePetActivity } from "../pet";
import type { AiAnswer, AiMode, Conversation } from "../types";

type Props = {
  conversation: Conversation | null;
  onOpenSource: (messageId: string) => void;
  onClose: () => void;
};

const modeLabels: Array<{ mode: AiMode; label: string; icon: typeof MagnifyingGlass }> = [
  { mode: "search", label: "Найти", icon: MagnifyingGlass },
  { mode: "summary", label: "Сводка", icon: FileText },
  { mode: "draft", label: "Черновик", icon: NotePencil }
];

const stageLabels = {
  moderation: "Проверяю безопасность",
  retrieval: "Ищу только в доступных вам чатах",
  generation: "Формулирую ответ"
};

export function AiAssistantModal({ conversation, onOpenSource, onClose }: Props) {
  const [mode, setMode] = useState<AiMode>("search");
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState("Готов помочь");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    api.aiStatus().then((result) => setAvailable(result.enabled)).catch(() => setAvailable(false));
    return () => controllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (mode === "summary" && !prompt) setPrompt("Сделай краткую сводку последних сообщений");
  }, [mode, prompt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || busy || !available) return;
    if (mode === "summary" && !conversation) {
      setError("Сначала откройте чат для сводки");
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError("");
    setAnswer(null);
    setStatus("Начинаю");
    void announcePetActivity({ type: "searching", source: "assistant", label: "Думаю над ответом" });
    try {
      await api.streamAi({
        mode,
        prompt: prompt.trim(),
        conversationId: conversation?.id
      }, (streamEvent) => {
        if (streamEvent.type === "status") setStatus(stageLabels[streamEvent.stage]);
        if (streamEvent.type === "result") {
          setAnswer(streamEvent.result);
          setStatus("Готово");
        }
      }, controller.signal);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Барсик не смог ответить");
    } finally {
      controllerRef.current = null;
      setBusy(false);
      void announcePetActivity(null);
    }
  }

  function cancel() {
    controllerRef.current?.abort();
    setStatus("Остановлено");
    setBusy(false);
    void announcePetActivity(null);
  }

  return createPortal(
    <div className="modal-backdrop ai-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="modal-card ai-assistant-modal" role="dialog" aria-modal="true" aria-labelledby="ai-title">
        <header className="modal-header">
          <div className="ai-modal-title">
            <span className="ai-orb"><Sparkle size={20} weight="fill" /></span>
            <div><h2 id="ai-title">Барсик ИИ</h2><p>Поиск, сводки и черновики · только чтение</p></div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Закрыть"><X size={19} /></button>
        </header>

        <div className="ai-mode-switch" role="tablist" aria-label="Режим Барсика">
          {modeLabels.map(({ mode: value, label, icon: Icon }) => (
            <button key={value} type="button" className={mode === value ? "active" : ""} onClick={() => setMode(value)} disabled={busy}>
              <Icon size={16} />{label}
            </button>
          ))}
        </div>

        <div className="ai-context-chip">
          <span>{conversation ? `Контекст: ${conversation.title}` : "Общий поиск: только групповые чаты"}</span>
          <small>Личные чаты используются только при явно открытом чате</small>
        </div>

        {available === false && (
          <div className="ai-unavailable"><strong>Luna не подключена</strong><span>Добавьте новый OPENAI_API_KEY в окружение dev-сервера и перезапустите dev-стек.</span></div>
        )}

        <div className="ai-answer" aria-live="polite">
          {busy && <div className="ai-thinking"><span /><span /><span /><p>{status}</p></div>}
          {!busy && !answer && available !== false && <div className="ai-empty"><Sparkle size={28} /><p>Спросите о переписке или попросите подготовить черновик.</p></div>}
          {answer && (
            <article>
              <p>{answer.answer}</p>
              {answer.citations.length > 0 && <footer><strong>Источники</strong>{answer.citations.map((citation) => (
                <button type="button" key={citation.sourceId} onClick={() => onOpenSource(citation.sourceId)}>{citation.label}</button>
              ))}</footer>}
            </article>
          )}
          {error && <div className="form-error">{error}</div>}
        </div>

        <form className="ai-prompt" onSubmit={submit}>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} disabled={busy || available === false} placeholder="Например: какие сроки мы согласовали?" />
          {busy ? (
            <button className="ai-stop" type="button" onClick={cancel} aria-label="Остановить"><Stop size={18} weight="fill" /></button>
          ) : (
            <button className="ai-send" type="submit" disabled={!prompt.trim() || !available} aria-label="Спросить Барсика"><PaperPlaneTilt size={19} weight="fill" /></button>
          )}
        </form>
        <p className="ai-disclaimer">Барсик может ошибаться. Проверяйте ответ по указанным сообщениям.</p>
      </section>
    </div>,
    document.body
  );
}
