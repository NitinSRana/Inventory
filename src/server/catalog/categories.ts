import { asc, eq, getTableColumns, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';

import { categories, products } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { marginPercent } from '@/server/settings/valuation';
import { getRatesByBand } from '@/server/settings/vat';

export type CategoryInput = {
  name: string;
  description?: string | null;
  icon?: string | null;
  defaultCountFrequency?: (typeof categories.$inferSelect)['defaultCountFrequency'];
};

export async function listCategories(orgId: string) {
  return withTenant(orgId, (tx) =>
    tx
      .select({
        ...getTableColumns(categories),
        /** Active products only — what the category list's "45 items" means. */
        // "categories"."id" spelled out: Drizzle renders ${categories.id} here as a
        // bare "id", which binds to the inner products row and counts nothing.
        productCount: sql<number>`(select count(*)::int from products p where p.category_id = "categories"."id" and p.is_active)`,
      })
      .from(categories)
      .orderBy(asc(categories.name)),
  );
}

export async function getCategory(orgId: string, categoryId: string) {
  const [category] = await withTenant(orgId, (tx) =>
    tx.select().from(categories).where(eq(categories.id, categoryId)).limit(1),
  );
  return category ?? null;
}

export async function createCategory(orgId: string, input: CategoryInput) {
  const name = input.name.trim();
  if (!name) throw new Error('Category name is required');

  const [category] = await withTenant(orgId, (tx) =>
    tx
      .insert(categories)
      .values({ ...input, name, organizationId: orgId })
      .returning(),
  );
  return category;
}

export async function updateCategory(orgId: string, categoryId: string, input: CategoryInput) {
  const name = input.name.trim();
  if (!name) throw new Error('Category name is required');

  const [category] = await withTenant(orgId, (tx) =>
    tx.update(categories).set({ ...input, name }).where(eq(categories.id, categoryId)).returning(),
  );
  return category ?? null;
}

/**
 * Hard delete, unlike products/suppliers: nothing in the ledger references a
 * category directly, and `products.category_id` is `on delete set null` — a
 * deleted category just leaves its products uncategorised, never orphans a
 * historical record the way deleting a product or supplier would.
 */
export async function deleteCategory(orgId: string, categoryId: string) {
  await withTenant(orgId, (tx) => tx.delete(categories).where(eq(categories.id, categoryId)));
}

/** So the delete confirmation can say "12 products will be uncategorised" rather than nothing. */
export async function countProductsInCategory(orgId: string, categoryId: string) {
  const [row] = await withTenant(orgId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(products)
      .where(eq(products.categoryId, categoryId)),
  );
  return row?.n ?? 0;
}

/**
 * Products in this category, with on-hand quantity and margin — the number a
 * manager reviewing a category actually wants, not just its settings.
 *
 * Margin is computed the same way the product page computes it (see
 * settings/valuation.ts's marginPercent(): net sell minus net cost, never the
 * naive gross-vs-net subtraction). A product missing cost or sell price is
 * still listed — it just doesn't contribute a number to the average, the same
 * way the product page shows nothing rather than a wrong figure for it.
 */
export async function getCategorySummary(orgId: string, categoryId: string) {
  return withTenant(orgId, async (tx) => {
    const rows = await tx
      .select({
        id: products.id,
        name: products.name,
        gtin: products.gtin,
        unit: products.unit,
        sellPrice: products.sellPrice,
        costPrice: products.costPrice,
        vatBand: products.vatBand,
        // Summed across locations, not joined: a join gives a product one row
        // per location it is stocked in, listing and counting it twice.
        quantity: sql<string>`coalesce((select sum(ps.quantity) from product_stock ps where ps.product_id = "products"."id"), 0)::text`,
      })
      .from(products)
      .where(eq(products.categoryId, categoryId))
      .orderBy(asc(products.name));

    const rates = await getRatesByBand(orgId);
    const margins: Decimal[] = [];
    const list = rows.map((r) => {
      const margin =
        r.costPrice && r.sellPrice
          ? marginPercent(r.sellPrice, r.costPrice, rates[r.vatBand as keyof typeof rates] ?? '0')
          : null;
      if (margin !== null) margins.push(new Decimal(margin));
      return { ...r, marginPercent: margin };
    });

    const totalStock = rows
      .reduce((sum, r) => sum.plus(r.quantity), new Decimal(0))
      .toString();
    const avgMarginPercent = margins.length
      ? margins.reduce((sum, m) => sum.plus(m), new Decimal(0)).dividedBy(margins.length).toFixed(1)
      : null;

    return { products: list, productCount: rows.length, totalStock, avgMarginPercent };
  });
}
