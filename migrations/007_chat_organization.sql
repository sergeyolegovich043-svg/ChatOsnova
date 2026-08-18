ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE TABLE IF NOT EXISTS chat_folders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(40) NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, title)
);

CREATE TABLE IF NOT EXISTS chat_folder_items (
  folder_id uuid NOT NULL REFERENCES chat_folders(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_folders_user_position
  ON chat_folders (user_id, position, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_folder_items_conversation
  ON chat_folder_items (conversation_id);
