ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS manual_unread boolean NOT NULL DEFAULT false;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS silent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expire_seconds integer,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS view_once boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_expire_seconds_check'
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_expire_seconds_check
      CHECK (expire_seconds IS NULL OR expire_seconds BETWEEN 60 AND 604800);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS conversation_message_pins (
  message_id uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  pinned_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pinned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_hidden_users (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_views (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_pins_conversation
  ON conversation_message_pins (conversation_id, pinned_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_hidden_user
  ON message_hidden_users (user_id, message_id);

CREATE INDEX IF NOT EXISTS idx_messages_scheduled_publish
  ON messages (scheduled_at)
  WHERE published_at IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_expiry
  ON messages (expires_at)
  WHERE expires_at IS NOT NULL AND deleted_at IS NULL;
