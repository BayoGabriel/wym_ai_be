import { db } from '../../database/client';
import { organizationProducts, products } from '../../database/schema/core';
import { and, eq } from 'drizzle-orm';

export async function organizationHasProduct(organizationId: string, productCode: string) {
  const rows = await db
    .select({})
    .from(organizationProducts)
    .innerJoin(products, eq(organizationProducts.productId, products.id))
    .where(
      and(
        eq(organizationProducts.organizationId, organizationId),
        eq(products.code, productCode),
        eq(products.active, true),
        eq(organizationProducts.status, 'active')
      )
    )
    .limit(1);
  return rows.length > 0;
}
