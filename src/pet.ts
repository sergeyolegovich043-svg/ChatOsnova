export const PET_ENABLED_KEY = "barsikchat.pet.enabled";
export const PET_POSITION_KEY = "barsikchat.pet.position";
export const PET_LEGACY_X_POSITION_KEY = "barsikchat.pet.position-x";
export const PET_ONBOARDING_SEEN_KEY = "barsikchat.pet.onboarding-v1-seen";
export const PET_ACTIVITY_EVENT = "barsikchat:pet-activity";
export const PET_UNREAD_STACK_THRESHOLD = 5;

export type PetPosition = {
  x: number;
  y: number;
};

export type PetActivity = {
  type: "searching";
  source: "messages" | "internet" | "assistant";
  label: string;
};

export type PetNotification = {
  id: string;
  conversationId: string;
  title: string;
  subtitle: string;
  body: string;
};

export type PetReaction = {
  id: string;
  type: "onboarding" | "unread-stack" | "reply";
};

type NativePetBridge = {
  setEnabled: (enabled: boolean) => void | Promise<void>;
  setActivity?: (activity: PetActivity | null) => void | Promise<void>;
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

export function readPetOnboardingSeen(storage: Pick<Storage, "getItem"> | null = safeStorage()) {
  if (!storage) return false;
  try {
    return storage.getItem(PET_ONBOARDING_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function savePetOnboardingSeen(storage: Pick<Storage, "setItem"> | null = safeStorage()) {
  if (!storage) return;
  try {
    storage.setItem(PET_ONBOARDING_SEEN_KEY, "1");
  } catch {
    // The welcome animation may repeat on the next launch when storage is blocked.
  }
}

export function shouldAnimateUnreadStack(previousCount: number, nextCount: number, threshold = PET_UNREAD_STACK_THRESHOLD) {
  return previousCount < threshold && nextCount >= threshold;
}

export function clampPetX(value: number, viewportWidth: number, petWidth = 148) {
  const max = Math.max(12, viewportWidth - petWidth - 12);
  return Math.min(Math.max(12, value), max);
}

export function clampPetY(value: number, viewportHeight: number, petHeight = 160) {
  const max = Math.max(12, viewportHeight - petHeight - 12);
  return Math.min(Math.max(12, value), max);
}

export function clampPetPosition(
  position: PetPosition,
  viewportWidth: number,
  viewportHeight: number,
  petWidth = 148,
  petHeight = 160
): PetPosition {
  return {
    x: clampPetX(position.x, viewportWidth, petWidth),
    y: clampPetY(position.y, viewportHeight, petHeight)
  };
}

export function dragPetPosition(
  startPosition: PetPosition,
  startPointer: PetPosition,
  currentPointer: PetPosition,
  viewportWidth: number,
  viewportHeight: number,
  petWidth = 148,
  petHeight = 160
): PetPosition {
  return clampPetPosition(
    {
      x: startPosition.x + currentPointer.x - startPointer.x,
      y: startPosition.y + currentPointer.y - startPointer.y
    },
    viewportWidth,
    viewportHeight,
    petWidth,
    petHeight
  );
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

export function syncNativePetActivity(activity: PetActivity | null) {
  return Promise.resolve(window.BarsikPetNative?.setActivity?.(activity)).catch(() => undefined);
}

// AI features can call this helper before and after any longer operation.
// The browser companion reacts immediately; native Windows/Android bridges
// receive the same activity when they implement setActivity.
export function announcePetActivity(activity: PetActivity | null) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<PetActivity | null>(PET_ACTIVITY_EVENT, { detail: activity }));
  }
  return typeof window === "undefined" ? Promise.resolve() : syncNativePetActivity(activity);
}

function safeStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
