import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import createApp from '../../app';
import { db } from '../../database/client';
import { organizations, users } from '../../database/schema/core';
import { hashPassword, issueTokens } from '../../modules/auth/service';
import { eq } from 'drizzle-orm';

async function ensureOrg(name: string, slug: string) {
  const existing = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (existing.length) return existing[0];
  const [o] = await db.insert(organizations).values({ name, slug, status: 'active' }).returning();
  return o;
}

async function ensureUser(email: string, organizationId: string | null) {
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) return existing[0];
  const passwordHash = await hashPassword('Passw0rd!');
  const [u] = await db
    .insert(users)
    .values({ email, name: email.split('@')[0], passwordHash, status: 'active', organizationId })
    .returning();
  return u;
}

describe('Organization settings & Assist configuration', () => {
  const app = createApp();
  let orgA: any;
  let orgB: any;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    orgA = await ensureOrg('Org A', 'org-a-settings');
    orgB = await ensureOrg('Org B', 'org-b-settings');
    const uA = await ensureUser('adminA@example.com', orgA.id);
    const uB = await ensureUser('adminB@example.com', orgB.id);
    tokenA = (await issueTokens({ id: uA.id, organizationId: orgA.id, status: 'active' }))
      .accessToken;
    tokenB = (await issueTokens({ id: uB.id, organizationId: orgB.id, status: 'active' }))
      .accessToken;
  });

  it('GET settings requires auth', async () => {
    const res = await request(app).get('/api/v1/organizations/settings');
    expect(res.status).toBe(401);
  });

  it('Org A can read and update its settings; partial updates work', async () => {
    const get1 = await request(app)
      .get('/api/v1/organizations/settings')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(get1.status).toBe(200);

    const patch1 = await request(app)
      .patch('/api/v1/organizations/settings')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ businessName: 'ClientCorp A', timezone: 'UTC' });
    expect(patch1.status).toBe(200);
    expect(patch1.body.businessName).toBe('ClientCorp A');

    const patch2 = await request(app)
      .patch('/api/v1/organizations/settings')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ defaultLanguage: 'en' });
    expect(patch2.status).toBe(200);
    expect(patch2.body.defaultLanguage).toBe('en');
  });

  it("Org A cannot affect Org B's settings", async () => {
    const res = await request(app)
      .patch('/api/v1/organizations/settings')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ businessName: 'HACK B' });
    expect(res.status).toBe(200);
    // Ensure that B's settings remain unaffected by separate context check using tokenB
    const getB = await request(app)
      .get('/api/v1/organizations/settings')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(getB.status).toBe(200);
    expect(getB.body.businessName ?? '').not.toBe('HACK B');
  });

  it('Assist config is org-scoped and PATCH is partial', async () => {
    const up1 = await request(app)
      .patch('/api/v1/assist')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ assistantName: 'Wymie A', leadCaptureEnabled: true });
    expect(up1.status).toBe(200);
    expect(up1.body.assistantName).toBe('Wymie A');

    const up2 = await request(app)
      .patch('/api/v1/assist')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ assistantName: 'Wymie B' });
    expect(up2.status).toBe(200);
    expect(up2.body.assistantName).toBe('Wymie B');

    const getA = await request(app).get('/api/v1/assist').set('Authorization', `Bearer ${tokenA}`);
    const getB = await request(app).get('/api/v1/assist').set('Authorization', `Bearer ${tokenB}`);
    expect(getA.body.assistantName).toBe('Wymie A');
    expect(getB.body.assistantName).toBe('Wymie B');
  });
});
