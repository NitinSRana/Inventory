/**
 * Drizzle schema — mirrors 0001_init.sql.
 *
 * The SQL migration is the source of truth for constraints, RLS policies and
 * triggers. This file exists for type-safe queries; it deliberately does not
 * try to express RLS or the append-only trigger, which live in the database.
 *
 * Place at: src/db/schema.ts
 */

import {
  pgTable, uuid, text, boolean, integer, smallint, date,
  timestamp, numeric, char, index, uniqueIndex, pgView,
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';

/* -------------------------------------------------------------------------- */
/* Shared column helpers                                                       */
/* -------------------------------------------------------------------------- */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);

/* -------------------------------------------------------------------------- */
/* Organizations & membership                                                  */
/* -------------------------------------------------------------------------- */

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  countryCode: char('country_code', { length: 2 }).notNull(),
  currencyCode: char('currency_code', { length: 3 }).notNull().default('EUR'),
  timezone: text('timezone').notNull().default('Europe/Berlin'),
  locale: text('locale').notNull().default('en'),
  ...timestamps,
});

/** Every tenant-scoped table starts with this column. No exceptions. */
const orgId = () =>
  uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' });

export const organizationMembers = pgTable('organization_members', {
  id: id(),
  organizationId: orgId(),
  userId: uuid('user_id').notNull(),
  role: text('role', { enum: ['owner', 'manager', 'staff'] }).notNull(),
  ...timestamps,
}, (t) => ({
  orgUser: uniqueIndex('organization_members_organization_id_user_id_key')
    .on(t.organizationId, t.userId),
  byUser: index('organization_members_user_id_idx').on(t.userId),
}));

/**
 * Pending invitations. Claimed on the invitee's first sign-in via
 * app.claim_invitation — nothing here creates a Supabase auth user.
 */
export const organizationInvitations = pgTable('organization_invitations', {
  id: id(),
  organizationId: orgId(),
  email: text('email').notNull(),
  role: text('role', { enum: ['owner', 'manager', 'staff'] }).notNull(),
  invitedBy: uuid('invited_by'),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedBy: uuid('accepted_by'),
  ...timestamps,
}, (t) => ({
  byEmail: index('organization_invitations_email_idx').on(t.email),
}));

/* -------------------------------------------------------------------------- */
/* Locations                                                                   */
/* -------------------------------------------------------------------------- */

export const locations = pgTable('locations', {
  id: id(),
  organizationId: orgId(),
  name: text('name').notNull(),
  type: text('type', { enum: ['store', 'backroom', 'warehouse'] }).notNull().default('store'),
  isDefault: boolean('is_default').notNull().default(false),
  ...timestamps,
});

/* -------------------------------------------------------------------------- */
/* VAT — per-tenant data, never hardcoded per country                          */
/* -------------------------------------------------------------------------- */

export const VAT_BANDS = ['standard', 'reduced', 'super_reduced', 'zero'] as const;

export const vatRates = pgTable('vat_rates', {
  id: id(),
  organizationId: orgId(),
  band: text('band', { enum: VAT_BANDS }).notNull(),
  rate: numeric('rate', { precision: 5, scale: 4 }).notNull(),
  label: text('label'),
  validFrom: date('valid_from').notNull().defaultNow(),
  ...timestamps,
});

/* -------------------------------------------------------------------------- */
/* Categories & suppliers                                                      */
/* -------------------------------------------------------------------------- */

export const COUNT_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly'] as const;

export const categories = pgTable('categories', {
  id: id(),
  organizationId: orgId(),
  name: text('name').notNull(),
  parentId: uuid('parent_id'),
  defaultCountFrequency: text('default_count_frequency', { enum: COUNT_FREQUENCIES })
    .notNull().default('monthly'),
  ...timestamps,
});

export const suppliers = pgTable('suppliers', {
  id: id(),
  organizationId: orgId(),
  name: text('name').notNull(),
  contactName: text('contact_name'),
  email: text('email'),
  phone: text('phone'),
  leadTimeDays: integer('lead_time_days').notNull().default(3),
  minOrderValue: numeric('min_order_value', { precision: 12, scale: 4 }),
  /** ISO weekdays: 1 = Monday .. 7 = Sunday */
  deliveryWeekdays: smallint('delivery_weekdays').array().notNull().default(sql`'{}'`),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
}, (t) => ({
  orgName: uniqueIndex('suppliers_organization_id_name_key').on(t.organizationId, t.name),
}));

/* -------------------------------------------------------------------------- */
/* Products                                                                    */
/* -------------------------------------------------------------------------- */

export const UNITS = ['each', 'kg', 'g', 'l', 'ml'] as const;

/**
 * Legally distinct in the UK: selling past `use_by` is a criminal offence,
 * past `best_before` is routine and gets marked down. See 0012_date_type.
 */
export const DATE_TYPES = ['use_by', 'best_before'] as const;

export const products = pgTable('products', {
  id: id(),
  organizationId: orgId(),
  /** EAN-13 / EAN-8. Null for weighed goods, which have no fixed barcode. */
  gtin: text('gtin'),
  /** Barcode on the shipping case, scanned when a delivery arrives by the
   * case rather than the unit. GTIN-12/13/14, separate from `gtin`. */
  caseGtin: text('case_gtin'),
  /** Units per case, when `caseGtin` is set. */
  unitsPerCase: numeric('units_per_case', { precision: 10, scale: 3 }),
  sku: text('sku'),
  name: text('name').notNull(),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  unit: text('unit', { enum: UNITS }).notNull().default('each'),
  isWeighed: boolean('is_weighed').notNull().default(false),
  costPrice: numeric('cost_price', { precision: 12, scale: 4 }),
  sellPrice: numeric('sell_price', { precision: 12, scale: 4 }),
  /*
   * Defaults to 'zero' because the primary market is the UK, where most food is
   * zero-rated and standard-rating is the exception. See 0010_uk_vat_defaults.
   */
  vatBand: text('vat_band', { enum: VAT_BANDS }).notNull().default('zero'),
  /** Steady-state default post-migration; existing rows landed on
   *  'best_before' instead. See 0012_date_type. */
  dateType: text('date_type', { enum: DATE_TYPES }).notNull().default('use_by'),
  minStock: numeric('min_stock', { precision: 14, scale: 3 }),
  maxStock: numeric('max_stock', { precision: 14, scale: 3 }),
  shelfLifeDays: integer('shelf_life_days'),
  countFrequency: text('count_frequency', { enum: COUNT_FREQUENCIES }),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
}, (t) => ({
  bySupplier: index('products_organization_id_supplier_id_idx').on(t.organizationId, t.supplierId),
  byCategory: index('products_organization_id_category_id_idx').on(t.organizationId, t.categoryId),
}));

/* -------------------------------------------------------------------------- */
/* Batches — the unit of expiry tracking                                       */
/* -------------------------------------------------------------------------- */

export const batches = pgTable('batches', {
  id: id(),
  organizationId: orgId(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
  lotNumber: text('lot_number'),
  expiryDate: date('expiry_date'),
  /** Copied from the product at receive time — never chosen per delivery. */
  dateType: text('date_type', { enum: DATE_TYPES }).notNull().default('best_before'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  unitCost: numeric('unit_cost', { precision: 12, scale: 4 }),
  ...timestamps,
}, (t) => ({
  byExpiry: index('batches_expiry_idx').on(t.organizationId, t.expiryDate),
  byProduct: index('batches_organization_id_product_id_location_id_idx')
    .on(t.organizationId, t.productId, t.locationId),
}));

/* -------------------------------------------------------------------------- */
/* Stock movements — APPEND-ONLY LEDGER                                        */
/*                                                                             */
/* Never write an UPDATE or DELETE against this table. A database trigger will  */
/* reject it. To correct a mistake, post a compensating movement.               */
/* -------------------------------------------------------------------------- */

export const MOVEMENT_TYPES = [
  'receipt',
  'waste',
  'count_adjustment',
  'manual_adjustment',
  'consumption', // a till sale; reference_type 'sale' points at the sales row
] as const;

export const REASON_CODES = [
  'expired', 'damaged', 'theft', 'staff_use', 'sampling',
  'supplier_return', 'correction', 'other',
] as const;

export const stockMovements = pgTable('stock_movements', {
  id: id(),
  organizationId: orgId(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
  batchId: uuid('batch_id').references(() => batches.id, { onDelete: 'restrict' }),
  /** Signed. Positive adds stock, negative removes it. Never zero. */
  quantityDelta: numeric('quantity_delta', { precision: 14, scale: 3 }).notNull(),
  movementType: text('movement_type', { enum: MOVEMENT_TYPES }).notNull(),
  reasonCode: text('reason_code', { enum: REASON_CODES }),
  referenceType: text('reference_type', { enum: ['purchase_order', 'count_session', 'manual', 'sale'] }),
  referenceId: uuid('reference_id'),
  actorId: uuid('actor_id'),
  note: text('note'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byProduct: index('stock_movements_organization_id_product_id_location_id_idx')
    .on(t.organizationId, t.productId, t.locationId),
  byBatch: index('stock_movements_organization_id_batch_id_idx').on(t.organizationId, t.batchId),
  byTime: index('stock_movements_organization_id_occurred_at_idx')
    .on(t.organizationId, t.occurredAt),
  byReference: index('stock_movements_organization_id_reference_type_reference_id_idx')
    .on(t.organizationId, t.referenceType, t.referenceId),
}));

/* -------------------------------------------------------------------------- */
/* Purchase orders                                                             */
/* -------------------------------------------------------------------------- */

export const PO_STATUSES = [
  'draft', 'sent', 'partially_received', 'received', 'cancelled',
] as const;

export const purchaseOrders = pgTable('purchase_orders', {
  id: id(),
  organizationId: orgId(),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
  poNumber: text('po_number').notNull(),
  status: text('status', { enum: PO_STATUSES }).notNull().default('draft'),
  orderedAt: timestamp('ordered_at', { withTimezone: true }),
  expectedAt: date('expected_at'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  note: text('note'),
  createdBy: uuid('created_by'),
  ...timestamps,
}, (t) => ({
  orgNumber: uniqueIndex('purchase_orders_organization_id_po_number_key')
    .on(t.organizationId, t.poNumber),
  byStatus: index('purchase_orders_organization_id_status_idx').on(t.organizationId, t.status),
}));

export const purchaseOrderLines = pgTable('purchase_order_lines', {
  id: id(),
  organizationId: orgId(),
  purchaseOrderId: uuid('purchase_order_id').notNull()
    .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  quantityOrdered: numeric('quantity_ordered', { precision: 14, scale: 3 }).notNull(),
  quantityReceived: numeric('quantity_received', { precision: 14, scale: 3 }).notNull().default('0'),
  unitCost: numeric('unit_cost', { precision: 12, scale: 4 }),
  ...timestamps,
}, (t) => ({
  poProduct: uniqueIndex('purchase_order_lines_purchase_order_id_product_id_key')
    .on(t.purchaseOrderId, t.productId),
}));

/* -------------------------------------------------------------------------- */
/* Sales — POS checkout                                                        */
/* -------------------------------------------------------------------------- */

export const SALE_STATUSES = ['completed', 'voided'] as const;
export const SALE_SOURCES = ['till', 'epos_now'] as const;
export const TENDER_TYPES = ['cash', 'card'] as const;

export const sales = pgTable('sales', {
  id: id(),
  organizationId: orgId(),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
  saleNumber: text('sale_number').notNull(),
  status: text('status', { enum: SALE_STATUSES }).notNull().default('completed'),
  subtotal: numeric('subtotal', { precision: 12, scale: 4 }).notNull(),
  vatTotal: numeric('vat_total', { precision: 12, scale: 4 }).notNull(),
  total: numeric('total', { precision: 12, scale: 4 }).notNull(),
  tenderType: text('tender_type', { enum: TENDER_TYPES }).notNull(),
  soldBy: uuid('sold_by'),
  /** Where the sale came from. External sales land in this same table. */
  source: text('source', { enum: SALE_SOURCES }).notNull().default('till'),
  /** The provider's own transaction id. Null for our own till. Unique per
   *  (org, source) — that index is the whole idempotency guarantee. */
  externalRef: text('external_ref'),
  /** When it happened at the till, which is not when we heard about it. */
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidedBy: uuid('voided_by'),
  ...timestamps,
}, (t) => ({
  orgNumber: uniqueIndex('sales_organization_id_sale_number_key').on(t.organizationId, t.saleNumber),
  byStatus: index('sales_organization_id_status_idx').on(t.organizationId, t.status),
  byTime: index('sales_organization_id_created_at_idx').on(t.organizationId, t.createdAt),
}));

export const saleLines = pgTable('sale_lines', {
  id: id(),
  organizationId: orgId(),
  saleId: uuid('sale_id').notNull().references(() => sales.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 12, scale: 4 }).notNull(),
  vatBand: text('vat_band', { enum: VAT_BANDS }).notNull(),
  vatAmount: numeric('vat_amount', { precision: 12, scale: 4 }).notNull(),
  lineTotal: numeric('line_total', { precision: 12, scale: 4 }).notNull(),
  ...timestamps,
}, (t) => ({
  saleProduct: uniqueIndex('sale_lines_sale_id_product_id_key').on(t.saleId, t.productId),
  byProduct: index('sale_lines_organization_id_product_id_idx').on(t.organizationId, t.productId),
}));

/* -------------------------------------------------------------------------- */
/* External POS                                                                */
/*                                                                             */
/* A shop already running an EPOS will never switch to our till, so its sales   */
/* arrive by sync instead. They land in the `sales` table above, not a parallel */
/* one — reports and insights should not have to know where a sale came from.   */
/* -------------------------------------------------------------------------- */

export const POS_PROVIDERS = ['epos_now'] as const;
export const POS_CONNECTION_STATUSES = ['disconnected', 'connected', 'error'] as const;

export const posConnections = pgTable('pos_connections', {
  id: id(),
  organizationId: orgId(),
  locationId: uuid('location_id').notNull(),
  provider: text('provider', { enum: POS_PROVIDERS }).notNull(),
  status: text('status', { enum: POS_CONNECTION_STATUSES }).notNull().default('disconnected'),
  /** Key into the secret store — never the token itself. */
  credentialRef: text('credential_ref'),
  /** High-water mark. Rewound slightly on each sync; duplicates are free
   *  because the unique index on (org, source, external_ref) discards them. */
  syncedThrough: timestamp('synced_through', { withTimezone: true }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastError: text('last_error'),
  ...timestamps,
});

/**
 * A barcode the EPOS sold that we have no product for.
 *
 * Kept rather than dropped: an unknown barcode is usually a product that exists
 * in their till and not in our catalogue, so this is the shop's to-do list for
 * closing the gap — and early on, a way to build the catalogue at all.
 */
export const posUnmatchedLines = pgTable('pos_unmatched_lines', {
  id: id(),
  organizationId: orgId(),
  connectionId: uuid('connection_id'),
  barcode: text('barcode').notNull(),
  description: text('description'),
  /** Running total sold while unmatched — how much drift this represents. */
  quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull().default('0'),
  timesSeen: integer('times_seen').notNull().default(1),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedProductId: uuid('resolved_product_id'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...timestamps,
}, (t) => ({
  orgBarcode: uniqueIndex('pos_unmatched_lines_organization_id_barcode_key')
    .on(t.organizationId, t.barcode),
}));

/* -------------------------------------------------------------------------- */
/* Cycle counting                                                              */
/* -------------------------------------------------------------------------- */

export const countSessions = pgTable('count_sessions', {
  id: id(),
  organizationId: orgId(),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
  name: text('name'),
  scopeType: text('scope_type', { enum: ['full', 'category', 'supplier', 'custom'] })
    .notNull().default('full'),
  scopeId: uuid('scope_id'),
  status: text('status', { enum: ['in_progress', 'completed', 'cancelled'] })
    .notNull().default('in_progress'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  startedBy: uuid('started_by'),
  ...timestamps,
});

export const countLines = pgTable('count_lines', {
  id: id(),
  organizationId: orgId(),
  countSessionId: uuid('count_session_id').notNull()
    .references(() => countSessions.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  batchId: uuid('batch_id').references(() => batches.id, { onDelete: 'restrict' }),
  /** What the ledger believed at the moment of counting. */
  expectedQuantity: numeric('expected_quantity', { precision: 14, scale: 3 }),
  countedQuantity: numeric('counted_quantity', { precision: 14, scale: 3 }).notNull(),
  countedAt: timestamp('counted_at', { withTimezone: true }).notNull().defaultNow(),
  countedBy: uuid('counted_by'),
  ...timestamps,
});

/* -------------------------------------------------------------------------- */
/* Consumption rates                                                           */
/*                                                                             */
/* Derived from count-to-count deltas:                                         */
/*   consumption = opening count + receipts - waste - closing count            */
/*                                                                             */
/* confidence === 'insufficient' means the UI must say "not enough data yet"   */
/* rather than render a misleading zero.                                       */
/* -------------------------------------------------------------------------- */

export const consumptionRates = pgTable('consumption_rates', {
  id: id(),
  organizationId: orgId(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
  dailyRate: numeric('daily_rate', { precision: 14, scale: 4 }),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  sampleCount: integer('sample_count').notNull().default(0),
  confidence: text('confidence', { enum: ['insufficient', 'low', 'medium', 'high'] })
    .notNull().default('insufficient'),
  calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),
  ...timestamps,
}, (t) => ({
  orgProductLocation: uniqueIndex('consumption_rates_org_product_location_key')
    .on(t.organizationId, t.productId, t.locationId),
}));

/* -------------------------------------------------------------------------- */
/* Views — read-only, defined in SQL                                           */
/* -------------------------------------------------------------------------- */

export const stockLevels = pgView('stock_levels', {
  organizationId: uuid('organization_id'),
  productId: uuid('product_id'),
  locationId: uuid('location_id'),
  batchId: uuid('batch_id'),
  quantity: numeric('quantity', { precision: 14, scale: 3 }),
  lastMovementAt: timestamp('last_movement_at', { withTimezone: true }),
}).existing();

export const productStock = pgView('product_stock', {
  organizationId: uuid('organization_id'),
  productId: uuid('product_id'),
  locationId: uuid('location_id'),
  quantity: numeric('quantity', { precision: 14, scale: 3 }),
  lastMovementAt: timestamp('last_movement_at', { withTimezone: true }),
}).existing();

export const expiringStock = pgView('expiring_stock', {
  organizationId: uuid('organization_id'),
  batchId: uuid('batch_id'),
  productId: uuid('product_id'),
  locationId: uuid('location_id'),
  productName: text('product_name'),
  gtin: text('gtin'),
  lotNumber: text('lot_number'),
  expiryDate: date('expiry_date'),
  daysRemaining: integer('days_remaining'),
  quantity: numeric('quantity', { precision: 14, scale: 3 }),
  unitCost: numeric('unit_cost', { precision: 12, scale: 4 }),
  valueAtRisk: numeric('value_at_risk', { precision: 20, scale: 7 }),
  dateType: text('date_type', { enum: DATE_TYPES }),
}).existing();

export const onOrderQuantities = pgView('on_order_quantities', {
  organizationId: uuid('organization_id'),
  productId: uuid('product_id'),
  locationId: uuid('location_id'),
  quantityOnOrder: numeric('quantity_on_order', { precision: 14, scale: 3 }),
}).existing();

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const productsRelations = relations(products, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [products.organizationId], references: [organizations.id],
  }),
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  supplier: one(suppliers, { fields: [products.supplierId], references: [suppliers.id] }),
  batches: many(batches),
  movements: many(stockMovements),
}));

export const batchesRelations = relations(batches, ({ one, many }) => ({
  product: one(products, { fields: [batches.productId], references: [products.id] }),
  location: one(locations, { fields: [batches.locationId], references: [locations.id] }),
  movements: many(stockMovements),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  product: one(products, { fields: [stockMovements.productId], references: [products.id] }),
  location: one(locations, { fields: [stockMovements.locationId], references: [locations.id] }),
  batch: one(batches, { fields: [stockMovements.batchId], references: [batches.id] }),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  lines: many(purchaseOrderLines),
}));

export const purchaseOrderLinesRelations = relations(purchaseOrderLines, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderLines.purchaseOrderId], references: [purchaseOrders.id],
  }),
  product: one(products, { fields: [purchaseOrderLines.productId], references: [products.id] }),
}));

export const countSessionsRelations = relations(countSessions, ({ one, many }) => ({
  location: one(locations, { fields: [countSessions.locationId], references: [locations.id] }),
  lines: many(countLines),
}));

export const countLinesRelations = relations(countLines, ({ one }) => ({
  session: one(countSessions, {
    fields: [countLines.countSessionId], references: [countSessions.id],
  }),
  product: one(products, { fields: [countLines.productId], references: [products.id] }),
  batch: one(batches, { fields: [countLines.batchId], references: [batches.id] }),
}));
