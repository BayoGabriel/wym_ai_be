import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Options } from 'express-rate-limit';
import { and, eq, sql } from 'drizzle-orm';
import createApp from '../../app';
import { db } from '../../database/client';
import {
  assistantConfigurations,
  messages,
  organizations,
  usageRecords,
} from '../../database/schema/core';
import { issueTokens } from '../../modules/auth/service';
import { PostgresRateLimitStore } from '../../modules/public/rateLimitStore';
import { ApiError, errorHandler } from '../../middleware/error';
import { ensureOrg, ensureUser, setAssistEntitlement } from '../utils/fixtures';

type OrgRow = typeof organizations.$inferSelect;

async function enablePublicChat(organizationId: string, allowedOrigins?: string[]) {
  const existing = await db
    .select()
    .from(assistantConfigurations)
    .where(eq(assistantConfigurations.organizationId, organizationId))
    .limit(1);

  const values = {
    assistantName: 'Hardening Assistant',
    publicChatEnabled: true,
    allowedOrigins: allowedOrigins ? JSON.stringify(allowedOrigins) : null,
  };

  if (existing.length) {
    await db
      .update(assistantConfigurations)
      .set(values)
      .where(eq(assistantConfigurations.organizationId, organizationId));
    return;
  }
  await db.insert(assistantConfigurations).values({ organizationId, ...values });
}

async function createSession(slug: string, headers?: Record<string, string>) {
  let req = request(createApp()).post('/api/v1/public/assist/sessions');
  if (headers) for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  return req.send({ organizationSlug: slug });
}

describe.sequential('Phase 9.1: public chat security hardening', () => {
  const app = createApp();
  let orgToggle: OrgRow;
  let orgNoEntMid: OrgRow;
  let orgConcurrent: OrgRow;
  let orgIsolation: OrgRow;
  let orgOriginsNorm: OrgRow;
  let staffToken: string;

  beforeAll(async () => {
    orgToggle = await ensureOrg('Hardening Toggle', 'hard-toggle');
    orgNoEntMid = await ensureOrg('Hardening NoEnt', 'hard-noent');
    orgConcurrent = await ensureOrg('Hardening Concurrent', 'hard-concurrent');
    orgIsolation = await ensureOrg('Hardening Isolation', 'hard-isolation');
    orgOriginsNorm = await ensureOrg('Hardening Origins', 'hard-origins');

    const staff = await ensureUser('hard-staff@example.com', orgOriginsNorm.id);
    staffToken = (
      await issueTokens({ id: staff.id, organizationId: orgOriginsNorm.id, status: 'active' })
    ).accessToken;

    for (const org of [orgToggle, orgNoEntMid, orgConcurrent, orgIsolation, orgOriginsNorm]) {
      await setAssistEntitlement({ organizationId: org.id, status: 'active' });
      await enablePublicChat(org.id);
    }

    await db.execute(sql`DELETE FROM rate_limit_buckets`);
  });

  it('cuts off an active session when public chat is disabled', async () => {
    const s = await createSession(orgToggle.slug);
    expect(s.status).toBe(201);

    await db
      .update(assistantConfigurations)
      .set({ publicChatEnabled: false })
      .where(eq(assistantConfigurations.organizationId, orgToggle.id));

    const res = await request(app)
      .get('/api/v1/public/assist/session')
      .set('Authorization', `Bearer ${s.body.sessionToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PUBLIC_CHAT_DISABLED');

    await db
      .update(assistantConfigurations)
      .set({ publicChatEnabled: true })
      .where(eq(assistantConfigurations.organizationId, orgToggle.id));
  });

  it('cuts off an active session when the entitlement is revoked', async () => {
    const s = await createSession(orgNoEntMid.slug);
    expect(s.status).toBe(201);

    await setAssistEntitlement({ organizationId: orgNoEntMid.id, status: 'inactive' });

    const res = await request(app)
      .post('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${s.body.sessionToken}`)
      .send({ content: 'still here?' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PUBLIC_CHAT_UNAVAILABLE');

    await setAssistEntitlement({ organizationId: orgNoEntMid.id, status: 'active' });
  });

  it('keeps same-organization sessions isolated from each other', async () => {
    const s1 = await createSession(orgIsolation.slug);
    const s2 = await createSession(orgIsolation.slug);
    expect(s1.status).toBe(201);
    expect(s2.status).toBe(201);
    expect(s1.body.sessionToken).not.toBe(s2.body.sessionToken);
    expect(s1.body.conversation.id).not.toBe(s2.body.conversation.id);

    await request(app)
      .post('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${s1.body.sessionToken}`)
      .send({ content: 'session one secret', clientRequestId: 'iso-msg-0001' });

    const h2 = await request(app)
      .get('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${s2.body.sessionToken}`);
    expect(h2.status).toBe(200);
    expect(h2.body.total).toBe(0);
  });

  it('dedupes concurrent duplicate messages to one AI call and one usage record', async () => {
    const s = await createSession(orgConcurrent.slug);
    expect(s.status).toBe(201);
    const token = s.body.sessionToken;

    const usageBefore = await db
      .select()
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.organizationId, orgConcurrent.id),
          eq(usageRecords.eventType, 'conversation.ai.response')
        )
      );

    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        request(app)
          .post('/api/v1/public/assist/messages')
          .set('Authorization', `Bearer ${token}`)
          .send({ content: 'racy message', clientRequestId: 'race-key-00001' })
      )
    );

    for (const r of results) expect(r.status).toBe(201);
    expect(results.filter((r) => r.body.idempotentReplay === false).length).toBe(1);
    expect(results.filter((r) => r.body.idempotentReplay === true).length).toBe(2);

    const userMsgs = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, s.body.conversation.id),
          eq(messages.clientRequestId, 'race-key-00001')
        )
      );
    expect(userMsgs.length).toBe(1);

    const assistantMsgs = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, s.body.conversation.id),
          eq(messages.clientRequestId, `assistant:${userMsgs[0].id}`)
        )
      );
    expect(assistantMsgs.length).toBe(1);

    const usage = await db
      .select()
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.organizationId, orgConcurrent.id),
          eq(usageRecords.eventType, 'conversation.ai.response')
        )
      );
    expect(usage.length).toBe(usageBefore.length + 1);
  });

  it('accepts concurrent session creations without collisions', async () => {
    const results = await Promise.all(
      Array.from({ length: 3 }, () => createSession(orgConcurrent.slug))
    );
    for (const r of results) expect(r.status).toBe(201);
    const tokens = new Set(results.map((r) => r.body.sessionToken));
    const convs = new Set(results.map((r) => r.body.conversation.id));
    expect(tokens.size).toBe(3);
    expect(convs.size).toBe(3);
  });

  it('normalizes configured origins and rejects malformed ones', async () => {
    const ok = await request(app)
      .patch('/api/v1/assist')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ allowedOrigins: ['https://widget.example.com/', 'https://widget.example.com'] });
    expect(ok.status).toBe(200);
    expect(ok.body.allowedOrigins).toEqual(['https://widget.example.com']);

    for (const bad of ['*', 'javascript:alert(1)', 'notaurl', 'https://a.com/path']) {
      const res = await request(app)
        .patch('/api/v1/assist')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ allowedOrigins: [bad] });
      expect(res.status).toBe(400);
    }
  });

  it('enforces normalized origin matching at session creation', async () => {
    const denied = await createSession(orgOriginsNorm.slug, {
      Origin: 'https://evil.example.com',
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('ORIGIN_NOT_ALLOWED');

    const malformed = await createSession(orgOriginsNorm.slug, { Origin: 'not-an-origin' });
    expect(malformed.status).toBe(403);

    const allowed = await createSession(orgOriginsNorm.slug, {
      Origin: 'https://widget.example.com',
    });
    expect(allowed.status).toBe(201);
  });

  it('shares rate-limit counters across separate limiter instances', async () => {
    const storeA = new PostgresRateLimitStore();
    const storeB = new PostgresRateLimitStore();
    const options = { windowMs: 60_000 } as Options;
    storeA.init(options);
    storeB.init(options);

    const key = `test-shared-${Date.now()}`;
    const first = await storeA.increment(key);
    const second = await storeB.increment(key);
    const third = await storeA.increment(key);
    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
    expect(third.totalHits).toBe(3);
    await storeA.resetKey(key);
  });

  it('masks internal 5xx error details from clients', () => {
    const payloads: unknown[] = [];
    const res = {
      status(code: number) {
        payloads.push(code);
        return this;
      },
      json(body: unknown) {
        payloads.push(body);
        return this;
      },
    };
    const next = () => undefined;

    errorHandler(
      Object.assign(new Error('relation "chat_sessions" does not exist'), { status: 500 }),
      {} as never,
      res as never,
      next
    );
    const body = payloads[1] as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.error.message).toBe('An unexpected error occurred');

    payloads.length = 0;
    errorHandler(
      new ApiError(409, 'CONVERSATION_READ_ONLY', 'read only'),
      {} as never,
      res as never,
      next
    );
    const apiBody = payloads[1] as { error: { code: string; message: string } };
    expect(apiBody.error.code).toBe('CONVERSATION_READ_ONLY');
    expect(apiBody.error.message).toBe('read only');
  });
});
