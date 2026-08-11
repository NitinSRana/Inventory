// Builds a demo shop with enough history that every screen has something to show.
//
//   pnpm seed                      -> creates/resets "Demo Grocer"
//   pnpm seed you@example.com      -> also adds you to it as owner
//
// Runs through the real server layer rather than raw SQL, so the data it
// produces is data the app could have produced — including the ledger rows and
// count sessions that consumption rates are derived from. A demo built by
// INSERTing totals would hide exactly the bugs this app is about.
import postgres from 'postgres';

import { createProduct } from '@/server/catalog/products';
import { createSupplier } from '@/server/catalog/suppliers';
import { completeCountSession, recordCount, startCountSession } from '@/server/counting/sessions';
import { recalculateConsumptionRates } from '@/server/consumption/calculate';
import { createPurchaseOrder, markPurchaseOrderSent } from '@/server/purchasing/orders';
import { seedVatRatesForCountry } from '@/server/settings/vat';
import { receiveStock, recordWaste } from '@/server/stock/movements';

const ORG_NAME = 'Demo Grocer';
const email = process.argv[2];
const sql = postgres(process.env.ADMIN_DATABASE_URL!, { prepare: false, max: 1 });
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

// A fresh demo every time: reruns should not pile duplicate stock onto an org
// that already has some.
const [existing] = await sql`select id from organizations where name = ${ORG_NAME}`;
if (existing) {
  // Deleting an organization cascades into stock_movements, and the append-only
  // trigger refuses that — correctly. Nothing in the app should ever delete a
  // ledger row, so the trigger is suspended here, for one statement, by the
  // owner connection, and only ever for the demo tenant.
  //
  // Note what this implies: a real tenant cannot currently be erased. That is a
  // GDPR question, not a seeding one, and it needs its own answer.
  await sql.begin(async (tx) => {
    await tx`alter table stock_movements disable trigger stock_movements_append_only`;
    await tx`delete from organizations where id = ${existing.id}`;
    await tx`alter table stock_movements enable trigger stock_movements_append_only`;
  });
  console.log(`removed the previous ${ORG_NAME}`);
}

const [org] = await sql`
  insert into organizations (name, country_code, currency_code)
  values (${ORG_NAME}, 'DE', 'EUR') returning id`;
const orgId = org.id as string;
await sql`insert into locations (organization_id, name, is_default) values (${orgId}, 'Shop floor', true)`;
await seedVatRatesForCountry(orgId, 'DE');

const suppliers = {
  molkerei: await createSupplier(orgId, {
    name: 'Molkerei Nord', leadTimeDays: 2, email: 'orders@molkerei-nord.example', minOrderValue: '50.0000',
  }),
  backerei: await createSupplier(orgId, {
    name: 'Bäckerei Süd', leadTimeDays: 1, email: 'bestellung@baeckerei-sued.example',
  }),
  grosshandel: await createSupplier(orgId, {
    name: 'Großhandel West', leadTimeDays: 5, email: 'orders@gh-west.example', minOrderValue: '150.0000',
  }),
};

// name, barcode, cost, sell, unit, shelf life, supplier, min stock
const CATALOGUE = [
  ['Vollmilch 3,5% 1L', '4001234567891', '0.7900', '1.19', 'l', 10, 'molkerei', '40'],
  ['Milch, fettarm 1L', '4006381333931', '0.7500', '1.09', 'l', 10, 'molkerei', '30'],
  ['Bio Joghurt natur 500g', '5901234123457', '0.9500', '1.49', 'each', 21, 'molkerei', '24'],
  ['Butter 250g', '96385074', '1.8500', '2.79', 'each', 30, 'molkerei', '20'],
  ['Frischkäse Kräuter 200g', '4012345678901', '1.2000', '1.99', 'each', 14, 'molkerei', '12'],
  ['Gouda jung 400g', '4012345678918', '2.4000', '3.79', 'each', 45, 'molkerei', '10'],
  ['Bauernbrot 750g', '4012345678925', '1.4000', '2.49', 'each', 3, 'backerei', '15'],
  ['Vollkornbrötchen 6er', '4012345678932', '0.9000', '1.79', 'each', 2, 'backerei', '20'],
  ['Croissant', '4012345678949', '0.4500', '0.99', 'each', 2, 'backerei', '30'],
  ['Eier Freiland 10er', '4012345678956', '2.1000', '3.29', 'each', 21, 'grosshandel', '18'],
  ['Bananen', '4012345678963', '1.1000', '1.99', 'kg', 7, 'grosshandel', '25'],
  ['Äpfel Elstar', '4012345678970', '1.6000', '2.49', 'kg', 14, 'grosshandel', '20'],
  ['Kartoffeln 2,5kg', '4012345678987', '1.9000', '2.99', 'each', 60, 'grosshandel', '15'],
  ['Spaghetti 500g', '4012345678994', '0.6500', '1.29', 'each', 540, 'grosshandel', '24'],
  ['Passierte Tomaten 500g', '4012345679007', '0.7000', '1.19', 'each', 400, 'grosshandel', '30'],
  ['Olivenöl 500ml', '4012345679014', '4.2000', '6.99', 'ml', 540, 'grosshandel', '8'],
  ['Kaffee gemahlen 500g', '4012345679021', '3.8000', '5.99', 'each', 300, 'grosshandel', '12'],
  ['Mineralwasser 6x1,5L', '4012345679038', '2.4000', '3.49', 'each', 400, 'grosshandel', '20'],
] as const;

const products: Record<string, { id: string; cost: string }> = {};
for (const [name, gtin, cost, sell, unit, shelf, supplier, min] of CATALOGUE) {
  const p = await createProduct(orgId, {
    name, gtin, costPrice: cost, sellPrice: sell,
    unit: unit as 'each' | 'kg' | 'g' | 'l' | 'ml',
    shelfLifeDays: shelf, minStock: min,
    // Fresh weekly, ambient monthly — CLAUDE.md's stated placeholder, and what
    // makes the due-for-count queue mean anything.
    countFrequency: shelf <= 21 ? 'weekly' : 'monthly',
    supplierId: suppliers[supplier as keyof typeof suppliers].id,
    vatBand: 'reduced',
  });
  products[name] = { id: p.id, cost };
}
console.log(`${CATALOGUE.length} products`);

// Opening stock 21 days ago, so there is history to derive rates from.
for (const [name, , , , , shelf] of CATALOGUE) {
  await receiveStock(orgId, {
    productId: products[name].id,
    quantity: '40',
    expiryDate: inDays(Math.min(shelf, 120)),
    unitCost: products[name].cost,
    occurredAt: daysAgo(21),
  });
}

// First count, backdated, so a count-to-count window exists.
const first = await startCountSession(orgId, { name: 'Opening count' });
for (const [name] of CATALOGUE) {
  await recordCount(orgId, { countSessionId: first.id, productId: products[name].id, countedQuantity: '40' });
}
await completeCountSession(orgId, first.id);
await sql`update count_lines set counted_at = ${daysAgo(14)} where count_session_id = ${first.id}`;

// A fortnight of trading: deliveries, a little waste, then a closing count that
// is lower — which is what consumption is derived from.
for (const [name, , , , , shelf] of CATALOGUE) {
  await receiveStock(orgId, {
    productId: products[name].id, quantity: '30',
    expiryDate: inDays(Math.min(shelf, 60)),
    unitCost: products[name].cost, occurredAt: daysAgo(7),
  });
}
for (const name of ['Bauernbrot 750g', 'Croissant', 'Bananen']) {
  await recordWaste(orgId, {
    productId: products[name].id, quantity: '4', reasonCode: 'expired', occurredAt: daysAgo(5),
  });
}

// A real cycle count covers a section, not the whole shop — so three fresh
// items are deliberately left uncounted and fall due.
const SKIPPED = ['Croissant', 'Bauernbrot 750g', 'Vollkornbrötchen 6er'];
const second = await startCountSession(orgId, { name: 'Chiller and ambient' });
for (const [name] of CATALOGUE) {
  if (SKIPPED.includes(name)) continue;
  await recordCount(orgId, { countSessionId: second.id, productId: products[name].id, countedQuantity: '22' });
}
await completeCountSession(orgId, second.id);
await recalculateConsumptionRates(orgId);

// Stock that is about to go off, so the dashboard has something to say.
const expiring: [string, number, string][] = [
  ['Bauernbrot 750g', -2, '6'],
  ['Croissant', 1, '14'],
  ['Vollkornbrötchen 6er', 2, '9'],
  ['Frischkäse Kräuter 200g', 5, '7'],
  ['Bio Joghurt natur 500g', 11, '12'],
];
for (const [name, days, qty] of expiring) {
  await receiveStock(orgId, {
    productId: products[name].id, quantity: qty,
    expiryDate: inDays(days), unitCost: products[name].cost, occurredAt: daysAgo(1),
  });
}

// One order already placed, so /orders and on-order maths are not empty.
const po = await createPurchaseOrder(orgId, {
  supplierId: suppliers.molkerei.id,
  lines: [
    { productId: products['Vollmilch 3,5% 1L'].id, quantity: '48', unitCost: '0.7900' },
    { productId: products['Butter 250g'].id, quantity: '24', unitCost: '1.8500' },
  ],
});
await markPurchaseOrderSent(orgId, po.id);

if (email) {
  const [user] = await sql`select id from auth.users where email = ${email}`;
  if (user) {
    await sql`insert into organization_members (organization_id, user_id, role)
              values (${orgId}, ${user.id}, 'owner')`;
    console.log(`${email} is an owner of ${ORG_NAME}`);
  } else {
    await sql`insert into organization_invitations (organization_id, email, role)
              values (${orgId}, ${email}, 'owner')`;
    console.log(`invited ${email} — they join ${ORG_NAME} on first sign-in`);
  }
} else {
  console.log(`no email given: run "pnpm seed you@example.com" to join ${ORG_NAME}`);
}

console.log(`\n${ORG_NAME} ready: ${CATALOGUE.length} products, 2 completed counts, 1 sent order`);
await sql.end();
process.exit(0);
