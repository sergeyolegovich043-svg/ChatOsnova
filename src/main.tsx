import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IconContext } from "@phosphor-icons/react";
import { registerSW } from "virtual:pwa-register";
import "@fontsource-variable/manrope";
import App from "./App";
import "./styles.css";
import "./barsik-theme.css";
import "./light-theme.css";

let savedTheme: string | null = null;
try {
  savedTheme = localStorage.getItem("barsikchat.theme");
} catch {
  // Storage can be unavailable in hardened browser modes; dark remains the safe default.
}
const initialTheme = savedTheme === "light" ? "light" : "dark";
document.documentElement.dataset.theme = initialTheme;
document.querySelector('meta[name="theme-color"]')?.setAttribute("content", initialTheme === "light" ? "#f5f2fa" : "#0b0914");

const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh: () => void updateServiceWorker(true),
  onRegisteredSW: (_scriptUrl, registration) => {
    if (!registration) return;
    const checkForUpdate = () => void registration.update().catch(() => undefined);
    window.setInterval(checkForUpdate, 60_000);
    window.addEventListener("focus", checkForUpdate);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate();
    });
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IconContext.Provider value={{ weight: "duotone", mirrored: false }}>
      <App />
    </IconContext.Provider>
  </StrictMode>
);
