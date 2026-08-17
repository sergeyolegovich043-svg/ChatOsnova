ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS avatar_storage_name text,
  ADD COLUMN IF NOT EXISTS avatar_mime_type varchar(80),
  ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;

ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS notification_mode varchar(16) NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS mute_until timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversation_members_notification_mode_check'
  ) THEN
    ALTER TABLE conversation_members
      ADD CONSTRAINT conversation_members_notification_mode_check
      CHECK (notification_mode IN ('all', 'mentions', 'muted'));
  END IF;
END $$;

UPDATE conversation_members
   SET notification_mode = CASE WHEN muted THEN 'muted' ELSE 'all' END
 WHERE notification_mode = 'all' AND muted = true;

CREATE INDEX IF NOT EXISTS messages_body_search_idx
  ON messages USING gin (to_tsvector('simple', coalesce(body, '')));

CREATE INDEX IF NOT EXISTS messages_conversation_created_search_idx
  ON messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS attachments_message_media_search_idx
  ON attachments (message_id, media_kind, mime_type);
