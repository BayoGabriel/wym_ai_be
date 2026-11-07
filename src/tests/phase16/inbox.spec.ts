import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import createApp from '../../app';
import { db } from '../../database/client';
import {
  assistantConfigurations,
  chatSessions,
  conversations,
  handoffs,
  leads,
  messages,
} from '../../database/schema/core';
import { issueTokens } from '../../modules/auth/service';
import { hashSessionToken } from '../../modules/public/service';
import {
  ensureOrg,
  ensureUser,
  ensureRole,
  grantRolePermission,
  assignUserRole,
  setAssistEntitlement,
} from '../utils/fixtures';

// Phase 16: inbox filters (hasLead/escalated/assignedTo/tag/date), row
// enrichment (lastMessage, linked entities), assignee + tags updates,
// visitor message feedback, and booking availability rules.
describe('Phase 16: inbox', () => {
  const app = createApp();
  let token: string;
  let convA: string; // has lead + open handoff + tag
  let convB: string; // plain

  beforeAll(async () => {
    const org = await ensureOrg('Inbox Org', 'inbox-org');

    await setAssistEntitlement({ organizationId: org.id, status: 'active' });
    const user = await ensureUser('inbox-staff@example.com', org.id);
    const role = await ensureRole('Inbox Staff', 'organization');
    for (const perm of ['conversation.read', 'conversation.update']) {
      await grantRolePermission(role.id, perm);
    }
    await assignUserRole({ userId: user.id, roleId: role.id, organizationId: org.id });
    token = (await issueTokens({ id: user.id, organizationId: org.id, status: 'active' }))
      .accessToken;

    const [a, b] = await db
      .insert(conversations)
      .values([
        { organizationId: org.id, channel: 'WEB', title: 'Escalated billing chat', tags: ['billing'] },
        { organizationId: org.id, channel: 'WEB', title: 'Plain question' },
      ])
      .returning();
    convA = a.id;
    convB = b.id;
    await db.insert(leads).values({
      organizationId: org.id,
      conversationId: convA,
      name: 'Linked Lead',
      status: 'NEW',
    });
    await db.insert(handoffs).values({
      organizationId: org.id,
      conversationId: convA,
      status: 'QUEUED',
      requestedBy: 'VISITOR',
    });
    // A staff reply gives convA a lastMessage preview.
    await db.insert(messages).values({
      organizationId: org.id,
      conversationId: convA,
      role: 'AGENT',
      content: 'checking your invoice now',
    });
  });

  it('returns enriched rows (last message, lead, handoff)', async () => {
    const res = await request(app)
      .get('/api/v1/conversations')
      .set('Authorization', `Bearer ${token}`);
    const row = res.body.items.find((c: { id: string }) => c.id === convA);
    expect(row.lastMessage.content).toContain('checking your invoice');
    expect(row.lastMessage.role).toBe('AGENT');
    expect(row.leadId).toBeTruthy();
    expect(row.openHandoff.status).toBe('QUEUED');
  });

  it('filters by escalated, hasLead and tag', async () => {
    const esc = await request(app)
      .get('/api/v1/conversations?escalated=true')
      .set('Authorization', `Bearer ${token}`);
    expect(esc.body.items.some((c: { id: string }) => c.id === convA)).toBe(true);
    expect(esc.body.items.some((c: { id: string }) => c.id === convB)).toBe(false);

    const lead = await request(app)
      .get('/api/v1/conversations?hasLead=true')
      .set('Authorization', `Bearer ${token}`);
    expect(lead.body.items.some((c: { id: string }) => c.id === convA)).toBe(true);
    expect(lead.body.items.some((c: { id: string }) => c.id === convB)).toBe(false);

    const tagged = await request(app)
      .get('/api/v1/conversations?tag=billing')
      .set('Authorization', `Bearer ${token}`);
    expect(tagged.body.items.map((c: { id: string }) => c.id)).toContain(convA);
  });

  it('assigns, unassigns and retags a conversation', async () => {
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    const meId = me.body.id;

    const assign = await request(app)
      .patch(`/api/v1/conversations/${convB}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assignedTo: meId, tags: ['followup', 'vip'] });
    expect(assign.status).toBe(200);
    expect(assign.body.assignedTo).toBe(meId);
    expect(assign.body.tags).toEqual(['followup', 'vip']);

    const mine = await request(app)
      .get(`/api/v1/conversations?assignedTo=${meId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(mine.body.items.some((c: { id: string }) => c.id === convB)).toBe(true);
    const mineRow = mine.body.items.find((c: { id: string }) => c.id === convB);
    expect(mineRow.assignee.name).toBeTruthy();

    const un = await request(app)
      .get('/api/v1/conversations?assignedTo=none')
      .set('Authorization', `Bearer ${token}`);
    expect(un.body.items.some((c: { id: string }) => c.id === convB)).toBe(false);
  });
});

describe('Phase 16: visitor feedback', () => {
  const app = createApp();
  let sessionToken: string;
  let convId: string;

  beforeAll(async () => {
    const org = await ensureOrg('Feedback Org', 'feedback-org');
    await setAssistEntitlement({ organizationId: org.id, status: 'active' });
    await db
      .insert(assistantConfigurations)
      .values({ organizationId: org.id, publicChatEnabled: true, allowedOrigins: '[]' })
      .onConflictDoNothing();
    const [conv] = await db
      .insert(conversations)
      .values({ organizationId: org.id, channel: 'WEB', title: 'Widget chat' })
      .returning();
    convId = conv.id;
    sessionToken = `wymcs_fb_${Math.random().toString(36).slice(2)}`;
    await db.insert(chatSessions).values({
      organizationId: org.id,
      conversationId: conv.id,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });

  it('lets a visitor rate an assistant message', async () => {
    const ask = await request(app)
      .post('/api/v1/public/assist/messages')
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({ content: 'hi there' });
    expect(ask.status).toBe(201);
    const assistantId = ask.body.assistantMessage.id;

    const rate = await request(app)
      .post(`/api/v1/public/assist/messages/${assistantId}/feedback`)
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({ feedback: 'up' });
    expect(rate.status).toBe(200);
    expect(rate.body.feedback).toBe('up');

    const list = await request(app)
      .get('/api/v1/public/assist/messages')
      .set("Authorization", `Bearer ${sessionToken}`);
    const msg = list.body.items.find((m: { id: string }) => m.id === assistantId);
    expect(msg.feedback).toBe('up');
    expect(msg).toHaveProperty('grounded');
  });

  it('cannot rate a message in another conversation', async () => {
    const res = await request(app)
      .post(`/api/v1/public/assist/messages/${convId}/feedback`) // conv id, not a message id
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({ feedback: 'down' });
    expect(res.status).toBe(404);
  });
});

describe('Phase 16: booking availability', () => {
  const app = createApp();
  let sessionToken: string;

  beforeAll(async () => {
    const org = await ensureOrg('Avail Org', 'avail-org');

    await setAssistEntitlement({ organizationId: org.id, status: 'active' });
    const user = await ensureUser('avail-admin@example.com', org.id);
    const role = await ensureRole('Avail Admin', 'organization');
    await grantRolePermission(role.id, 'organization.update');
    await assignUserRole({ userId: user.id, roleId: role.id, organizationId: org.id });
    const token = (await issueTokens({ id: user.id, organizationId: org.id, status: 'active' }))
      .accessToken;

    // Weekdays 9–17, closed 2030-01-01.
    const cfg = await request(app)
      .patch('/api/v1/assist')
      .set('Authorization', `Bearer ${token}`)
      .send({
        appointmentRequestsEnabled: true,
        publicChatEnabled: true,
        availability: {
          days: [1, 2, 3, 4, 5],
          open: '09:00',
          close: '17:00',
          slotMinutes: 30,
          bufferMinutes: 15,
          blackoutDates: ['2030-01-01'],
        },
      });
    expect(cfg.status).toBe(200);
    expect(cfg.body.availability.days).toEqual([1, 2, 3, 4, 5]);

    const [conv] = await db
      .insert(conversations)
      .values({ organizationId: org.id, channel: 'WEB', title: 'Booking chat' })
      .returning();
    sessionToken = `wymcs_av_${Math.random().toString(36).slice(2)}`;
    await db.insert(chatSessions).values({
      organizationId: org.id,
      conversationId: conv.id,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt: new Date(Date.now() + 3600_000),
    });
  });

  const request_ = (date: string, time: string) =>
    request(app)
      .post('/api/v1/public/assist/appointments')
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({
        customerName: 'Pat',
        email: 'pat@example.com',
        preferredDate: date,
        preferredTime: time,
      });

  it('accepts a weekday inside hours', async () => {
    // 2030-01-02 is a Wednesday.
    const res = await request_('2030-01-02', '10:00');
    expect(res.status).toBe(201);
  });

  it('rejects weekends, blackouts and out-of-hours', async () => {
    const sunday = await request_('2030-01-06', '10:00'); // a Sunday
    expect(sunday.status).toBe(400);
    expect(sunday.body.error.code).toBe('OUTSIDE_AVAILABILITY');
    const blackout = await request_('2030-01-01', '10:00'); // Wednesday, blacked out
    expect(blackout.status).toBe(400);
    const early = await request_('2030-01-02', '07:30');
    expect(early.status).toBe(400);
    const late = await request_('2030-01-02', '17:00');
    expect(late.status).toBe(400);
  });
});
