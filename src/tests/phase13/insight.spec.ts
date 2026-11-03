import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import createApp from '../../app';
import { db } from '../../database/client';
import { datasets, insightReports, organizations } from '../../database/schema/core';
import { issueTokens } from '../../modules/auth/service';
import {
  assignUserRole,
  ensureOrg,
  ensureRole,
  ensureUser,
  grantRolePermission,
  setEntitlement,
} from '../utils/fixtures';

type OrgRow = typeof organizations.$inferSelect;

const CSV = [
  'month,product,units,revenue',
  '2025-09,Alpha,10,5000',
  '2025-10,Alpha,15,7500',
  '2025-10,Beta,5,2000',
  '2025-11,Alpha,20,10000',
  '2025-11,Beta,8,3200',
].join('\n');

const CSV_B64 = Buffer.from(CSV, 'utf8').toString('base64');

async function makeUser(org: OrgRow, email: string, perms: string[]) {
  const role = await ensureRole(`${email} role`, 'organization');
  for (const p of perms) await grantRolePermission(role.id, p);
  const user = await ensureUser(email, org.id);
  await assignUserRole({ userId: user.id, roleId: role.id, organizationId: org.id });
  return issueTokens(user);
}

describe.sequential('Phase 13: WymInsight datasets and analysis', () => {
  const app = createApp();
  let orgA: OrgRow;
  let orgB: OrgRow;
  let token: string;
  let outsiderToken: string;
  let noPermToken: string;
  let noEntitlementToken: string;
  let datasetId: string;

  beforeAll(async () => {
    orgA = await ensureOrg('Insight Org A', 'insight-org-a');
    orgB = await ensureOrg('Insight Org B', 'insight-org-b');
    const orgNoEnt = await ensureOrg('Insight Org C', 'insight-org-c');
    await setEntitlement({ organizationId: orgA.id, productCode: 'WYMINSIGHT', status: 'active' });
    await setEntitlement({ organizationId: orgB.id, productCode: 'WYMINSIGHT', status: 'active' });

    token = (await makeUser(orgA, 'insight-rw@a.test', ['insight.read', 'insight.write']))
      .accessToken;
    outsiderToken = (
      await makeUser(orgB, 'insight-outer@b.test', ['insight.read', 'insight.write'])
    ).accessToken;
    noPermToken = (await makeUser(orgA, 'insight-noperm@a.test', [])).accessToken;
    noEntitlementToken = (
      await makeUser(orgNoEnt, 'insight-c@c.test', ['insight.read', 'insight.write'])
    ).accessToken;
  });

  it('rejects requests from an org without the WYMINSIGHT entitlement', async () => {
    const res = await request(app)
      .get('/api/v1/insight/datasets')
      .set('Authorization', `Bearer ${noEntitlementToken}`);
    expect(res.status).toBe(403);
  });

  it('denies upload without insight.write', async () => {
    const res = await request(app)
      .post('/api/v1/insight/datasets')
      .set('Authorization', `Bearer ${noPermToken}`)
      .send({ name: 'Sales', filename: 'sales.csv', contentBase64: CSV_B64 });
    expect(res.status).toBe(403);
  });

  it('uploads a CSV and stores a column profile', async () => {
    const res = await request(app)
      .post('/api/v1/insight/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sales', filename: 'sales.csv', contentBase64: CSV_B64 });
    expect(res.status).toBe(201);
    expect(res.body.rowCount).toBe(5);
    expect(res.body.status).toBe('PROCESSED');
    datasetId = res.body.id;
    const names = (res.body.profile as { name: string; type: string }[]).map((c) => c.name);
    expect(names).toEqual(['month', 'product', 'units', 'revenue']);
  });

  it('rejects unsupported file types', async () => {
    const res = await request(app)
      .post('/api/v1/insight/datasets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Doc', filename: 'doc.txt', contentBase64: CSV_B64 });
    expect(res.status).toBe(400);
  });

  it('enforces tenant isolation on datasets', async () => {
    const res = await request(app)
      .get(`/api/v1/insight/datasets/${datasetId}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(404);
  });

  it('generates an analysis report with KPIs and a trend', async () => {
    const res = await request(app)
      .post(`/api/v1/insight/datasets/${datasetId}/analyze`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(201);
    expect(res.body.analysis.rowCount).toBe(5);
    expect(res.body.analysis.kpis.length).toBeGreaterThan(0);
    expect(res.body.analysis.trends.length).toBeGreaterThan(0);
    expect(res.body.analysis.trends[0].forecast).toHaveLength(3);
    expect(typeof res.body.summary).toBe('string');

    const [stored] = await db
      .select()
      .from(insightReports)
      .where(eq(insightReports.id, res.body.id))
      .limit(1);
    expect(stored.organizationId).toBe(orgA.id);
  });

  it('serves the report as a downloadable CSV', async () => {
    const [report] = await db
      .select()
      .from(insightReports)
      .where(eq(insightReports.organizationId, orgA.id))
      .limit(1);
    const res = await request(app)
      .get(`/api/v1/insight/reports/${report.id}/download`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('KPI,Value');
  });

  it('keeps dataset rows tenant-scoped on delete', async () => {
    const res = await request(app)
      .delete(`/api/v1/insight/datasets/${datasetId}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(404);
    const [still] = await db.select().from(datasets).where(eq(datasets.id, datasetId)).limit(1);
    expect(still).toBeTruthy();
  });
});
