import { useEffect, useState } from "react";
import { api } from "./api";
import { AuthScreen } from "./components/AuthScreen";
import { BrandLogo } from "./components/BrandLogo";
import { InstallAppPrompt } from "./components/InstallAppPrompt";
import { Messenger } from "./components/Messenger";
import type { ColorTheme, User } from "./types";

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_DISMISSED_KEY = "barsikchat.install-prompt-dismissed";
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
    </>
  );
}
