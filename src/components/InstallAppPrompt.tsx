import { useEffect, useState } from "react";
import { Bell, DownloadSimple, ShieldCheck, X } from "@phosphor-icons/react";
import { BrandLogo } from "./BrandLogo";

type InstallAppPromptProps = {
  mode: "native" | "ios" | "manual";
  busy: boolean;
  onInstall: () => Promise<boolean>;
  onDismiss: () => void;
};

export function InstallAppPrompt({ mode, busy, onInstall, onDismiss }: InstallAppPromptProps) {
  const [showManualGuide, setShowManualGuide] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onDismiss]);

  async function handleInstall() {
    if (mode !== "native") {
      setShowManualGuide(true);
      return;
    }
    await onInstall();
  }

  return (
    <div
      className="modal-backdrop install-permission-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onDismiss()}
    >
      <section
        className="modal-card install-permission-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-permission-title"
      >
        <span className="install-permission-aurora" aria-hidden="true" />
        <button className="install-permission-close" type="button" onClick={onDismiss} aria-label="Закрыть">
          <X size={18} weight="bold" />
        </button>

        <div className="install-app-icon">
          <BrandLogo size="xl" />
          <span className="install-status-dot" aria-hidden="true" />
        </div>

        <span className="install-permission-kicker">Приложение BarsikChat</span>
        <h2 id="install-permission-title">Установить на это устройство?</h2>
        <p className="install-permission-lead">
          BarsikChat откроется отдельным приложением — со своим значком, быстрым запуском и поддержкой уведомлений.
        </p>

        <div className="install-permission-features">
          <div>
            <span><DownloadSimple size={19} weight="duotone" /></span>
            <strong>Быстрый запуск</strong>
            <small>Прямо с рабочего стола</small>
          </div>
          <div>
            <span><Bell size={19} weight="duotone" /></span>
            <strong>Уведомления</strong>
            <small>После вашего разрешения</small>
          </div>
          <div>
            <span><ShieldCheck size={19} weight="duotone" /></span>
            <strong>Безопасно</strong>
            <small>Установка через браузер</small>
          </div>
        </div>

        {mode === "ios" && showManualGuide && (
          <div className="ios-install-guide" role="status">
            <strong>Установка на iPhone или iPad</strong>
            <ol>
              <li>Нажмите кнопку «Поделиться» в Safari.</li>
              <li>Выберите «На экран Домой».</li>
              <li>Нажмите «Добавить».</li>
            </ol>
          </div>
        )}

        {mode === "manual" && showManualGuide && (
          <div className="ios-install-guide" role="status">
            <strong>Установка через меню браузера</strong>
            <ol>
              <li>Откройте эту ссылку в Chrome или Edge.</li>
              <li>Откройте меню браузера.</li>
              <li>Выберите «Установить BarsikChat» или «Добавить на главный экран».</li>
            </ol>
          </div>
        )}

        <div className="install-permission-actions">
          <button className="install-secondary-button" type="button" onClick={onDismiss}>
            Не сейчас
          </button>
          <button className="install-primary-button" type="button" onClick={handleInstall} disabled={busy}>
            <DownloadSimple size={19} weight="bold" />
            {busy ? "Открываем…" : mode === "native" ? "Установить" : "Как установить"}
          </button>
        </div>

        <small className="install-permission-note">Можно удалить в любой момент — как обычное приложение.</small>
      </section>
    </div>
  );
}
