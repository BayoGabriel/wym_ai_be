import { db } from '../../database/client';
import { auditEvents } from '../../database/schema/core';

export async function recordAudit(params: {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: object | null;
}) {
  const payload: any = {
    organizationId: params.organizationId ?? null,
    actorUserId: params.actorUserId ?? null,
    action: params.action,
    resourceType: params.resourceType ?? null,
    resourceId: params.resourceId ?? null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
  };
  await db.insert(auditEvents).values(payload);
}
