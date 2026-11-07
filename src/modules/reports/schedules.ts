import { and, eq } from 'drizzle-orm';
import { db } from '../../database/client';
import { reportSchedules } from '../../database/schema/core';
import { enquiryReport } from './service';
import { getNotificationProvider } from '../notifications/provider';
import { ApiError } from '../../middleware/error';

const TICK_MS = 60_000;
let timer: NodeJS.Timeout | null = null;

export async function listSchedules(organizationId: string) {
  const rows = await db
    .select()
    .from(reportSchedules)
    .where(eq(reportSchedules.organizationId, organizationId));
  return rows.map((r) => ({
    ...r,
    recipients: safeJson(r.recipients),
  }));
}

export async function createSchedule(params: {
  organizationId: string;
  createdBy: string;
  frequency: string;
  recipients: string[];
}) {
  const [row] = await db
    .insert(reportSchedules)
    .values({
      organizationId: params.organizationId,
      createdBy: params.createdBy,
      frequency: params.frequency,
      recipients: JSON.stringify(params.recipients),
    })
    .returning();
  return { ...row, recipients: params.recipients };
}

export async function deleteSchedule(organizationId: string, id: string) {
  const [row] = await db
    .delete(reportSchedules)
    .where(and(eq(reportSchedules.id, id), eq(reportSchedules.organizationId, organizationId)))
    .returning({ id: reportSchedules.id });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Schedule not found');
}

function safeJson(v: string | null): string[] {
  try {
    return JSON.parse(v ?? '[]') as string[];
  } catch {
    return [];
  }
}

function dueIn(frequency: string, lastSentAt: Date | null): boolean {
  if (!lastSentAt) return true;
  const ms = { daily: 86_400_000, weekly: 604_800_000, monthly: 2_592_000_000 }[frequency] ?? 604_800_000;
  return Date.now() - lastSentAt.getTime() >= ms;
}

async function tick() {
  const provider = getNotificationProvider();
  const due = await db.select().from(reportSchedules).where(eq(reportSchedules.enabled, true));
  for (const s of due) {
    if (!dueIn(s.frequency, s.lastSentAt)) continue;
    const recipients = safeJson(s.recipients);
    if (recipients.length === 0) continue;
    try {
      const days = s.frequency === 'daily' ? 1 : s.frequency === 'monthly' ? 30 : 7;
      const r = await enquiryReport(s.organizationId, days);
      const text = [
        `Enquiry report — last ${days} day${days === 1 ? '' : 's'}`,
        `Conversations: ${r.conversations.total} (prev ${r.previous.conversations})`,
        `Messages: ${r.messages.total}`,
        `Leads: ${r.leads.total} · Open handoffs: ${r.handoffs.open} · Appointments: ${r.appointments.total}`,
        `Escalation rate: ${(r.rates.escalationRate * 100).toFixed(1)}% · Resolution rate: ${(r.rates.resolutionRate * 100).toFixed(1)}%`,
        r.rates.avgFirstResponseSeconds
          ? `Avg first response: ${Math.round(r.rates.avgFirstResponseSeconds)}s`
          : '',
        r.csat.score != null ? `CSAT: ${(r.csat.score * 100).toFixed(0)}% positive` : '',
      ]
        .filter(Boolean)
        .join('\n');
      for (const to of recipients) {
        await provider.send({
          to,
          subject: `WymAssist report (${s.frequency})`,
          text,
          event: 'report.scheduled',
          organizationId: s.organizationId,
        });
      }
      await db
        .update(reportSchedules)
        .set({ lastSentAt: new Date() })
        .where(eq(reportSchedules.id, s.id));
    } catch {
      // best-effort — a failed send retries on the next tick
    }
  }
}

/** In-process scheduler — starts on boot, safe to call once. */
export function startReportScheduler() {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
}
