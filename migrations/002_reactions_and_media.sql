ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS media_kind varchar(20) NOT NULL DEFAULT 'file',
  ADD COLUMN IF NOT EXISTS duration_ms integer;

ALTER TABLE attachments
  DROP CONSTRAINT IF EXISTS attachments_media_kind_check;

ALTER TABLE attachments
  ADD CONSTRAINT attachments_media_kind_check
  CHECK (media_kind IN ('file', 'voice', 'video_circle'));

ALTER TABLE attachments
  DROP CONSTRAINT IF EXISTS attachments_duration_ms_check;

ALTER TABLE attachments
  ADD CONSTRAINT attachments_duration_ms_check
  CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 600000);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji varchar(16) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji),
  CONSTRAINT message_reactions_emoji_check CHECK (char_length(emoji) BETWEEN 1 AND 8)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_reactions_user ON message_reactions(user_id);
