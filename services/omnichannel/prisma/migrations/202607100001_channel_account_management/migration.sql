ALTER TABLE "channel_accounts"
  ADD COLUMN IF NOT EXISTS "connection_status" TEXT NOT NULL DEFAULT 'not_configured',
  ADD COLUMN IF NOT EXISTS "is_critical" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "last_tested_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_connected_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_error" TEXT;

UPDATE "channel_accounts"
SET
  "is_critical" = COALESCE(("configuration"->>'critical')::boolean, false),
  "connection_status" = CASE
    WHEN "status" = 'mock_connected' THEN 'mock_connected'
    WHEN "status" = 'connected' THEN 'connected'
    WHEN "status" = 'not_connected' THEN 'not_configured'
    ELSE COALESCE(NULLIF("status", ''), 'not_configured')
  END
WHERE "deleted_at" IS NULL;

CREATE TABLE IF NOT EXISTS "channel_account_credentials" (
  "id" TEXT NOT NULL,
  "channel_account_id" TEXT NOT NULL,
  "credential_type" TEXT NOT NULL,
  "encrypted_value" TEXT NOT NULL,
  "key_version" TEXT NOT NULL DEFAULT 'v1',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rotated_at" TIMESTAMP(3),
  CONSTRAINT "channel_account_credentials_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'channel_account_credentials_channel_account_id_fkey'
  ) THEN
    ALTER TABLE "channel_account_credentials"
      ADD CONSTRAINT "channel_account_credentials_channel_account_id_fkey"
      FOREIGN KEY ("channel_account_id") REFERENCES "channel_accounts"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "channel_account_credentials_channel_account_id_credential_type_key"
  ON "channel_account_credentials"("channel_account_id", "credential_type");

CREATE INDEX IF NOT EXISTS "channel_account_credentials_channel_account_id_idx"
  ON "channel_account_credentials"("channel_account_id");

CREATE INDEX IF NOT EXISTS "channel_accounts_connection_status_idx"
  ON "channel_accounts"("connection_status");
