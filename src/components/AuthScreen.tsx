import { useState, type ChangeEvent, type FormEvent } from "react";
import {
  ArrowRight,
  BellRinging as BellRing,
  Check,
  LockKey as LockKeyhole,
  Sparkle as Sparkles,
  UsersThree as Users
} from "@phosphor-icons/react";
import { api } from "../api";
import type { User } from "../types";
import { BrandLogo } from "./BrandLogo";
import { Avatar } from "./Avatar";

type AuthScreenProps = {
  onAuthenticated: (user: User) => void;
};

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      setError("Выберите PNG, JPEG, WebP или GIF");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Аватар не должен превышать 5 МБ");
      return;
    }
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result =
        mode === "login"
          ? await api.login({
              login: String(form.get("login")),
              password: String(form.get("password"))
            })
          : await api.register({
              email: String(form.get("email")),
              username: String(form.get("username")),
              displayName: String(form.get("displayName")),
              password: String(form.get("password"))
            });
      let authenticatedUser = result.user;
      if (mode === "register" && avatarFile) {
        try {
          authenticatedUser = (await api.uploadAvatar(avatarFile)).user;
        } catch {
          // The account is already valid; the photo can be retried from Profile.
        }
      }
      onAuthenticated(authenticatedUser);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось войти");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="О приложении">
        <div className="brand brand-light">
          <BrandLogo size="sm" />
          <span>Barsik<span className="brand-accent">Chat</span></span>
        </div>
        <div className="auth-story-copy">
          <span className="eyebrow"><Sparkles size={15} /> Мессенджер нового поколения</span>
          <h1>Общение,<br />которое <em>мурчит.</em></h1>
          <p>Красивое и приватное пространство для вашей команды. Быстрые диалоги, группы и файлы — на вашем сервере.</p>
        </div>
        <div className="auth-features">
          <div><span className="feature-icon"><Check size={17} /></span><span><strong>Мгновенно</strong><small>Сообщения без задержек</small></span></div>
          <div><span className="feature-icon"><Users size={17} /></span><span><strong>Для команды</strong><small>До 100 коллег</small></span></div>
          <div><span className="feature-icon"><LockKeyhole size={17} /></span><span><strong>Под контролем</strong><small>Данные на вашем сервере</small></span></div>
        </div>
        <div className="story-message story-message-one"><span className="story-avatar">М</span><span><strong>Мария</strong><small>Макет готов — посмотрите ✨</small></span></div>
        <div className="story-message story-message-two"><BellRing size={17} /><span>Новое сообщение</span></div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="mobile-brand brand">
            <BrandLogo size="sm" />
            <span>Barsik<span className="brand-accent">Chat</span></span>
          </div>
          <div className="auth-tabs" role="tablist" aria-label="Авторизация">
            <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>
              Вход
            </button>
            <button className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); }}>
              Регистрация
            </button>
          </div>

          <div className="auth-heading">
            <span className="form-kicker">{mode === "login" ? "Личный кабинет" : "Новый участник"}</span>
            <h2>{mode === "login" ? "С возвращением" : "Создайте аккаунт"}</h2>
            <p>{mode === "login" ? "Войдите в своё пространство BarsikChat." : "Присоединитесь к закрытому пространству команды."}</p>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {mode === "register" && (
              <>
                <label className="auth-avatar-picker">
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={chooseAvatar} />
                  <Avatar label={String(avatarPreview ? "Фото профиля" : "Новый участник")} imageUrl={avatarPreview} size="xl" />
                  <span className="auth-avatar-copy"><strong>{avatarFile ? "Фото выбрано" : "Добавить аватар"}</strong><small>PNG, JPEG, WebP или GIF · до 5 МБ</small></span>
                  <span className="auth-avatar-action"><ArrowRight size={17} /></span>
                </label>
                <label>
                  <span>Имя</span>
                  <input name="displayName" autoComplete="name" placeholder="Анна Смирнова" minLength={2} maxLength={80} required />
                </label>
                <label>
                  <span>Логин</span>
                  <div className="input-prefix"><span>@</span><input name="username" autoComplete="username" placeholder="anna" pattern="[a-zA-Z0-9_]{3,32}" required /></div>
                </label>
                <label>
                  <span>Email</span>
                  <input name="email" type="email" autoComplete="email" placeholder="anna@company.ru" required />
                </label>
              </>
            )}
            {mode === "login" && (
              <label>
                <span>Email или логин</span>
                <input name="login" autoComplete="username" placeholder="anna или anna@company.ru" required autoFocus />
              </label>
            )}
            <label>
              <span>Пароль</span>
              <input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="Не менее 8 символов" minLength={mode === "register" ? 8 : 1} required />
            </label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="primary-button auth-submit" type="submit" disabled={loading}>
              <span>{loading ? "Подождите…" : mode === "login" ? "Войти" : "Создать аккаунт"}</span>
              {!loading && <ArrowRight size={18} />}
            </button>
          </form>
          {mode === "register" && <p className="auth-note">Регистрируясь, вы соглашаетесь соблюдать правила вашей команды.</p>}
        </div>
      </section>
    </main>
  );
}
