let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (audioContext) return audioContext;
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  audioContext = new AudioContextConstructor();
  return audioContext;
}

export async function unlockNotificationSound() {
  const context = getAudioContext();
  if (context?.state === "suspended") await context.resume().catch(() => undefined);
}

export async function playIncomingMessageSound() {
  const context = getAudioContext();
  if (!context) return false;
  if (context.state === "suspended") await context.resume().catch(() => undefined);
  if (context.state !== "running") return false;

  const start = context.currentTime + 0.01;
  const master = context.createGain();
  master.gain.setValueAtTime(0.0001, start);
  master.gain.exponentialRampToValueAtTime(0.16, start + 0.018);
  master.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
  master.connect(context.destination);

  [
    { frequency: 740, delay: 0, duration: 0.19 },
    { frequency: 988, delay: 0.105, duration: 0.22 }
  ].forEach(({ frequency, delay, duration }) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start + delay);
    gain.gain.setValueAtTime(0.72, start + delay);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(start + delay);
    oscillator.stop(start + delay + duration);
  });
  return true;
}
