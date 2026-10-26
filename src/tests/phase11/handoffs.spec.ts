import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import createApp from '../../app';
import { db } from '../../database/client';
import {
  assistantConfigurations,
  auditEvents,
  chatSessions,
  handoffs,
  messages,
  organizations,
  usageRecords,
  users,
} from '../../database/schema/core';
import { issueTokens } from '../../modules/auth/service';
import { createPublicChatSession } from '../../modules/public/service';
import { env } from '../../config/env';
import {
  assignUserRole,
  ensureOrg,
  ensureRole,
  ensureUser,
  grantRolePermission,
  setAssistEntitlement,
} from '../utils/fixtures';

type OrgRow = typeof organizations.$inferSelect;

async function setConfig(
  organizationId: string,
  values: { publicChatEnabled?: boolean; escalationEnabled?: boolean }
) {
  const existing = await db
    .select()
    .from(assistantConfigurations)
    .where(eq(assistantConfigurations.organizationId, organizationId))
    .limit(1);
  if (existing.length) {
    await db
      .update(assistantConfigurations)
      .set(values)
      .where(eq(assistantConfigurations.organizationId, organizationId));
    return;
  }
  await db.insert(assistantConfigurations).values({ organizationId, ...values });
}

// Service-level session creation keeps suite volume from tripping the
// session-creation rate limiter; sessions are still real DB records.
async function createSession(slug: string) {
  return createPublicChatSession({ organizationSlug: slug });
}

async function requestHandoff(token: string, body: Record<string, unknown> = {}) {
  return request(createApp())
    .post('/api/v1/public/assist/handoff')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

async function staffCall(
  token: string,
  method: 'get' | 'post' | 'patch',
  path: string,
  body?: unknown
) {
  const r = request(createApp())[method](path).set('Authorization', `Bearer ${token}`);
  return body === undefined ? r : r.send(body as object);
}

describe.sequential('Phase 11: human handoff and escalation', () => {
  let orgA: OrgRow;
  let orgB: OrgRow;
  let orgNoEsc: OrgRow;
  let adminAToken: string;
  let agentAToken: string;
  let agentA2Token: string;
  let agentA2UserId: string;
  let readOnlyToken: string;
  let staffBToken: string;
  let staffBUserId: string;
  let orgAUserId: string;

  beforeAll(async () => {
    orgA = await ensureOrg('Handoff Org A', 'handoff-org-a');
    orgB = await ensureOrg('Handoff Org B', 'handoff-org-b');
    orgNoEsc = await ensureOrg('Escalation Disabled Org', 'esc-disabled-org');

    const adminRole = await ensureRole('Handoff Admin', 'organization');
    for (const perm of [
      'handoff.read',
      'handoff.write',
      'handoff.assign',
      'conversation.read',
      'conversation.update',
    ]) {
      await grantRolePermission(adminRole.id, perm);
    }
    const agentRole = await ensureRole('Handoff Agent', 'organization');
    for (const perm of ['handoff.read', 'handoff.write', 'conversation.read']) {
      await grantRolePermission(agentRole.id, perm);
    }
    const readRole = await ensureRole('Handoff Read Only', 'organization');
    await grantRolePermission(readRole.id, 'handoff.read');

    const adminA = await ensureUser('hoffadmina@example.com', orgA.id);
    orgAUserId = adminA.id;
    const agentA = await ensureUser('hoffagenta@example.com', orgA.id);
    const agentA2 = await ensureUser('hoffagenta2@example.com', orgA.id);
    agentA2UserId = agentA2.id;
    const readOnly = await ensureUser('hoffro@example.com', orgA.id);
    const staffB = await ensureUser('hoffb@example.com', orgB.id);
    staffBUserId = staffB.id;

    await assignUserRole({ userId: adminA.id, roleId: adminRole.id, organizationId: orgA.id });
    await assignUserRole({ userId: agentA.id, roleId: agentRole.id, organizationId: orgA.id });
    await assignUserRole({ userId: agentA2.id, roleId: agentRole.id, organizationId: orgA.id });
    await assignUserRole({ userId: readOnly.id, roleId: readRole.id, organizationId: orgA.id });
    await assignUserRole({ userId: staffB.id, roleId: adminRole.id, organizationId: orgB.id });

    adminAToken = (await issueTokens({ id: adminA.id, organizationId: orgA.id, status: 'active' }))
      .accessToken;
    agentAToken = (await issueTokens({ id: agentA.id, organizationId: orgA.id, status: 'active' }))
      .accessToken;
    agentA2Token = (
      await issueTokens({ id: agentA2.id, organizationId: orgA.id, status: 'active' })
    ).accessToken;
    readOnlyToken = (
      await issueTokens({ id: readOnly.id, organizationId: orgA.id, status: 'active' })
    ).accessToken;
    staffBToken = (await issueTokens({ id: staffB.id, organizationId: orgB.id, status: 'active' }))
      .accessToken;

    for (const org of [orgA, orgB, orgNoEsc]) {
      await setAssistEntitlement({ organizationId: org.id, status: 'active' });
    }
    await setConfig(orgA.id, { publicChatEnabled: true, escalationEnabled: true });
    await setConfig(orgB.id, { publicChatEnabled: true, escalationEnabled: true });
    await setConfig(orgNoEsc.id, { publicChatEnabled: true, escalationEnabled: false });

    await db.execute(sql`DELETE FROM rate_limit_buckets`);
  });

  it('creates a QUEUED handoff from a public session', async () => {
    const s = await createSession(orgA.slug);
    const res = await requestHandoff(s.sessionToken, { reason: 'Need a human please' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.status).toBe('QUEUED');
    expect(res.body.alreadyActive).toBe(false);
    // safe public shape — no internal references
    expect(res.body.organizationId).toBeUndefined();
    expect(res.body.conversationId).toBeUndefined();
    expect(res.body.assignedTo).toBeUndefined();

    const [row] = await db.select().from(handoffs).where(eq(handoffs.id, res.body.id));
    expect(row.organizationId).toBe(orgA.id);
    expect(row.conversationId).toBe(s.conversation.id);
    expect(row.chatSessionId).toBe(s.sessionId);
    expect(row.requestedBy).toBe('VISITOR');
    expect(row.reason).toBe('Need a human please');
  });

  it('returns the same handoff on repeated requests (idempotent)', async () => {
    const s = await createSession(orgA.slug);
    const first = await requestHandoff(s.sessionToken, { reason: 'first' });
    expect(first.status).toBe(201);

    const second = await requestHandoff(s.sessionToken, { reason: 'different reason' });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.alreadyActive).toBe(true);

    const rows = await db
      .select()
      .from(handoffs)
      .where(eq(handoffs.conversationId, s.conversation.id));
    expect(rows.length).toBe(1);
  });

  it('serializes concurrent handoff requests to one record', async () => {
    const s = await createSession(orgA.slug);
    const results = await Promise.all([
      requestHandoff(s.sessionToken),
      requestHandoff(s.sessionToken),
      requestHandoff(s.sessionToken),
    ]);
    const ids = new Set(results.map((r) => r.body.id));
    expect(ids.size).toBe(1);
    const rows = await db
      .select()
      .from(handoffs)
      .where(eq(handoffs.conversationId, s.conversation.id));
    expect(rows.length).toBe(1);
  });

  it('rejects handoff requests when escalation is disabled for the org', async () => {
    const s = await createSession(orgNoEsc.slug);
    const res = await requestHandoff(s.sessionToken, { reason: 'help' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ESCALATION_DISABLED');
  });

  it('rejects invalid, revoked, and expired session credentials', async () => {
    const missing = await request(createApp()).post('/api/v1/public/assist/handoff').send({});
    expect(missing.status).toBe(401);

    expect((await requestHandoff('bogus')).status).toBe(401);
    // staff JWT is not a public credential
    expect((await requestHandoff(adminAToken)).status).toBe(401);

    const s = await createSession(orgA.slug);
    await db
      .update(chatSessions)
      .set({ revokedAt: new Date() })
      .where(eq(chatSessions.id, s.sessionId));
    expect((await requestHandoff(s.sessionToken)).status).toBe(401);

    const s2 = await createSession(orgA.slug);
    await db
      .update(chatSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(chatSessions.id, s2.sessionId));
    const expired = await requestHandoff(s2.sessionToken);
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('rejects handoff requests on closed conversations and ignores forged ids', async () => {
    const s = await createSession(orgA.slug);
    const sB = await createSession(orgB.slug);

    // forged identifiers in the body cannot change server-side binding
    const forged = await requestHandoff(s.sessionToken, {
      organizationId: orgB.id,
      conversationId: sB.conversation.id,
      status: 'RESOLVED',
      assignedTo: staffBUserId,
      reason: 'forge attempt',
    });
    expect(forged.status).toBe(201);
    const [row] = await db.select().from(handoffs).where(eq(handoffs.id, forged.body.id));
    expect(row.organizationId).toBe(orgA.id);
    expect(row.conversationId).toBe(s.conversation.id);
    expect(row.status).toBe('QUEUED');
    expect(row.assignedTo).toBeNull();

    // close a fresh conversation, then request — must not reopen
    const s2 = await createSession(orgA.slug);
    const closed = await staffCall(
      adminAToken,
      'patch',
      `/api/v1/conversations/${s2.conversation.id}`,
      {
        status: 'CLOSED',
      }
    );
    expect(closed.status).toBe(200);
    const res = await requestHandoff(s2.sessionToken, { reason: 'too late' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONVERSATION_READ_ONLY');
  });

  it('exposes handoff status via GET /public/assist/handoff', async () => {
    const s = await createSession(orgA.slug);
    const before = await request(createApp())
      .get('/api/v1/public/assist/handoff')
      .set('Authorization', `Bearer ${s.sessionToken}`);
    expect(before.status).toBe(200);
    expect(before.body.handoff).toBeNull();

    const created = await requestHandoff(s.sessionToken);
    const after = await request(createApp())
      .get('/api/v1/public/assist/handoff')
      .set('Authorization', `Bearer ${s.sessionToken}`);
    expect(after.status).toBe(200);
    expect(after.body.handoff.id).toBe(created.body.id);
    expect(after.body.handoff.status).toBe('QUEUED');
  });

  it('pauses AI replies while a handoff is active and resumes after resolve', async () => {
    const s = await createSession(orgA.slug);

    // normal AI reply before handoff
    const before = await request(createApp())
      .post('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${s.sessionToken}`)
      .send({ content: 'hello before handoff', clientRequestId: 'pre-handoff-001' });
    expect(before.status).toBe(201);
    expect(before.body.assistantMessage.content).not.toBe(env.PUBLIC_CHAT_HANDOFF_ACK_MESSAGE);

    const h = await requestHandoff(s.sessionToken, { reason: 'human please' });
    expect(h.status).toBe(201);

    const usageBefore = await db
      .select()
      .from(usageRecords)
      .where(eq(usageRecords.organizationId, orgA.id));

    // visitor message during active handoff → ack, no provider call
    const during = await request(createApp())
      .post('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${s.sessionToken}`)
      .send({ content: 'are you there?', clientRequestId: 'during-handoff-001' });
    expect(during.status).toBe(201);
    expect(during.body.assistantMessage.content).toBe(env.PUBLIC_CHAT_HANDOFF_ACK_MESSAGE);
    expect(during.body.assistantMessage.role).toBe('ASSISTANT');
    expect(during.body.assistantMessage.grounded).toBe(false);

    const usageAfter = await db
      .select()
      .from(usageRecords)
      .where(eq(usageRecords.organizationId, orgA.id));
    expect(usageAfter.length).toBe(usageBefore.length);

    // claim + resolve by staff, then AI resumes on the next visitor message
    await staffCall(agentAToken, 'post', `/api/v1/handoffs/${h.body.id}/claim`);
    const resolved = await staffCall(agentAToken, 'post', `/api/v1/handoffs/${h.body.id}/resolve`, {
      resolutionSummary: 'Done',
    });
    expect(resolved.status).toBe(200);

    const after = await request(createApp())
      .post('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${s.sessionToken}`)
      .send({ content: 'thanks, next question', clientRequestId: 'post-handoff-001' });
    expect(after.status).toBe(201);
    expect(after.body.assistantMessage.content).not.toBe(env.PUBLIC_CHAT_HANDOFF_ACK_MESSAGE);
  });

  it('lets one claimant win a concurrent claim race', async () => {
    const s = await createSession(orgA.slug);
    const h = await requestHandoff(s.sessionToken);

    const [r1, r2] = await Promise.all([
      staffCall(agentAToken, 'post', `/api/v1/handoffs/${h.body.id}/claim`),
      staffCall(agentA2Token, 'post', `/api/v1/handoffs/${h.body.id}/claim`),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = r1.status === 200 ? r1 : r2;
    expect(winner.body.status).toBe('ASSIGNED');
    const agentIds = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.organizationId, orgA.id));
    expect(agentIds.map((u) => u.id)).toContain(winner.body.assignedTo);
  });

  it('supports claim, assign, release, resolve with transition enforcement', async () => {
    const s = await createSession(orgA.slug);
    const h = await requestHandoff(s.sessionToken);
    const id = h.body.id;

    // cannot resolve while QUEUED
    const early = await staffCall(agentAToken, 'post', `/api/v1/handoffs/${id}/resolve`);
    expect(early.status).toBe(400);
    expect(early.body.error.code).toBe('INVALID_STATUS_TRANSITION');

    // admin assigns to agent2 (handoff.assign)
    const assigned = await staffCall(adminAToken, 'post', `/api/v1/handoffs/${id}/assign`, {
      userId: agentA2UserId,
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body.assignedTo).toBe(agentA2UserId);
    expect(assigned.body.status).toBe('ASSIGNED');

    // agent without assign perm cannot reassign
    const forbidden = await staffCall(agentAToken, 'post', `/api/v1/handoffs/${id}/assign`, {
      userId: orgAUserId,
    });
    expect(forbidden.status).toBe(403);

    // foreign assignee rejected
    const foreign = await staffCall(adminAToken, 'post', `/api/v1/handoffs/${id}/assign`, {
      userId: staffBUserId,
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.code).toBe('INVALID_ASSIGNEE');

    // release back to queue
    const released = await staffCall(adminAToken, 'post', `/api/v1/handoffs/${id}/assign`, {
      userId: null,
    });
    expect(released.status).toBe(200);
    expect(released.body.status).toBe('QUEUED');
    expect(released.body.assignedTo).toBeNull();

    // claim then resolve
    const claimed = await staffCall(agentAToken, 'post', `/api/v1/handoffs/${id}/claim`);
    expect(claimed.status).toBe(200);
    const resolved = await staffCall(agentAToken, 'post', `/api/v1/handoffs/${id}/resolve`, {
      resolutionSummary: 'Resolved by agent',
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe('RESOLVED');
    expect(resolved.body.resolvedBy).toBeTruthy();

    // terminal: no further transitions
    const reopen = await staffCall(adminAToken, 'post', `/api/v1/handoffs/${id}/assign`, {
      userId: orgAUserId,
    });
    expect(reopen.status).toBe(400);
    const cancelTerminal = await staffCall(agentAToken, 'post', `/api/v1/handoffs/${id}/cancel`);
    expect(cancelTerminal.status).toBe(400);
  });

  it('restricts resolve/cancel on ASSIGNED handoffs to assignee or assign holders', async () => {
    const s = await createSession(orgA.slug);
    const h = await requestHandoff(s.sessionToken);
    const id = h.body.id;

    await staffCall(agentAToken, 'post', `/api/v1/handoffs/${id}/claim`);

    // agent2 (write but not assignee, no assign perm) cannot resolve
    const denied = await staffCall(agentA2Token, 'post', `/api/v1/handoffs/${id}/resolve`);
    expect(denied.status).toBe(403);

    // admin (handoff.assign) can cancel someone else's assignment
    const cancelled = await staffCall(adminAToken, 'post', `/api/v1/handoffs/${id}/cancel`, {
      reason: 'duplicate',
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    // new request on the same conversation creates a fresh handoff after cancel
    const again = await requestHandoff(s.sessionToken);
    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(id);
  });

  it('persists staff replies as AGENT messages, idempotent and assignee-only', async () => {
    const s = await createSession(orgA.slug);
    const h = await requestHandoff(s.sessionToken);
    const id = h.body.id;

    // cannot reply while QUEUED
    const early = await staffCall(agentAToken, 'post', `/api/v1/handoffs/${id}/replies`, {
      content: 'Hi there',
    });
    expect(early.status).toBe(400);

    await staffCall(agentAToken, 'post', `/api/v1/handoffs/${id}/claim`);

    // non-assignee cannot reply
    const denied = await staffCall(agentA2Token, 'post', `/api/v1/handoffs/${id}/replies`, {
      content: 'not mine',
    });
    expect(denied.status).toBe(403);

    const reply = await staffCall(agentAToken, 'post', `/api/v1/handoffs/${id}/replies`, {
      content: 'Hello, I am a human agent',
      clientRequestId: 'reply-0001',
    });
    expect(reply.status).toBe(201);
    expect(reply.body.message.role).toBe('AGENT');

    const replay = await staffCall(agentAToken, 'post', `/api/v1/handoffs/${id}/replies`, {
      content: 'Hello, I am a human agent',
      clientRequestId: 'reply-0001',
    });
    expect(replay.status).toBe(200);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(replay.body.message.id).toBe(reply.body.message.id);

    const rows = await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, s.conversation.id), eq(messages.role, 'AGENT')));
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0].metadata ?? '{}').authorUserId).toBeTruthy();

    // visitor sees the AGENT reply in public history
    const history = await request(createApp())
      .get('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${s.sessionToken}`);
    const agentMsgs = history.body.items.filter((m: { role: string }) => m.role === 'AGENT');
    expect(agentMsgs.length).toBe(1);
    expect(agentMsgs[0].content).toBe('Hello, I am a human agent');
    expect(agentMsgs[0].authorUserId).toBeUndefined();
  });

  it('keeps internal notes staff-only and out of public history', async () => {
    const s = await createSession(orgA.slug);
    const h = await requestHandoff(s.sessionToken);
    const id = h.body.id;

    const note = await staffCall(agentAToken, 'post', `/api/v1/handoffs/${id}/notes`, {
      body: 'INTERNAL: visitor sounds upset, handle carefully',
    });
    expect(note.status).toBe(201);

    const detail = await staffCall(agentAToken, 'get', `/api/v1/handoffs/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.notes.length).toBe(1);
    expect(detail.body.notes[0].body).toContain('INTERNAL');
    expect(detail.body.conversation.id).toBe(s.conversation.id);
    expect(Array.isArray(detail.body.recentMessages)).toBe(true);

    const history = await request(createApp())
      .get('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${s.sessionToken}`);
    expect(JSON.stringify(history.body)).not.toContain('visitor sounds upset');
  });

  it('lists handoffs with pagination and filters, scoped to org', async () => {
    const res = await staffCall(agentAToken, 'get', '/api/v1/handoffs?page=1&limit=100');
    expect(res.status).toBe(200);
    for (const item of res.body.items) {
      expect(item.organizationId).toBe(orgA.id);
    }
    const filtered = await staffCall(agentAToken, 'get', '/api/v1/handoffs?status=QUEUED');
    expect(filtered.status).toBe(200);
    for (const item of filtered.body.items) {
      expect(item.status).toBe('QUEUED');
    }
  });

  it('enforces permissions: read-only cannot write; visitor creds rejected', async () => {
    const s = await createSession(orgA.slug);
    const h = await requestHandoff(s.sessionToken);
    const id = h.body.id;

    const noPerm = await ensureUser('hoffnoperm@example.com', orgA.id);
    const noPermToken = (
      await issueTokens({ id: noPerm.id, organizationId: orgA.id, status: 'active' })
    ).accessToken;
    expect((await staffCall(noPermToken, 'get', '/api/v1/handoffs')).status).toBe(403);

    // read-only can read but not claim
    expect((await staffCall(readOnlyToken, 'get', `/api/v1/handoffs/${id}`)).status).toBe(200);
    expect((await staffCall(readOnlyToken, 'post', `/api/v1/handoffs/${id}/claim`)).status).toBe(
      403
    );
    expect(
      (await staffCall(readOnlyToken, 'post', `/api/v1/handoffs/${id}/notes`, { body: 'x' })).status
    ).toBe(403);

    // visitor token cannot reach staff endpoints
    expect(
      (
        await request(createApp())
          .get('/api/v1/handoffs')
          .set('Authorization', `Bearer ${s.sessionToken}`)
      ).status
    ).toBe(401);
  });

  it('isolates handoffs across organizations', async () => {
    const s = await createSession(orgA.slug);
    const h = await requestHandoff(s.sessionToken);
    const id = h.body.id;

    expect((await staffCall(staffBToken, 'get', `/api/v1/handoffs/${id}`)).status).toBe(404);
    expect((await staffCall(staffBToken, 'post', `/api/v1/handoffs/${id}/claim`)).status).toBe(404);
    expect((await staffCall(staffBToken, 'post', `/api/v1/handoffs/${id}/resolve`)).status).toBe(
      404
    );
    expect(
      (await staffCall(staffBToken, 'post', `/api/v1/handoffs/${id}/notes`, { body: 'x' })).status
    ).toBe(404);
    expect(
      (await staffCall(staffBToken, 'post', `/api/v1/handoffs/${id}/replies`, { content: 'x' }))
        .status
    ).toBe(404);

    const bList = await staffCall(staffBToken, 'get', '/api/v1/handoffs?page=1&limit=100');
    expect(bList.body.items.every((x: { id: string }) => x.id !== id)).toBe(true);
  });

  it('rate limits repeated handoff requests per session', async () => {
    const s = await createSession(orgA.slug);
    let last = 0;
    for (let i = 0; i < env.PUBLIC_CHAT_HANDOFF_MAX + 2; i++) {
      const res = await requestHandoff(s.sessionToken);
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it('records audit events for the handoff lifecycle', async () => {
    const s = await createSession(orgA.slug);
    const h = await requestHandoff(s.sessionToken, { reason: 'audit me' });
    const id = h.body.id;

    await staffCall(agentAToken, 'post', `/api/v1/handoffs/${id}/claim`);
    await staffCall(agentAToken, 'post', `/api/v1/handoffs/${id}/replies`, {
      content: 'audit reply',
    });
    await staffCall(agentAToken, 'post', `/api/v1/handoffs/${id}/notes`, { body: 'audit note' });
    await staffCall(adminAToken, 'post', `/api/v1/handoffs/${id}/resolve`, {
      resolutionSummary: 'wrapped',
    });

    const events = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.resourceId, id), eq(auditEvents.organizationId, orgA.id)));
    const actions = events.map((e) => e.action);
    expect(actions).toContain('handoff.requested');
    expect(actions).toContain('handoff.claimed');
    expect(actions).toContain('handoff.reply_sent');
    expect(actions).toContain('handoff.note_added');
    expect(actions).toContain('handoff.resolved');
    for (const e of events) {
      expect(e.resourceType).toBe('handoff');
      // no session credentials in audit metadata
      expect(e.metadata ?? '').not.toContain('wymcs_');
    }
  });

  it('does not auto-create handoffs for ordinary visitor messages', async () => {
    const s = await createSession(orgA.slug);
    await request(createApp())
      .post('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${s.sessionToken}`)
      .send({ content: 'just chatting' });
    const rows = await db
      .select()
      .from(handoffs)
      .where(eq(handoffs.conversationId, s.conversation.id));
    expect(rows.length).toBe(0);
  });
});
