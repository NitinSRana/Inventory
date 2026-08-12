import { asc, eq, sql } from 'drizzle-orm';

import { categories, products } from '@/db/schema';
import { withTenant } from '@/db/tenant';

export type CategoryInput = {
  name: string;
  defaultCountFrequency?: (typeof categories.$inferSelect)['defaultCountFrequency'];
};

export async function listCategories(orgId: string) {
  return withTenant(orgId, (tx) => tx.select().from(categories).orderBy(asc(categories.name)));
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
