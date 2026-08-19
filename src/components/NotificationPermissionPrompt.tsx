import { BellRinging, SpeakerHigh, X } from "@phosphor-icons/react";
import type { PushNotificationStatus } from "../push-notifications";

type NotificationPermissionPromptProps = {
  status: PushNotificationStatus;
  error: string;
  onEnable: () => Promise<void>;
  onDismiss: () => void;
};

export function NotificationPermissionPrompt({ status, error, onEnable, onDismiss }: NotificationPermissionPromptProps) {
  const busy = status === "syncing";
  return (
    <aside className="notification-permission-prompt" role="dialog" aria-labelledby="notification-permission-title">
      <button className="notification-permission-close" type="button" onClick={onDismiss} aria-label="Закрыть"><X size={16} weight="bold" /></button>
      <span className="notification-permission-icon"><BellRinging size={25} weight="duotone" /></span>
      <span className="notification-permission-copy">
        <strong id="notification-permission-title">Не пропускайте сообщения</strong>
        <small><SpeakerHigh size={14} /> Push-уведомления и звук, даже когда BarsikChat свёрнут.</small>
        {error && <em>{error}</em>}
      </span>
      <button className="notification-permission-enable" type="button" disabled={busy} onClick={() => void onEnable()}>
        {busy ? "Подключаем…" : "Включить"}
      </button>
    </aside>
  );
}
