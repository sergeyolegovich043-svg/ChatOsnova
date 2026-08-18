ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_storage_name text,
  ADD COLUMN IF NOT EXISTS avatar_mime_type varchar(80),
  ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS users_avatar_storage_name_unique
  ON users (avatar_storage_name)
  WHERE avatar_storage_name IS NOT NULL;
