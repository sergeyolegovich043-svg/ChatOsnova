-- Development-only productivity schema. Production skips files marked _dev_ai_.
ALTER TABLE ai_conversations
  DROP CONSTRAINT IF EXISTS ai_conversations_mode_check;

ALTER TABLE ai_conversations
  ADD CONSTRAINT ai_conversations_mode_check
  CHECK (mode IN ('search', 'summary', 'catchup', 'draft', 'tasks', 'notification'));

CREATE TABLE IF NOT EXISTS ai_personal_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  source_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  title varchar(240) NOT NULL,
  details text NOT NULL DEFAULT '',
  assignee_name varchar(120),
  due_at timestamptz,
  status varchar(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_personal_tasks_user_status
  ON ai_personal_tasks (user_id, status, due_at NULLS LAST, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_notification_queue (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  mentioned boolean NOT NULL DEFAULT false,
  needs_attention boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  PRIMARY KEY (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_notification_queue_pending
  ON ai_notification_queue (user_id, created_at DESC)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_notification_queue_conversation
  ON ai_notification_queue (user_id, conversation_id, created_at DESC)
  WHERE consumed_at IS NULL;
