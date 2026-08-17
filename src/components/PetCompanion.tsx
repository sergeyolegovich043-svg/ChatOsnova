import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { EyeSlash, PawPrint } from "@phosphor-icons/react";
import {
  clampPetX,
  PET_ACTIVITY_EVENT,
  PET_POSITION_KEY,
  type PetActivity,
  type PetNotification
} from "../pet";
import petIdleUrl from "../assets/pet-states/barsik-metallica-idle-v2.png";
import petSearchUrl from "../assets/pet-states/barsik-metallica-search-v1.png";
import "../pet.css";

type PetCompanionProps = {
  activity: PetActivity | null;
  notification: PetNotification | null;
  onOpenConversation: (conversationId: string) => void;
  onDisable: () => void;
};

type PetMode = "sit" | "excited";
type PetSearchStage = "idle" | "searching" | "found";

const PET_WIDTH = 167;
const IDLE_FRAME_POSITIONS = ["0%", "25%", "50%", "75%", "100%"];
const SEARCH_FRAME_POSITIONS = ["0%", "25%", "50%", "75%", "100%"];
const SEARCH_SEQUENCE = [0, 1, 2, 3, 2, 1];
const MIN_SEARCH_VISIBLE_MS = 1_600;
const SEARCH_FOUND_VISIBLE_MS = 720;
const IDLE_SEQUENCE = [
  { frame: 0, duration: 1_300 },
  { frame: 1, duration: 460 },
  { frame: 2, duration: 300 },
  { frame: 3, duration: 580 },
  { frame: 4, duration: 720 },
  { frame: 3, duration: 520 },
  { frame: 1, duration: 440 }
];

function initialPosition() {
  const fallback = typeof window === "undefined" ? 24 : window.innerWidth - PET_WIDTH - 28;
  if (typeof window === "undefined") return fallback;
  try {
    const saved = Number(window.localStorage.getItem(PET_POSITION_KEY));
    return clampPetX(Number.isFinite(saved) && saved > 0 ? saved : fallback, window.innerWidth, PET_WIDTH);
  } catch {
    return clampPetX(fallback, window.innerWidth, PET_WIDTH);
  }
}

export function PetCompanion({ activity, notification, onOpenConversation, onDisable }: PetCompanionProps) {
  const [x, setX] = useState(initialPosition);
  const [idleFrame, setIdleFrame] = useState(0);
  const [searchFrame, setSearchFrame] = useState(0);
  const [searchStage, setSearchStage] = useState<PetSearchStage>("idle");
  const [searchLabel, setSearchLabel] = useState("Ищу и анализирую");
  const [externalActivity, setExternalActivity] = useState<PetActivity | null>(null);
  const [mode, setMode] = useState<PetMode>("sit");
  const [visibleNotification, setVisibleNotification] = useState<PetNotification | null>(null);
  const [greeting, setGreeting] = useState("Мяу! Я рядом.");
  const [greetingVisible, setGreetingVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const xRef = useRef(x);
  const searchStartedAtRef = useRef(0);
  const dragRef = useRef({ startPointerX: 0, startPetX: 0, moved: false });
  const currentActivity = activity ?? externalActivity;
  const visualMode = mode === "excited"
    ? "excited"
    : searchStage === "idle"
      ? "sit"
      : searchStage;

  useEffect(() => {
    const handleActivity = (event: Event) => {
      setExternalActivity((event as CustomEvent<PetActivity | null>).detail);
    };
    window.addEventListener(PET_ACTIVITY_EVENT, handleActivity);
    return () => window.removeEventListener(PET_ACTIVITY_EVENT, handleActivity);
  }, []);

  useEffect(() => {
    let foundTimer = 0;
    let idleTimer = 0;
    if (currentActivity?.type === "searching") {
      searchStartedAtRef.current = Date.now();
      setSearchLabel(currentActivity.label || "Ищу и анализирую");
      setSearchFrame(0);
      setSearchStage("searching");
      setGreetingVisible(false);
      return;
    }

    if (searchStartedAtRef.current > 0) {
      const elapsed = Date.now() - searchStartedAtRef.current;
      foundTimer = window.setTimeout(() => {
        setSearchFrame(4);
        setSearchStage("found");
        idleTimer = window.setTimeout(() => {
          searchStartedAtRef.current = 0;
          setSearchFrame(0);
          setSearchStage("idle");
        }, SEARCH_FOUND_VISIBLE_MS);
      }, Math.max(0, MIN_SEARCH_VISIBLE_MS - elapsed));
    } else {
      setSearchStage("idle");
    }

    return () => {
      window.clearTimeout(foundTimer);
      window.clearTimeout(idleTimer);
    };
  }, [currentActivity?.label, currentActivity?.type]);

  useEffect(() => {
    if (searchStage !== "searching") return;
    let sequenceIndex = 0;
    setSearchFrame(SEARCH_SEQUENCE[0]);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSearchFrame(1);
      return;
    }
    const interval = window.setInterval(() => {
      sequenceIndex = (sequenceIndex + 1) % SEARCH_SEQUENCE.length;
      setSearchFrame(SEARCH_SEQUENCE[sequenceIndex]);
    }, 280);
    return () => window.clearInterval(interval);
  }, [searchStage]);

  useEffect(() => {
    if (!notification) return;
    setVisibleNotification(notification);
    setGreetingVisible(false);
    setMode("excited");
    setIdleFrame(4);
    const timer = window.setTimeout(() => {
      setVisibleNotification((current) => current?.id === notification.id ? null : current);
      setMode("sit");
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    if (visualMode !== "sit" || dragging || visibleNotification) return;
    setIdleFrame(0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let sequenceIndex = 0;
    let timer = 0;
    const advance = () => {
      timer = window.setTimeout(() => {
        sequenceIndex = (sequenceIndex + 1) % IDLE_SEQUENCE.length;
        setIdleFrame(IDLE_SEQUENCE[sequenceIndex].frame);
        advance();
      }, IDLE_SEQUENCE[sequenceIndex].duration);
    };
    advance();

    return () => window.clearTimeout(timer);
  }, [dragging, visualMode, visibleNotification]);

  useEffect(() => {
    const resize = () => {
      const next = clampPetX(xRef.current, window.innerWidth, PET_WIDTH);
      xRef.current = next;
      setX(next);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startPointerX: event.clientX, startPetX: xRef.current, moved: false };
    setDragging(true);
    setMode("sit");
    setIdleFrame(0);
  }

  function movePet(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    const distance = event.clientX - dragRef.current.startPointerX;
    if (Math.abs(distance) > 4) dragRef.current.moved = true;
    const next = clampPetX(dragRef.current.startPetX + distance, window.innerWidth, PET_WIDTH);
    xRef.current = next;
    setX(next);
  }

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    setMode("sit");
    try {
      window.localStorage.setItem(PET_POSITION_KEY, String(Math.round(xRef.current)));
    } catch {
      // The position remains valid until this tab is closed.
    }
    if (!dragRef.current.moved) greet();
  }

  function greet() {
    const phrases = ["Мяу! Я рядом.", "Новых сообщений не пропущу.", "Барсик на посту!", "Погладить Барсика — хорошая идея."];
    setMenuOpen(false);
    setGreeting(phrases[Math.floor(Math.random() * phrases.length)]);
    setGreetingVisible(true);
    setMode("excited");
    setIdleFrame(4);
    window.setTimeout(() => {
      setGreetingVisible(false);
      setMode("sit");
    }, 3_200);
  }

  const spriteStyle = {
    "--pet-idle": `url("${petIdleUrl}")`,
    "--pet-idle-frame": IDLE_FRAME_POSITIONS[idleFrame],
    "--pet-search": `url("${petSearchUrl}")`,
    "--pet-search-frame": SEARCH_FRAME_POSITIONS[searchFrame]
  } as CSSProperties;
  const alignRight = x > (typeof window === "undefined" ? 640 : window.innerWidth / 2);

  return (
    <aside
      className={`pet-companion pet-${visualMode} ${dragging ? "is-dragging" : ""}`}
      style={{ left: x }}
      data-mode={visualMode}
      aria-label={visualMode === "searching" ? `Барсик: ${searchLabel}` : visualMode === "found" ? "Барсик нашёл результат" : "Питомец Барсик"}
    >
      {visibleNotification && (
        <button
          className={`pet-speech pet-notification ${alignRight ? "align-right" : "align-left"}`}
          type="button"
          onClick={() => {
            onOpenConversation(visibleNotification.conversationId);
            setVisibleNotification(null);
            setMode("sit");
          }}
        >
          <span className="pet-speech-kicker">Новое сообщение</span>
          <strong>{visibleNotification.title}</strong>
          <small>{visibleNotification.subtitle}</small>
          <p>{visibleNotification.body}</p>
        </button>
      )}
      {!visibleNotification && greetingVisible && (
        <div className={`pet-speech pet-greeting ${alignRight ? "align-right" : "align-left"}`} role="status">
          {greeting}
        </div>
      )}
      {mode !== "excited" && searchStage !== "idle" && (
        <div className={`pet-activity ${alignRight ? "align-right" : "align-left"}`} role="status">
          <span className="pet-activity-dot" aria-hidden="true" />
          <strong>ИИ</strong>
          <span>{searchStage === "found" ? "Нашёл" : searchLabel}</span>
        </div>
      )}
      {menuOpen && (
        <div className={`pet-menu ${alignRight ? "align-right" : "align-left"}`} role="menu" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={greet}><PawPrint size={16} weight="fill" /> Погладить</button>
          <button type="button" role="menuitem" className="danger" onClick={onDisable}><EyeSlash size={16} /> Спрятать</button>
        </div>
      )}
      <button
        className="pet-sprite-button"
        type="button"
        aria-label="Перетащить или погладить Барсика"
        title="Барсика можно перетащить"
        style={spriteStyle}
        onPointerDown={startDrag}
        onPointerMove={movePet}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuOpen(true);
        }}
      >
        <span className="pet-idle-sprite" aria-hidden="true" />
        <span className="pet-search-sprite" aria-hidden="true" />
      </button>
      <span className="pet-ground-shadow" aria-hidden="true" />
    </aside>
  );
}
