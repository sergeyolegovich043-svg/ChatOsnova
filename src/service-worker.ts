/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkFirst } from "workbox-strategies";
import { isConversationActivelyViewed, selectNotificationWindow } from "./pwa-window-routing";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<unknown>;
};

const staticAssets = self.__WB_MANIFEST.filter((entry) => {
  const url = typeof entry === "string" ? entry : (entry as { url?: string }).url;
  return url !== "index.html" && url !== "/index.html";
});

precacheAndRoute(staticAssets);
registerRoute(new NavigationRoute(
  new NetworkFirst({
    cacheName: "barsikchat-navigation",
    networkTimeoutSeconds: 4
  }),
  {
    denylist: [/^\/api(?:\/|$)/, /^\/socket\.io(?:\/|$)/]
  }
));
cleanupOutdatedCaches();
clientsClaim();
self.skipWaiting();

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const navigationCache = await caches.open("barsikchat-navigation");
    const cachedRequests = await navigationCache.keys();
    await Promise.all(cachedRequests
      .filter((request) => {
        const pathname = new URL(request.url).pathname;
        return pathname.startsWith("/api/") || pathname.startsWith("/socket.io/");
      })
      .map((request) => navigationCache.delete(request)));
  })());
});

self.addEventListener("push", (event) => {
  const payload = event.data?.json() ?? {};
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (isConversationActivelyViewed(windows, payload.conversationId)) return;

      const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
        body: payload.body ?? "Новое сообщение",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: payload.conversationId ?? "message",
        data: { url: payload.url ?? "/" },
        renotify: true,
        silent: false,
        vibrate: [120, 50, 120]
      };
      await self.registration.showNotification(payload.title ?? "BarsikChat", options);
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedUrl = new URL(event.notification.data?.url ?? "/", self.location.origin);
  const targetUrl = requestedUrl.origin === self.location.origin ? requestedUrl.href : `${self.location.origin}/`;
  const targetConversationId = new URL(targetUrl).searchParams.get("chat");
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const appWindows = windows.filter((client) => client.url.startsWith(self.location.origin));
      const existing = selectNotificationWindow(appWindows, targetConversationId);
      if (existing) {
        if (new URL(existing.url).searchParams.get("chat") !== targetConversationId) {
          await existing.navigate(targetUrl);
        }
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    })()
  );
});
