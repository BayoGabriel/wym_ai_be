import { and, count, eq, gte, lt, ne, sql } from 'drizzle-orm';
import { db } from '../../database/client';
import { appointments, conversations, handoffs, leads, messages } from '../../database/schema/core';

async function countSince(
  table: 'conversations' | 'messages' | 'leads' | 'handoffs' | 'appointments',
  organizationId: string,
  since: Date
) {
  return countSinceRange(table, organizationId, since, new Date());
}

async function countSinceRange(
  table: 'conversations' | 'messages' | 'leads' | 'handoffs' | 'appointments',
  organizationId: string,
  since: Date,
  until: Date
) {
  const t = { conversations, messages, leads, handoffs, appointments }[table];
  const [row] = await db
    .select({ value: count() })
    .from(t)
    .where(
      and(
        eq(t.organizationId, organizationId),
        gte(t.createdAt, since),
        lt(t.createdAt, until)
      )
    );
  return Number(row?.value ?? 0);
}

// Per-org enquiry report: volumes and status breakdowns for the dashboard's
// "basic reports on customer enquiries" requirement. All queries are org-scoped.
export async function enquiryReport(organizationId: string, windowDays: number) {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const prevSince = new Date(since.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const [
    conversationTotal,
    messageTotal,
    leadTotal,
    handoffTotal,
    appointmentTotal,
    prevConversationTotal,
    prevMessageTotal,
    prevLeadTotal,
    prevHandoffTotal,
    prevAppointmentTotal,
    conversationsByChannel,
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
    // Previous window — same span ending where the current one starts.
    countSinceRange('conversations', organizationId, prevSince, since),
    countSinceRange('messages', organizationId, prevSince, since),
    countSinceRange('leads', organizationId, prevSince, since),
    countSinceRange('handoffs', organizationId, prevSince, since),
    countSinceRange('appointments', organizationId, prevSince, since),
    db
      .select({ channel: conversations.channel, value: count() })
      .from(conversations)
      .where(and(eq(conversations.organizationId, organizationId), gte(conversations.createdAt, since)))
      .groupBy(conversations.channel),
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

  // Rates + timing + satisfaction — computed alongside the counts.
  const [escalatedConversations, resolvedConversations, firstResponse, csat] = await Promise.all([
    // Conversations that have at least one handoff row.
    db
      .select({ value: sql<number>`count(distinct ${handoffs.conversationId})` })
      .from(handoffs)
      .where(and(eq(handoffs.organizationId, organizationId), gte(handoffs.createdAt, since))),
    // Closed conversations with no handoff — resolved by the assistant.
    db
      .select({ value: count() })
      .from(conversations)
      .where(
        and(
          eq(conversations.organizationId, organizationId),
          eq(conversations.status, 'CLOSED'),
          gte(conversations.createdAt, since),
          sql`not exists (select 1 from handoffs h where h.conversation_id = ${conversations.id})`
        )
      ),
    // Avg seconds between the first USER message and the next ASSISTANT/AGENT reply per conversation.
    db.execute(sql`
      select avg(diff_seconds) as avg_seconds
      from (
        select extract(epoch from min(a.created_at - u.created_at)) as diff_seconds
        from (
          select conversation_id, min(created_at) as created_at
          from messages
          where organization_id = ${organizationId}
            and role = 'USER'
            and created_at >= ${since}
          group by conversation_id
        ) u
        join messages a
          on a.conversation_id = u.conversation_id
         and a.organization_id = ${organizationId}
         and a.role in ('ASSISTANT', 'AGENT')
         and a.created_at > u.created_at
        group by u.conversation_id
      ) t
    `),
    // CSAT — thumbs up/down on assistant messages.
    db
      .select({ feedback: messages.feedback, value: count() })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          gte(messages.createdAt, since),
          sql`${messages.feedback} is not null`
        )
      )
      .groupBy(messages.feedback),
  ]);

  const escalated = Number(escalatedConversations[0]?.value ?? 0);
  const resolved = Number(resolvedConversations[0]?.value ?? 0);
  const closedTotal =
    conversationsByChannel.length === 0
      ? 0
      : // count closed conversations in window regardless of handoff
        Number(
          (
            await db
              .select({ value: count() })
              .from(conversations)
              .where(
                and(
                  eq(conversations.organizationId, organizationId),
                  eq(conversations.status, 'CLOSED'),
                  gte(conversations.createdAt, since)
                )
              )
          )[0]?.value ?? 0
        );
  const frRow = firstResponse.rows[0] as { avg_seconds: string | null } | undefined;
  const csatUp = Number(csat.find((r) => r.feedback === 'up')?.value ?? 0);
  const csatDown = Number(csat.find((r) => r.feedback === 'down')?.value ?? 0);

  return {
    windowDays,
    conversations: {
      total: conversationTotal,
      byChannel: conversationsByChannel.map((r) => ({
        channel: r.channel,
        count: Number(r.value),
      })),
    },
    previous: {
      conversations: prevConversationTotal,
      messages: prevMessageTotal,
      leads: prevLeadTotal,
      handoffs: prevHandoffTotal,
      appointments: prevAppointmentTotal,
    },
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
    rates: {
      escalationRate: conversationTotal > 0 ? escalated / conversationTotal : 0,
      resolutionRate: closedTotal > 0 ? resolved / closedTotal : 0,
      avgFirstResponseSeconds: frRow?.avg_seconds ? Number(frRow.avg_seconds) : null,
    },
    csat: {
      positive: csatUp,
      negative: csatDown,
      score: csatUp + csatDown > 0 ? csatUp / (csatUp + csatDown) : null,
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
