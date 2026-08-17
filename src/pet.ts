export const PET_ENABLED_KEY = "barsikchat.pet.enabled";
export const PET_POSITION_KEY = "barsikchat.pet.position-x";

export type PetNotification = {
  id: string;
  conversationId: string;
  title: string;
  subtitle: string;
  body: string;
};

type NativePetBridge = {
  setEnabled: (enabled: boolean) => void | Promise<void>;
  notify: (notification: PetNotification) => void | Promise<void>;
};

declare global {
  interface Window {
    BarsikPetNative?: NativePetBridge;
  }
}

export function readPetEnabled(available: boolean, storage: Pick<Storage, "getItem"> | null = safeStorage()) {
  if (!available || !storage) return false;
  try {
    return storage.getItem(PET_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function savePetEnabled(enabled: boolean, storage: Pick<Storage, "setItem"> | null = safeStorage()) {
  if (!storage) return;
  try {
    storage.setItem(PET_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // The preference remains active for the current session when storage is blocked.
  }
}

export function clampPetX(value: number, viewportWidth: number, petWidth = 148) {
  const max = Math.max(12, viewportWidth - petWidth - 12);
  return Math.min(Math.max(12, value), max);
}

export function hasNativePetBridge() {
  return typeof window !== "undefined" && Boolean(window.BarsikPetNative);
}

export function syncNativePet(enabled: boolean) {
  return Promise.resolve(window.BarsikPetNative?.setEnabled(enabled)).catch(() => undefined);
}

export function notifyNativePet(notification: PetNotification) {
  return Promise.resolve(window.BarsikPetNative?.notify(notification)).catch(() => undefined);
}

function safeStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
