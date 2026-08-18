ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

ALTER TABLE attachments
  DROP CONSTRAINT IF EXISTS attachments_storage_name_key;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS forwarded_from_id uuid REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_members_visible_user
  ON conversation_members (user_id, pinned_at DESC, conversation_id)
  WHERE hidden_at IS NULL;
