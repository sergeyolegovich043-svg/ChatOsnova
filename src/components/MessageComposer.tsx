import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import {
  Camera,
  Microphone as Mic,
  Paperclip,
  PaperPlaneTilt as Send,
  Smiley as Smile,
  Stop as Square,
  TextB,
  TextItalic,
  Code,
  Quotes,
  EyeSlash,
  SlidersHorizontal,
  Trash as Trash2,
  X
} from "@phosphor-icons/react";
import { formatMediaDuration, normalizeRecordedMimeType, pickSupportedMimeType, recordedFileName, type RecordedMediaKind } from "../media";
import { EmojiPicker } from "./EmojiPicker";
import type { Member } from "../types";

type MessageComposerProps = {
  chatId: string;
  draft: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  uploading: boolean;
  sending: boolean;
  hasAttachments: boolean;
  editing: boolean;
  mentionUsers: Member[];
  sendOptionsActive: boolean;
  onDraftChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onAttach: () => void;
  onSend: () => void;
  onOpenSendOptions: () => void;
  onRecorded: (file: File, kind: RecordedMediaKind, durationMs: number) => Promise<void>;
  onError: (message: string) => void;
};

type RecordingView = {
  kind: RecordedMediaKind;
  elapsedMs: number;
  processing: boolean;
};

const maximumDuration: Record<RecordedMediaKind, number> = {
  voice: 10 * 60_000,
  video_circle: 60_000
};

export function MessageComposer({
  chatId,
  draft,
  inputRef,
  uploading,
  sending,
  hasAttachments,
  editing,
  mentionUsers,
  sendOptionsActive,
  onDraftChange,
  onKeyDown,
  onAttach,
  onSend,
  onOpenSendOptions,
  onRecorded,
  onError
}: MessageComposerProps) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState<RecordingView | null>(null);
  const recordingRef = useRef<RecordingView | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const finishingRef = useRef(false);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const previousChatRef = useRef(chatId);
  const previousDraftRef = useRef(draft);

  function clearTimers() {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    intervalRef.current = null;
    timeoutRef.current = null;
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function discardRecording() {
    clearTimers();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    chunksRef.current = [];
    stopStream();
    finishingRef.current = false;
    recordingRef.current = null;
    setRecording(null);
  }

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    if (previousDraftRef.current && !draft) setEmojiOpen(false);
    previousDraftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (previousChatRef.current !== chatId) {
      discardRecording();
      setEmojiOpen(false);
      previousChatRef.current = chatId;
    }
    // Recording cleanup is intentionally keyed by chat selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  useEffect(() => () => {
    clearTimers();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stopStream();
  }, []);

  useEffect(() => {
    if (recording?.kind === "video_circle" && videoPreviewRef.current && streamRef.current) {
      videoPreviewRef.current.srcObject = streamRef.current;
      void videoPreviewRef.current.play().catch(() => undefined);
    }
  }, [recording?.kind]);

  async function startRecording(kind: RecordedMediaKind) {
    setEmojiOpen(false);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError("Этот браузер не поддерживает запись медиа");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === "voice"
          ? { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
          : {
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
              video: {
                facingMode: "user",
                width: { ideal: 480, max: 720 },
                height: { ideal: 480, max: 720 },
                aspectRatio: { ideal: 1 },
                frameRate: { ideal: 24, max: 30 }
              }
            }
      );
      const mimeType = pickSupportedMimeType(kind);
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64_000,
        ...(kind === "video_circle" ? { videoBitsPerSecond: 900_000 } : {})
      });
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      finishingRef.current = false;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener("error", () => {
        discardRecording();
        onError("Запись прервалась. Попробуйте ещё раз");
      });
      recorder.start(250);
      const recordingView = { kind, elapsedMs: 0, processing: false };
      recordingRef.current = recordingView;
      setRecording(recordingView);
      intervalRef.current = window.setInterval(() => {
        setRecording((current) => current ? { ...current, elapsedMs: Date.now() - startedAtRef.current } : current);
      }, 200);
      timeoutRef.current = window.setTimeout(() => void finishRecording(), maximumDuration[kind]);
    } catch (caught) {
      stopStream();
      const name = caught instanceof DOMException ? caught.name : "";
      onError(
        name === "NotAllowedError"
          ? "Разрешите доступ к микрофону и камере в настройках браузера"
          : name === "NotFoundError"
            ? "Микрофон или камера не найдены"
            : "Не удалось начать запись"
      );
    }
  }

  async function finishRecording() {
    const recorder = recorderRef.current;
    const current = recordingRef.current;
    if (!recorder || !current || finishingRef.current) return;
    finishingRef.current = true;
    clearTimers();
    setRecording({ ...current, elapsedMs: Date.now() - startedAtRef.current, processing: true });

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        recorder.addEventListener("stop", () => {
          const type = normalizeRecordedMimeType(current.kind, recorder.mimeType);
          resolve(new Blob(chunksRef.current, { type }));
        }, { once: true });
        recorder.addEventListener("error", () => reject(new Error("RECORDER_FAILED")), { once: true });
        recorder.stop();
      });
      const durationMs = Math.max(350, Math.min(maximumDuration[current.kind], Date.now() - startedAtRef.current));
      recorderRef.current = null;
      chunksRef.current = [];
      stopStream();
      if (blob.size < 128) throw new Error("EMPTY_RECORDING");
      const file = new File([blob], recordedFileName(current.kind, blob.type), { type: blob.type });
      await onRecorded(file, current.kind, durationMs);
      recordingRef.current = null;
      setRecording(null);
    } catch (caught) {
      stopStream();
      recordingRef.current = null;
      setRecording(null);
      const message = caught instanceof Error ? caught.message : "";
      onError(
        message === "EMPTY_RECORDING"
          ? "Запись получилась слишком короткой"
          : message && message !== "RECORDER_FAILED"
            ? message
            : "Не удалось отправить запись"
      );
    } finally {
      finishingRef.current = false;
    }
  }

  function insertEmoji(emoji: string) {
    const input = inputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? draft.length;
    const next = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;
    onDraftChange(next);
    window.requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  function insertMarkup(prefix: string, suffix = prefix) {
    const input = inputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? draft.length;
    const selected = draft.slice(start, end);
    const next = `${draft.slice(0, start)}${prefix}${selected}${suffix}${draft.slice(end)}`;
    onDraftChange(next);
    window.requestAnimationFrame(() => {
      input?.focus();
      const cursor = start + prefix.length + selected.length;
      input?.setSelectionRange(selected ? cursor + suffix.length : cursor, selected ? cursor + suffix.length : cursor);
    });
  }

  function insertQuote() {
    const input = inputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const lineStart = draft.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    onDraftChange(`${draft.slice(0, lineStart)}> ${draft.slice(lineStart)}`);
    window.requestAnimationFrame(() => input?.focus());
  }

  const mentionMatch = draft.slice(0, inputRef.current?.selectionStart ?? draft.length).match(/(?:^|\s)@([A-Za-z0-9_]*)$/);
  const mentionSuggestions = mentionMatch
    ? mentionUsers.filter((member) => member.username.toLowerCase().startsWith(mentionMatch[1].toLowerCase())).slice(0, 5)
    : [];

  function insertMention(username: string) {
    const input = inputRef.current;
    const end = input?.selectionStart ?? draft.length;
    const start = end - (mentionMatch?.[1].length ?? 0) - 1;
    const next = `${draft.slice(0, start)}@${username} ${draft.slice(end)}`;
    onDraftChange(next);
    window.requestAnimationFrame(() => {
      const cursor = start + username.length + 2;
      input?.focus();
      input?.setSelectionRange(cursor, cursor);
    });
  }

  if (recording) {
    return (
      <div className={`recording-composer ${recording.kind === "video_circle" ? "video-recording" : "voice-recording"}`}>
        <button className="record-cancel" type="button" onClick={discardRecording} disabled={recording.processing} aria-label="Отменить запись">
          <Trash2 size={18} />
        </button>
        {recording.kind === "video_circle" ? (
          <div className="record-video-preview">
            <video ref={videoPreviewRef} muted playsInline autoPlay />
            <span className="record-live-dot" />
          </div>
        ) : (
          <div className="record-wave" aria-hidden="true">
            {[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18].map((bar) => <i key={bar} style={{ animationDelay: `${-bar * 65}ms` }} />)}
          </div>
        )}
        <div className="record-copy">
          <strong>{recording.processing ? "Подготавливаем…" : recording.kind === "voice" ? "Записываем голос" : "Записываем кружок"}</strong>
          <span><b />{formatMediaDuration(recording.elapsedMs)} <em>/ {formatMediaDuration(maximumDuration[recording.kind])}</em></span>
        </div>
        <button className="record-send" type="button" onClick={() => void finishRecording()} disabled={recording.processing} aria-label="Остановить и отправить запись">
          {recording.processing ? <span className="mini-loader light" /> : <><Square size={13} fill="currentColor" /><Send size={18} /></>}
        </button>
      </div>
    );
  }

  const canSend = Boolean(draft.trim() || hasAttachments || editing);
  return (
    <div className="composer-shell">
      <div className="format-toolbar" aria-label="Форматирование сообщения">
        <button type="button" onClick={() => insertMarkup("**")} title="Жирный"><TextB size={17} /></button>
        <button type="button" onClick={() => insertMarkup("__")} title="Курсив"><TextItalic size={17} /></button>
        <button type="button" onClick={() => insertMarkup("`")} title="Код"><Code size={17} /></button>
        <button type="button" onClick={insertQuote} title="Цитата"><Quotes size={17} /></button>
        <button type="button" onClick={() => insertMarkup("||")} title="Спойлер"><EyeSlash size={17} /></button>
      </div>
      {mentionSuggestions.length > 0 && (
        <div className="mention-suggestions">
          {mentionSuggestions.map((member) => (
            <button type="button" key={member.id} onClick={() => insertMention(member.username)}>
              <span style={{ background: member.avatarColor }}>{member.displayName.slice(0, 1)}</span>
              <strong>{member.displayName}</strong><small>@{member.username}</small>
            </button>
          ))}
        </div>
      )}
      {emojiOpen && (
        <div className="composer-emoji-popover">
          <button className="emoji-close" type="button" onClick={() => setEmojiOpen(false)} aria-label="Закрыть эмодзи"><X size={16} weight="bold" /></button>
          <EmojiPicker onSelect={insertEmoji} />
        </div>
      )}
      <div className="composer">
        <div className="composer-tools">
          <button className="composer-tool" type="button" onClick={onAttach} disabled={uploading} aria-label="Прикрепить файл"><Paperclip size={20} /></button>
          <button className={`composer-tool ${emojiOpen ? "active" : ""}`} type="button" onClick={() => setEmojiOpen((open) => !open)} aria-label="Добавить эмодзи" aria-pressed={emojiOpen}><Smile size={20} /></button>
        </div>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Сообщение"
          rows={1}
          maxLength={4000}
          aria-label="Сообщение"
        />
        <div className="composer-actions">
          {canSend ? (
            <div className="send-button-group">
              <button className={`send-options-button ${sendOptionsActive ? "active" : ""}`} type="button" onClick={onOpenSendOptions} disabled={sending || uploading || editing} aria-label="Параметры отправки"><SlidersHorizontal size={17} /></button>
              <button className="send-button" type="button" onClick={onSend} disabled={sending || uploading} aria-label={editing ? "Сохранить изменения" : "Отправить сообщение"}>
                {sending ? <span className="mini-loader light" /> : <Send size={19} />}
              </button>
            </div>
          ) : (
            <>
              <button className="media-record-button video" type="button" onClick={() => void startRecording("video_circle")} aria-label="Записать видеокружок"><Camera size={19} /></button>
              <button className="media-record-button voice" type="button" onClick={() => void startRecording("voice")} aria-label="Записать голосовое сообщение"><Mic size={20} /></button>
            </>
          )}
        </div>
      </div>
      <div className="composer-footnote">
        <span>{uploading ? "Загружаем вложение…" : "Enter — отправить · Shift+Enter — новая строка"}</span>
        <span className={draft.length > 3600 ? "near-limit" : ""}>{draft.length}/4000</span>
      </div>
    </div>
  );
}
