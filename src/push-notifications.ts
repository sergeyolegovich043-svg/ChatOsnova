import { api } from "./api";

export type PushNotificationStatus = "idle" | "syncing" | "enabled" | "denied" | "unsupported" | "error";

const SERVICE_WORKER_TIMEOUT_MS = 12_000;

export function isPushNotificationSupported() {
  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

export function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((character) => character.charCodeAt(0)));
}

export function pushKeysMatch(current: ArrayBuffer | null, expected: Uint8Array) {
  if (!current) return false;
  const currentBytes = new Uint8Array(current);
  return currentBytes.length === expected.length && currentBytes.every((byte, index) => byte === expected[index]);
}

async function serviceWorkerRegistration() {
  let timer = 0;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new Error("Service Worker не запустился. Перезапустите приложение.")), SERVICE_WORKER_TIMEOUT_MS);
      })
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

export async function syncPushNotifications(requestPermission = false): Promise<PushNotificationStatus> {
  if (!isPushNotificationSupported()) return "unsupported";

  let permission = Notification.permission;
  if (permission === "default" && requestPermission) permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "idle";

  const [{ publicKey }, registration] = await Promise.all([
    api.pushPublicKey(),
    serviceWorkerRegistration()
  ]);
  if (!publicKey) throw new Error("На сервере не настроены ключи Web Push");

  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !pushKeysMatch(subscription.options.applicationServerKey, applicationServerKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey
  });

  // Re-send even an existing browser subscription. This restores delivery after
  // a server or database migration without asking the user to enable push again.
  await api.subscribePush(subscription.toJSON());
  return "enabled";
}
