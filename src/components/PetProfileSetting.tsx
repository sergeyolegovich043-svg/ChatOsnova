import { Cat } from "@phosphor-icons/react";

type PetProfileSettingProps = {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
};

export function PetProfileSetting({ enabled, onChange }: PetProfileSettingProps) {
  return (
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
        <small>{enabled ? "Ходит по экрану и сообщает о новых сообщениях" : "Показать пиксельного кота на этом устройстве"}</small>
      </span>
      <span className="theme-switch" aria-hidden="true"><span /></span>
    </button>
  );
}
