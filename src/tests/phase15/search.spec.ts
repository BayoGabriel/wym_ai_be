import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import createApp from '../../app';
import { db } from '../../database/client';
import { conversations, leads } from '../../database/schema/core';
import { issueTokens } from '../../modules/auth/service';
import {
  ensureOrg,
  ensureUser,
  ensureRole,
  grantRolePermission,
  assignUserRole,
  setAssistEntitlement,
} from '../utils/fixtures';

// Command-palette search: `q` on conversations (title) and leads
// (name/email/phone/summary), plus `channel` on conversations.
// The shared test DB accumulates rows across runs, so assertions check
// result contents rather than exact totals.
describe('Phase 15: list search & channel filter', () => {
  const app = createApp();
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    const orgA = await ensureOrg('Search Org A', 'search-org-a');
    const orgB = await ensureOrg('Search Org B', 'search-org-b');
    await setAssistEntitlement({ organizationId: orgA.id, status: 'active' });
    await setAssistEntitlement({ organizationId: orgB.id, status: 'active' });

    const uA = await ensureUser('search-a@example.com', orgA.id);
    const uB = await ensureUser('search-b@example.com', orgB.id);

    const role = await ensureRole('Search Reader', 'organization');
    for (const perm of ['conversation.read', 'lead.read']) {
      await grantRolePermission(role.id, perm);
    }
    await assignUserRole({ userId: uA.id, roleId: role.id, organizationId: orgA.id });
    await assignUserRole({ userId: uB.id, roleId: role.id, organizationId: orgB.id });

    tokenA = (await issueTokens({ id: uA.id, organizationId: orgA.id, status: 'active' }))
      .accessToken;
    tokenB = (await issueTokens({ id: uB.id, organizationId: orgB.id, status: 'active' }))
      .accessToken;

    await db.insert(conversations).values([
      {
        organizationId: orgA.id,
        channel: 'WEB',
        title: 'Refund question about fees',
        status: 'ACTIVE',
      },
      {
        organizationId: orgA.id,
        channel: 'WHATSAPP',
        title: 'Delivery status enquiry',
        status: 'ACTIVE',
      },
      { organizationId: orgB.id, channel: 'WEB', title: 'Refund policy', status: 'ACTIVE' },
    ]);
    await db.insert(leads).values([
      {
        organizationId: orgA.id,
        name: 'Ada Lovelace',
        email: 'ada@analytical.example',
        phone: '+15550101',
        status: 'NEW',
      },
      { organizationId: orgA.id, name: 'Alan Kay', summary: 'Asked about pricing', status: 'NEW' },
      { organizationId: orgB.id, name: 'Ada FromB', email: 'ada@b.example', status: 'NEW' },
    ]);
  });

  it('searches conversations by title', async () => {
    const res = await request(app)
      .get('/api/v1/conversations?q=refund')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    for (const item of res.body.items) {
      expect(item.title.toLowerCase()).toContain('refund');
    }
  });

  it('filters conversations by channel', async () => {
    const res = await request(app)
      .get('/api/v1/conversations?channel=WHATSAPP')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    for (const item of res.body.items) {
      expect(item.channel).toBe('WHATSAPP');
    }
  });

  it('combines channel and text filters', async () => {
    const res = await request(app)
      .get('/api/v1/conversations?channel=WEB&q=refund')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    const miss = await request(app)
      .get('/api/v1/conversations?channel=TELEGRAM&q=refund')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(miss.body.total).toBe(0);
  });

  it('searches leads by name, email and summary', async () => {
    const byName = await request(app)
      .get('/api/v1/leads?q=lovelace')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(byName.body.items.some((l: { name: string }) => l.name === 'Ada Lovelace')).toBe(true);
    const byEmail = await request(app)
      .get('/api/v1/leads?q=analytical')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(
      byEmail.body.items.some((l: { email: string }) => l.email === 'ada@analytical.example')
    ).toBe(true);
    const bySummary = await request(app)
      .get('/api/v1/leads?q=pricing')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(bySummary.body.items.some((l: { name: string }) => l.name === 'Alan Kay')).toBe(true);
  });

  it('scopes search results to the caller organization', async () => {
    const res = await request(app)
      .get('/api/v1/conversations?q=refund')
      .set('Authorization', `Bearer ${tokenB}`);
    const titles = res.body.items.map((c: { title: string }) => c.title);
    expect(titles).not.toContain('Refund question about fees');

    const leadRes = await request(app)
      .get('/api/v1/leads?q=ada')
      .set('Authorization', `Bearer ${tokenB}`);
    const names = leadRes.body.items.map((l: { name: string }) => l.name);
    expect(names).not.toContain('Ada Lovelace');
  });

  it('rejects unauthenticated search', async () => {
    const res = await request(app).get('/api/v1/conversations?q=refund');
    expect(res.status).toBe(401);
  });
});
