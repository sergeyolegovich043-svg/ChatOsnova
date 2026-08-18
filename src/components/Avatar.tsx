import type { Member } from "../types";

type AvatarProps = {
  user?: Pick<Member, "displayName" | "avatarColor" | "avatarUrl" | "online">;
  label?: string;
  color?: string;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  online?: boolean;
};

export function Avatar({ user, label, color, imageUrl, size = "md", online }: AvatarProps) {
  const name = user?.displayName ?? label ?? "BarsikChat";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const isOnline = online ?? user?.online;
  const source = user?.avatarUrl ?? imageUrl;

  return (
    <span
      className={`avatar avatar-${size}`}
      style={{ background: user?.avatarColor ?? color ?? "#7657ff" }}
      aria-label={name}
    >
      {source ? <img src={source} alt="" draggable={false} /> : initials || "B"}
      {isOnline && <span className="avatar-online" aria-label="В сети" />}
    </span>
  );
}
