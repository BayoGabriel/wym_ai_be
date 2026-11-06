import { Router } from 'express';
import { authenticate } from '../auth/middleware';
import { requirePermission } from '../rbac/authz';
import { db } from '../../database/client';
import { organizationProducts, organizations, products } from '../../database/schema/core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { recordAudit } from '../audit/service';

const createProductSchema = z.object({
  name: z.string().min(2),
  code: z.string().regex(/^[A-Z0-9_]+$/),
  description: z.string().optional(),
  active: z.boolean().optional(),
});

const assignSchema = z.object({
  organizationId: z.string().uuid(),
  productCode: z.string().regex(/^[A-Z0-9_]+$/),
  status: z.enum(['active', 'inactive']).default('active'),
});

const router = Router();

router.get('/products', authenticate, async (req, res) => {
  const auth = req.auth;
  requirePermission(auth, 'platform.manage');
  const rows = await db.select().from(products);
  return res.json(rows);
});

router.post('/products', authenticate, validate(createProductSchema), async (req, res) => {
  const auth = req.auth;
  requirePermission(auth, 'platform.manage');
  const body = req.body;
  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.code, body.code))
    .limit(1);
  if (existing)
    return res
      .status(409)
      .json({ error: { code: 'PRODUCT_CODE_EXISTS', message: 'Product code must be unique' } });
  const [row] = await db.insert(products).values(body).returning();
  await recordAudit({
    actorUserId: auth.userId,
    action: 'product.created',
    resourceType: 'product',
    resourceId: row.id,
    metadata: { code: row.code },
  });
  return res.status(201).json(row);
});

router.post('/products/assign', authenticate, validate(assignSchema), async (req, res) => {
  const auth = req.auth;
  requirePermission(auth, 'platform.manage');
  const body = req.body as {
    organizationId: string;
    productCode: string;
    status: 'active' | 'inactive';
  };
  const [p] = await db.select().from(products).where(eq(products.code, body.productCode)).limit(1);
  if (!p)
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, body.organizationId))
    .limit(1);
  if (!org)
    return res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Organization not found' } });
  if (!p.active && body.status === 'active')
    return res
      .status(400)
      .json({ error: { code: 'PRODUCT_INACTIVE', message: 'Cannot activate inactive product' } });
  const ins = db
    .insert(organizationProducts)
    .values({ organizationId: body.organizationId, productId: p.id, status: body.status });
  // Re-assignment of an already-entitled product is a no-op, not an error.
  const inserted = await ins
    .onConflictDoNothing({
      target: [organizationProducts.organizationId, organizationProducts.productId],
    })
    .returning();
  let row = inserted[0];
  if (!row) {
    const existing = await db
      .select()
      .from(organizationProducts)
      .where(
        and(
          eq(organizationProducts.organizationId, body.organizationId),
          eq(organizationProducts.productId, p.id)
        )
      )
      .limit(1);
    row = existing[0];
  }
  await recordAudit({
    actorUserId: auth.userId,
    action: 'product.assigned',
    resourceType: 'organization_product',
    resourceId: `${body.organizationId}:${p.id}`,
    metadata: {
      organizationId: body.organizationId,
      productCode: body.productCode,
      status: body.status,
    },
  });
  return res.status(201).json(row);
});

export default router;
