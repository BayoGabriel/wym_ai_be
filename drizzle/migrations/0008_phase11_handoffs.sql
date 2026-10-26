DO $$ BEGIN
 CREATE TYPE "public"."handoff_requested_by" AS ENUM('VISITOR', 'STAFF', 'SYSTEM');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."handoff_status" AS ENUM('REQUESTED', 'QUEUED', 'ASSIGNED', 'RESOLVED', 'CANCELLED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "message_role" ADD VALUE IF NOT EXISTS 'AGENT';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "handoff_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handoff_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"chat_session_id" uuid,
	"status" "handoff_status" DEFAULT 'QUEUED' NOT NULL,
	"requested_by" "handoff_requested_by" DEFAULT 'VISITOR' NOT NULL,
	"reason" varchar(500),
	"assigned_to" uuid,
	"assigned_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_summary" varchar(1000),
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "handoff_notes" ADD CONSTRAINT "handoff_notes_handoff_id_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."handoffs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "handoff_notes" ADD CONSTRAINT "handoff_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "handoff_notes" ADD CONSTRAINT "handoff_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_chat_session_id_chat_sessions_id_fk" FOREIGN KEY ("chat_session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "handoff_notes_handoff_idx" ON "handoff_notes" USING btree ("handoff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "handoff_notes_org_idx" ON "handoff_notes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "handoffs_org_created_idx" ON "handoffs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "handoffs_org_status_idx" ON "handoffs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "handoffs_org_assignee_idx" ON "handoffs" USING btree ("organization_id","assigned_to");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "handoffs_session_idx" ON "handoffs" USING btree ("chat_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "handoffs_conv_idx" ON "handoffs" USING btree ("conversation_id");--> statement-breakpoint
-- At most one non-terminal handoff per conversation.
CREATE UNIQUE INDEX IF NOT EXISTS "handoffs_active_conv_unique" ON "handoffs" USING btree ("conversation_id") WHERE "status" IN ('REQUESTED', 'QUEUED', 'ASSIGNED');