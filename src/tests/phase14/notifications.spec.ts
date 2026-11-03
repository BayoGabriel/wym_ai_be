import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { assistantConfigurations } from '../../database/schema/core';
import * as providerModule from '../../modules/notifications/provider';
import type { NotificationMessage } from '../../modules/notifications/provider';
import {
  notifyOrganization,
  notifyOrgDirect,
  resolveNotificationRecipients,
} from '../../modules/notifications/service';
import { ensureOrg, ensureUser } from '../utils/fixtures';

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
  } else {
    await db.insert(assistantConfigurations).values({ organizationId, ...values });
  }
}

describe.sequential('Phase 14: email notifications', () => {
  const sent: NotificationMessage[] = [];

  beforeAll(async () => {
    sent.length = 0;
    vi.spyOn(providerModule, 'getNotificationProvider').mockImplementation(() => ({
      name: 'TEST',
      async send(m: NotificationMessage) {
        sent.push(m);
      },
    }));
  });

  it('fans out to all active org users plus the configured mailbox', async () => {
    const org = await ensureOrg('Notify Org', 'notify-org');
    await ensureUser('staff-a@notify.test', org.id);
    await ensureUser('staff-b@notify.test', org.id);
    await setConfig(org.id, { notifyOnLead: true, notificationEmail: 'inbox@notify.test' });

    const recipients = await resolveNotificationRecipients(org.id, {
      configuredEmail: 'inbox@notify.test',
    });
    expect(recipients.sort()).toEqual(
      ['inbox@notify.test', 'staff-a@notify.test', 'staff-b@notify.test'].sort()
    );

    await notifyOrganization({
      organizationId: org.id,
      event: 'lead.created',
      subject: 'New lead',
      text: 'A visitor left their details.',
    });
    const delivered = sent.filter((m) => m.subject === 'New lead').map((m) => m.to);
    expect(delivered.sort()).toEqual(recipients.sort());
  });

  it('respects event flags and skips orgs with notifications disabled', async () => {
    const org = await ensureOrg('Quiet Org', 'quiet-org');
    await ensureUser('staff@quiet.test', org.id);
    await setConfig(org.id, { notifyOnLead: false, notifyOnHandoff: false });

    const before = sent.length;
    await notifyOrganization({
      organizationId: org.id,
      event: 'lead.created',
      subject: 'Should not send',
      text: 'Flag is off.',
    });
    await notifyOrganization({
      organizationId: org.id,
      event: 'handoff.requested',
      subject: 'Also not sent',
      text: 'Flag is off.',
    });
    expect(sent.length).toBe(before);
  });

  it('notifyOrgDirect reaches org users without flag gating', async () => {
    const org = await ensureOrg('Direct Org', 'direct-org');
    await ensureUser('worker@direct.test', org.id);

    const before = sent.length;
    await notifyOrgDirect({
      organizationId: org.id,
      event: 'flow.task.reminder',
      subject: 'Reminder: task pending',
      text: 'A task is waiting.',
    });
    expect(sent.length).toBe(before + 1);
    expect(sent[sent.length - 1].to).toBe('worker@direct.test');
  });

  it('falls back to contactEmail when an org has no users', async () => {
    const org = await ensureOrg('Empty Org', 'empty-org');
    const { organizationSettings } = await import('../../database/schema/core');
    await db
      .insert(organizationSettings)
      .values({ organizationId: org.id, contactEmail: 'owner@empty.test' })
      .onConflictDoNothing();

    const recipients = await resolveNotificationRecipients(org.id);
    expect(recipients).toEqual(['owner@empty.test']);
  });
});
