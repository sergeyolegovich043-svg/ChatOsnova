import { useEffect, useState } from "react";
import { api } from "./api";
import { AuthScreen } from "./components/AuthScreen";
import { BrandLogo } from "./components/BrandLogo";
import { InstallAppPrompt } from "./components/InstallAppPrompt";
import { Messenger } from "./components/Messenger";
import { NotificationPermissionPrompt } from "./components/NotificationPermissionPrompt";
import { isPushNotificationSupported, syncPushNotifications, type PushNotificationStatus } from "./push-notifications";
import type { ColorTheme, User } from "./types";

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_DISMISSED_KEY = "barsikchat.install-prompt-dismissed";
const NOTIFICATION_DISMISSED_KEY = "barsikchat.notification-prompt-dismissed";
const THEME_KEY = "barsikchat.theme";

function isStandaloneMode() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

function isIosBrowser() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export default function App() {
  const [theme, setTheme] = useState<ColorTheme>(() => document.documentElement.dataset.theme === "light" ? "light" : "dark");
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installNoticeOpen, setInstallNoticeOpen] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [installed, setInstalled] = useState(isStandaloneMode);
  const [iosBrowser] = useState(isIosBrowser);
  const [notificationPromptOpen, setNotificationPromptOpen] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState<PushNotificationStatus>("idle");
  const [notificationError, setNotificationError] = useState("");

  function changeTheme(nextTheme: ColorTheme) {
    document.documentElement.dataset.theme = nextTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", nextTheme === "light" ? "#f5f2fa" : "#0b0914");
    try {
      localStorage.setItem(THEME_KEY, nextTheme);
    } catch {
      // The selected theme still applies for the current session when storage is blocked.
    }
    setTheme(nextTheme);
  }

  useEffect(() => {
    api.me()
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const followPointer = (event: PointerEvent) => {
      document.documentElement.style.setProperty("--pointer-x", `${event.clientX}px`);
      document.documentElement.style.setProperty("--pointer-y", `${event.clientY}px`);
    };
    window.addEventListener("pointermove", followPointer, { passive: true });
    return () => window.removeEventListener("pointermove", followPointer);
  }, []);

  useEffect(() => {
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
      if (sessionStorage.getItem(INSTALL_DISMISSED_KEY) !== "1") setInstallNoticeOpen(true);
    };
    const markInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setInstallNoticeOpen(false);
      sessionStorage.removeItem(INSTALL_DISMISSED_KEY);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", markInstalled);

    let installTimer: number | undefined;
    if (!installed && sessionStorage.getItem(INSTALL_DISMISSED_KEY) !== "1") {
      installTimer = window.setTimeout(() => setInstallNoticeOpen(true), 900);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", markInstalled);
      if (installTimer) window.clearTimeout(installTimer);
    };
  }, [installed, iosBrowser]);

  useEffect(() => {
    if (!user || !isPushNotificationSupported()) return;
    let cancelled = false;
    let promptTimer = 0;

    if (Notification.permission === "granted") {
      setNotificationStatus("syncing");
      void syncPushNotifications()
        .then((status) => {
          if (cancelled) return;
          setNotificationStatus(status);
          setNotificationPromptOpen(status !== "enabled" && installed);
        })
        .catch((caught) => {
          if (cancelled) return;
          setNotificationStatus("error");
          setNotificationError(caught instanceof Error ? caught.message : "Не удалось восстановить push-подписку");
          if (installed) setNotificationPromptOpen(true);
        });
    } else if (Notification.permission === "denied") {
      setNotificationStatus("denied");
      setNotificationError("Уведомления заблокированы. Разрешите их в системных настройках BarsikChat или браузера.");
      if (installed && sessionStorage.getItem(NOTIFICATION_DISMISSED_KEY) !== "1") {
        promptTimer = window.setTimeout(() => setNotificationPromptOpen(true), 700);
      }
    } else if (installed && sessionStorage.getItem(NOTIFICATION_DISMISSED_KEY) !== "1") {
      promptTimer = window.setTimeout(() => setNotificationPromptOpen(true), 700);
    }

    return () => {
      cancelled = true;
      window.clearTimeout(promptTimer);
    };
  }, [installed, user]);

  async function enableNotifications() {
    setNotificationStatus("syncing");
    setNotificationError("");
    try {
      const status = await syncPushNotifications(true);
      setNotificationStatus(status);
      if (status === "enabled") {
        setNotificationPromptOpen(false);
        sessionStorage.removeItem(NOTIFICATION_DISMISSED_KEY);
      } else if (status === "denied") {
        setNotificationError("Уведомления заблокированы. Разрешите их в настройках приложения или браузера.");
      }
    } catch (caught) {
      setNotificationStatus("error");
      setNotificationError(caught instanceof Error ? caught.message : "Не удалось включить уведомления");
    }
  }

  function dismissNotificationPrompt() {
    sessionStorage.setItem(NOTIFICATION_DISMISSED_KEY, "1");
    setNotificationPromptOpen(false);
  }

  function dismissInstallNotice() {
    sessionStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    setInstallNoticeOpen(false);
  }

  async function installApp() {
    if (!installPrompt) return false;
    setInstallBusy(true);
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      setInstallNoticeOpen(false);
      if (choice.outcome === "accepted") {
        setInstalled(true);
        sessionStorage.removeItem(INSTALL_DISMISSED_KEY);
      } else {
        sessionStorage.setItem(INSTALL_DISMISSED_KEY, "1");
      }
      return choice.outcome === "accepted";
    } finally {
      setInstallBusy(false);
    }
  }

  let content;
  if (loading) {
    content = (
      <main className="splash-screen">
        <BrandLogo size="lg" className="splash-mark" />
        <strong>BarsikChat</strong>
        <small>Ваше пространство общения</small>
        <span className="loader" aria-label="Загрузка" />
      </main>
    );
  } else if (!user) {
    content = <AuthScreen onAuthenticated={setUser} />;
  } else {
    content = (
      <Messenger
        user={user}
        setUser={setUser}
        canInstall={Boolean(installPrompt)}
        installApp={installApp}
        theme={theme}
        onThemeChange={changeTheme}
        onLogout={() => setUser(null)}
      />
    );
  }

  return (
    <>
      {content}
      {installNoticeOpen && !installed && (
        <InstallAppPrompt
          mode={installPrompt ? "native" : iosBrowser ? "ios" : "manual"}
          busy={installBusy}
          onInstall={installApp}
          onDismiss={dismissInstallNotice}
        />
      )}
      {notificationPromptOpen && user && (
        <NotificationPermissionPrompt
          status={notificationStatus}
          error={notificationError}
          onEnable={enableNotifications}
          onDismiss={dismissNotificationPrompt}
        />
      )}
    </>
  );
}
