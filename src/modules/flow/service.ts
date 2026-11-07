import { and, count, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { db } from '../../database/client';
import {
  flowActivities,
  flowDefinitions,
  flowInstances,
  flowTasks,
  usageRecords,
  products,
} from '../../database/schema/core';
import { ApiError } from '../../middleware/error';
import { recordAudit } from '../audit/service';
import { notifyOrgDirect } from '../notifications/service';

export type FlowField = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox';
  required?: boolean;
  options?: string[];
};

export type FlowStep = { name: string; description?: string };

type DefinitionRow = typeof flowDefinitions.$inferSelect;
type InstanceRow = typeof flowInstances.$inferSelect;
type TaskRow = typeof flowTasks.$inferSelect;

// ── Definitions ──

export function mapDefinition(d: DefinitionRow) {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    fields: (d.fields as FlowField[]) ?? [],
    steps: (d.steps as FlowStep[]) ?? [],
    active: d.active,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function createDefinition(params: {
  organizationId: string;
  userId: string;
  name: string;
  description?: string;
  fields: FlowField[];
  steps: FlowStep[];
  active: boolean;
}) {
  const keys = params.fields.map((f) => f.key);
  if (new Set(keys).size !== keys.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Field keys must be unique');
  }
  const [d] = await db
    .insert(flowDefinitions)
    .values({
      organizationId: params.organizationId,
      name: params.name,
      description: params.description ?? null,
      fields: params.fields,
      steps: params.steps,
      active: params.active,
      createdBy: params.userId,
    })
    .returning();
  await recordAudit({
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: 'flow.definition.created',
    resourceType: 'flow_definition',
    resourceId: d.id,
  });
  return d;
}

export async function listDefinitions(organizationId: string) {
  const rows = await db
    .select()
    .from(flowDefinitions)
    .where(eq(flowDefinitions.organizationId, organizationId))
    .orderBy(desc(flowDefinitions.createdAt));
  return rows.map(mapDefinition);
}

export async function getDefinition(organizationId: string, id: string) {
  const [d] = await db
    .select()
    .from(flowDefinitions)
    .where(and(eq(flowDefinitions.id, id), eq(flowDefinitions.organizationId, organizationId)))
    .limit(1);
  if (!d) throw new ApiError(404, 'NOT_FOUND', 'Workflow definition not found');
  return d;
}

export async function updateDefinition(params: {
  organizationId: string;
  id: string;
  userId: string;
  patch: Partial<{
    name: string;
    description: string;
    fields: FlowField[];
    steps: FlowStep[];
    active: boolean;
  }>;
}) {
  await getDefinition(params.organizationId, params.id);
  const [d] = await db
    .update(flowDefinitions)
    .set({ ...params.patch, updatedAt: new Date() })
    .where(
      and(
        eq(flowDefinitions.id, params.id),
        eq(flowDefinitions.organizationId, params.organizationId)
      )
    )
    .returning();
  await recordAudit({
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: 'flow.definition.updated',
    resourceType: 'flow_definition',
    resourceId: d.id,
  });
  return d;
}

// ── Instances ──

export function mapInstance(i: InstanceRow) {
  return {
    id: i.id,
    definitionId: i.definitionId,
    title: i.title,
    status: i.status,
    currentStep: i.currentStep,
    data: i.data,
    documents: (i.documents as { filename: string }[]).map((d) => ({ filename: d.filename })),
    submittedBy: i.submittedBy,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

export function mapTask(t: TaskRow) {
  return {
    id: t.id,
    instanceId: t.instanceId,
    stepIndex: t.stepIndex,
    title: t.title,
    status: t.status,
    outcome: t.outcome,
    assignedTo: t.assignedTo,
    dueAt: t.dueAt,
    completedAt: t.completedAt,
    completedBy: t.completedBy,
    decisionNote: t.decisionNote,
    createdAt: t.createdAt,
  };
}

function validateSubmissionData(fields: FlowField[], data: Record<string, unknown>) {
  const allowed = new Set(fields.map((f) => f.key));
  const unknown = Object.keys(data).filter((k) => !allowed.has(k));
  if (unknown.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Unknown fields: ${unknown.join(', ')}`);
  }
  const missing: string[] = [];
  for (const f of fields) {
    const v = data[f.key];
    const empty = v === undefined || v === null || v === '';
    if (f.required && empty) {
      missing.push(f.label);
      continue;
    }
    if (empty) continue;
    if (f.type === 'number' && typeof v !== 'number' && Number.isNaN(Number(v))) {
      throw new ApiError(400, 'VALIDATION_ERROR', `${f.label} must be a number`);
    }
    if (f.type === 'checkbox' && typeof v !== 'boolean' && v !== 'true' && v !== 'false') {
      throw new ApiError(400, 'VALIDATION_ERROR', `${f.label} must be true or false`);
    }
    if (f.type === 'select' && f.options?.length && !f.options.includes(String(v))) {
      throw new ApiError(400, 'VALIDATION_ERROR', `${f.label} must be one of the allowed options`);
    }
  }
  if (missing.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Missing required fields: ${missing.join(', ')}`);
  }
}

async function createStepTask(params: {
  organizationId: string;
  instance: InstanceRow;
  steps: FlowStep[];
  stepIndex: number;
}) {
  const step = params.steps[params.stepIndex];
  await db.insert(flowTasks).values({
    organizationId: params.organizationId,
    instanceId: params.instance.id,
    stepIndex: params.stepIndex,
    title: step.name,
  });
}

async function recordActivity(params: {
  organizationId: string;
  instanceId: string;
  actorUserId: string | null;
  action: string;
  detail?: Record<string, unknown>;
}) {
  await db.insert(flowActivities).values({
    organizationId: params.organizationId,
    instanceId: params.instanceId,
    actorUserId: params.actorUserId,
    action: params.action,
    detail: params.detail ?? null,
  });
}

export async function submitInstance(params: {
  organizationId: string;
  userId: string;
  definitionId: string;
  title: string;
  data: Record<string, unknown>;
  documents: { filename: string; contentBase64: string }[];
}) {
  const definition = await getDefinition(params.organizationId, params.definitionId);
  if (!definition.active) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'This workflow is not accepting submissions');
  }
  const fields = (definition.fields as FlowField[]) ?? [];
  const steps = (definition.steps as FlowStep[]) ?? [];
  validateSubmissionData(fields, params.data);
  for (const doc of params.documents) {
    if (Buffer.from(doc.contentBase64, 'base64').length > 4 * 1024 * 1024) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Document ${doc.filename} exceeds 4MB`);
    }
  }

  const [instance] = await db
    .insert(flowInstances)
    .values({
      organizationId: params.organizationId,
      definitionId: params.definitionId,
      title: params.title,
      data: params.data,
      documents: params.documents,
      submittedBy: params.userId,
    })
    .returning();
  await createStepTask({
    organizationId: params.organizationId,
    instance,
    steps,
    stepIndex: 0,
  });
  await recordActivity({
    organizationId: params.organizationId,
    instanceId: instance.id,
    actorUserId: params.userId,
    action: 'submitted',
    detail: { title: params.title },
  });
  await recordAudit({
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: 'flow.instance.submitted',
    resourceType: 'flow_instance',
    resourceId: instance.id,
  });
  void notifyOrgDirect({
    organizationId: params.organizationId,
    event: 'flow.instance.submitted',
    subject: `New ${definition.name} submission: ${params.title}`,
    text: `A new "${definition.name}" submission (${params.title}) is waiting for step "${steps[0]?.name}".`,
    link: `/dashboard/flow/instances/${instance.id}`,
  });
  void recordFlowUsage(params.organizationId, 'instance_submitted');
  return instance;
}

async function recordFlowUsage(organizationId: string, eventType: string) {
  try {
    const [product] = await db.select().from(products).where(eq(products.code, 'WYMFLOW')).limit(1);
    await db.insert(usageRecords).values({
      organizationId,
      productId: product?.id ?? null,
      eventType,
      quantity: 1,
    });
  } catch {
    /* usage must never break the workflow */
  }
}

export async function listInstances(params: {
  organizationId: string;
  status?: string;
  definitionId?: string;
  page: number;
  limit: number;
}) {
  const conditions = [eq(flowInstances.organizationId, params.organizationId)];
  if (params.status) {
    conditions.push(eq(flowInstances.status, params.status as InstanceRow['status']));
  }
  if (params.definitionId) {
    conditions.push(eq(flowInstances.definitionId, params.definitionId));
  }
  const where = and(...conditions);
  const rows = await db
    .select()
    .from(flowInstances)
    .where(where)
    .orderBy(desc(flowInstances.createdAt))
    .limit(params.limit)
    .offset((params.page - 1) * params.limit);
  const [totalRow] = await db.select({ value: count() }).from(flowInstances).where(where);
  return { items: rows.map(mapInstance), total: totalRow?.value ?? 0 };
}

export async function getInstanceDetail(organizationId: string, id: string) {
  const [instance] = await db
    .select()
    .from(flowInstances)
    .where(and(eq(flowInstances.id, id), eq(flowInstances.organizationId, organizationId)))
    .limit(1);
  if (!instance) throw new ApiError(404, 'NOT_FOUND', 'Submission not found');
  const tasks = await db
    .select()
    .from(flowTasks)
    .where(and(eq(flowTasks.instanceId, id), eq(flowTasks.organizationId, organizationId)))
    .orderBy(flowTasks.stepIndex);
  const activities = await db
    .select()
    .from(flowActivities)
    .where(
      and(eq(flowActivities.instanceId, id), eq(flowActivities.organizationId, organizationId))
    )
    .orderBy(flowActivities.createdAt);
  const definition = await getDefinition(organizationId, instance.definitionId);
  return {
    instance: mapInstance(instance),
    definition: mapDefinition(definition),
    tasks: tasks.map(mapTask),
    activities: activities.map((a) => ({
      id: a.id,
      action: a.action,
      detail: a.detail,
      actorUserId: a.actorUserId,
      createdAt: a.createdAt,
    })),
  };
}

// ── Tasks / decisions ──

export async function listTasks(params: {
  organizationId: string;
  mineFor?: string;
  status?: string;
  page: number;
  limit: number;
}) {
  const conditions = [eq(flowTasks.organizationId, params.organizationId)];
  if (params.mineFor) {
    // Tasks assigned to the caller, plus the shared unassigned queue.
    conditions.push(or(eq(flowTasks.assignedTo, params.mineFor), isNull(flowTasks.assignedTo))!);
  }
  if (params.status) {
    conditions.push(eq(flowTasks.status, params.status as TaskRow['status']));
  }
  const where = and(...conditions);
  const rows = await db
    .select()
    .from(flowTasks)
    .where(where)
    .orderBy(desc(flowTasks.createdAt))
    .limit(params.limit)
    .offset((params.page - 1) * params.limit);
  const [totalRow] = await db.select({ value: count() }).from(flowTasks).where(where);
  return { items: rows.map(mapTask), total: totalRow?.value ?? 0 };
}

export async function assignTask(params: {
  organizationId: string;
  taskId: string;
  assignedTo: string | null;
  actorUserId: string;
}) {
  const task = await getTask(params.organizationId, params.taskId);
  if (task.status !== 'PENDING') {
    throw new ApiError(409, 'CONFLICT', 'Only pending tasks can be reassigned');
  }
  await db
    .update(flowTasks)
    .set({ assignedTo: params.assignedTo })
    .where(and(eq(flowTasks.id, task.id), eq(flowTasks.organizationId, params.organizationId)));
  await recordActivity({
    organizationId: params.organizationId,
    instanceId: task.instanceId,
    actorUserId: params.actorUserId,
    action: 'task.assigned',
    detail: { taskId: task.id, assignedTo: params.assignedTo },
  });
}

async function getTask(organizationId: string, taskId: string) {
  const [t] = await db
    .select()
    .from(flowTasks)
    .where(and(eq(flowTasks.id, taskId), eq(flowTasks.organizationId, organizationId)))
    .limit(1);
  if (!t) throw new ApiError(404, 'NOT_FOUND', 'Task not found');
  return t;
}

export async function decideTask(params: {
  organizationId: string;
  taskId: string;
  userId: string;
  approve: boolean;
  note?: string;
  canAdmin: boolean;
}) {
  const task = await getTask(params.organizationId, params.taskId);
  if (task.status !== 'PENDING') {
    throw new ApiError(409, 'CONFLICT', 'This task has already been decided');
  }
  if (task.assignedTo && task.assignedTo !== params.userId && !params.canAdmin) {
    throw new ApiError(403, 'FORBIDDEN', 'This task is assigned to another staff member');
  }

  const [instance] = await db
    .select()
    .from(flowInstances)
    .where(
      and(
        eq(flowInstances.id, task.instanceId),
        eq(flowInstances.organizationId, params.organizationId)
      )
    )
    .limit(1);
  if (!instance || instance.status !== 'IN_PROGRESS') {
    throw new ApiError(409, 'CONFLICT', 'The submission is no longer in progress');
  }
  const definition = await getDefinition(params.organizationId, instance.definitionId);
  const steps = (definition.steps as FlowStep[]) ?? [];

  await db
    .update(flowTasks)
    .set({
      status: 'COMPLETED',
      outcome: params.approve ? 'APPROVED' : 'REJECTED',
      completedAt: new Date(),
      completedBy: params.userId,
      decisionNote: params.note ?? null,
    })
    .where(eq(flowTasks.id, task.id));

  await recordActivity({
    organizationId: params.organizationId,
    instanceId: instance.id,
    actorUserId: params.userId,
    action: params.approve ? 'task.approved' : 'task.rejected',
    detail: { taskId: task.id, stepIndex: task.stepIndex, note: params.note },
  });

  if (!params.approve) {
    await db
      .update(flowTasks)
      .set({ status: 'CANCELLED' })
      .where(and(eq(flowTasks.instanceId, instance.id), eq(flowTasks.status, 'PENDING')));
    await db
      .update(flowInstances)
      .set({ status: 'REJECTED', updatedAt: new Date() })
      .where(eq(flowInstances.id, instance.id));
    await recordActivity({
      organizationId: params.organizationId,
      instanceId: instance.id,
      actorUserId: params.userId,
      action: 'instance.rejected',
    });
  } else if (task.stepIndex + 1 >= steps.length) {
    await db
      .update(flowInstances)
      .set({ status: 'APPROVED', updatedAt: new Date() })
      .where(eq(flowInstances.id, instance.id));
    await recordActivity({
      organizationId: params.organizationId,
      instanceId: instance.id,
      actorUserId: params.userId,
      action: 'instance.approved',
    });
  } else {
    const nextIndex = task.stepIndex + 1;
    await db
      .update(flowInstances)
      .set({ currentStep: nextIndex, updatedAt: new Date() })
      .where(eq(flowInstances.id, instance.id));
    await createStepTask({
      organizationId: params.organizationId,
      instance,
      steps,
      stepIndex: nextIndex,
    });
    await recordActivity({
      organizationId: params.organizationId,
      instanceId: instance.id,
      actorUserId: params.userId,
      action: 'step.advanced',
      detail: { stepIndex: nextIndex, stepName: steps[nextIndex]?.name },
    });
    void notifyOrgDirect({
      organizationId: params.organizationId,
      event: 'flow.step.advanced',
      subject: `${definition.name}: "${instance.title}" moved to ${steps[nextIndex]?.name}`,
      text: `Submission "${instance.title}" was approved at step ${task.stepIndex + 1} and now awaits "${steps[nextIndex]?.name}".`,
      link: `/dashboard/flow/instances/${instance.id}`,
    });
  }

  await recordAudit({
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: params.approve ? 'flow.task.approved' : 'flow.task.rejected',
    resourceType: 'flow_task',
    resourceId: task.id,
  });
  void recordFlowUsage(params.organizationId, 'task_decided');
  return getInstanceDetail(params.organizationId, instance.id);
}

export async function cancelInstance(params: {
  organizationId: string;
  instanceId: string;
  userId: string;
}) {
  const [instance] = await db
    .select()
    .from(flowInstances)
    .where(
      and(
        eq(flowInstances.id, params.instanceId),
        eq(flowInstances.organizationId, params.organizationId)
      )
    )
    .limit(1);
  if (!instance) throw new ApiError(404, 'NOT_FOUND', 'Submission not found');
  if (instance.status !== 'IN_PROGRESS') {
    throw new ApiError(409, 'CONFLICT', 'Only in-progress submissions can be cancelled');
  }
  await db
    .update(flowTasks)
    .set({ status: 'CANCELLED' })
    .where(and(eq(flowTasks.instanceId, instance.id), eq(flowTasks.status, 'PENDING')));
  await db
    .update(flowInstances)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(eq(flowInstances.id, instance.id));
  await recordActivity({
    organizationId: params.organizationId,
    instanceId: instance.id,
    actorUserId: params.userId,
    action: 'instance.cancelled',
  });
  await recordAudit({
    organizationId: params.organizationId,
    actorUserId: params.userId,
    action: 'flow.instance.cancelled',
    resourceType: 'flow_instance',
    resourceId: instance.id,
  });
}

// Automated reminders: notify on PENDING tasks older than the threshold that
// haven't been reminded yet. Designed to be called by a scheduler/cron.
export async function dispatchReminders(olderThanHours = 24) {
  const cutoff = new Date(Date.now() - olderThanHours * 3600 * 1000);
  const pending = await db
    .select()
    .from(flowTasks)
    .where(
      and(
        eq(flowTasks.status, 'PENDING'),
        isNull(flowTasks.reminderSentAt),
        lt(flowTasks.createdAt, cutoff)
      )
    )
    .limit(200);
  let sent = 0;
  for (const task of pending) {
    const [instance] = await db
      .select()
      .from(flowInstances)
      .where(eq(flowInstances.id, task.instanceId))
      .limit(1);
    await notifyOrgDirect({
      organizationId: task.organizationId,
      event: 'flow.task.reminder',
      subject: `Reminder: "${task.title}" is still pending`,
      text: `The approval step "${task.title}" for submission "${instance?.title ?? task.instanceId}" has been waiting since ${task.createdAt.toISOString()}.`,
      link: '/dashboard/flow/tasks',
    });
    await db.update(flowTasks).set({ reminderSentAt: new Date() }).where(eq(flowTasks.id, task.id));
    sent++;
  }
  return { reminded: sent };
}
