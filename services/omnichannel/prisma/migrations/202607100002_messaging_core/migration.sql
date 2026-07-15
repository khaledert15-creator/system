ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'sending';
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'retry_pending';
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "media_storage_key" TEXT,
  ADD COLUMN IF NOT EXISTS "media_filename" TEXT,
  ADD COLUMN IF NOT EXISTS "media_size" INTEGER,
  ADD COLUMN IF NOT EXISTS "media_metadata" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "caption" TEXT;

CREATE TABLE IF NOT EXISTS "message_templates" (
  "id" TEXT NOT NULL,
  "channel_account_id" TEXT,
  "provider" TEXT NOT NULL,
  "template_name" TEXT NOT NULL,
  "language_code" TEXT NOT NULL DEFAULT 'ar',
  "category" TEXT NOT NULL DEFAULT 'utility',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "components" JSONB NOT NULL DEFAULT '{}',
  "variables_schema" JSONB NOT NULL DEFAULT '{}',
  "external_template_id" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "last_synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'message_templates_channel_account_id_fkey'
  ) THEN
    ALTER TABLE "message_templates"
      ADD CONSTRAINT "message_templates_channel_account_id_fkey"
      FOREIGN KEY ("channel_account_id") REFERENCES "channel_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "message_templates_channel_account_id_idx" ON "message_templates"("channel_account_id");
CREATE INDEX IF NOT EXISTS "message_templates_provider_idx" ON "message_templates"("provider");
CREATE INDEX IF NOT EXISTS "message_templates_status_idx" ON "message_templates"("status");

CREATE TABLE IF NOT EXISTS "outbound_message_jobs" (
  "id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_attempt_at" TIMESTAMP(3),
  "last_error" TEXT,
  "error_code" TEXT,
  "locked_at" TIMESTAMP(3),
  "locked_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbound_message_jobs_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outbound_message_jobs_message_id_fkey'
  ) THEN
    ALTER TABLE "outbound_message_jobs"
      ADD CONSTRAINT "outbound_message_jobs_message_id_fkey"
      FOREIGN KEY ("message_id") REFERENCES "messages"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "outbound_message_jobs_message_id_idx" ON "outbound_message_jobs"("message_id");
CREATE INDEX IF NOT EXISTS "outbound_message_jobs_status_next_attempt_at_idx" ON "outbound_message_jobs"("status", "next_attempt_at");
