import Decimal from 'decimal.js';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { locations, products, saleLines, sales, stockMovements } from '@/db/schema';
import { withTenant, type Tx } from '@/db/tenant';
import { netFromGross } from '@/server/settings/valuation';
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
      const vatRate = new Decimal(rates[product.vatBand as keyof typeof rates] ?? '0');
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
export async function listSales(orgId: string, limit = 50) {
  return withTenant(orgId, (tx) =>
    tx
      .select({
        id: sales.id,
        saleNumber: sales.saleNumber,
        // Falls back to createdAt, which is never null, for any row from
        // before occurred_at existed.
        occurredAt: sql<Date>`coalesce(${sales.occurredAt}, ${sales.createdAt})`,
        tenderType: sales.tenderType,
        total: sales.total,
        status: sales.status,
      })
      .from(sales)
      .orderBy(sql`${sales.createdAt} desc`)
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

export async function voidSale(orgId: string, saleId: string, actorId?: string | null) {
  return withTenant(orgId, async (tx) => {
    const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId)).limit(1);
    if (!sale) throw new Error('Sale not found');
    if (sale.status === 'voided') throw new Error('Sale is already voided');

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
          actorId: actorId ?? null,
          note: `Reverses sale ${sale.saleNumber}`,
        })),
      );
    }

    const [voided] = await tx
      .update(sales)
      .set({ status: 'voided', voidedAt: new Date(), voidedBy: actorId ?? null })
      .where(eq(sales.id, saleId))
      .returning();

    return voided;
  });
}
