CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
	"key" varchar(512) PRIMARY KEY NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
