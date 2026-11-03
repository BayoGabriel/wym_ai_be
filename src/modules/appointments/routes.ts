import { NextFunction, Request, Response, Router } from 'express';
import { authenticate } from '../auth/middleware';
import { requirePermission } from '../rbac/authz';
import { validate } from '../../middleware/validate';
import { AppointmentStatus, listAppointmentsQuerySchema, updateAppointmentSchema } from './schemas';
import { organizationHasProduct } from '../products/service';
import { getAppointmentById, listAppointments, updateAppointment } from './service';
import { AuthContext } from '../../types/auth';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

router.use(authenticate);

function authOf(req: Request): AuthContext {
  return (req as unknown as { auth: AuthContext }).auth;
}

async function ensureAssistEntitlement(auth: AuthContext) {
  const ok =
    auth.organizationId && (await organizationHasProduct(auth.organizationId, 'WYMASSIST'));
  if (!ok) {
    const err = new Error('Forbidden: WYMASSIST not entitled') as Error & {
      status?: number;
      code?: string;
    };
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}

router.get(
  '/appointments',
  validate(listAppointmentsQuerySchema, 'query'),
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'appointment.read');
    await ensureAssistEntitlement(auth);

    const query = req.query as unknown as {
      page: number;
      limit: number;
      status?: AppointmentStatus;
      from?: string;
      to?: string;
      assignedTo?: string;
      order: 'asc' | 'desc';
    };

    const response = await listAppointments({
      organizationId: auth.organizationId!,
      page: query.page,
      limit: query.limit,
      status: query.status,
      from: query.from,
      to: query.to,
      assignedTo: query.assignedTo,
      order: query.order,
    });
    res.json(response);
  })
);

router.get(
  '/appointments/:id',
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'appointment.read');
    await ensureAssistEntitlement(auth);

    const appointment = await getAppointmentById(auth.organizationId!, req.params.id);
    res.json(appointment);
  })
);

router.patch(
  '/appointments/:id',
  validate(updateAppointmentSchema),
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'appointment.write');
    await ensureAssistEntitlement(auth);

    const body = req.body as {
      customerName?: string;
      email?: string | null;
      phone?: string | null;
      preferredDate?: string;
      preferredTime?: string;
      reason?: string | null;
      internalNotes?: string | null;
      status?: AppointmentStatus;
      assignedTo?: string | null;
    };

    const appointment = await updateAppointment({
      organizationId: auth.organizationId!,
      userId: auth.userId,
      appointmentId: req.params.id,
      ...body,
    });
    res.json(appointment);
  })
);

export default router;
