import { and, eq } from 'drizzle-orm';
import { db } from '../../database/client';
import {
  assistantConfigurations,
  organizationSettings,
  users,
} from '../../database/schema/core';
import { getNotificationProvider } from './provider';
import { writeInAppNotifications } from './inapp';

export type StaffEvent = 'lead.created' | 'handoff.requested' | 'appointment.requested';

const EVENT_FLAG: Record<StaffEvent, 'notifyOnLead' | 'notifyOnHandoff' | 'notifyOnAppointment'> = {
  'lead.created': 'notifyOnLead',
  'handoff.requested': 'notifyOnHandoff',
  'appointment.requested': 'notifyOnAppointment',
};

// Everyone in the org who should hear about activity: all active users plus
// the configured notification mailbox. contactEmail is only a fallback when
// no other recipient exists.
export async function resolveNotificationRecipients(
  organizationId: string,
  params: { configuredEmail?: string | null } = {}
): Promise<string[]> {
  const recipients = new Set<string>();
  const staff = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.organizationId, organizationId), eq(users.status, 'active')));
  for (const u of staff) recipients.add(u.email.toLowerCase());
  if (params.configuredEmail) recipients.add(params.configuredEmail.toLowerCase());
  if (recipients.size === 0) {
    const [settings] = await db
      .select()
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, organizationId))
      .limit(1);
    if (settings?.contactEmail) recipients.add(settings.contactEmail.toLowerCase());
  }
  return Array.from(recipients);
}

async function deliver(params: {
  organizationId: string;
  event: string;
  subject: string;
  text: string;
  to: string[];
}) {
  const provider = getNotificationProvider();
  for (const to of params.to) {
    await provider.send({
      to,
      subject: params.subject,
      text: params.text,
      event: params.event,
      organizationId: params.organizationId,
    });
  }
}

// Staff-facing alert for events raised by the public assistant. Delivery is
// best-effort: a notification failure must never fail the business operation.
export async function notifyOrganization(params: {
  organizationId: string;
  event: StaffEvent;
  subject: string;
  text: string;
  link?: string;
}) {
  // In-app bell notifications are always recorded for active staff; the
  // notifyOn* flags gate email delivery only.
  void writeInAppNotifications({
    organizationId: params.organizationId,
    event: params.event,
    title: params.subject,
    body: params.text,
    link: params.link,
  });
  try {
    const [config] = await db
      .select()
      .from(assistantConfigurations)
      .where(eq(assistantConfigurations.organizationId, params.organizationId))
      .limit(1);
    if (!config?.[EVENT_FLAG[params.event]]) return;

    const to = await resolveNotificationRecipients(params.organizationId, {
      configuredEmail: config.notificationEmail,
    });
    if (to.length === 0) return;
    await deliver({ ...params, to });
  } catch (err) {
     
    console.error(
      `[notification] failed for org ${params.organizationId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

// Product-agnostic delivery (WymFlow task alerts, platform notices) — no
// assistant-config flag gating; goes to all org users or the explicit `to`.
export async function notifyOrgDirect(params: {
  organizationId: string;
  event: string;
  subject: string;
  text: string;
  to?: string;
  link?: string;
}) {
  try {
    let to: string[];
    if (params.to) {
      to = [params.to];
    } else {
      const [config] = await db
        .select()
        .from(assistantConfigurations)
        .where(eq(assistantConfigurations.organizationId, params.organizationId))
        .limit(1);
      to = await resolveNotificationRecipients(params.organizationId, {
        configuredEmail: config?.notificationEmail,
      });
    }
    if (to.length === 0) return;
    await deliver({ ...params, to });
  } catch (err) {
     
    console.error(
      `[notification] failed for org ${params.organizationId}:`,
      err instanceof Error ? err.message : err
    );
  }
  // Mirror the alert into the in-app inbox. When `to` targets a specific
  // address we only notify that staff member; otherwise everyone active.
  try {
    let userIds: string[] | undefined;
    if (params.to) {
      const [u] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.organizationId, params.organizationId),
            eq(users.email, params.to),
            eq(users.status, 'active')
          )
        )
        .limit(1);
      userIds = u ? [u.id] : [];
    }
    void writeInAppNotifications({
      organizationId: params.organizationId,
      event: params.event,
      title: params.subject,
      body: params.text,
      link: params.link,
      userIds,
    });
  } catch (err) {
    console.error(
      `[notification] in-app write failed for org ${params.organizationId}:`,
      err instanceof Error ? err.message : err
    );
  }
}
