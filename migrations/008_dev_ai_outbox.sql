-- Development-only AI schema. Production migrations deliberately skip files marked _dev_ai_.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(64) NOT NULL,
  aggregate_type varchar(32) NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  processed_at timestamptz,
  last_error varchar(500)
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON outbox_events (available_at, created_at)
  WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS ai_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  source_kind varchar(24) NOT NULL CHECK (source_kind IN ('message', 'attachment')),
  source_id uuid NOT NULL,
  source_message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  access_scope varchar(24) NOT NULL CHECK (access_scope IN ('conversation', 'private')),
  content text NOT NULL,
  content_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_chunks_conversation ON ai_chunks (conversation_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chunks_search ON ai_chunks USING gin (to_tsvector('simple', content));

CREATE TABLE IF NOT EXISTS ai_embeddings (
  chunk_id uuid PRIMARY KEY REFERENCES ai_chunks(id) ON DELETE CASCADE,
  model varchar(80) NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_embeddings_hnsw
  ON ai_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS ai_index_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_event_id uuid NOT NULL UNIQUE REFERENCES outbox_events(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  mode varchar(16) NOT NULL CHECK (mode IN ('search', 'summary', 'draft')),
  title varchar(120) NOT NULL DEFAULT 'Диалог с Барсиком',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider varchar(24) NOT NULL,
  model varchar(80) NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_month ON ai_usage (created_at, user_id);

CREATE TABLE IF NOT EXISTS ai_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  request_hash char(64) NOT NULL,
  action varchar(32) NOT NULL,
  status varchar(24) NOT NULL,
  provider varchar(24),
  model varchar(80),
  source_ids uuid[] NOT NULL DEFAULT '{}',
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  error_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_user_created ON ai_audit_log (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_user_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  allow_private_context boolean NOT NULL DEFAULT false,
  monthly_budget_usd numeric(12, 2),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION enqueue_message_outbox() RETURNS trigger AS $$
DECLARE
  chosen messages;
BEGIN
  chosen := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
  VALUES (
    CASE
      WHEN TG_OP = 'DELETE' OR chosen.deleted_at IS NOT NULL THEN 'message.deleted'
      WHEN TG_OP = 'INSERT' THEN 'message.created'
      ELSE 'message.updated'
    END,
    'message',
    chosen.id,
    jsonb_build_object('messageId', chosen.id, 'conversationId', chosen.conversation_id)
  );
  RETURN chosen;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_outbox_trigger ON messages;
CREATE TRIGGER messages_outbox_trigger
AFTER INSERT OR UPDATE OF body, deleted_at, published_at, expires_at, view_once OR DELETE ON messages
FOR EACH ROW EXECUTE FUNCTION enqueue_message_outbox();

CREATE OR REPLACE FUNCTION enqueue_attachment_outbox() RETURNS trigger AS $$
DECLARE
  chosen attachments;
BEGIN
  chosen := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF chosen.message_id IS NOT NULL THEN
    INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
    VALUES (
      'attachment.ready',
      'attachment',
      chosen.id,
      jsonb_build_object('attachmentId', chosen.id, 'messageId', chosen.message_id, 'operation', lower(TG_OP))
    );
  END IF;
  RETURN chosen;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS attachments_outbox_trigger ON attachments;
CREATE TRIGGER attachments_outbox_trigger
AFTER INSERT OR UPDATE OF message_id OR DELETE ON attachments
FOR EACH ROW EXECUTE FUNCTION enqueue_attachment_outbox();

CREATE OR REPLACE FUNCTION enqueue_member_removed_outbox() RETURNS trigger AS $$
BEGIN
  INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
  VALUES (
    'member.removed',
    'membership',
    OLD.conversation_id,
    jsonb_build_object('conversationId', OLD.conversation_id, 'userId', OLD.user_id)
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS member_removed_outbox_trigger ON conversation_members;
CREATE TRIGGER member_removed_outbox_trigger
AFTER DELETE ON conversation_members
FOR EACH ROW EXECUTE FUNCTION enqueue_member_removed_outbox();

CREATE OR REPLACE FUNCTION enqueue_conversation_deleted_outbox() RETURNS trigger AS $$
BEGIN
  INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
  VALUES (
    'conversation.deleted',
    'conversation',
    OLD.id,
    jsonb_build_object('conversationId', OLD.id)
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS conversation_deleted_outbox_trigger ON conversations;
CREATE TRIGGER conversation_deleted_outbox_trigger
AFTER DELETE ON conversations
FOR EACH ROW EXECUTE FUNCTION enqueue_conversation_deleted_outbox();
