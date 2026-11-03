DO $$ BEGIN
 CREATE TYPE "public"."appointment_status" AS ENUM('REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid,
	"chat_session_id" uuid,
	"customer_name" varchar(255) NOT NULL,
	"email" varchar(255),
	"phone" varchar(64),
	"preferred_date" varchar(10) NOT NULL,
	"preferred_time" varchar(5) NOT NULL,
	"reason" varchar(1000),
	"internal_notes" text,
	"status" "appointment_status" DEFAULT 'REQUESTED' NOT NULL,
	"source" varchar(64) DEFAULT 'PUBLIC_CHAT' NOT NULL,
	"assigned_to" uuid,
	"client_request_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_conv_client_request_unique" UNIQUE("conversation_id","client_request_id")
);
--> statement-breakpoint
ALTER TABLE "assistant_configurations" ADD COLUMN "intake_fields" jsonb;--> statement-breakpoint
ALTER TABLE "assistant_configurations" ADD COLUMN "notification_email" varchar(255);--> statement-breakpoint
ALTER TABLE "assistant_configurations" ADD COLUMN "notify_on_lead" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_configurations" ADD COLUMN "notify_on_handoff" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_configurations" ADD COLUMN "notify_on_appointment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "custom_fields" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_chat_session_id_chat_sessions_id_fk" FOREIGN KEY ("chat_session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_org_created_idx" ON "appointments" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_org_status_date_idx" ON "appointments" USING btree ("organization_id","status","preferred_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_session_idx" ON "appointments" USING btree ("chat_session_id");