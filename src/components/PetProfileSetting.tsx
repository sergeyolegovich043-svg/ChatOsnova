import { BellSlash, Cat, Eye, EyeSlash } from "@phosphor-icons/react";
import { isPetQuiet, type PetPreferences } from "../pet";
import "../pet.css";

type PetProfileSettingProps = {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  preferences: PetPreferences;
  onPreferencesChange: (preferences: PetPreferences) => void;
};

export function PetProfileSetting({ enabled, onChange, preferences, onPreferencesChange }: PetProfileSettingProps) {
  const quiet = isPetQuiet(preferences);

  return (
    <>
      <button
        className="theme-setting pet-setting"
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={enabled ? "Спрятать питомца Барсика" : "Показать питомца Барсика"}
        onClick={() => onChange(!enabled)}
      >
        <span className="setting-icon"><Cat size={20} weight="fill" /></span>
        <span>
          <strong>Питомец Барсик</strong>
          <small>{enabled ? "Помогает с сообщениями на этом устройстве" : "Показать пиксельного кота на этом устройстве"}</small>
        </span>
        <span className="theme-switch" aria-hidden="true"><span /></span>
      </button>
      {enabled && (
        <>
          <button
            className="theme-setting pet-subsetting"
            type="button"
            role="switch"
            aria-checked={preferences.showMessagePreview}
            onClick={() => onPreferencesChange({ ...preferences, showMessagePreview: !preferences.showMessagePreview })}
          >
            <span className="setting-icon">{preferences.showMessagePreview ? <Eye size={19} /> : <EyeSlash size={19} />}</span>
            <span><strong>Текст в уведомлениях</strong><small>{preferences.showMessagePreview ? "Барсик показывает фрагмент сообщения" : "Текст сообщения скрыт"}</small></span>
            <span className="theme-switch" aria-hidden="true"><span /></span>
          </button>
          <button
            className="theme-setting pet-subsetting"
            type="button"
            role="switch"
            aria-checked={quiet}
            onClick={() => onPreferencesChange({ ...preferences, quietUntil: quiet ? null : Date.now() + 60 * 60_000 })}
          >
            <span className="setting-icon"><BellSlash size={19} /></span>
            <span><strong>Тихий режим</strong><small>{quiet ? "Анимации приостановлены — нажмите, чтобы включить" : "Отключить реакции Барсика на один час"}</small></span>
            <span className="theme-switch" aria-hidden="true"><span /></span>
          </button>
        </>
      )}
    </>
  );
}
