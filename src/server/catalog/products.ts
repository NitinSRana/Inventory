import { and, asc, eq, ilike, or, type SQL } from 'drizzle-orm';

import { products, UNITS, type VAT_BANDS, type COUNT_FREQUENCIES } from '@/db/schema';
import { withTenant } from '@/db/tenant';

import { normalizeGtin } from './ean';

export type ProductInput = {
  name: string;
  gtin?: string | null;
  sku?: string | null;
  categoryId?: string | null;
  supplierId?: string | null;
  unit?: (typeof UNITS)[number];
  isWeighed?: boolean;
  /** Money and quantity stay strings end to end — never parse to a JS float. */
  costPrice?: string | null;
  sellPrice?: string | null;
  vatBand?: (typeof VAT_BANDS)[number];
  minStock?: string | null;
  maxStock?: string | null;
  shelfLifeDays?: number | null;
  countFrequency?: (typeof COUNT_FREQUENCIES)[number] | null;
};

export class InvalidBarcodeError extends Error {
  constructor(readonly raw: string) {
    super(`Not a valid EAN-13 or EAN-8: ${raw}`);
    this.name = 'InvalidBarcodeError';
  }
}

/**
 * Validates the fields the database cannot: a barcode that is well-formed but
 * mistyped is a valid string, and a blank name passes a NOT NULL check.
 *
 * Everything else — positive quantities, enum membership, GTIN uniqueness per
 * org — is a constraint in 0001_init.sql and is not re-checked here.
 */
function clean(input: ProductInput) {
  const name = input.name.trim();
  if (!name) throw new Error('Product name is required');

  let gtin: string | null = null;
  if (input.gtin) {
    gtin = normalizeGtin(input.gtin);
    if (!gtin) throw new InvalidBarcodeError(input.gtin);
  }

  return { ...input, name, gtin, sku: input.sku?.trim() || null };
}

export async function listProducts(
  orgId: string,
  options: { search?: string; limit?: number; includeInactive?: boolean } = {},
) {
  const { search, limit = 50, includeInactive = false } = options;

  const filters: SQL[] = [];
  if (!includeInactive) filters.push(eq(products.isActive, true));
  if (search?.trim()) {
    const term = `%${search.trim()}%`;
    filters.push(or(ilike(products.name, term), ilike(products.gtin, term))!);
  }

  return withTenant(orgId, (tx) =>
    tx
      .select()
      .from(products)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(products.name))
      .limit(limit),
  );
}

export async function getProduct(orgId: string, productId: string) {
  const [product] = await withTenant(orgId, (tx) =>
    tx.select().from(products).where(eq(products.id, productId)).limit(1),
  );
  return product ?? null;
}

/** Barcode lookup for the scanning flows. Returns null on an unknown or malformed code. */
export async function findProductByBarcode(orgId: string, barcode: string) {
  const gtin = normalizeGtin(barcode);
  if (!gtin) return null;

  const [product] = await withTenant(orgId, (tx) =>
    tx.select().from(products).where(eq(products.gtin, gtin)).limit(1),
  );
  return product ?? null;
}

export async function createProduct(orgId: string, input: ProductInput) {
  const values = clean(input);
  const [product] = await withTenant(orgId, (tx) =>
    tx
      .insert(products)
      .values({ ...values, organizationId: orgId })
      .returning(),
  );
  return product;
}

export async function updateProduct(orgId: string, productId: string, input: ProductInput) {
  const values = clean(input);
  const [product] = await withTenant(orgId, (tx) =>
    tx.update(products).set(values).where(eq(products.id, productId)).returning(),
  );
  return product ?? null;
}

/** Products are deactivated, never deleted — the ledger still references them. */
export async function deactivateProduct(orgId: string, productId: string) {
  const [product] = await withTenant(orgId, (tx) =>
    tx
      .update(products)
      .set({ isActive: false })
      .where(eq(products.id, productId))
      .returning(),
  );
  return product ?? null;
}
