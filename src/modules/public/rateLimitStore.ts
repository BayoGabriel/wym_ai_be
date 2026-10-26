import { sql } from 'drizzle-orm';
import type { Options, Store, ClientRateLimitInfo } from 'express-rate-limit';
import { db } from '../../database/client';

export class PostgresRateLimitStore implements Store {
  private windowMs = 60_000;
  private callsSinceSweep = 0;

  init(options: Options) {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const resetAt = new Date(Date.now() + this.windowMs);
    const result = await db.execute(sql`
      INSERT INTO rate_limit_buckets ("key", hits, expires_at)
      VALUES (${key}, 1, ${resetAt})
      ON CONFLICT ("key") DO UPDATE SET
        hits = CASE WHEN rate_limit_buckets.expires_at <= now()
                    THEN 1 ELSE rate_limit_buckets.hits + 1 END,
        expires_at = CASE WHEN rate_limit_buckets.expires_at <= now()
                          THEN ${resetAt} ELSE rate_limit_buckets.expires_at END
      RETURNING hits, expires_at
    `);
    this.sweepExpired();
    const row = result.rows[0] as { hits: number; expires_at: string };
    return { totalHits: row.hits, resetTime: new Date(row.expires_at) };
  }

  async decrement(key: string): Promise<void> {
    await db.execute(sql`
      UPDATE rate_limit_buckets SET hits = GREATEST(hits - 1, 0) WHERE "key" = ${key}
    `);
  }

  async resetKey(key: string): Promise<void> {
    await db.execute(sql`DELETE FROM rate_limit_buckets WHERE "key" = ${key}`);
  }

  private sweepExpired() {
    if (++this.callsSinceSweep < 50) return;
    this.callsSinceSweep = 0;
    db.execute(sql`DELETE FROM rate_limit_buckets WHERE expires_at < now()`).catch(() => {});
  }
}
