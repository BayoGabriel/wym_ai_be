import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/middleware';
import { requirePermission } from '../rbac/authz';
import { validate } from '../../middleware/validate';
import { organizationHasProduct } from '../products/service';
import { enquiryReport, enquiryReportToCsv } from './service';
import { AuthContext } from '../../types/auth';

const router = Router();

const reportQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  format: z.enum(['json', 'csv']).default('json'),
});

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

router.use(authenticate);

router.get(
  '/reports/enquiries',
  validate(reportQuerySchema, 'query'),
  handle(async (req, res) => {
    const auth = (req as unknown as { auth: AuthContext }).auth;
    requirePermission(auth, 'report.read');
    if (!auth.organizationId || !(await organizationHasProduct(auth.organizationId, 'WYMASSIST'))) {
      const err = new Error('Forbidden: WYMASSIST not entitled') as Error & {
        status?: number;
        code?: string;
      };
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }
    const { days, format } = req.query as unknown as { days: number; format: 'json' | 'csv' };
    const report = await enquiryReport(auth.organizationId, days);
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="enquiry-report-${days}d.csv"`);
      return res.send(enquiryReportToCsv(report));
    }
    res.json(report);
  })
);

const scheduleSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly']).default('weekly'),
  recipients: z.array(z.string().email()).min(1).max(10),
});

router.get(
  '/reports/schedules',
  handle(async (req, res) => {
    const auth = (req as unknown as { auth: AuthContext }).auth;
    requirePermission(auth, 'report.read');
    const { listSchedules } = await import('./schedules');
    res.json({ items: await listSchedules(auth.organizationId!) });
  })
);

router.post(
  '/reports/schedules',
  validate(scheduleSchema),
  handle(async (req, res) => {
    const auth = (req as unknown as { auth: AuthContext }).auth;
    requirePermission(auth, 'report.read');
    const { createSchedule } = await import('./schedules');
    const body = req.body as { frequency: string; recipients: string[] };
    res.status(201).json(
      await createSchedule({
        organizationId: auth.organizationId!,
        createdBy: auth.userId,
        frequency: body.frequency,
        recipients: body.recipients,
      })
    );
  })
);

router.delete(
  '/reports/schedules/:id',
  handle(async (req, res) => {
    const auth = (req as unknown as { auth: AuthContext }).auth;
    requirePermission(auth, 'report.read');
    const { deleteSchedule } = await import('./schedules');
    await deleteSchedule(auth.organizationId!, req.params.id);
    res.status(204).send();
  })
);

export default router;
