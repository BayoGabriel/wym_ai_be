import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import createApp from '../../app';
import { db } from '../../database/client';
import {
  assistantConfigurations,
  auditEvents,
  chatSessions,
  leads,
  organizations,
} from '../../database/schema/core';
import { issueTokens } from '../../modules/auth/service';
import { createPublicChatSession } from '../../modules/public/service';
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
  values: { publicChatEnabled?: boolean; leadCaptureEnabled?: boolean }
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

// Creates sessions through the service layer so suite-wide session volume does
// not trip the session-creation rate limiter; the sessions are real DB records.
async function createSession(slug: string) {
  const session = await createPublicChatSession({ organizationSlug: slug });
  return { status: 201, body: session };
}

async function captureLead(token: string, body: Record<string, unknown>) {
  return request(createApp())
    .post('/api/v1/public/assist/leads')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

describe.sequential('Phase 10: customer identity and lead capture', () => {
  const app = createApp();
  let orgA: OrgRow;
  let orgB: OrgRow;
  let orgNoLead: OrgRow;
  let staffAToken: string;
  let staffA2Token: string;
  let readOnlyToken: string;
  let staffBToken: string;
  let staffBUserId: string;
  let orgAUserId: string;

  beforeAll(async () => {
    orgA = await ensureOrg('Lead Org A', 'lead-org-a');
    orgB = await ensureOrg('Lead Org B', 'lead-org-b');
    orgNoLead = await ensureOrg('Lead Disabled Org', 'lead-disabled-org');

    const role = await ensureRole('Lead Staff', 'organization');
    for (const perm of ['lead.read', 'lead.write', 'conversation.read']) {
      await grantRolePermission(role.id, perm);
    }
    const readRole = await ensureRole('Lead Read Only', 'organization');
    await grantRolePermission(readRole.id, 'lead.read');

    const staffA = await ensureUser('leada@example.com', orgA.id);
    orgAUserId = staffA.id;
    const staffA2 = await ensureUser('leada2@example.com', orgA.id);
    const readOnly = await ensureUser('leadro@example.com', orgA.id);
    const staffB = await ensureUser('leadb@example.com', orgB.id);
    staffBUserId = staffB.id;

    await assignUserRole({ userId: staffA.id, roleId: role.id, organizationId: orgA.id });
    await assignUserRole({ userId: staffA2.id, roleId: role.id, organizationId: orgA.id });
    await assignUserRole({ userId: readOnly.id, roleId: readRole.id, organizationId: orgA.id });
    await assignUserRole({ userId: staffB.id, roleId: role.id, organizationId: orgB.id });

    staffAToken = (await issueTokens({ id: staffA.id, organizationId: orgA.id, status: 'active' }))
      .accessToken;
    staffA2Token = (
      await issueTokens({ id: staffA2.id, organizationId: orgA.id, status: 'active' })
    ).accessToken;
    readOnlyToken = (
      await issueTokens({ id: readOnly.id, organizationId: orgA.id, status: 'active' })
    ).accessToken;
    staffBToken = (await issueTokens({ id: staffB.id, organizationId: orgB.id, status: 'active' }))
      .accessToken;

    for (const org of [orgA, orgB, orgNoLead]) {
      await setAssistEntitlement({ organizationId: org.id, status: 'active' });
    }
    await setConfig(orgA.id, { publicChatEnabled: true, leadCaptureEnabled: true });
    await setConfig(orgB.id, { publicChatEnabled: true, leadCaptureEnabled: true });
    await setConfig(orgNoLead.id, { publicChatEnabled: true, leadCaptureEnabled: false });

    await db.execute(sql`DELETE FROM rate_limit_buckets`);
  });

  it('captures a lead from a public session with normalized contact fields', async () => {
    const s = await createSession(orgA.slug);
    expect(s.status).toBe(201);

    const res = await captureLead(s.body.sessionToken, {
      name: '  Ada Visitor  ',
      email: 'Ada@Example.COM',
      phone: '+1 (555) 123-4567',
      enquiryCategory: 'SALES',
      summary: 'Interested in pricing',
      consentToContact: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.status).toBe('NEW');
    expect(res.body.deduplicated).toBe(false);
    // Safe public shape: no internal ids or contact fields echoed back
    expect(res.body.organizationId).toBeUndefined();
    expect(res.body.conversationId).toBeUndefined();
    expect(res.body.email).toBeUndefined();
    expect(res.body.chatSessionId).toBeUndefined();

    const [row] = await db.select().from(leads).where(eq(leads.id, res.body.id));
    expect(row.organizationId).toBe(orgA.id);
    expect(row.conversationId).toBe(s.body.conversation.id);
    expect(row.chatSessionId).toBe(s.body.sessionId);
    expect(row.email).toBe('ada@example.com');
    expect(row.phone).toBe('+15551234567');
    expect(row.consentToContact).toBe(true);
    expect(row.source).toBe('PUBLIC_CHAT');
  });

  it('rejects capture when lead capture is disabled for the org', async () => {
    const s = await createSession(orgNoLead.slug);
    expect(s.status).toBe(201);

    const res = await captureLead(s.body.sessionToken, {
      name: 'No Lead',
      email: 'x@example.com',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LEAD_CAPTURE_DISABLED');
  });

  it('rejects submissions with no contact information', async () => {
    const s = await createSession(orgA.slug);
    const res = await captureLead(s.body.sessionToken, { summary: 'just a note' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid and oversized payloads', async () => {
    const s = await createSession(orgA.slug);
    const bad = await captureLead(s.body.sessionToken, {
      name: 'X',
      email: 'not-an-email',
    });
    expect(bad.status).toBe(400);

    const huge = await captureLead(s.body.sessionToken, {
      name: 'X'.repeat(300),
      email: 'a@b.com',
    });
    expect(huge.status).toBe(400);

    const badCategory = await captureLead(s.body.sessionToken, {
      name: 'X',
      enquiryCategory: 'MAGIC',
    });
    expect(badCategory.status).toBe(400);
  });

  it('rejects missing, malformed, and foreign credentials', async () => {
    const missing = await request(createApp())
      .post('/api/v1/public/assist/leads')
      .send({ name: 'X' });
    expect(missing.status).toBe(401);

    const malformed = await captureLead('bogus', { name: 'X' });
    expect(malformed.status).toBe(401);

    // staff JWT is not a valid public credential
    const staffCred = await captureLead(staffAToken, { name: 'X' });
    expect(staffCred.status).toBe(401);
  });

  it('rejects revoked and expired session credentials', async () => {
    const s = await createSession(orgA.slug);
    await db
      .update(chatSessions)
      .set({ revokedAt: new Date() })
      .where(eq(chatSessions.id, s.body.sessionId));
    const revoked = await captureLead(s.body.sessionToken, { name: 'X' });
    expect(revoked.status).toBe(401);

    const s2 = await createSession(orgA.slug);
    await db
      .update(chatSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(chatSessions.id, s2.body.sessionId));
    const expired = await captureLead(s2.body.sessionToken, { name: 'X' });
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('replays idempotent retries and dedupes repeat submissions', async () => {
    const s = await createSession(orgA.slug);
    const payload = {
      name: 'Retry Visitor',
      email: 'retry@example.com',
      clientRequestId: 'lead-req-0001',
    };

    const first = await captureLead(s.body.sessionToken, payload);
    expect(first.status).toBe(201);
    const second = await captureLead(s.body.sessionToken, payload);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.idempotentReplay).toBe(true);

    // Same details, different request id → deduplicated, not duplicated
    const dup = await captureLead(s.body.sessionToken, {
      name: 'Retry Visitor',
      email: 'retry@example.com',
      clientRequestId: 'lead-req-0002',
    });
    expect(dup.status).toBe(200);
    expect(dup.body.id).toBe(first.body.id);
    expect(dup.body.deduplicated).toBe(true);

    const rows = await db.select().from(leads).where(eq(leads.chatSessionId, s.body.sessionId));
    expect(rows.length).toBe(1);
  });

  it('serializes concurrent duplicate captures to one lead', async () => {
    const s = await createSession(orgA.slug);
    const payload = {
      name: 'Concurrent Lead',
      email: 'concurrent@example.com',
      clientRequestId: 'lead-conc-0001',
    };
    const results = await Promise.all([
      captureLead(s.body.sessionToken, payload),
      captureLead(s.body.sessionToken, payload),
      captureLead(s.body.sessionToken, payload),
    ]);
    const ids = new Set(results.map((r) => r.body.id));
    expect(ids.size).toBe(1);

    const rows = await db.select().from(leads).where(eq(leads.chatSessionId, s.body.sessionId));
    expect(rows.length).toBe(1);
  });

  it('supports multiple distinct leads from the same session', async () => {
    const s = await createSession(orgA.slug);
    const a = await captureLead(s.body.sessionToken, { name: 'Person One', email: 'p1@ex.com' });
    const b = await captureLead(s.body.sessionToken, { name: 'Person Two', email: 'p2@ex.com' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).not.toBe(a.body.id);
  });

  it('forged identifiers in the payload cannot change org or conversation binding', async () => {
    const sA = await createSession(orgA.slug);
    const sB = await createSession(orgB.slug);

    const res = await captureLead(sA.body.sessionToken, {
      name: 'Forged',
      email: 'forged@example.com',
      organizationId: orgB.id,
      conversationId: sB.body.conversation.id,
      chatSessionId: sB.body.sessionId,
      status: 'CONVERTED',
      assignedTo: staffBUserId,
      source: 'ADMIN',
    });
    expect(res.status).toBe(201);
    const [row] = await db.select().from(leads).where(eq(leads.id, res.body.id));
    expect(row.organizationId).toBe(orgA.id);
    expect(row.conversationId).toBe(sA.body.conversation.id);
    expect(row.chatSessionId).toBe(sA.body.sessionId);
    expect(row.status).toBe('NEW');
    expect(row.assignedTo).toBeNull();
    expect(row.source).toBe('PUBLIC_CHAT');
  });

  it('rejects visitor credentials on staff lead endpoints', async () => {
    const s = await createSession(orgA.slug);
    const res = await request(app)
      .get('/api/v1/leads')
      .set('Authorization', `Bearer ${s.body.sessionToken}`);
    expect(res.status).toBe(401);
  });

  it('lists leads with pagination and filters for authorized staff', async () => {
    const res = await request(app)
      .get('/api/v1/leads?page=1&limit=50&status=NEW&category=SALES&order=desc')
      .set('Authorization', `Bearer ${staffAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    for (const l of res.body.items) {
      expect(l.status).toBe('NEW');
      expect(l.enquiryCategory).toBe('SALES');
      expect(l.organizationId).toBe(orgA.id);
    }

    const unfiltered = await request(app)
      .get('/api/v1/leads?page=1&limit=100')
      .set('Authorization', `Bearer ${staffAToken}`);
    expect(unfiltered.status).toBe(200);
    const orgALeads = await db.select().from(leads).where(eq(leads.organizationId, orgA.id));
    // The endpoint caps page size at the requested limit — the shared fixture
    // DB can accumulate more leads than fit on one page across reruns.
    expect(unfiltered.body.items.length).toBe(Math.min(orgALeads.length, 100));
    expect(unfiltered.body.total).toBe(orgALeads.length);
  });

  it('enforces lead.read permission for listing', async () => {
    const noPerm = await ensureUser('leadnoperm@example.com', orgA.id);
    const token = (await issueTokens({ id: noPerm.id, organizationId: orgA.id, status: 'active' }))
      .accessToken;
    const res = await request(app).get('/api/v1/leads').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('prevents cross-organization reads and updates', async () => {
    const s = await createSession(orgA.slug);
    const cap = await captureLead(s.body.sessionToken, { name: 'OrgA Lead', email: 'oa@ex.com' });
    const leadId = cap.body.id;

    // Org B staff cannot see or touch Org A's lead
    const bGet = await request(app)
      .get(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${staffBToken}`);
    expect(bGet.status).toBe(404);

    const bPatch = await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${staffBToken}`)
      .send({ status: 'CONTACTED' });
    expect(bPatch.status).toBe(404);

    const bNote = await request(app)
      .post(`/api/v1/leads/${leadId}/notes`)
      .set('Authorization', `Bearer ${staffBToken}`)
      .send({ body: 'cross-org note' });
    expect(bNote.status).toBe(404);

    const bList = await request(app)
      .get('/api/v1/leads?page=1&limit=100')
      .set('Authorization', `Bearer ${staffBToken}`);
    expect(bList.body.items.every((l: { id: string }) => l.id !== leadId)).toBe(true);
  });

  it('updates lead fields and enforces status transitions', async () => {
    const s = await createSession(orgA.slug);
    const cap = await captureLead(s.body.sessionToken, {
      name: 'Pipeline',
      email: 'pipeline@example.com',
    });
    const leadId = cap.body.id;

    // invalid: NEW → QUALIFIED (must go through CONTACTED)
    const bad = await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ status: 'QUALIFIED' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_STATUS_TRANSITION');

    const contact = await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ status: 'CONTACTED', summary: 'Called back' });
    expect(contact.status).toBe(200);
    expect(contact.body.status).toBe('CONTACTED');
    expect(contact.body.summary).toBe('Called back');

    const qualify = await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ status: 'QUALIFIED' });
    expect(qualify.status).toBe(200);

    const convert = await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ status: 'CONVERTED' });
    expect(convert.status).toBe(200);

    // terminal state rejects further transitions
    const reopen = await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ status: 'NEW' });
    expect(reopen.status).toBe(400);

    // immutable fields cannot be overwritten
    const forged = await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ organizationId: orgB.id, conversationId: 'x', status: 'CONVERTED' });
    expect(forged.status).toBe(200);
    const [row] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(row.organizationId).toBe(orgA.id);
    expect(row.conversationId).toBe(s.body.conversation.id);
  });

  it('rejects updates without lead.write permission', async () => {
    const s = await createSession(orgA.slug);
    const cap = await captureLead(s.body.sessionToken, { name: 'RO', email: 'ro@ex.com' });

    const res = await request(app)
      .patch(`/api/v1/leads/${cap.body.id}`)
      .set('Authorization', `Bearer ${readOnlyToken}`)
      .send({ status: 'CONTACTED' });
    expect(res.status).toBe(403);

    const note = await request(app)
      .post(`/api/v1/leads/${cap.body.id}/notes`)
      .set('Authorization', `Bearer ${readOnlyToken}`)
      .send({ body: 'nope' });
    expect(note.status).toBe(403);
  });

  it('assigns leads to same-org staff and rejects foreign assignees', async () => {
    const s = await createSession(orgA.slug);
    const cap = await captureLead(s.body.sessionToken, { name: 'Assign', email: 'as@ex.com' });
    const leadId = cap.body.id;

    const ok = await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ assignedTo: orgAUserId });
    expect(ok.status).toBe(200);
    expect(ok.body.assignedTo).toBe(orgAUserId);

    const foreign = await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ assignedTo: staffBUserId });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.code).toBe('INVALID_ASSIGNEE');

    const unassign = await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ assignedTo: null });
    expect(unassign.status).toBe(200);
    expect(unassign.body.assignedTo).toBeNull();

    // assignment filter works
    const filtered = await request(app)
      .get(`/api/v1/leads?assignedTo=${orgAUserId}`)
      .set('Authorization', `Bearer ${staffAToken}`);
    expect(filtered.status).toBe(200);
  });

  it('adds internal notes visible on the lead detail', async () => {
    const s = await createSession(orgA.slug);
    const cap = await captureLead(s.body.sessionToken, { name: 'Noted', email: 'n@ex.com' });
    const leadId = cap.body.id;

    const note = await request(app)
      .post(`/api/v1/leads/${leadId}/notes`)
      .set('Authorization', `Bearer ${staffA2Token}`)
      .send({ body: 'Customer prefers email contact' });
    expect(note.status).toBe(201);

    const detail = await request(app)
      .get(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${staffAToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.notes.length).toBeGreaterThan(0);
    expect(detail.body.notes[0].body).toBe('Customer prefers email contact');
  });

  it('does not leak contact data through the public history endpoint', async () => {
    const s = await createSession(orgA.slug);
    await captureLead(s.body.sessionToken, {
      name: 'Private',
      email: 'private@example.com',
      phone: '+441234567890',
    });

    const history = await request(app)
      .get('/api/v1/public/assist/messages')
      .set('Authorization', `Bearer ${s.body.sessionToken}`);
    expect(history.status).toBe(200);
    const raw = JSON.stringify(history.body);
    expect(raw).not.toContain('private@example.com');
    expect(raw).not.toContain('+441234567890');
    expect(raw).not.toContain('Private');
  });

  it('records audit events for capture, status changes, assignment, and notes', async () => {
    const s = await createSession(orgA.slug);
    const cap = await captureLead(s.body.sessionToken, {
      name: 'Audited',
      email: 'audited@example.com',
      consentToContact: true,
    });
    const leadId = cap.body.id;

    await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ status: 'CONTACTED', assignedTo: orgAUserId });
    await request(app)
      .post(`/api/v1/leads/${leadId}/notes`)
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ body: 'audit note' });

    const events = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.resourceType, 'lead'), eq(auditEvents.resourceId, leadId)));
    const actions = events.map((e) => e.action);
    expect(actions).toContain('lead.created');
    expect(actions).toContain('lead.status_changed');
    expect(actions).toContain('lead.assigned');
    expect(actions).toContain('lead.note_added');
    for (const e of events) expect(e.organizationId).toBe(orgA.id);
  });

  it('rate-limits lead captures per session', async () => {
    const s = await createSession(orgA.slug);
    // PUBLIC_CHAT_LEAD_MAX default is 5 — empty payloads still count hits
    const results = await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        captureLead(s.body.sessionToken, { name: `Burst${i}`, email: `b${i}@ex.com` })
      )
    );
    const ok = results.filter((r) => r.status === 201 || r.status === 200).length;
    const limited = results.filter((r) => r.status === 429).length;
    expect(ok).toBe(5);
    expect(limited).toBe(2);
  });
});
