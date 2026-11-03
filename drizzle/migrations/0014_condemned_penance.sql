ALTER TABLE "organizations" ADD COLUMN "public_key" varchar(64);--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_public_key_unique" UNIQUE("public_key");