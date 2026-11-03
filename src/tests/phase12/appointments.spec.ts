import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import createApp from '../../app';
import { db } from '../../database/client';
import {
  appointments,
  assistantConfigurations,
  auditEvents,
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

const VALID_REQUEST = {
  customerName: 'Ada Lovelace',
  email: 'ada@example.com',
  preferredDate: '2030-01-15',
  preferredTime: '09:30',
  reason: 'Course registration questions',
};

async function setConfig(organizationId: string, values: Record<string, unknown>) {
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

describe.sequential('Phase 12: appointment requests', () => {
  const app = createApp();
  let orgA: OrgRow;
  let orgB: OrgRow;
  let staffToken: string;
  let outsiderToken: string;
  let noPermToken: string;

  beforeAll(async () => {
    orgA = await ensureOrg('Appt Org A', 'appt-org-a');
    orgB = await ensureOrg('Appt Org B', 'appt-org-b');
    await setAssistEntitlement({ organizationId: orgA.id, status: 'active' });
    await setAssistEntitlement({ organizationId: orgB.id, status: 'active' });
    await setConfig(orgA.id, {
      publicChatEnabled: true,
      appointmentRequestsEnabled: true,
      leadCaptureEnabled: true,
    });
    await setConfig(orgB.id, { publicChatEnabled: true, appointmentRequestsEnabled: false });

    const role = await ensureRole('Appt Staff', 'organization');
    for (const perm of ['appointment.read', 'appointment.write']) {
      await grantRolePermission(role.id, perm);
    }
    const noPermRole = await ensureRole('Appt No Perms', 'organization');

    const staff = await ensureUser('appt-staff@a.test', orgA.id);
    await assignUserRole({ userId: staff.id, roleId: role.id, organizationId: orgA.id });
    staffToken = (await issueTokens(staff)).accessToken;

    const outsider = await ensureUser('appt-outsider@b.test', orgB.id);
    await assignUserRole({ userId: outsider.id, roleId: role.id, organizationId: orgB.id });
    outsiderToken = (await issueTokens(outsider)).accessToken;

    const noPerm = await ensureUser('appt-noperm@a.test', orgA.id);
    await assignUserRole({ userId: noPerm.id, roleId: noPermRole.id, organizationId: orgA.id });
    noPermToken = (await issueTokens(noPerm)).accessToken;
  });

  async function newSession(slug: string) {
    return createPublicChatSession({ organizationSlug: slug });
  }

  it('rejects appointment requests when the feature flag is disabled', async () => {
    const session = await newSession('appt-org-b');
    const res = await request(app)
      .post('/api/v1/public/assist/appointments')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .send(VALID_REQUEST);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('APPOINTMENTS_DISABLED');
  });

  it('rejects requests without any contact channel', async () => {
    const session = await newSession('appt-org-a');
    const res = await request(app)
      .post('/api/v1/public/assist/appointments')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .send({ customerName: 'No Contact', preferredDate: '2030-01-15', preferredTime: '09:30' });
    expect(res.status).toBe(400);
  });

  it('creates an appointment request linked to the conversation', async () => {
    const session = await newSession('appt-org-a');
    const res = await request(app)
      .post('/api/v1/public/assist/appointments')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .send(VALID_REQUEST);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('REQUESTED');
    expect(res.body.preferredDate).toBe('2030-01-15');

    const [row] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, res.body.id))
      .limit(1);
    expect(row.conversationId).toBe(session.conversation.id);
    expect(row.chatSessionId).toBe(session.sessionId);
  });

  it('replays idempotently for a repeated clientRequestId', async () => {
    const session = await newSession('appt-org-a');
    const body = { ...VALID_REQUEST, clientRequestId: 'appt-req-123456' };
    const first = await request(app)
      .post('/api/v1/public/assist/appointments')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .send(body);
    const second = await request(app)
      .post('/api/v1/public/assist/appointments')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.idempotentReplay).toBe(true);
  });

  it('lists appointments for staff with appointment.read', async () => {
    const res = await request(app)
      .get('/api/v1/appointments')
      .set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((a: { customerName?: string }) => Boolean(a.customerName))).toBe(
      true
    );
  });

  it('enforces tenant isolation on appointment access', async () => {
    const [row] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.organizationId, orgA.id))
      .limit(1);
    const res = await request(app)
      .get(`/api/v1/appointments/${row.id}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(404);
  });

  it('denies appointment endpoints without the permission', async () => {
    const res = await request(app)
      .get('/api/v1/appointments')
      .set('Authorization', `Bearer ${noPermToken}`);
    expect(res.status).toBe(403);
  });

  it('confirms a requested appointment and rejects invalid transitions', async () => {
    const session = await newSession('appt-org-a');
    const created = await request(app)
      .post('/api/v1/public/assist/appointments')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .send(VALID_REQUEST);
    const id = created.body.id;

    const confirmed = await request(app)
      .patch(`/api/v1/appointments/${id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'CONFIRMED' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('CONFIRMED');

    const invalid = await request(app)
      .patch(`/api/v1/appointments/${id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'REQUESTED' });
    expect(invalid.status).toBe(400);

    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.resourceId, id), eq(auditEvents.action, 'appointment.status_changed'))
      )
      .limit(1);
    expect(audit).toBeTruthy();
  });
});

describe.sequential('Phase 12: custom intake fields and widget config', () => {
  const app = createApp();
  let org: OrgRow;

  beforeAll(async () => {
    org = await ensureOrg('Intake Org', 'intake-org');
    await setAssistEntitlement({ organizationId: org.id, status: 'active' });
    await setConfig(org.id, {
      publicChatEnabled: true,
      leadCaptureEnabled: true,
      intakeFields: [
        { key: 'course', label: 'Course of interest', type: 'text', required: true },
        {
          key: 'level',
          label: 'Level',
          type: 'select',
          options: ['Undergraduate', 'Postgraduate'],
        },
      ],
    });
  });

  it('rejects lead capture missing a required intake field', async () => {
    const session = await createPublicChatSession({ organizationSlug: 'intake-org' });
    const res = await request(app)
      .post('/api/v1/public/assist/leads')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .send({ name: 'Prospect', email: 'p@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Course of interest');
  });

  it('rejects select answers outside configured options', async () => {
    const session = await createPublicChatSession({ organizationSlug: 'intake-org' });
    const res = await request(app)
      .post('/api/v1/public/assist/leads')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .send({
        name: 'Prospect',
        email: 'p@example.com',
        customFields: { course: 'Nursing', level: 'Doctorate' },
      });
    expect(res.status).toBe(400);
  });

  it('stores validated intake answers on the lead', async () => {
    const session = await createPublicChatSession({ organizationSlug: 'intake-org' });
    const res = await request(app)
      .post('/api/v1/public/assist/leads')
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .send({
        name: 'Prospect',
        email: 'p@example.com',
        customFields: { course: 'Nursing', level: 'Postgraduate', unknownKey: 'dropped' },
      });
    expect(res.status).toBe(201);

    const [lead] = await db.select().from(leads).where(eq(leads.id, res.body.id)).limit(1);
    expect(lead.customFields).toEqual({ course: 'Nursing', level: 'Postgraduate' });
  });

  it('serves widget config with branding and intake definitions', async () => {
    const res = await request(app)
      .get('/api/v1/public/assist/config')
      .query({ organizationSlug: 'intake-org' });
    expect(res.status).toBe(200);
    expect(res.body.organization.slug).toBe('intake-org');
    expect(res.body.features.leadCapture).toBe(true);
    expect(res.body.features.appointments).toBe(false);
    expect(res.body.intakeFields).toHaveLength(2);
  });

  it('rejects config requests for unknown organizations', async () => {
    const res = await request(app)
      .get('/api/v1/public/assist/config')
      .query({ organizationSlug: 'does-not-exist' });
    expect(res.status).toBe(404);
  });
});

describe.sequential('Phase 12: enquiry report', () => {
  const app = createApp();
  let org: OrgRow;
  let token: string;
  let noReportToken: string;

  beforeAll(async () => {
    org = await ensureOrg('Report Org', 'report-org');
    await setAssistEntitlement({ organizationId: org.id, status: 'active' });

    const role = await ensureRole('Report Reader', 'organization');
    await grantRolePermission(role.id, 'report.read');
    const user = await ensureUser('report@r.test', org.id);
    await assignUserRole({ userId: user.id, roleId: role.id, organizationId: org.id });
    token = (await issueTokens(user)).accessToken;

    const otherRole = await ensureRole('Report Denied', 'organization');
    const other = await ensureUser('no-report@r.test', org.id);
    await assignUserRole({ userId: other.id, roleId: otherRole.id, organizationId: org.id });
    noReportToken = (await issueTokens(other)).accessToken;
  });

  it('returns an org-scoped enquiry summary', async () => {
    const res = await request(app)
      .get('/api/v1/reports/enquiries?days=30')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(30);
    expect(res.body.leads).toHaveProperty('byStatus');
    expect(res.body.handoffs).toHaveProperty('open');
    expect(Array.isArray(res.body.messages.daily)).toBe(true);
  });

  it('denies the report without report.read', async () => {
    const res = await request(app)
      .get('/api/v1/reports/enquiries')
      .set('Authorization', `Bearer ${noReportToken}`);
    expect(res.status).toBe(403);
  });
});
