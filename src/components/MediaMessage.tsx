import { useRef, useState, type CSSProperties } from "react";
import { ArrowCounterClockwise as RotateCcw, Pause, Play } from "@phosphor-icons/react";
import { formatMediaDuration } from "../media";
import type { Attachment } from "../types";

export function VoiceMessage({ attachment }: { attachment: Attachment }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(attachment.durationMs ?? 0);

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = value * audio.duration;
    setCurrentMs(audio.currentTime * 1000);
  }

  const progress = durationMs ? Math.min(1, currentMs / durationMs) : 0;
  return (
    <div className="voice-message">
      <audio
        ref={audioRef}
        src={attachment.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentMs(0); }}
        onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)}
        onLoadedMetadata={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) setDurationMs(event.currentTarget.duration * 1000);
        }}
      />
      <button className="voice-play" type="button" onClick={() => void toggle()} aria-label={playing ? "Пауза" : "Воспроизвести голосовое сообщение"}>
        {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
      </button>
      <div className="voice-track">
        <div className="voice-wave" aria-hidden="true">
          {[7,13,9,18,12,23,15,10,20,14,25,12,18,8,16,22,11,19,14,9,21,13,17,8].map((height, index) => (
            <i key={index} className={index / 23 <= progress ? "played" : ""} style={{ height }} />
          ))}
        </div>
        <input type="range" min="0" max="1" step="0.001" value={progress} onChange={(event) => seek(Number(event.target.value))} aria-label="Позиция голосового сообщения" />
        <span>{formatMediaDuration(currentMs || durationMs)}</span>
      </div>
    </div>
  );
}

export function VideoCircleMessage({ attachment }: { attachment: Attachment }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(attachment.durationMs ?? 0);
  const progress = durationMs ? Math.min(1, currentMs / durationMs) : 0;

  async function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (video.ended) video.currentTime = 0;
    if (video.paused) await video.play();
    else video.pause();
  }

  return (
    <div className="video-circle-message" style={{ "--media-progress": `${progress * 360}deg` } as CSSProperties}>
      <video
        ref={videoRef}
        src={attachment.url}
        playsInline
        preload="metadata"
        onClick={() => void toggle()}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)}
        onLoadedMetadata={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) setDurationMs(event.currentTarget.duration * 1000);
        }}
      />
      <button type="button" onClick={() => void toggle()} aria-label={playing ? "Пауза" : "Воспроизвести видеосообщение"}>
        {playing ? <Pause size={24} fill="currentColor" /> : currentMs ? <RotateCcw size={23} /> : <Play size={24} fill="currentColor" />}
      </button>
      <span>{formatMediaDuration(currentMs || durationMs)}</span>
    </div>
  );
}
