CREATE TABLE IF NOT EXISTS "chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"visitor_label" varchar(255),
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "chat_sessions_conversation_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
ALTER TABLE "assistant_configurations" ADD COLUMN "public_chat_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_configurations" ADD COLUMN "allowed_origins" text;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_sessions_organization_id_organizations_id_fk' AND conrelid = 'chat_sessions'::regclass) THEN
  ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_sessions_conversation_id_conversations_id_fk' AND conrelid = 'chat_sessions'::regclass) THEN
  ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_sessions_org_idx" ON "chat_sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_sessions_expires_idx" ON "chat_sessions" USING btree ("expires_at");--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_org_external_session_unique' AND conrelid = 'conversations'::regclass) THEN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_org_external_session_unique" UNIQUE("organization_id","external_session_id");
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_conv_client_request_unique' AND conrelid = 'messages'::regclass) THEN
  ALTER TABLE "messages" ADD CONSTRAINT "messages_conv_client_request_unique" UNIQUE("conversation_id","client_request_id");
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_product_unique' AND conrelid = 'organization_products'::regclass) THEN
  ALTER TABLE "organization_products" ADD CONSTRAINT "org_product_unique" UNIQUE("organization_id","product_id");
 END IF;
END $$;