import { and, asc, eq, getTableColumns, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';

import { categories, products, suppliers, UNITS, type VAT_BANDS, type DATE_TYPES, type COUNT_FREQUENCIES } from '@/db/schema';
import { withTenant } from '@/db/tenant';

import { normalizeGtin } from './ean';

export type ProductInput = {
  name: string;
  gtin?: string | null;
  caseGtin?: string | null;
  unitsPerCase?: string | null;
  sku?: string | null;
  categoryId?: string | null;
  supplierId?: string | null;
  unit?: (typeof UNITS)[number];
  isWeighed?: boolean;
  /** Money and quantity stay strings end to end — never parse to a JS float. */
  costPrice?: string | null;
  sellPrice?: string | null;
  vatBand?: (typeof VAT_BANDS)[number];
  dateType?: (typeof DATE_TYPES)[number];
  minStock?: string | null;
  maxStock?: string | null;
  shelfLifeDays?: number | null;
  /** Free text, as staff name it ("Fridge Row 2"). See 0016. */
  shelfLocation?: string | null;
  countFrequency?: (typeof COUNT_FREQUENCIES)[number] | null;
};

export class InvalidBarcodeError extends Error {
  readonly raw: string;
  readonly field: 'gtin' | 'caseGtin';

  constructor(raw: string, field: 'gtin' | 'caseGtin' = 'gtin') {
    super(`Not a valid GTIN-8/12/13/14 barcode: ${raw}`);
    this.name = 'InvalidBarcodeError';
    this.raw = raw;
    this.field = field;
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

  let caseGtin: string | null = null;
  if (input.caseGtin) {
    caseGtin = normalizeGtin(input.caseGtin);
    if (!caseGtin) throw new InvalidBarcodeError(input.caseGtin, 'caseGtin');
  }

  return { ...input, name, gtin, caseGtin, sku: input.sku?.trim() || null };
}

/**
 * "Needs attention" — the catalogue's own to-do list.
 *
 * A product with no price cannot be sold at all (checkout refuses it), one with
 * no barcode cannot be scanned, and one with no category is invisible to the
 * count schedule. All three are silent until someone hits them at the till or
 * the shelf, which is exactly when it is most expensive to find out.
 */
const NEEDS_ATTENTION = or(
  isNull(products.sellPrice),
  isNull(products.gtin),
  isNull(products.categoryId),
)!;

export type ProductFilters = {
  search?: string;
  categoryId?: string;
  supplierId?: string;
  /** Only products missing a price, a barcode or a category. */
  needsAttention?: boolean;
  limit?: number;
  includeInactive?: boolean;
  /** Only products out of stock, or below their own minimum. */
  lowOrOut?: boolean;
};

/** Units on hand across every location, from the ledger view — never stored. */
const ON_HAND = sql<string>`coalesce((select sum(ps.quantity) from product_stock ps where ps.product_id = ${products.id}), 0)`;

export async function listProducts(orgId: string, options: ProductFilters = {}) {
  const {
    search,
    categoryId,
    supplierId,
    needsAttention,
    limit = 50,
    includeInactive = false,
    lowOrOut = false,
  } = options;

  const filters: SQL[] = [];
  if (!includeInactive) filters.push(eq(products.isActive, true));
  if (categoryId) filters.push(eq(products.categoryId, categoryId));
  if (supplierId) filters.push(eq(products.supplierId, supplierId));
  if (needsAttention) filters.push(NEEDS_ATTENTION);
  if (lowOrOut) {
    filters.push(sql`(${ON_HAND} <= 0 or (${products.minStock} is not null and ${ON_HAND} < ${products.minStock}))`);
  }
  if (search?.trim()) {
    const term = `%${search.trim()}%`;
    filters.push(
      or(
        ilike(products.name, term),
        ilike(products.gtin, term),
        ilike(products.caseGtin, term),
        ilike(products.sku, term),
      )!,
    );
  }

  return withTenant(orgId, (tx) =>
    tx
      .select({
        ...getTableColumns(products),
        categoryName: categories.name,
        supplierName: suppliers.name,
        onHand: sql<string>`${ON_HAND}::text`,
        // When a completed count last covered it — the same definition the
        // count schedule uses (counting/due.ts).
        lastCountedAt: sql<string | null>`(
          select max(cl.counted_at)::text from count_lines cl
          join count_sessions cs on cs.id = cl.count_session_id
          where cl.product_id = ${products.id} and cs.status = 'completed'
        )`,
      })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
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

/**
 * Barcode lookup for the scanning flows. Returns null on an unknown or
 * malformed code. Matches either the unit barcode or the case barcode — a
 * delivery is often scanned by the case, everything else by the unit.
 */
export async function findProductByBarcode(orgId: string, barcode: string) {
  const gtin = normalizeGtin(barcode);
  if (!gtin) return null;

  const [product] = await withTenant(orgId, (tx) =>
    tx
      .select()
      .from(products)
      .where(or(eq(products.gtin, gtin), eq(products.caseGtin, gtin)))
      .limit(1),
  );
  return product ?? null;
}

/**
 * A cart line only ever carries a product id; the checkout screen re-reads
 * name/unit/price fresh every render rather than trusting anything from the
 * URL, the same rule every other price in this app follows.
 */
export async function getProductsByIds(orgId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return withTenant(orgId, (tx) => tx.select().from(products).where(inArray(products.id, ids)));
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

/**
 * The way back.
 *
 * Deactivating is this product's whole deletion model — the ledger references a
 * product forever, so rows are hidden rather than removed. Until now the only
 * route back to active was re-importing the barcode through the CSV, which
 * forces `is_active = true` as a side effect: a shop that deactivated something
 * by mistake had to discover that, or live with it.
 */
export async function reactivateProduct(orgId: string, productId: string) {
  const [product] = await withTenant(orgId, (tx) =>
    tx
      .update(products)
      .set({ isActive: true })
      .where(eq(products.id, productId))
      .returning(),
  );
  return product ?? null;
}
