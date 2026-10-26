import { NextFunction, Request, Response, Router } from 'express';
import { authenticate } from '../auth/middleware';
import { requirePermission } from '../rbac/authz';
import { validate } from '../../middleware/validate';
import {
  createLeadNoteSchema,
  listLeadsQuerySchema,
  updateLeadSchema,
  LeadStatus,
} from './schemas';
import { organizationHasProduct } from '../products/service';
import { addLeadNote, getLeadById, listLeads, updateLead } from './service';
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
  '/leads',
  validate(listLeadsQuerySchema, 'query'),
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'lead.read');
    await ensureAssistEntitlement(auth);

    const query = req.query as unknown as {
      page: number;
      limit: number;
      status?: LeadStatus;
      source?: string;
      category?: string;
      assignedTo?: string;
      order: 'asc' | 'desc';
    };

    const response = await listLeads({
      organizationId: auth.organizationId!,
      page: query.page,
      limit: query.limit,
      status: query.status,
      source: query.source,
      category: query.category,
      assignedTo: query.assignedTo,
      order: query.order,
    });
    res.json(response);
  })
);

router.get(
  '/leads/:id',
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'lead.read');
    await ensureAssistEntitlement(auth);

    const lead = await getLeadById(auth.organizationId!, req.params.id);
    res.json(lead);
  })
);

router.patch(
  '/leads/:id',
  validate(updateLeadSchema),
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'lead.write');
    await ensureAssistEntitlement(auth);

    const body = req.body as {
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      enquiryCategory?: string | null;
      summary?: string | null;
      status?: LeadStatus;
      assignedTo?: string | null;
    };

    const lead = await updateLead({
      organizationId: auth.organizationId!,
      userId: auth.userId,
      leadId: req.params.id,
      ...body,
    });
    res.json(lead);
  })
);

router.post(
  '/leads/:id/notes',
  validate(createLeadNoteSchema),
  handle(async (req, res) => {
    const auth = authOf(req);
    requirePermission(auth, 'lead.write');
    await ensureAssistEntitlement(auth);

    const note = await addLeadNote({
      organizationId: auth.organizationId!,
      userId: auth.userId,
      leadId: req.params.id,
      body: (req.body as { body: string }).body,
    });
    res.status(201).json(note);
  })
);

export default router;
