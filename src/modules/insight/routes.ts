import { NextFunction, Request, Response, Router } from 'express';
import { authenticate } from '../auth/middleware';
import { requirePermission } from '../rbac/authz';
import { validate } from '../../middleware/validate';
import { ApiError } from '../../middleware/error';
import { organizationHasProduct } from '../products/service';
import { AuthContext } from '../../types/auth';
import { listDatasetsQuerySchema, listReportsQuerySchema, uploadDatasetSchema } from './schemas';
import {
  analyzeDataset,
  deleteDataset,
  getDataset,
  getReport,
  listDatasets,
  listReports,
  mapDataset,
  mapReport,
  reportToCsv,
  uploadDataset,
} from './service';

const router = Router();

function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function authOf(req: Request): AuthContext {
  return (req as unknown as { auth: AuthContext }).auth;
}

async function requireInsight(req: Request) {
  const auth = authOf(req);
  if (!auth.organizationId || !(await organizationHasProduct(auth.organizationId, 'WYMINSIGHT'))) {
    throw new ApiError(403, 'FORBIDDEN', 'WymInsight AI is not enabled for this organization');
  }
  return auth;
}

router.use(authenticate);

// ── Datasets ──

router.post(
  '/insight/datasets',
  validate(uploadDatasetSchema),
  handle(async (req, res) => {
    const auth = await requireInsight(req);
    requirePermission(auth, 'insight.write');
    const body = req.body as { name: string; filename: string; contentBase64: string };
    const d = await uploadDataset({
      organizationId: auth.organizationId!,
      userId: auth.userId,
      ...body,
    });
    res.status(201).json(mapDataset(d));
  })
);

router.get(
  '/insight/datasets',
  validate(listDatasetsQuerySchema, 'query'),
  handle(async (req, res) => {
    const auth = await requireInsight(req);
    requirePermission(auth, 'insight.read');
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const result = await listDatasets({ organizationId: auth.organizationId!, page, limit });
    res.json({ items: result.items, page, limit, total: result.total });
  })
);

router.get(
  '/insight/datasets/:id',
  handle(async (req, res) => {
    const auth = await requireInsight(req);
    requirePermission(auth, 'insight.read');
    const d = await getDataset({ organizationId: auth.organizationId!, datasetId: req.params.id });
    res.json(mapDataset(d, true));
  })
);

router.delete(
  '/insight/datasets/:id',
  handle(async (req, res) => {
    const auth = await requireInsight(req);
    requirePermission(auth, 'insight.write');
    await deleteDataset({
      organizationId: auth.organizationId!,
      datasetId: req.params.id,
      userId: auth.userId,
    });
    res.status(204).send();
  })
);

router.post(
  '/insight/datasets/:id/analyze',
  handle(async (req, res) => {
    const auth = await requireInsight(req);
    requirePermission(auth, 'insight.write');
    const report = await analyzeDataset({
      organizationId: auth.organizationId!,
      datasetId: req.params.id,
      userId: auth.userId,
    });
    res.status(201).json(mapReport(report));
  })
);

// ── Reports ──

router.get(
  '/insight/reports',
  validate(listReportsQuerySchema, 'query'),
  handle(async (req, res) => {
    const auth = await requireInsight(req);
    requirePermission(auth, 'insight.read');
    const q = req.query as unknown as { datasetId?: string; page: number; limit: number };
    const result = await listReports({
      organizationId: auth.organizationId!,
      datasetId: q.datasetId,
      page: q.page,
      limit: q.limit,
    });
    res.json({ items: result.items, page: q.page, limit: q.limit, total: result.total });
  })
);

router.get(
  '/insight/reports/:id',
  handle(async (req, res) => {
    const auth = await requireInsight(req);
    requirePermission(auth, 'insight.read');
    const r = await getReport({ organizationId: auth.organizationId!, reportId: req.params.id });
    res.json(mapReport(r));
  })
);

router.get(
  '/insight/reports/:id/download',
  handle(async (req, res) => {
    const auth = await requireInsight(req);
    requirePermission(auth, 'insight.read');
    const r = await getReport({ organizationId: auth.organizationId!, reportId: req.params.id });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="insight-report-${r.id}.csv"`);
    res.send(reportToCsv(r));
  })
);

export default router;
