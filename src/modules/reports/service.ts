import { and, count, eq, gte, ne, sql } from 'drizzle-orm';
import { db } from '../../database/client';
import { appointments, conversations, handoffs, leads, messages } from '../../database/schema/core';

async function countSince(
  table: 'conversations' | 'messages' | 'leads' | 'handoffs' | 'appointments',
  organizationId: string,
  since: Date
) {
  const t = { conversations, messages, leads, handoffs, appointments }[table];
  const [row] = await db
    .select({ value: count() })
    .from(t)
    .where(and(eq(t.organizationId, organizationId), gte(t.createdAt, since)));
  return Number(row?.value ?? 0);
}

// Per-org enquiry report: volumes and status breakdowns for the dashboard's
// "basic reports on customer enquiries" requirement. All queries are org-scoped.
export async function enquiryReport(organizationId: string, windowDays: number) {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [
    conversationTotal,
    messageTotal,
    leadTotal,
    handoffTotal,
    appointmentTotal,
    leadsByStatus,
    leadsByCategory,
    handoffsByStatus,
    appointmentsByStatus,
    daily,
  ] = await Promise.all([
    countSince('conversations', organizationId, since),
    countSince('messages', organizationId, since),
    countSince('leads', organizationId, since),
    countSince('handoffs', organizationId, since),
    countSince('appointments', organizationId, since),
    db
      .select({ status: leads.status, value: count() })
      .from(leads)
      .where(and(eq(leads.organizationId, organizationId), gte(leads.createdAt, since)))
      .groupBy(leads.status),
    db
      .select({ status: leads.enquiryCategory, value: count() })
      .from(leads)
      .where(and(eq(leads.organizationId, organizationId), gte(leads.createdAt, since)))
      .groupBy(leads.enquiryCategory),
    db
      .select({ status: handoffs.status, value: count() })
      .from(handoffs)
      .where(and(eq(handoffs.organizationId, organizationId), gte(handoffs.createdAt, since)))
      .groupBy(handoffs.status),
    db
      .select({ status: appointments.status, value: count() })
      .from(appointments)
      .where(
        and(eq(appointments.organizationId, organizationId), gte(appointments.createdAt, since))
      )
      .groupBy(appointments.status),
    db
      .select({
        day: sql<string>`to_char(${messages.createdAt}::date, 'YYYY-MM-DD')`,
        value: count(),
      })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          gte(messages.createdAt, since),
          ne(messages.role, 'SYSTEM')
        )
      )
      .groupBy(sql`${messages.createdAt}::date`)
      .orderBy(sql`${messages.createdAt}::date`),
  ]);

  const openHandoffs = handoffsByStatus
    .filter((b) => b.status === 'REQUESTED' || b.status === 'QUEUED' || b.status === 'ASSIGNED')
    .reduce((sum, b) => sum + Number(b.value), 0);

  return {
    windowDays,
    conversations: { total: conversationTotal },
    messages: {
      total: messageTotal,
      daily: daily.map((d) => ({ date: d.day, count: Number(d.value) })),
    },
    leads: {
      total: leadTotal,
      byStatus: leadsByStatus.map((r) => ({ status: r.status, count: Number(r.value) })),
      byCategory: leadsByCategory.map((r) => ({
        category: r.status ?? 'UNCATEGORIZED',
        count: Number(r.value),
      })),
    },
    handoffs: {
      total: handoffTotal,
      open: openHandoffs,
      byStatus: handoffsByStatus.map((r) => ({ status: r.status, count: Number(r.value) })),
    },
    appointments: {
      total: appointmentTotal,
      byStatus: appointmentsByStatus.map((r) => ({
        status: r.status,
        count: Number(r.value),
      })),
    },
  };
}

export type EnquiryReport = Awaited<ReturnType<typeof enquiryReport>>;

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// Flat CSV export of the same report for the dashboard's Download button.
export function enquiryReportToCsv(r: EnquiryReport): string {
  const lines: string[] = [`# Enquiry report (last ${r.windowDays} days)`, ''];
  lines.push('Metric,Value');
  lines.push(`Conversations,${r.conversations.total}`);
  lines.push(`Messages,${r.messages.total}`);
  lines.push(`Leads,${r.leads.total}`);
  lines.push(`Handoffs,${r.handoffs.total}`);
  lines.push(`Open handoffs,${r.handoffs.open}`);
  lines.push(`Appointments,${r.appointments.total}`);
  lines.push('');
  lines.push('Lead status,Count');
  for (const s of r.leads.byStatus) lines.push(`${csvCell(s.status)},${s.count}`);
  lines.push('');
  lines.push('Lead category,Count');
  for (const c of r.leads.byCategory) lines.push(`${csvCell(c.category)},${c.count}`);
  lines.push('');
  lines.push('Handoff status,Count');
  for (const s of r.handoffs.byStatus) lines.push(`${csvCell(s.status)},${s.count}`);
  lines.push('');
  lines.push('Appointment status,Count');
  for (const s of r.appointments.byStatus) lines.push(`${csvCell(s.status)},${s.count}`);
  lines.push('');
  lines.push('Date,Messages');
  for (const d of r.messages.daily) lines.push(`${d.date},${d.count}`);
  return lines.join('\n');
}
