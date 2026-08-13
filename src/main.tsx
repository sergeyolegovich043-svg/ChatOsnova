import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IconContext } from "@phosphor-icons/react";
import { registerSW } from "virtual:pwa-register";
import "@fontsource-variable/manrope";
import App from "./App";
import "./styles.css";
import "./barsik-theme.css";

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
