import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { EyeSlash, PawPrint, Play } from "@phosphor-icons/react";
import { clampPetX, PET_POSITION_KEY, type PetNotification } from "../pet";
import petSpritesUrl from "../assets/barsik-pet-actions-v3.png";
import "../pet.css";

type PetCompanionProps = {
  notification: PetNotification | null;
  onOpenConversation: (conversationId: string) => void;
  onDisable: () => void;
};

type PetMode = "walk" | "sit" | "groom" | "play" | "excited";
type IdlePetMode = Exclude<PetMode, "walk" | "excited">;

// The rendered frame includes a transparent 16 px gutter on both sides.
// At 148 px of visible art this gives a 166.5 px frame footprint.
const PET_WIDTH = 167;
const FRAME_POSITIONS = ["0%", "11.1111%", "22.2222%", "33.3333%", "44.4444%", "55.5556%", "66.6667%", "77.7778%", "88.8889%", "100%"];

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function nextIdleMode(current: PetMode): IdlePetMode {
  const modes: IdlePetMode[] = ["sit", "groom", "play"];
  const alternatives = modes.filter((mode) => mode !== current);
  return alternatives[Math.floor(Math.random() * alternatives.length)];
}

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
  const [direction, setDirection] = useState<1 | -1>(-1);
  const [frame, setFrame] = useState(0);
  const [mode, setMode] = useState<PetMode>("sit");
  const [visibleNotification, setVisibleNotification] = useState<PetNotification | null>(null);
  const [greeting, setGreeting] = useState("Мяу! Я рядом.");
  const [greetingVisible, setGreetingVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const directionRef = useRef<1 | -1>(-1);
  const xRef = useRef(x);
  const dragRef = useRef({ startPointerX: 0, startPetX: 0, moved: false });

  useEffect(() => {
    if (!notification) return;
    setVisibleNotification(notification);
    setGreetingVisible(false);
    setMode("excited");
    setFrame(9);
    const timer = window.setTimeout(() => {
      setVisibleNotification((current) => current?.id === notification.id ? null : current);
      setMode("sit");
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    if (mode !== "walk" || dragging || visibleNotification) return;
    let animationFrame = 0;
    let previous = performance.now();
    const walk = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      setX((current) => {
        const min = 12;
        const max = Math.max(min, window.innerWidth - PET_WIDTH - 12);
        let next = current + directionRef.current * 24 * delta;
        if (next <= min || next >= max) {
          directionRef.current = directionRef.current === 1 ? -1 : 1;
          setDirection(directionRef.current);
          next = clampPetX(next, window.innerWidth, PET_WIDTH);
        }
        xRef.current = next;
        return next;
      });
      animationFrame = window.requestAnimationFrame(walk);
    };
    animationFrame = window.requestAnimationFrame(walk);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [dragging, mode, visibleNotification]);

  useEffect(() => {
    if (dragging || visibleNotification || mode === "excited") return;

    const duration = mode === "walk"
      ? randomBetween(2_800, 4_200)
      : mode === "sit"
        ? randomBetween(7_000, 12_000)
        : mode === "groom"
          ? randomBetween(5_500, 7_500)
          : randomBetween(6_000, 8_500);

    const activityTimer = window.setTimeout(() => {
      if (mode === "walk") {
        setMode(nextIdleMode(mode));
        return;
      }

      // Barsik spends most of his time behaving like a cat. Only roughly one
      // transition out of three starts a short walk across the screen.
      setMode(Math.random() < 0.3 ? "walk" : nextIdleMode(mode));
    }, duration);

    return () => window.clearTimeout(activityTimer);
  }, [dragging, mode, visibleNotification]);

  useEffect(() => {
    if (dragging || visibleNotification || mode === "excited") return;

    const frames = mode === "walk"
      ? [0, 1, 2, 3]
      : mode === "groom"
        ? [5, 6]
        : mode === "play"
          ? [7, 8, 9, 8]
          : [4];

    let frameIndex = 0;
    setFrame(frames[0]);
    if (frames.length === 1) return;

    const interval = window.setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      setFrame(frames[frameIndex]);
    }, mode === "walk" ? 210 : mode === "groom" ? 620 : 460);

    return () => window.clearInterval(interval);
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
    setFrame(4);
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
    setGreeting(phrases[Math.floor(Math.random() * phrases.length)]);
    setGreetingVisible(true);
    setMode("excited");
    setFrame(9);
    window.setTimeout(() => {
      setGreetingVisible(false);
      setMode("sit");
    }, 3_200);
  }

  function resumeWalking() {
    setMenuOpen(false);
    setVisibleNotification(null);
    setGreetingVisible(false);
    setMode("walk");
    setFrame(0);
  }

  const spriteStyle = {
    "--pet-frame": FRAME_POSITIONS[frame],
    // Both walking frames face left. Mirror the whole cycle only when Barsik
    // actually changes travel direction at a screen edge.
    "--pet-direction": direction === -1 ? 1 : -1,
    "--pet-sprites": `url("${petSpritesUrl}")`
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
          <button type="button" role="menuitem" onClick={resumeWalking}><Play size={16} weight="fill" /> Прогуляться</button>
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
        <span className="pet-sprite" aria-hidden="true" />
      </button>
      <span className="pet-ground-shadow" aria-hidden="true" />
    </aside>
  );
}
