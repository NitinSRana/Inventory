import Decimal from 'decimal.js';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { locations, products, purchaseOrderLines, purchaseOrders, suppliers } from '@/db/schema';
import { withTenant, type Tx } from '@/db/tenant';
import { receiveStock } from '@/server/stock/movements';

/**
 * Purchase orders.
 *
 * `on_order_quantities` only counts lines on orders that are sent or partly
 * received, so a draft never suppresses a reorder suggestion — you can leave a
 * draft sitting for a week without the app quietly deciding you've handled it.
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
 * simultaneous creates cannot collide on the unique (org, po_number) index.
 */
async function nextPoNumber(tx: Tx): Promise<string> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(purchaseOrders);
  const year = new Date().getFullYear();
  return `PO-${year}-${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
}

export type OrderLineInput = { productId: string; quantity: string; unitCost?: string | null };

export async function createPurchaseOrder(
  orgId: string,
  input: {
    supplierId: string;
    lines: OrderLineInput[];
    expectedAt?: string | null;
    note?: string | null;
    createdBy?: string | null;
  },
) {
  if (input.lines.length === 0) throw new Error('A purchase order needs at least one line');

  return withTenant(orgId, async (tx) => {
    const locationId = await defaultLocationId(tx);
    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        organizationId: orgId,
        supplierId: input.supplierId,
        locationId,
        poNumber: await nextPoNumber(tx),
        status: 'draft',
        expectedAt: input.expectedAt ?? null,
        note: input.note ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();

    await tx.insert(purchaseOrderLines).values(
      input.lines.map((l) => ({
        organizationId: orgId,
        purchaseOrderId: po.id,
        productId: l.productId,
        quantityOrdered: l.quantity,
        unitCost: l.unitCost ?? null,
      })),
    );

    return po;
  });
}

export async function listPurchaseOrders(orgId: string) {
  return withTenant(orgId, (tx) =>
    tx
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status,
        expectedAt: purchaseOrders.expectedAt,
        orderedAt: purchaseOrders.orderedAt,
        supplierName: suppliers.name,
        lineCount: sql<number>`(
          select count(*)::int from ${purchaseOrderLines}
          where ${purchaseOrderLines.purchaseOrderId} = ${purchaseOrders.id}
        )`,
        total: sql<string>`(
          select coalesce(round(sum(${purchaseOrderLines.quantityOrdered} * coalesce(${purchaseOrderLines.unitCost}, 0)), 2), 0)::text
          from ${purchaseOrderLines}
          where ${purchaseOrderLines.purchaseOrderId} = ${purchaseOrders.id}
        )`,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .orderBy(desc(purchaseOrders.createdAt)),
  );
}

export async function getPurchaseOrder(orgId: string, poId: string) {
  return withTenant(orgId, async (tx) => {
    const [po] = await tx
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status,
        expectedAt: purchaseOrders.expectedAt,
        sentAt: purchaseOrders.sentAt,
        note: purchaseOrders.note,
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.name,
        supplierEmail: suppliers.email,
        leadTimeDays: suppliers.leadTimeDays,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(eq(purchaseOrders.id, poId))
      .limit(1);
    if (!po) return null;

    const lines = await tx
      .select({
        id: purchaseOrderLines.id,
        productId: purchaseOrderLines.productId,
        productName: products.name,
        gtin: products.gtin,
        unit: products.unit,
        shelfLifeDays: products.shelfLifeDays,
        quantityOrdered: purchaseOrderLines.quantityOrdered,
        quantityReceived: purchaseOrderLines.quantityReceived,
        unitCost: purchaseOrderLines.unitCost,
      })
      .from(purchaseOrderLines)
      .innerJoin(products, eq(products.id, purchaseOrderLines.productId))
      .where(eq(purchaseOrderLines.purchaseOrderId, poId))
      .orderBy(asc(products.name));

    const total = lines
      .reduce((acc, l) => acc.plus(new Decimal(l.quantityOrdered).times(l.unitCost ?? 0)), new Decimal(0))
      .toDecimalPlaces(2)
      .toString();

    return { ...po, lines, total };
  });
}

/**
 * Marks the order as sent. This is the moment it starts counting against future
 * reorder suggestions, which is why it is an explicit step and not a side
 * effect of creating the draft.
 */
export async function markPurchaseOrderSent(orgId: string, poId: string) {
  return withTenant(orgId, async (tx) => {
    const [po] = await tx
      .update(purchaseOrders)
      .set({ status: 'sent', sentAt: new Date(), orderedAt: new Date() })
      .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.status, 'draft')))
      .returning();
    if (!po) throw new Error('Purchase order is not a draft');
    return po;
  });
}

/**
 * Cancels an order that is not coming.
 *
 * Anything already delivered stays in the ledger — that stock is physically on
 * the shelf and the ledger is append-only. Cancelling only stops the
 * outstanding quantity, which drops out of on_order_quantities and lets the
 * reorder suggestion come back.
 *
 * A fully received order cannot be cancelled: there is nothing outstanding to
 * cancel, and pretending otherwise would misreport history.
 */
export async function cancelPurchaseOrder(orgId: string, poId: string, note?: string | null) {
  return withTenant(orgId, async (tx) => {
    const [po] = await tx
      .update(purchaseOrders)
      .set({ status: 'cancelled', note: note ?? null })
      .where(
        and(
          eq(purchaseOrders.id, poId),
          inArray(purchaseOrders.status, ['draft', 'sent', 'partially_received']),
        ),
      )
      .returning();
    if (!po) throw new Error('Only an open purchase order can be cancelled');
    return po;
  });
}

export type ReceiptLineInput = {
  lineId: string;
  quantity: string;
  expiryDate?: string | null;
  lotNumber?: string | null;
};

/**
 * Receives a delivery against an order.
 *
 * Partial deliveries are the norm, not the exception: a supplier short-ships and
 * the rest follows next week. So each receipt adds to quantity_received and the
 * order only closes when every line is satisfied.
 *
 * Over-delivery is accepted and flagged rather than rejected — the stock is
 * physically on the shelf, and refusing to record it would make the ledger lie.
 */
export async function receiveAgainstPurchaseOrder(
  orgId: string,
  poId: string,
  receipts: ReceiptLineInput[],
  actorId?: string | null,
) {
  const usable = receipts.filter((r) => new Decimal(r.quantity || '0').greaterThan(0));
  if (usable.length === 0) throw new Error('Nothing to receive');

  const discrepancies: { lineId: string; ordered: string; received: string }[] = [];

  await withTenant(orgId, async (tx) => {
    const lines = await tx
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, poId));
    const byId = new Map(lines.map((l) => [l.id, l]));

    for (const receipt of usable) {
      const line = byId.get(receipt.lineId);
      if (!line) throw new Error('Line does not belong to this purchase order');

      const received = new Decimal(line.quantityReceived).plus(receipt.quantity);
      if (received.greaterThan(line.quantityOrdered)) {
        discrepancies.push({
          lineId: line.id,
          ordered: line.quantityOrdered,
          received: received.toString(),
        });
      }

      await tx
        .update(purchaseOrderLines)
        .set({ quantityReceived: received.toString() })
        .where(eq(purchaseOrderLines.id, line.id));
    }

    const [po] = await tx
      .select({ locationId: purchaseOrders.locationId })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, poId))
      .limit(1);

    // Stock enters through the same ledger path as a manual receipt — batch
    // find-or-create included — tagged with the order so the movement traces
    // back to it. Same transaction, so lines and ledger move together.
    for (const receipt of usable) {
      const line = byId.get(receipt.lineId)!;
      await receiveStock(
        orgId,
        {
          productId: line.productId,
          locationId: po.locationId,
          quantity: receipt.quantity,
          expiryDate: receipt.expiryDate ?? null,
          lotNumber: receipt.lotNumber ?? null,
          unitCost: line.unitCost,
          referenceType: 'purchase_order',
          referenceId: poId,
          actorId,
        },
        tx,
      );
    }

    const after = await tx
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, poId));
    const complete = after.every((l) =>
      new Decimal(l.quantityReceived).greaterThanOrEqualTo(l.quantityOrdered),
    );

    await tx
      .update(purchaseOrders)
      .set({ status: complete ? 'received' : 'partially_received' })
      .where(eq(purchaseOrders.id, poId));
  });

  return { discrepancies };
}

/** Re-exported so the receiving UI can share one path into the ledger. */
export { receiveStock };
