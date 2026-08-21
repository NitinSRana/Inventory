import { and, asc, eq, sql } from 'drizzle-orm';

import { categories, productStock, products, suppliers } from '@/db/schema';
import { withTenant } from '@/db/tenant';

export type SupplierInput = {
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  leadTimeDays?: number;
  minOrderValue?: string | null;
  /** ISO weekdays: 1 = Monday .. 7 = Sunday */
  deliveryWeekdays?: number[];
};

export async function listSuppliers(orgId: string, options: { includeInactive?: boolean } = {}) {
  return withTenant(orgId, async (tx) => {
    const rows = await tx
      .select()
      .from(suppliers)
      .where(options.includeInactive ? undefined : eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.name));

    // A second, grouped query rather than a join: the list is small (dozens
    // of suppliers, not thousands), and this keeps the row shape identical
    // to a plain select() instead of fighting Drizzle's join-plus-groupBy typing.
    const counts = await tx
      .select({ supplierId: products.supplierId, n: sql<number>`count(*)::int` })
      .from(products)
      .groupBy(products.supplierId);
    const countBySupplier = new Map(counts.map((c) => [c.supplierId, c.n]));

    return rows.map((r) => ({ ...r, productCount: countBySupplier.get(r.id) ?? 0 }));
  });
}

export async function createSupplier(orgId: string, input: SupplierInput) {
  const name = input.name.trim();
  if (!name) throw new Error('Supplier name is required');

  const [supplier] = await withTenant(orgId, (tx) =>
    tx
      .insert(suppliers)
      .values({ ...input, name, organizationId: orgId })
      .returning(),
  );
  return supplier;
}

export async function getSupplier(orgId: string, supplierId: string) {
  const [supplier] = await withTenant(orgId, (tx) =>
    tx.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1),
  );
  return supplier ?? null;
}

/** Deactivated, never deleted — products and purchase orders still reference them. */
export async function deactivateSupplier(orgId: string, supplierId: string) {
  const [supplier] = await withTenant(orgId, (tx) =>
    tx
      .update(suppliers)
      .set({ isActive: false })
      .where(eq(suppliers.id, supplierId))
      .returning(),
  );
  return supplier ?? null;
}

export async function updateSupplier(orgId: string, supplierId: string, input: SupplierInput) {
  const name = input.name.trim();
  if (!name) throw new Error('Supplier name is required');

  const [supplier] = await withTenant(orgId, (tx) =>
    tx
      .update(suppliers)
      .set({ ...input, name })
      .where(and(eq(suppliers.id, supplierId)))
      .returning(),
  );
  return supplier ?? null;
}

/** Products from this supplier, for the supplier detail screen. */
export async function getSupplierProducts(orgId: string, supplierId: string) {
  return withTenant(orgId, (tx) =>
    tx
      .select({
        id: products.id,
        name: products.name,
        gtin: products.gtin,
        unit: products.unit,
        categoryName: categories.name,
        sellPrice: products.sellPrice,
        quantity: sql<string>`coalesce(${productStock.quantity}, 0)::text`,
      })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(productStock, eq(productStock.productId, products.id))
      .where(eq(products.supplierId, supplierId))
      .orderBy(asc(products.name)),
  );
}
