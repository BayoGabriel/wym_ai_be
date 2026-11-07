import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import createApp from '../../app';
import { db } from '../../database/client';
import { notifications } from '../../database/schema/core';
import { issueTokens } from '../../modules/auth/service';
import { ensureOrg, ensureUser } from '../utils/fixtures';
import { writeInAppNotifications } from '../../modules/notifications/inapp';
import { notifyOrganization } from '../../modules/notifications/service';

describe('Phase 15: in-app notifications', () => {
  const app = createApp();
  let tokenA: string;
  let tokenB: string;
  let orgAId: string;
  let orgBId: string;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    const orgA = await ensureOrg('Notify Org A', 'notify-org-a');
    const orgB = await ensureOrg('Notify Org B', 'notify-org-b');
    orgAId = orgA.id;
    orgBId = orgB.id;
    const uA = await ensureUser('notify-a@example.com', orgA.id);
    const uB = await ensureUser('notify-b@example.com', orgB.id);
    userAId = uA.id;
    userBId = uB.id;
    tokenA = (await issueTokens({ id: uA.id, organizationId: orgA.id, status: 'active' }))
      .accessToken;
    tokenB = (await issueTokens({ id: uB.id, organizationId: orgB.id, status: 'active' }))
      .accessToken;
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });

  it('lists only the signed-in user notifications with unread counts', async () => {
    await writeInAppNotifications({
      organizationId: orgAId,
      event: 'test.event',
      title: 'Welcome to WymNet',
      body: 'In-app hello',
      link: '/dashboard',
    });
    await writeInAppNotifications({
      organizationId: orgAId,
      event: 'test.event',
      title: 'Second notice',
      userIds: [userAId],
    });
    await writeInAppNotifications({
      organizationId: orgBId,
      event: 'test.event',
      title: 'For org B only',
    });

    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    const titles = res.body.items.map((n: { title: string }) => n.title);
    expect(titles).toContain('Welcome to WymNet');
    expect(titles).toContain('Second notice');
    expect(titles).not.toContain('For org B only');
    expect(res.body.unreadCount).toBeGreaterThanOrEqual(2);
    expect(res.body.items[0].link).toBeDefined();
  });

  it('marks a single notification read and reports unread count', async () => {
    const list = await request(app)
      .get('/api/v1/notifications?unread=true')
      .set('Authorization', `Bearer ${tokenA}`);
    const target = list.body.items[0];
    const res = await request(app)
      .post(`/api/v1/notifications/${target.id}/read`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.readAt).not.toBeNull();

    const count = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(count.status).toBe(200);
    expect(count.body.count).toBe(list.body.unreadCount - 1);
  });

  it('does not let another user mark or see a foreign notification', async () => {
    const [foreign] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userAId))
      .limit(1);
    const res = await request(app)
      .post(`/api/v1/notifications/${foreign.id}/read`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
    const [still] = await db.select().from(notifications).where(eq(notifications.id, foreign.id));
    expect(still.userId).toBe(userAId);
  });

  it('mark-all read clears the unread inbox', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.updated).toBeGreaterThanOrEqual(1);

    const count = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(count.body.count).toBe(0);
  });

  it('staff alerts write in-app rows even when email flags are off', async () => {
    const before = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${tokenA}`);
    await notifyOrganization({
      organizationId: orgAId,
      event: 'lead.created',
      subject: 'New enquiry captured via WymAssist',
      text: 'A visitor shared details.',
      link: '/dashboard/assist/leads',
    });
    // writeInAppNotifications is fired-and-forgotten inside notifyOrganization.
    await new Promise((r) => setTimeout(r, 300));
    const after = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(after.body.total).toBe(before.body.total + 1);
    expect(after.body.items[0].event).toBe('lead.created');
    expect(after.body.items[0].link).toBe('/dashboard/assist/leads');
  });

  it('user B is unaffected by org A notifications', async () => {
    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${tokenB}`);
    const titles = res.body.items.map((n: { title: string }) => n.title);
    expect(titles).not.toContain('Welcome to WymNet');
    expect(titles).not.toContain('New enquiry captured via WymAssist');
    expect(userBId).toBeTruthy();
  });
});
