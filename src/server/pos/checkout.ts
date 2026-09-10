import Decimal from 'decimal.js';
import { and, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';

import {
  SALE_STATUSES,
  TENDER_TYPES,
  locations,
  organizations,
  products,
  saleLines,
  sales,
  stockMovements,
} from '@/db/schema';
import { withTenant, type Tx } from '@/db/tenant';
import { netFromGross, rateForBand } from '@/server/settings/valuation';
import { getRatesByBand } from '@/server/settings/vat';
import { allocateFefo } from '@/server/stock/fefo';
import { getBatchStock } from '@/server/stock/levels';

/**
 * POS checkout.
 *
 * A sale is rung up, not typed in after the fact — the till records it as a
 * side effect of completing the transaction, the same way receiving records a
 * delivery. Depletes stock through the same append-only ledger every other
 * movement uses, FEFO.
 *
 * Lines loop inside one withTenant transaction, ledger rows composed into that
 * same transaction. Price and VAT are always derived from the product and the
 * tenant's own rates — never trusted from the caller, so nothing about the
 * total can be posted from the client.
 */

/**
 * When a sale happened, as against when this database heard about it.
 *
 * `occurred_at` is the till's own time; it is null only for rows written before
 * that column existed, where `created_at` is the same moment anyway. Defined
 * once because three things have to agree on it — the list's ordering, its date
 * filter, and any report that assigns a sale to a period. A sale rung up at
 * 23:55 on the 31st and synced at 00:05 on the 1st belongs to the earlier
 * month, and a VAT return is the place where disagreeing about that is
 * expensive.
 */
export const SALE_OCCURRED = sql<Date>`coalesce(${sales.occurredAt}, ${sales.createdAt})`;

async function defaultLocationId(tx: Tx): Promise<string> {
  const [location] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.isDefault, true))
    .limit(1);
  if (!location) throw new Error('Organization has no default location');
  return location.id;
}

/**
 * Sequential per tenant, computed inside the caller's transaction so two
 * simultaneous checkouts cannot collide on the unique (org, sale_number) index
 * — same technique as purchase orders' nextPoNumber.
 */
async function nextSaleNumber(tx: Tx): Promise<string> {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(sales);
  const year = new Date().getFullYear();
  return `TXN-${year}-${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
}

export class UnpricedProductError extends Error {
  constructor(readonly productName: string) {
    super(`${productName} has no sell price set`);
    this.name = 'UnpricedProductError';
  }
}

export type CheckoutLine = { productId: string; quantity: string };

export async function checkout(
  orgId: string,
  input: {
    locationId?: string;
    lines: CheckoutLine[];
    tenderType: 'cash' | 'card';
    actorId?: string | null;
  },
) {
  if (input.lines.length === 0) throw new Error('A sale needs at least one line');

  // Scanning the same barcode twice must add to one line, not collide with the
  // sale_lines unique (sale_id, product_id) index.
  const merged = new Map<string, Decimal>();
  for (const line of input.lines) {
    const qty = new Decimal(line.quantity);
    merged.set(line.productId, (merged.get(line.productId) ?? new Decimal(0)).plus(qty));
  }

  return withTenant(orgId, async (tx) => {
    const locationId = input.locationId ?? (await defaultLocationId(tx));
    const productIds = [...merged.keys()];

    // Asked of the database, not the Node clock: the expiry dashboard derives
    // "today" from current_date, and a filter computed in a different
    // timezone would disagree with what it already calls expired.
    const todayRows = await tx.execute<{ today: string }>(sql`select current_date::text as today`);
    const today = todayRows[0]?.today ?? '';

    const rows = await tx
      .select({
        id: products.id,
        name: products.name,
        sellPrice: products.sellPrice,
        vatBand: products.vatBand,
      })
      .from(products)
      .where(inArray(products.id, productIds));
    const byId = new Map(rows.map((r) => [r.id, r]));

    const rates = await getRatesByBand(orgId);

    let subtotal = new Decimal(0);
    let vatTotal = new Decimal(0);
    const lineValues: (typeof saleLines.$inferInsert)[] = [];
    const movementValues: (typeof stockMovements.$inferInsert)[] = [];

    for (const [productId, quantity] of merged) {
      const product = byId.get(productId);
      if (!product) throw new Error(`Product ${productId} not found`);
      if (!product.sellPrice) throw new UnpricedProductError(product.name);

      const unitPrice = new Decimal(product.sellPrice);
      /*
       * sellPrice is the SHELF price: what the customer actually pays, VAT
       * included. UK and EU consumer retail prices are display-inclusive by
       * law, so VAT is extracted from the price rather than added on top of it.
       * Adding it on top would charge a customer £1.44 for a £1.20 chocolate
       * bar.
       */
      const lineTotal = unitPrice.times(quantity);
      // Throws rather than falling back to 0%: a sale is the moment a VAT
      // figure stops being a display value and becomes a stored fact the shop
      // will later declare from.
      const vatRate = new Decimal(rateForBand(rates, product.vatBand));
      /*
       * Derive net first, then take VAT as the remainder. Doing it this way
       * round guarantees net + vat === lineTotal exactly, so no penny can go
       * missing to rounding and the receipt always adds up.
       */
      const lineNet = new Decimal(netFromGross(lineTotal.toString(), vatRate.toString(), 4));
      const vatAmount = lineTotal.minus(lineNet);

      subtotal = subtotal.plus(lineNet);
      vatTotal = vatTotal.plus(vatAmount);

      lineValues.push({
        organizationId: orgId,
        saleId: '', // filled in once the parent row exists, below
        productId,
        quantity: quantity.toString(),
        unitPrice: unitPrice.toString(),
        vatBand: product.vatBand,
        vatAmount: vatAmount.toDecimalPlaces(4).toString(),
        lineTotal: lineTotal.toDecimalPlaces(4).toString(),
      });

      // A batch past its use-by date cannot be sold — that's a criminal
      // offence in the UK, not a judgement call the till gets to make.
      // Best-before past date is routine and stays sellable; FEFO still pulls
      // it first once excluded batches are out of the running.
      const sellable = (await getBatchStock(orgId, productId, locationId, tx)).filter(
        (b) => !(b.dateType === 'use_by' && b.expiryDate !== null && b.expiryDate < today),
      );

      // FEFO, same as a write-off with no batch specified: oldest expiry first.
      const allocations = allocateFefo(sellable, quantity.toString());
      for (const a of allocations) {
        movementValues.push({
          organizationId: orgId,
          productId,
          locationId,
          batchId: a.batchId,
          quantityDelta: new Decimal(a.quantity).negated().toString(),
          movementType: 'consumption',
          referenceType: 'sale',
          actorId: input.actorId ?? null,
        });
      }
    }

    const total = subtotal.plus(vatTotal);

    const [sale] = await tx
      .insert(sales)
      .values({
        organizationId: orgId,
        locationId,
        saleNumber: await nextSaleNumber(tx),
        tenderType: input.tenderType,
        soldBy: input.actorId ?? null,
        subtotal: subtotal.toDecimalPlaces(4).toString(),
        vatTotal: vatTotal.toDecimalPlaces(4).toString(),
        total: total.toDecimalPlaces(4).toString(),
        // Till sales happen the instant they're posted, unlike a synced external
        // sale where this is backfilled from the provider's own timestamp.
        occurredAt: new Date(),
      })
      .returning();

    await tx
      .insert(saleLines)
      .values(lineValues.map((l) => ({ ...l, saleId: sale.id })));

    await tx
      .insert(stockMovements)
      .values(movementValues.map((m) => ({ ...m, referenceId: sale.id })));

    return sale;
  });
}

/**
 * Voids a whole sale. No partial/line-level refunds in v1.
 *
 * A compensating stock_movements row per original consumption movement —
 * exactly the correction pattern every other movement in this ledger follows
 * (.claude/rules/database.md: "Correct mistakes by posting a compensating
 * movement") — plus a status update on `sales`, which is a normal table update,
 * not the append-only ledger.
 */
/**
 * Recent sales, newest first — what a staff member scans when a customer
 * says "you overcharged me five minutes ago" and needs to find the sale
 * before it can be voided.
 */
export type SaleFilters = {
  /** Inclusive, plain `YYYY-MM-DD` as a date input hands it over. */
  from?: string;
  to?: string;
  tenderType?: (typeof TENDER_TYPES)[number];
  status?: (typeof SALE_STATUSES)[number];
  /** Matches the sale number. */
  search?: string;
  limit?: number;
};

export async function listSales(orgId: string, filters: SaleFilters = {}) {
  const { from, to, tenderType, status, search, limit = 50 } = filters;

  const where: SQL[] = [];
  /*
   * The list displays, orders by and filters on the same expression, and all
   * three matter. It used to display `occurred_at` while ordering by
   * `created_at`; a date filter added against either one alone would have
   * silently dropped sales whose displayed date sat inside the range — the kind
   * of bug that surfaces weeks later as "the filter lost a sale". A sale synced
   * from an external till carries the time it happened at their end, which is
   * the only time a shopkeeper recognises.
   */
  if (from) where.push(sql`${SALE_OCCURRED} >= ${from}::date`);
  // Inclusive of the closing day itself, rather than stopping at its midnight.
  if (to) where.push(sql`${SALE_OCCURRED} < (${to}::date + interval '1 day')`);
  if (tenderType) where.push(eq(sales.tenderType, tenderType));
  if (status) where.push(eq(sales.status, status));
  if (search?.trim()) where.push(ilike(sales.saleNumber, `%${search.trim()}%`));

  return withTenant(orgId, (tx) =>
    tx
      .select({
        id: sales.id,
        saleNumber: sales.saleNumber,
        occurredAt: SALE_OCCURRED,
        tenderType: sales.tenderType,
        total: sales.total,
        status: sales.status,
      })
      .from(sales)
      .where(where.length ? and(...where) : undefined)
      // id breaks ties, so two sales in the same second keep a stable order
      // rather than shuffling between renders.
      .orderBy(sql`${SALE_OCCURRED} desc`, desc(sales.id))
      .limit(limit),
  );
}

/**
 * A sale and everything printed on its receipt.
 *
 * The figures are read back rather than recomputed. Prices and VAT rates both
 * change, and a receipt that recalculates itself from today's rates would show
 * a different total tomorrow than the customer was charged today. What was
 * charged is what `sale_lines` recorded at the time.
 */
export async function getSale(orgId: string, saleId: string) {
  return withTenant(orgId, async (tx) => {
    const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId)).limit(1);
    if (!sale) return null;

    const lines = await tx
      .select({
        productId: saleLines.productId,
        name: products.name,
        gtin: products.gtin,
        unit: products.unit,
        quantity: saleLines.quantity,
        unitPrice: saleLines.unitPrice,
        vatBand: saleLines.vatBand,
        vatAmount: saleLines.vatAmount,
        lineTotal: saleLines.lineTotal,
      })
      .from(saleLines)
      .innerJoin(products, eq(products.id, saleLines.productId))
      .where(eq(saleLines.saleId, saleId))
      .orderBy(products.name);

    /**
     * VAT grouped by band, which is the breakdown a receipt actually needs:
     * a shop taking something back has to refund the tax at the rate it was
     * charged at, and one summed VAT figure cannot tell you what that was.
     */
    const byBand = new Map<string, { net: Decimal; vat: Decimal }>();
    for (const line of lines) {
      const net = new Decimal(line.lineTotal).minus(line.vatAmount);
      const seen = byBand.get(line.vatBand) ?? { net: new Decimal(0), vat: new Decimal(0) };
      byBand.set(line.vatBand, {
        net: seen.net.plus(net),
        vat: seen.vat.plus(line.vatAmount),
      });
    }

    const vatBreakdown = [...byBand.entries()]
      .map(([band, totals]) => ({
        band,
        net: totals.net.toFixed(2),
        vat: totals.vat.toFixed(2),
      }))
      // Largest first: the standard band is usually the bulk of a basket.
      .sort((a, b) => Number(b.vat) - Number(a.vat));

    return { sale, lines, vatBreakdown };
  });
}

/** A void of an older sale went through with nothing on the record. */
export class VoidReasonRequiredError extends Error {
  constructor() {
    super('Voiding a sale from a previous day needs a written reason');
    this.name = 'VoidReasonRequiredError';
  }
}

/**
 * Was this sale rung up today, in the shop's own timezone?
 *
 * Asked of Postgres inside the transaction, never of the Node clock: a server
 * in another region would put a 23:40 sale on the wrong side of midnight and
 * demand a reason for voiding something that happened twenty minutes ago.
 *
 * ponytail: calendar day, not trading day. A shop that closes at 01:00 will see
 * the small hours count as a new day. Add a per-org day-start offset if a real
 * one asks.
 */
async function ringUpDayIsToday(tx: Tx, saleId: string) {
  const rows = await tx.execute<{ same: boolean }>(sql`
    select (${SALE_OCCURRED} at time zone ${organizations.timezone})::date
         = (now() at time zone ${organizations.timezone})::date as same
    from ${sales} join ${organizations} on ${organizations.id} = ${sales.organizationId}
    where ${sales.id} = ${saleId}`);
  return rows[0]?.same ?? false;
}

/** Whether the void screen has to ask for a reason before it will submit. */
export async function voidNeedsReason(orgId: string, saleId: string) {
  return withTenant(orgId, async (tx) => !(await ringUpDayIsToday(tx, saleId)));
}

/**
 * Reverses a sale in full.
 *
 * Voiding stays manager-only at every entry point. What is new is that a sale
 * from a previous day needs a written reason: today's mis-ring is ordinary
 * till work, but reaching back into a closed day moves money that has already
 * been counted and, once the VAT report exists, already declared. A hard
 * refusal was the other option and is worse — it removes the only fix for a
 * mis-rung sale and leaves its VAT on the books.
 *
 * The reason rides into the compensating movement's note, so it turns up in
 * the corrections report without anything else being written.
 */
export async function voidSale(
  orgId: string,
  saleId: string,
  options: { actorId?: string | null; reason?: string | null } = {},
) {
  const { actorId = null, reason = null } = options;
  return withTenant(orgId, async (tx) => {
    const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId)).limit(1);
    if (!sale) throw new Error('Sale not found');
    if (sale.status === 'voided') throw new Error('Sale is already voided');

    // In the domain, not on the page: a page-only guard is one a bookmarked
    // URL walks straight past.
    const trimmedReason = reason?.trim() || null;
    if (!trimmedReason && !(await ringUpDayIsToday(tx, saleId))) {
      throw new VoidReasonRequiredError();
    }

    const originalMovements = await tx
      .select()
      .from(stockMovements)
      .where(
        and(eq(stockMovements.referenceType, 'sale'), eq(stockMovements.referenceId, saleId)),
      );

    if (originalMovements.length > 0) {
      await tx.insert(stockMovements).values(
        originalMovements.map((m) => ({
          organizationId: orgId,
          productId: m.productId,
          locationId: m.locationId,
          batchId: m.batchId,
          quantityDelta: new Decimal(m.quantityDelta).negated().toString(),
          movementType: 'manual_adjustment' as const,
          reasonCode: 'correction' as const,
          referenceType: 'sale' as const,
          referenceId: saleId,
          actorId,
          note: trimmedReason
            ? `Reverses sale ${sale.saleNumber}: ${trimmedReason}`
            : `Reverses sale ${sale.saleNumber}`,
        })),
      );
    }

    const [voided] = await tx
      .update(sales)
      .set({ status: 'voided', voidedAt: new Date(), voidedBy: actorId })
      .where(eq(sales.id, saleId))
      .returning();

    return voided;
  });
}
