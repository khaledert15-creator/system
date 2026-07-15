CREATE TYPE "SavedReplyScope" AS ENUM ('personal', 'team', 'global');
CREATE TYPE "AutomationRunStatus" AS ENUM ('pending', 'skipped', 'success', 'failed');

CREATE TABLE "saved_replies" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "shortcut" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "scope" "SavedReplyScope" NOT NULL DEFAULT 'personal',
  "owner_user_id" TEXT,
  "team_key" TEXT,
  "category" TEXT,
  "channel_type" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "usage_count" INTEGER NOT NULL DEFAULT 0,
  "last_used_at" TIMESTAMP(3),
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "saved_replies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "saved_replies_shortcut_idx" ON "saved_replies"("shortcut");
CREATE INDEX "saved_replies_scope_idx" ON "saved_replies"("scope");
CREATE INDEX "saved_replies_owner_user_id_idx" ON "saved_replies"("owner_user_id");
CREATE INDEX "saved_replies_team_key_idx" ON "saved_replies"("team_key");
CREATE INDEX "saved_replies_is_active_idx" ON "saved_replies"("is_active");

CREATE TABLE "automation_rules" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "trigger_type" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "channel_scope" TEXT NOT NULL DEFAULT 'all',
  "channel_account_id" TEXT,
  "conditions" JSONB NOT NULL DEFAULT '{}',
  "actions" JSONB NOT NULL DEFAULT '[]',
  "stop_processing" BOOLEAN NOT NULL DEFAULT false,
  "cooldown_seconds" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "automation_rules_trigger_type_idx" ON "automation_rules"("trigger_type");
CREATE INDEX "automation_rules_is_active_idx" ON "automation_rules"("is_active");
CREATE INDEX "automation_rules_channel_account_id_idx" ON "automation_rules"("channel_account_id");

CREATE TABLE "automation_runs" (
  "id" TEXT NOT NULL,
  "automation_rule_id" TEXT,
  "conversation_id" TEXT,
  "message_id" TEXT,
  "status" "AutomationRunStatus" NOT NULL DEFAULT 'pending',
  "matched" BOOLEAN NOT NULL DEFAULT false,
  "actions_executed" JSONB NOT NULL DEFAULT '[]',
  "error" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "automation_runs_automation_rule_id_idx" ON "automation_runs"("automation_rule_id");
CREATE INDEX "automation_runs_conversation_id_idx" ON "automation_runs"("conversation_id");
CREATE INDEX "automation_runs_message_id_idx" ON "automation_runs"("message_id");
CREATE INDEX "automation_runs_status_idx" ON "automation_runs"("status");
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_rule_id_fkey" FOREIGN KEY ("automation_rule_id") REFERENCES "automation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "business_hours" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Africa/Cairo',
  "schedule" JSONB NOT NULL DEFAULT '{}',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "business_hours_is_active_idx" ON "business_hours"("is_active");

CREATE TABLE "automation_cooldowns" (
  "id" TEXT NOT NULL,
  "automation_rule_id" TEXT NOT NULL,
  "cooldown_key" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_cooldowns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_cooldowns_automation_rule_id_cooldown_key_key" ON "automation_cooldowns"("automation_rule_id", "cooldown_key");
CREATE INDEX "automation_cooldowns_expires_at_idx" ON "automation_cooldowns"("expires_at");
ALTER TABLE "automation_cooldowns" ADD CONSTRAINT "automation_cooldowns_automation_rule_id_fkey" FOREIGN KEY ("automation_rule_id") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
