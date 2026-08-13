export const quickReactions = ["👍", "❤️", "🔥", "😂", "😍", "😮", "😢", "👏", "🎉", "🤝", "💯", "🐈"];

const emojis = [
  "😀", "😃", "😄", "😁", "😊", "🥰", "😍", "😘",
  "😎", "🤩", "🥳", "😂", "🤣", "🙂", "🙃", "😉",
  "🤔", "🫡", "🤗", "😮", "😢", "😭", "😡", "🤯",
  "👍", "👎", "👏", "🙌", "🤝", "🙏", "💪", "👀",
  "❤️", "💜", "💙", "💚", "🧡", "🔥", "✨", "💯",
  "🎉", "🚀", "✅", "⭐", "💡", "☕", "🐈", "😺"
];

type EmojiPickerProps = {
  onSelect: (emoji: string) => void;
  compact?: boolean;
  title?: string;
};

export function EmojiPicker({ onSelect, compact = false, title = "Эмодзи" }: EmojiPickerProps) {
  const items = compact ? quickReactions : emojis;
  return (
    <section className={`emoji-picker ${compact ? "compact" : ""}`} aria-label={title}>
      {!compact && (
        <header>
          <span>Эмоции</span>
          <small>Выберите смайлик</small>
        </header>
      )}
      <div className="emoji-grid">
        {items.map((emoji) => (
          <button key={emoji} type="button" onClick={() => onSelect(emoji)} aria-label={`Добавить ${emoji}`}>
            {emoji}
          </button>
        ))}
      </div>
    </section>
  );
}
