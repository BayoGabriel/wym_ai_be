import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../database/client';
import { notifications, users } from '../../database/schema/core';

// Writes dashboard bell notifications for all active staff in an org (or an
// explicit subset). Best-effort like email delivery — never throws into the
// calling business operation.
export async function writeInAppNotifications(params: {
  organizationId: string;
  event: string;
  title: string;
  body?: string;
  link?: string;
  userIds?: string[];
}) {
  try {
    let userIds = params.userIds;
    if (!userIds) {
      const staff = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(eq(users.organizationId, params.organizationId), eq(users.status, 'active'))
        );
      userIds = staff.map((s) => s.id);
    }
    if (userIds.length === 0) return;
    await db.insert(notifications).values(
      userIds.map((userId) => ({
        organizationId: params.organizationId,
        userId,
        event: params.event,
        title: params.title,
        body: params.body ?? null,
        link: params.link ?? null,
      }))
    );
  } catch (err) {
    console.error(
      `[notification] in-app write failed for org ${params.organizationId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

export async function listInAppNotifications(params: {
  userId: string;
  organizationId: string;
  page: number;
  limit: number;
  unreadOnly?: boolean;
}) {
  const where = params.unreadOnly
    ? and(
        eq(notifications.userId, params.userId),
        eq(notifications.organizationId, params.organizationId),
        isNull(notifications.readAt)
      )
    : and(
        eq(notifications.userId, params.userId),
        eq(notifications.organizationId, params.organizationId)
      );

  const items = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(params.limit)
    .offset((params.page - 1) * params.limit);

  const [totals] = await db
    .select({
      total: count(),
      unread: sql<number>`count(*) filter (where ${notifications.readAt} is null)`,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, params.userId),
        eq(notifications.organizationId, params.organizationId)
      )
    );

  return {
    items,
    total: Number(totals?.total ?? 0),
    unreadCount: Number(totals?.unread ?? 0),
    page: params.page,
    limit: params.limit,
  };
}

export async function countUnreadInApp(userId: string, organizationId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.organizationId, organizationId),
        isNull(notifications.readAt)
      )
    );
  return Number(row?.value ?? 0);
}

export async function markInAppRead(params: {
  userId: string;
  organizationId: string;
  notificationId: string;
}) {
  const [row] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, params.notificationId),
        eq(notifications.userId, params.userId),
        eq(notifications.organizationId, params.organizationId)
      )
    )
    .returning();
  return row ?? null;
}

export async function markAllInAppRead(params: {
  userId: string;
  organizationId: string;
  ids?: string[];
}) {
  const conditions = [
    eq(notifications.userId, params.userId),
    eq(notifications.organizationId, params.organizationId),
    isNull(notifications.readAt),
  ];
  if (params.ids?.length) conditions.push(inArray(notifications.id, params.ids));
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(...conditions))
    .returning({ id: notifications.id });
  return { updated: rows.length };
}
