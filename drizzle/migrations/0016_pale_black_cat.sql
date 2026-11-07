ALTER TYPE "knowledge_category" ADD VALUE 'COMPANY_INFO';--> statement-breakpoint
ALTER TYPE "knowledge_category" ADD VALUE 'SERVICES';--> statement-breakpoint
ALTER TYPE "knowledge_category" ADD VALUE 'POLICIES';--> statement-breakpoint
ALTER TYPE "knowledge_category" ADD VALUE 'PRICING';--> statement-breakpoint
ALTER TYPE "knowledge_category" ADD VALUE 'PROCEDURES';--> statement-breakpoint
ALTER TABLE "assistant_configurations" ADD COLUMN "availability" jsonb;--> statement-breakpoint
ALTER TABLE "assistant_configurations" ADD COLUMN "guardrails" jsonb;--> statement-breakpoint
ALTER TABLE "assistant_configurations" ADD COLUMN "widget_appearance" jsonb;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "assigned_to" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "tags" text[];--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "grounded" boolean;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "feedback" varchar(16);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
UPDATE "messages" SET "grounded" = (metadata::jsonb->>'grounded')::boolean WHERE "role" = 'ASSISTANT' AND metadata IS NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_org_grounded_idx" ON "messages" ("organization_id", "grounded");--> statement-breakpoint
CREATE INDEX "conversations_org_assignee_idx" ON "conversations" ("organization_id", "assigned_to");
