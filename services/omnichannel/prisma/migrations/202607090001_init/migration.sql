-- Omnichannel Customer Service Center initial PostgreSQL schema.
-- Generated to match prisma/schema.prisma.

CREATE TYPE "ConversationStatus" AS ENUM ('unassigned', 'claimed', 'assigned', 'waiting_customer', 'waiting_agent', 'closed');
CREATE TYPE "ConversationPriority" AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE "MessageDirection" AS ENUM ('inbound', 'outbound');
CREATE TYPE "SenderType" AS ENUM ('customer', 'agent', 'system');
CREATE TYPE "MessageStatus" AS ENUM ('pending', 'queued', 'sent', 'delivered', 'read', 'failed');
CREATE TYPE "AssignmentAction" AS ENUM ('claimed', 'assigned', 'transferred', 'released', 'closed', 'reopened');
CREATE TYPE "WebhookStatus" AS ENUM ('received', 'processing', 'processed', 'failed', 'ignored');

CREATE TABLE "channels" (
  "id" TEXT PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "channel_accounts" (
  "id" TEXT PRIMARY KEY,
  "channel_id" TEXT NOT NULL REFERENCES "channels"("id"),
  "name" TEXT NOT NULL,
  "external_account_id" TEXT,
  "external_phone_number" TEXT,
  "phone_number_id" TEXT,
  "business_account_id" TEXT,
  "page_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'not_connected',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "configuration" JSONB NOT NULL DEFAULT '{}',
  "credentials_reference" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3)
);

CREATE UNIQUE INDEX "channel_accounts_channel_id_external_account_id_key" ON "channel_accounts"("channel_id","external_account_id");
CREATE UNIQUE INDEX "channel_accounts_channel_id_phone_number_id_key" ON "channel_accounts"("channel_id","phone_number_id");
CREATE UNIQUE INDEX "channel_accounts_channel_id_page_id_key" ON "channel_accounts"("channel_id","page_id");
CREATE INDEX "channel_accounts_channel_id_idx" ON "channel_accounts"("channel_id");
CREATE INDEX "channel_accounts_status_idx" ON "channel_accounts"("status");

CREATE TABLE "contacts" (
  "id" TEXT PRIMARY KEY,
  "customer_id" TEXT,
  "display_name" TEXT NOT NULL,
  "primary_phone" TEXT,
  "email" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3)
);
CREATE INDEX "contacts_customer_id_idx" ON "contacts"("customer_id");
CREATE INDEX "contacts_primary_phone_idx" ON "contacts"("primary_phone");

CREATE TABLE "contact_identities" (
  "id" TEXT PRIMARY KEY,
  "contact_id" TEXT NOT NULL REFERENCES "contacts"("id"),
  "channel_account_id" TEXT NOT NULL REFERENCES "channel_accounts"("id"),
  "provider" TEXT NOT NULL,
  "external_identity_id" TEXT NOT NULL,
  "normalized_phone" TEXT,
  "username" TEXT,
  "display_name" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "contact_identities_channel_account_id_external_identity_id_key" ON "contact_identities"("channel_account_id","external_identity_id");
CREATE INDEX "contact_identities_contact_id_idx" ON "contact_identities"("contact_id");
CREATE INDEX "contact_identities_normalized_phone_idx" ON "contact_identities"("normalized_phone");

CREATE TABLE "conversations" (
  "id" TEXT PRIMARY KEY,
  "channel_account_id" TEXT NOT NULL REFERENCES "channel_accounts"("id"),
  "contact_id" TEXT NOT NULL REFERENCES "contacts"("id"),
  "external_conversation_id" TEXT,
  "status" "ConversationStatus" NOT NULL DEFAULT 'unassigned',
  "priority" "ConversationPriority" NOT NULL DEFAULT 'normal',
  "assigned_user_id" TEXT,
  "customer_id" TEXT,
  "online_order_id" TEXT,
  "sale_id" TEXT,
  "shipment_id" TEXT,
  "subject" TEXT,
  "last_message_at" TIMESTAMP(3),
  "last_inbound_at" TIMESTAMP(3),
  "last_outbound_at" TIMESTAMP(3),
  "first_response_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "closed_by_user_id" TEXT,
  "unread_count" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3)
);
CREATE INDEX "conversations_channel_account_id_idx" ON "conversations"("channel_account_id");
CREATE INDEX "conversations_contact_id_idx" ON "conversations"("contact_id");
CREATE INDEX "conversations_status_idx" ON "conversations"("status");
CREATE INDEX "conversations_assigned_user_id_idx" ON "conversations"("assigned_user_id");
CREATE INDEX "conversations_last_message_at_idx" ON "conversations"("last_message_at");
CREATE INDEX "conversations_customer_id_idx" ON "conversations"("customer_id");

CREATE TABLE "conversation_participants" (
  "id" TEXT PRIMARY KEY,
  "conversation_id" TEXT NOT NULL REFERENCES "conversations"("id"),
  "participant_type" TEXT NOT NULL,
  "contact_id" TEXT REFERENCES "contacts"("id"),
  "user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "conversation_participants_conversation_id_idx" ON "conversation_participants"("conversation_id");

CREATE TABLE "messages" (
  "id" TEXT PRIMARY KEY,
  "conversation_id" TEXT NOT NULL REFERENCES "conversations"("id"),
  "channel_account_id" TEXT NOT NULL REFERENCES "channel_accounts"("id"),
  "direction" "MessageDirection" NOT NULL,
  "sender_type" "SenderType" NOT NULL,
  "sent_by_user_id" TEXT,
  "external_message_id" TEXT,
  "reply_to_message_id" TEXT,
  "message_type" TEXT NOT NULL DEFAULT 'text',
  "text_content" TEXT,
  "media_url" TEXT,
  "media_mime_type" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "status" "MessageStatus" NOT NULL DEFAULT 'pending',
  "client_message_id" TEXT,
  "provider_timestamp" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3)
);
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id","created_at");
CREATE INDEX "messages_external_message_id_idx" ON "messages"("external_message_id");
CREATE INDEX "messages_status_idx" ON "messages"("status");
CREATE UNIQUE INDEX "messages_channel_account_id_external_message_id_key" ON "messages"("channel_account_id","external_message_id");
CREATE UNIQUE INDEX "messages_conversation_id_client_message_id_key" ON "messages"("conversation_id","client_message_id");

CREATE TABLE "message_delivery_statuses" (
  "id" TEXT PRIMARY KEY,
  "message_id" TEXT NOT NULL REFERENCES "messages"("id"),
  "status" "MessageStatus" NOT NULL,
  "provider_status" TEXT NOT NULL,
  "provider_timestamp" TIMESTAMP(3),
  "error_code" TEXT,
  "error_message" TEXT,
  "raw_payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "message_delivery_statuses_message_id_idx" ON "message_delivery_statuses"("message_id");

CREATE TABLE "conversation_assignments" (
  "id" TEXT PRIMARY KEY,
  "conversation_id" TEXT NOT NULL REFERENCES "conversations"("id"),
  "assigned_to_user_id" TEXT,
  "assigned_by_user_id" TEXT,
  "action" "AssignmentAction" NOT NULL,
  "from_user_id" TEXT,
  "to_user_id" TEXT,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "conversation_assignments_conversation_id_idx" ON "conversation_assignments"("conversation_id");
CREATE INDEX "conversation_assignments_assigned_to_user_id_idx" ON "conversation_assignments"("assigned_to_user_id");

CREATE TABLE "conversation_events" (
  "id" TEXT PRIMARY KEY,
  "conversation_id" TEXT NOT NULL REFERENCES "conversations"("id"),
  "event_type" TEXT NOT NULL,
  "actor_type" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "message_id" TEXT REFERENCES "messages"("id"),
  "payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "conversation_events_conversation_id_idx" ON "conversation_events"("conversation_id");
CREATE INDEX "conversation_events_event_type_idx" ON "conversation_events"("event_type");

CREATE TABLE "webhook_events" (
  "id" TEXT PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "channel_account_id" TEXT REFERENCES "channel_accounts"("id"),
  "external_event_id" TEXT UNIQUE,
  "event_hash" TEXT NOT NULL UNIQUE,
  "event_type" TEXT NOT NULL,
  "status" "WebhookStatus" NOT NULL DEFAULT 'received',
  "raw_payload" JSONB NOT NULL,
  "signature_valid" BOOLEAN NOT NULL DEFAULT false,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT
);
CREATE INDEX "webhook_events_provider_idx" ON "webhook_events"("provider");
CREATE INDEX "webhook_events_status_idx" ON "webhook_events"("status");

CREATE TABLE "agent_activity_logs" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "conversation_id" TEXT,
  "message_id" TEXT REFERENCES "messages"("id"),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "agent_activity_logs_user_id_idx" ON "agent_activity_logs"("user_id");
CREATE INDEX "agent_activity_logs_conversation_id_idx" ON "agent_activity_logs"("conversation_id");
