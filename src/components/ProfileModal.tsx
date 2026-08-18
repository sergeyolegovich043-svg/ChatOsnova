import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  Bell,
  BellRinging,
  BellSlash as BellOff,
  DownloadSimple as Download,
  FloppyDisk as Save,
  MoonStars,
  SignOut as LogOut,
  Sun,
  Trash,
  UploadSimple,
  X
} from "@phosphor-icons/react";
import { api } from "../api";
import { featureFlags } from "../features";
import type { PetPreferences } from "../pet";
import { isPushNotificationSupported, syncPushNotifications, type PushNotificationStatus } from "../push-notifications";
import type { ColorTheme, User } from "../types";
import { Avatar } from "./Avatar";

const PetProfileSetting = featureFlags.petCompanion
  ? lazy(() => import("./PetProfileSetting").then((module) => ({ default: module.PetProfileSetting })))
  : null;

type ProfileModalProps = {
  user: User;
  canInstall: boolean;
  installApp: () => Promise<boolean>;
  theme: ColorTheme;
  onThemeChange: (theme: ColorTheme) => void;
  petAvailable: boolean;
  petEnabled: boolean;
  petPreferences: PetPreferences;
  onPetEnabledChange: (enabled: boolean) => void;
  onPetPreferencesChange: (preferences: PetPreferences) => void;
  onUserChange: (user: User) => void;
  onLogout: () => Promise<void>;
  onClose: () => void;
};

export function ProfileModal({
  user,
  canInstall,
  installApp,
  theme,
  onThemeChange,
  petAvailable,
  petEnabled,
  petPreferences,
  onPetEnabledChange,
  onPetPreferencesChange,
  onUserChange,
  onLogout,
  onClose
}: ProfileModalProps) {
  const [saving, setSaving] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [error, setError] = useState("");
  const [notificationState, setNotificationState] = useState<PushNotificationStatus>("idle");
  const [testingNotification, setTestingNotification] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isPushNotificationSupported()) {
      setNotificationState("unsupported");
    } else if (Notification.permission === "denied") {
      setNotificationState("denied");
    } else if (Notification.permission === "granted") {
      setNotificationState("syncing");
      void syncPushNotifications()
        .then(setNotificationState)
        .catch((caught) => {
          setNotificationState("error");
          setError(caught instanceof Error ? caught.message : "Не удалось восстановить push-подписку");
        });
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
      setNotificationState("syncing");
      const status = await syncPushNotifications(true);
      setNotificationState(status);
      if (status === "denied") setError("Уведомления заблокированы. Разрешите их в настройках приложения или браузера.");
    } catch (caught) {
      setNotificationState("error");
      setError(caught instanceof Error ? caught.message : "Не удалось включить уведомления");
    }
  }

  async function testNotifications() {
    setTestingNotification(true);
    setError("");
    try {
      await syncPushNotifications();
      await api.testPush();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось отправить тестовое уведомление");
    } finally {
      setTestingNotification(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <header className="modal-header">
          <div><h2 id="profile-title">Профиль</h2><p>Ваши данные и настройки приложения</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={20} weight="bold" /></button>
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
          <button onClick={enableNotifications} disabled={!(["idle", "error"] as PushNotificationStatus[]).includes(notificationState)}>
            <span className="setting-icon">{notificationState === "unsupported" ? <BellOff size={19} /> : <Bell size={19} />}</span>
            <span>
              <strong>{notificationState === "enabled" ? "Уведомления включены" : notificationState === "syncing" ? "Подключаем уведомления…" : "Включить уведомления"}</strong>
              <small>{notificationState === "unsupported" ? "Не поддерживаются этим браузером" : notificationState === "denied" ? "Разрешите их в настройках приложения" : "Push и звук, когда приложение закрыто"}</small>
            </span>
          </button>
          {notificationState === "enabled" && (
            <button type="button" onClick={() => void testNotifications()} disabled={testingNotification}>
              <span className="setting-icon"><BellRinging size={19} /></span>
              <span><strong>{testingNotification ? "Отправляем…" : "Проверить уведомления"}</strong><small>Получить тестовый push со звуком на этом устройстве</small></span>
            </button>
          )}
          {canInstall && (
            <button onClick={installApp}>
              <span className="setting-icon"><Download size={19} /></span>
              <span><strong>Установить BarsikChat</strong><small>Открывать как отдельное приложение с уведомлениями</small></span>
            </button>
          )}
          <button
            className="theme-setting"
            type="button"
            role="switch"
            aria-checked={theme === "light"}
            aria-label={theme === "light" ? "Включить тёмную тему" : "Включить светлую тему"}
            onClick={() => onThemeChange(theme === "light" ? "dark" : "light")}
          >
            <span className="setting-icon">{theme === "light" ? <Sun size={19} weight="regular" /> : <MoonStars size={19} weight="regular" />}</span>
            <span><strong>{theme === "light" ? "Светлая тема" : "Тёмная тема"}</strong><small>{theme === "light" ? "Переключить на тёмное оформление" : "Переключить на светлое оформление"}</small></span>
            <span className="theme-switch" aria-hidden="true"><span /></span>
          </button>
          {PetProfileSetting && petAvailable && (
            <Suspense fallback={null}>
              <PetProfileSetting
                enabled={petEnabled}
                preferences={petPreferences}
                onChange={onPetEnabledChange}
                onPreferencesChange={onPetPreferencesChange}
              />
            </Suspense>
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
