ALTER TYPE "conversation_channel" ADD VALUE 'TELEGRAM';--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "messenger_page_id" varchar(64);--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "instagram_account_id" varchar(64);--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "telegram_bot_token" varchar(128);--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "inbound_email_address" varchar(255);