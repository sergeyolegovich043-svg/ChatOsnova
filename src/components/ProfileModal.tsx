import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  Bell,
  BellSlash as BellOff,
  DownloadSimple as Download,
  FloppyDisk as Save,
  SignOut as LogOut,
  Trash,
  UploadSimple,
  X
} from "@phosphor-icons/react";
import { api } from "../api";
import type { User } from "../types";
import { Avatar } from "./Avatar";

type ProfileModalProps = {
  user: User;
  canInstall: boolean;
  installApp: () => Promise<boolean>;
  onUserChange: (user: User) => void;
  onLogout: () => Promise<void>;
  onClose: () => void;
};

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((character) => character.charCodeAt(0)));
}

export function ProfileModal({ user, canInstall, installApp, onUserChange, onLogout, onClose }: ProfileModalProps) {
  const [saving, setSaving] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [error, setError] = useState("");
  const [notificationState, setNotificationState] = useState<"idle" | "enabled" | "unsupported">("idle");
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setNotificationState("unsupported");
    } else if (Notification.permission === "granted") {
      navigator.serviceWorker.ready
        .then((registration) => registration.pushManager.getSubscription())
        .then((subscription) => subscription && setNotificationState("enabled"));
    }
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const { user: updated } = await api.updateProfile({
        displayName: String(form.get("displayName")),
        bio: String(form.get("bio"))
      });
      onUserChange(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить профиль");
    } finally {
      setSaving(false);
    }
  }

  async function changeAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      setError("Выберите PNG, JPEG, WebP или GIF");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Аватар не должен превышать 5 МБ");
      return;
    }
    setAvatarSaving(true);
    setError("");
    try {
      const { user: updated } = await api.uploadAvatar(file);
      onUserChange(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить аватар");
    } finally {
      setAvatarSaving(false);
    }
  }

  async function removeAvatar() {
    if (!user.avatarUrl || avatarSaving) return;
    setAvatarSaving(true);
    setError("");
    try {
      const { user: updated } = await api.deleteAvatar();
      onUserChange(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить аватар");
    } finally {
      setAvatarSaving(false);
    }
  }

  async function enableNotifications() {
    setError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Разрешите уведомления в настройках браузера");
        return;
      }
      const { publicKey } = await api.pushPublicKey();
      if (!publicKey) {
        setError("Администратор ещё не настроил ключи Web Push");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      await api.subscribePush(subscription.toJSON());
      setNotificationState("enabled");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось включить уведомления");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <header className="modal-header">
          <div><h2 id="profile-title">Профиль</h2><p>Ваши данные и настройки приложения</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={20} /></button>
        </header>
        <div className="profile-identity">
          <div className="profile-avatar-editor">
            <Avatar label={user.displayName} color={user.avatarColor} imageUrl={user.avatarUrl} size="xl" />
            <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarSaving} aria-label="Изменить аватар"><UploadSimple size={17} /></button>
            <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={changeAvatar} />
          </div>
          <div className="profile-identity-copy"><strong>{user.displayName}</strong><span>@{user.username}</span><small>{user.email}</small></div>
          <div className="profile-avatar-actions">
            <button type="button" className="avatar-upload-button" onClick={() => avatarInputRef.current?.click()} disabled={avatarSaving}><UploadSimple size={16} />{avatarSaving ? "Загружаем…" : user.avatarUrl ? "Заменить фото" : "Загрузить фото"}</button>
            {user.avatarUrl && <button type="button" className="avatar-remove-button" onClick={() => void removeAvatar()} disabled={avatarSaving} aria-label="Удалить аватар"><Trash size={16} /></button>}
          </div>
        </div>
        <form className="profile-form" onSubmit={save}>
          <label className="stacked-label"><span>Имя</span><input name="displayName" defaultValue={user.displayName} minLength={2} maxLength={80} required /></label>
          <label className="stacked-label"><span>О себе</span><textarea name="bio" defaultValue={user.bio} maxLength={180} rows={3} placeholder="Должность, команда или короткий статус" /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="secondary-button save-profile" type="submit" disabled={saving}><Save size={17} /> {saving ? "Сохраняем…" : "Сохранить профиль"}</button>
        </form>
        <div className="settings-list">
          <button onClick={enableNotifications} disabled={notificationState !== "idle"}>
            <span className="setting-icon">{notificationState === "unsupported" ? <BellOff size={19} /> : <Bell size={19} />}</span>
            <span><strong>{notificationState === "enabled" ? "Уведомления включены" : "Включить уведомления"}</strong><small>{notificationState === "unsupported" ? "Не поддерживаются этим браузером" : "Получать сообщения, когда приложение закрыто"}</small></span>
          </button>
          {canInstall && (
            <button onClick={installApp}>
              <span className="setting-icon"><Download size={19} /></span>
              <span><strong>Установить BarsikChat</strong><small>Открывать как отдельное приложение с уведомлениями</small></span>
            </button>
          )}
          <button className="danger-setting" onClick={onLogout}>
            <span className="setting-icon"><LogOut size={19} /></span>
            <span><strong>Выйти</strong><small>Завершить сеанс на этом устройстве</small></span>
          </button>
        </div>
      </section>
    </div>
  );
}
