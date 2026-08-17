import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { EyeSlash, PawPrint } from "@phosphor-icons/react";
import { clampPetX, PET_POSITION_KEY, type PetNotification } from "../pet";
import petIdleUrl from "../assets/pet-states/barsik-metallica-idle-v2.png";
import "../pet.css";

type PetCompanionProps = {
  notification: PetNotification | null;
  onOpenConversation: (conversationId: string) => void;
  onDisable: () => void;
};

type PetMode = "sit" | "excited";

const PET_WIDTH = 167;
const IDLE_FRAME_POSITIONS = ["0%", "25%", "50%", "75%", "100%"];
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

export function PetCompanion({ notification, onOpenConversation, onDisable }: PetCompanionProps) {
  const [x, setX] = useState(initialPosition);
  const [idleFrame, setIdleFrame] = useState(0);
  const [mode, setMode] = useState<PetMode>("sit");
  const [visibleNotification, setVisibleNotification] = useState<PetNotification | null>(null);
  const [greeting, setGreeting] = useState("Мяу! Я рядом.");
  const [greetingVisible, setGreetingVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const xRef = useRef(x);
  const dragRef = useRef({ startPointerX: 0, startPetX: 0, moved: false });

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
    if (mode !== "sit" || dragging || visibleNotification) return;
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
  }, [dragging, mode, visibleNotification]);

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
    "--pet-idle-frame": IDLE_FRAME_POSITIONS[idleFrame]
  } as CSSProperties;
  const alignRight = x > (typeof window === "undefined" ? 640 : window.innerWidth / 2);

  return (
    <aside
      className={`pet-companion pet-${mode} ${dragging ? "is-dragging" : ""}`}
      style={{ left: x }}
      data-mode={mode}
      aria-label="Питомец Барсик"
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
      </button>
      <span className="pet-ground-shadow" aria-hidden="true" />
    </aside>
  );
}
