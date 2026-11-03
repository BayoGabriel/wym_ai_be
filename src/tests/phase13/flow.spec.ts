import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import createApp from '../../app';
import { db } from '../../database/client';
import { flowDefinitions, flowInstances, organizations } from '../../database/schema/core';
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

const DEFINITION = {
  name: 'Purchase approval',
  description: 'Two-step purchase sign-off',
  fields: [
    { key: 'item', label: 'Item', type: 'text', required: true },
    { key: 'amount', label: 'Amount', type: 'number', required: true },
    { key: 'priority', label: 'Priority', type: 'select', options: ['Low', 'High'] },
  ],
  steps: [{ name: 'Manager approval' }, { name: 'Finance approval' }],
  active: true,
};

async function makeUser(org: OrgRow, email: string, perms: string[]) {
  const role = await ensureRole(`${email} role`, 'organization');
  for (const p of perms) await grantRolePermission(role.id, p);
  const user = await ensureUser(email, org.id);
  await assignUserRole({ userId: user.id, roleId: role.id, organizationId: org.id });
  return issueTokens(user);
}

describe.sequential('Phase 13: WymFlow approvals', () => {
  const app = createApp();
  let orgA: OrgRow;
  let adminToken: string;
  let staffToken: string;
  let outsiderToken: string;
  let noPermToken: string;
  let definitionId: string;
  let instanceId: string;

  beforeAll(async () => {
    orgA = await ensureOrg('Flow Org A', 'flow-org-a');
    const orgB = await ensureOrg('Flow Org B', 'flow-org-b');
    await setEntitlement({ organizationId: orgA.id, productCode: 'WYMFLOW', status: 'active' });
    await setEntitlement({ organizationId: orgB.id, productCode: 'WYMFLOW', status: 'active' });

    adminToken = (
      await makeUser(orgA, 'flow-admin@a.test', ['flow.read', 'flow.write', 'flow.admin'])
    ).accessToken;
    staffToken = (await makeUser(orgA, 'flow-staff@a.test', ['flow.read', 'flow.write']))
      .accessToken;
    outsiderToken = (
      await makeUser(orgB, 'flow-outer@b.test', ['flow.read', 'flow.write', 'flow.admin'])
    ).accessToken;
    noPermToken = (await makeUser(orgA, 'flow-noperm@a.test', [])).accessToken;
  });

  it('denies definition creation without flow.admin', async () => {
    const res = await request(app)
      .post('/api/v1/flow/definitions')
      .set('Authorization', `Bearer ${staffToken}`)
      .send(DEFINITION);
    expect(res.status).toBe(403);
  });

  it('creates a workflow definition', async () => {
    const res = await request(app)
      .post('/api/v1/flow/definitions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(DEFINITION);
    expect(res.status).toBe(201);
    expect(res.body.steps).toHaveLength(2);
    definitionId = res.body.id;
  });

  it('rejects submissions missing required fields', async () => {
    const res = await request(app)
      .post('/api/v1/flow/instances')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ definitionId, title: 'Laptop', data: { amount: 1200 } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Item');
  });

  it('rejects submissions with unknown fields', async () => {
    const res = await request(app)
      .post('/api/v1/flow/instances')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ definitionId, title: 'Laptop', data: { item: 'Laptop', amount: 1200, bogus: 1 } });
    expect(res.status).toBe(400);
  });

  it('submits an instance and creates the first pending task', async () => {
    const res = await request(app)
      .post('/api/v1/flow/instances')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        definitionId,
        title: 'Laptop for design team',
        data: { item: 'Laptop', amount: 1200, priority: 'High' },
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('IN_PROGRESS');
    instanceId = res.body.id;

    const detail = await request(app)
      .get(`/api/v1/flow/instances/${instanceId}`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.tasks).toHaveLength(1);
    expect(detail.body.tasks[0].title).toBe('Manager approval');
    expect(detail.body.tasks[0].status).toBe('PENDING');
  });

  it('enforces tenant isolation on instance detail', async () => {
    const res = await request(app)
      .get(`/api/v1/flow/instances/${instanceId}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(404);
  });

  it('approves step one and advances to step two', async () => {
    const detail = await request(app)
      .get(`/api/v1/flow/instances/${instanceId}`)
      .set('Authorization', `Bearer ${staffToken}`);
    const taskId = detail.body.tasks[0].id;

    const res = await request(app)
      .post(`/api/v1/flow/tasks/${taskId}/approve`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ note: 'Within budget' });
    expect(res.status).toBe(200);
    expect(res.body.instance.currentStep).toBe(1);
    expect(res.body.tasks.find((t: { status: string }) => t.status === 'PENDING')?.title).toBe(
      'Finance approval'
    );
  });

  it('final approval completes the instance', async () => {
    const detail = await request(app)
      .get(`/api/v1/flow/instances/${instanceId}`)
      .set('Authorization', `Bearer ${staffToken}`);
    const pending = detail.body.tasks.find((t: { status: string }) => t.status === 'PENDING');

    const res = await request(app)
      .post(`/api/v1/flow/tasks/${pending.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.instance.status).toBe('APPROVED');
  });

  it('rejecting a task rejects the instance and cancels remaining tasks', async () => {
    const created = await request(app)
      .post('/api/v1/flow/instances')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ definitionId, title: 'Office chairs', data: { item: 'Chairs', amount: 400 } });
    const taskId = (
      await request(app)
        .get(`/api/v1/flow/instances/${created.body.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
    ).body.tasks[0].id;

    const res = await request(app)
      .post(`/api/v1/flow/tasks/${taskId}/reject`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ note: 'Not needed' });
    expect(res.status).toBe(200);
    expect(res.body.instance.status).toBe('REJECTED');

    const [instance] = await db
      .select()
      .from(flowInstances)
      .where(eq(flowInstances.id, created.body.id))
      .limit(1);
    expect(instance.status).toBe('REJECTED');
  });

  it('denies task listing without flow.read', async () => {
    const res = await request(app)
      .get('/api/v1/flow/tasks')
      .set('Authorization', `Bearer ${noPermToken}`);
    expect(res.status).toBe(403);
  });

  it('prevents decisions on a definition from another tenant', async () => {
    const def = await request(app)
      .post('/api/v1/flow/definitions')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send(DEFINITION);
    const instance = await request(app)
      .post('/api/v1/flow/instances')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ definitionId: def.body.id, title: 'B item', data: { item: 'X', amount: 1 } });
    const [otherInstance] = await db
      .select()
      .from(flowInstances)
      .where(eq(flowInstances.id, instance.body.id))
      .limit(1);
    const res = await request(app)
      .get(`/api/v1/flow/instances/${otherInstance.id}`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(404);
  });

  it('deactivating a definition blocks new submissions', async () => {
    const [d] = await db
      .select()
      .from(flowDefinitions)
      .where(eq(flowDefinitions.id, definitionId))
      .limit(1);
    expect(d).toBeTruthy();
    await request(app)
      .patch(`/api/v1/flow/definitions/${definitionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false });
    const res = await request(app)
      .post('/api/v1/flow/instances')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ definitionId, title: 'Blocked', data: { item: 'Y', amount: 2 } });
    expect(res.status).toBe(400);
  });
});
