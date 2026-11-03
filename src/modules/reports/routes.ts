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

export default router;
