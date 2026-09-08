# Inventory — complete field and screen specification

Everything a designer needs to lay out this product: every screen, every field,
every option in every picker, and which figures are computed rather than typed.

Taken from the live schema (`src/db/schema.ts`), the route guards, and
`src/components/nav-items.ts`. This file is the portable copy — hand it over
whole rather than copying from a rendered page.

---

## 1. What the product does

Tells a store owner **what is about to expire**, without them counting anything
by hand. It is for independent European grocers and small supermarkets.

Stock changes from exactly three events, all of which staff already have a
reason to perform:

| Event | Captures |
|---|---|
| **Receiving** — a delivery arrives | Product, quantity, batch, expiry date, unit cost |
| **Counting** — a scheduled shelf count | Actual quantity on the shelf |
| **Checkout** — a sale is rung up | Product, quantity, price, VAT, tender type |

There is **no standalone write-off screen**. Loss is found by counting, not
logged in the moment: a count is a *shrinkage audit*, the gap between what the
ledger says should be on the shelf and what physically is. There is a fourth,
manager-only path — **correcting a keying error** (100 cases received instead of
10) — which is about typos, not loss, and requires a written sentence rather
than a reason code.

---

## 2. Roles

Roles nest: owner ⊃ manager ⊃ staff.

| Role | Can do | Cannot see |
|---|---|---|
| **staff** | Sell at the till, receive deliveries, count shelves, browse products and suppliers, read reports, view sales | Cost price, margin, inventory value, Insights, Categories, Settings |
| **manager** | All of the above, plus create/edit products, import a catalogue, manage categories and suppliers, correct stock, void a sale, see Insights and all money figures | Store details, team, VAT rates |
| **owner** | Everything, plus store settings, team and invitations, VAT rate configuration | — |

**The dividing line is money.** Cost and margin are manager+. A staff member on
the floor sees quantities, shelf prices and expiry dates — never what the shop
paid or what it makes.

**Accounts are created by invitation.** No self-serve signup. An owner invites
an email and picks its role; the person becomes a member on first sign-in.
Sign-in is a password *or* an emailed magic link — design for both.

---

## 3. Navigation

One source of truth (`src/components/nav-items.ts`) feeds three surfaces.

### Phone — bottom tab bar (5 items)

Today · Checkout · Receive · Count · **More**

Four destinations plus More, not nine: the first four are what a shop does every
day. A launcher with nine equal buttons makes the frequent things as hard to
reach as the rare ones. Everything else lives behind More.

### Desktop — sidebar (13 items, role-filtered)

The sidebar lists everything, so More has nothing left to point at and is not
shown.

| Group | Items |
|---|---|
| *(ungrouped, top)* | Today · Checkout · Receive · Count |
| **Catalogue** | Products `staff` · Suppliers `staff` · Categories `manager` |
| **Insight** | Sales `staff` · Insights `manager` · Reports `staff` |
| **Settings** | Store `owner` · Team `owner` · VAT rates `owner` |

Items the current role cannot use are hidden. Hiding is presentation; the server
checks the role again behind every screen.

---

## 4. Screen inventory

| Route | Screen | Access | What it is |
|---|---|---|---|
| `/` | Today | staff | Inventory-health KPIs, then the expiry-risk list. Home. |
| `/checkout` | Checkout | staff | The till. Scan or search, build a basket, take cash or card. |
| `/receive` | Receive | staff | Log a delivery: expiry, quantity, lot, cost. |
| `/count` | Count | staff | Cycle counting — a due-by-section queue, then scan-and-enter. |
| `/count/review` | Count review | staff | Variance before posting. The only write in the flow. |
| `/products` | Products | staff | Searchable catalogue. Stacked rows on phone, table on desktop. |
| `/products/[id]` | Product detail | staff | Stock, batches, movements, margin, days of cover. |
| `/products/new` | Add product | manager | The full product form. |
| `/products/[id]/edit` | Edit product | manager | Same form, populated. |
| `/products/[id]/correct` | Correct stock | manager | Fix a keying error. Needs a written reason. |
| `/products/import` | CSV import | manager | Bulk catalogue load. All-or-nothing. |
| `/suppliers` | Suppliers | staff | List. |
| `/suppliers/[id]` | Supplier detail | manager | Contact, lead time, products supplied. |
| `/suppliers/new` | Add supplier | manager | |
| `/categories` | Categories | manager | Flat list: icon, description, count frequency. |
| `/categories/[id]` | Category detail | manager | Product count, total stock, average margin. |
| `/categories/new` | Add category | manager | |
| `/sales` | Sales | staff | Completed and voided sales. |
| `/sales/[id]` | Receipt | staff | Lines, VAT broken out by band, total. |
| `/sales/[id]/void` | Void sale | manager | Whole-sale void. Puts stock back. |
| `/insights` | Insights | manager | Margin, takings trend, top products, dead stock. 7/30/90 days. |
| `/reports` | Reports | staff | Four reports, each with CSV export. |
| `/reports/[slug]` | Report detail | staff | Headline figure + table + CSV. |
| `/settings/store` | Store | owner | Name, country, currency, timezone, contact, VAT number. |
| `/settings/team` | Team | owner | Members, roles, invitations. |
| `/settings/vat` | VAT rates | owner | Rate per band for this store's country. |
| `/more` | More | staff | Phone-only menu for everything outside the tab bar. |
| `/sign-in` | Sign in | public | Password or emailed link. |

---

## 5. Product

The form with the most fields.

| Field | Type | | Notes for the screen |
|---|---|---|---|
| `name` | text | **required** | The identifying line of every row in the app. |
| `gtin` | text | optional | Unit barcode, EAN-8 or EAN-13. Null for loose goods. |
| `caseGtin` | text | optional | Carton barcode — GTIN-12/13/14, usually printed ITF-14. Separate from the unit barcode. |
| `unitsPerCase` | numeric(10,3) | optional | Decimal on purpose: 0.5 kg tubs, six to a tray. |
| `sku` | text | optional | The shop's own article number. |
| `categoryId` | → Category | optional | Drives count scheduling and report breakdowns. |
| `supplierId` | → Supplier | optional | |
| `unit` | enum | **required** | `each` · `kg` · `g` · `l` · `ml`. Default `each`. |
| `isWeighed` | boolean | **required** | Sold loose by weight. Changes the till: no barcode, priced per kg, quantity has no sensible default. |
| `costPrice` | numeric(12,4) | optional | **Net** — ex-VAT, as on a supplier invoice. Manager+ only. |
| `sellPrice` | numeric(12,4) | optional | **Gross** — the shelf price, VAT included. |
| `vatBand` | enum | **required** | `standard` · `reduced` · `super_reduced` · `zero`. Default `zero`. |
| `dateType` | enum | **required** | `use_by` · `best_before`. Legally distinct — see below. |
| `minStock` | numeric(14,3) | optional | Feeds the low-stock report. |
| `maxStock` | numeric(14,3) | optional | |
| `shelfLifeDays` | integer | optional | Pre-fills the expiry date at receiving, with its source stated. |
| `countFrequency` | enum | optional | `weekly` · `biweekly` · `monthly` · `quarterly`. Falls back to the category default, then monthly. |
| `isActive` | boolean | **required** | Deactivate rather than delete — the ledger references it forever. |

> **Use-by and best-before are not interchangeable.** Selling past a *use-by*
> date is a criminal offence in the UK, so the till refuses to allocate stock
> from an expired use-by batch. Past *best-before* is routine — advisory, never
> a block. Any expiry UI must say which one it is showing.

---

## 6. Batch and the stock ledger

Stock is addressed as **(product, location, batch)**. A batch is one delivery of
one product with one expiry date. Every tenant has one location today.

### Batch

| Field | Type | | Notes |
|---|---|---|---|
| `productId` | → Product | **required** | |
| `lotNumber` | text | optional | The supplier's own lot code, off the box. |
| `expiryDate` | date | optional | Null is allowed — ambient goods often carry none. |
| `dateType` | enum | **required** | Copied from the product at receipt, never chosen per delivery. |
| `unitCost` | numeric(12,4) | optional | Net. What this particular delivery cost. |
| `receivedAt` | timestamp | auto | |

Deliveries matching on product + location + expiry + lot **merge into one batch**
rather than creating duplicates.

### Stock movement — append-only

| Field | Type | Notes |
|---|---|---|
| `quantityDelta` | numeric(14,3) | Signed. Positive adds, negative removes. Never zero. |
| `movementType` | enum | `receipt` · `consumption` (a sale) · `count_adjustment` · `manual_adjustment` · `waste` (legacy; nothing writes new ones) |
| `reasonCode` | enum | `expired` · `damaged` · `theft` · `staff_use` · `sampling` · `supplier_return` · `correction` · `other` |
| `referenceType` / `referenceId` | enum + uuid | Points back at the sale, count session or manual action that caused it. |
| `actorId` | uuid | Who did it. |
| `note` | text | Free text. A correction's written reason lives here. |
| `occurredAt` | timestamp | When it happened, not when it was recorded. |

> **Nothing here is ever edited or deleted.** A mistake is corrected by posting
> an opposite movement, so history stays intact. Design implication: there is no
> "edit this movement" affordance anywhere, and a product's history is a
> permanent append-only list.

---

## 7. Supplier

| Field | Type | | Notes |
|---|---|---|---|
| `name` | text | **required** | |
| `contactName` | text | optional | |
| `email` | text | optional | |
| `phone` | text | optional | |
| `leadTimeDays` | integer | **required** | Default 3. |
| `minOrderValue` | numeric(12,4) | optional | Held for later; no ordering flow reads it today. |
| `deliveryWeekdays` | smallint[] | optional | Which days they deliver — a weekday multi-select. |
| `isActive` | boolean | **required** | |

---

## 8. Category

| Field | Type | | Notes |
|---|---|---|---|
| `name` | text | **required** | "Dairy & chilled", "Dry goods". |
| `description` | text | optional | |
| `icon` | text | optional | An emoji, shown before the name in lists. |
| `defaultCountFrequency` | enum | **required** | Inherited by products that don't set their own. Default monthly. |

Category detail also shows three computed rollups: product count, total stock on
hand, average margin.

---

## 9. Sale and sale line

**Sale:** `saleNumber` · `status` (completed / voided) · `subtotal` (net) ·
`vatTotal` · `total` (gross) · `tenderType` (cash / card) · `soldBy` ·
`voidedAt` / `voidedBy` · `source` (till / epos_now) · `occurredAt`

**Sale line:** `productId` · `quantity` · `unitPrice` (gross) · `vatBand` ·
`vatAmount` · `lineTotal` (gross)

> **The VAT convention, because it is easy to get backwards.** Shelf prices and
> line totals are **gross** — VAT already included. Cost prices and the sale
> subtotal are **net**. VAT is the remainder between them, never a number added
> on top. A basket of a £1.20 milk and a £1.20 chocolate bar totals **£3.60**,
> exactly the sum of the shelf prices, whatever their VAT bands. A receipt shows
> VAT broken out per band, because a refund must be given at the rate charged.

Only whole-sale voids exist — no partial or line-level refunds. Cash and card
are recorded as tender type only; there is no real payment processing.

---

## 10. Count session and count line

| Field | Type | Notes |
|---|---|---|
| `name` | text | What is being counted — "Chiller shelf 3". |
| `scopeType` | enum | `full` · `category` · `supplier` · `custom` |
| `status` | enum | `in_progress` · `completed` · `cancelled` |
| `startedBy` / `startedAt` | uuid + timestamp | Sessions are per-person and resumable. |
| `expectedQuantity` | numeric(14,3) | Per line. Captured at scan time, not at posting. |
| `countedQuantity` | numeric(14,3) | Per line. What was actually on the shelf. |

> **Two people counting at once is the normal case.** Each has their own
> session; a product already on someone else's open count cannot be counted
> twice, and the UI must say whose. A count left open by someone who went home
> must be reachable and closable by whoever is on shift.

---

## 11. Store, team and VAT

| Field | Type | Notes |
|---|---|---|
| `name` | text | Shown in the header on every screen. |
| `countryCode` | char(2) | Seeds the VAT bands. |
| `currencyCode` | char(3) | Every money figure formats to this. EUR default. |
| `timezone` | text | |
| `email` / `phone` / `address` | text | Store contact details. |
| `vatNumber` | text | |
| `vatRates[].band` + `.rate` | enum + numeric(5,4) | Stored as a fraction — `0.20`, not `20`. Per band, per store. |
| `members[].role` | enum | owner / manager / staff. The last owner cannot demote or remove themselves. |
| `invitations[].email` + `.role` | text + enum | Pending until first sign-in. |

> **No hardcoded VAT anywhere.** Rates are per-store rows seeded from the
> country. Never label a field "20% VAT" — the band is named, the rate is data.

---

## 12. Computed figures — never typed in

Calculated from the ledger on every read. Displayable anywhere, but there is no
form field behind them — and several can legitimately be **unknown**, which
needs its own treatment.

| Figure | Means | When it is unknown |
|---|---|---|
| quantity on hand | Sum of every movement for a product, or one batch. | Never — worst case zero, and it can go negative. |
| `daysRemaining` | Days until a batch's expiry. Negative means already expired. | When the batch has no expiry date. |
| `valueAtRisk` | Quantity × unit cost for a batch near expiry. The headline figure on Today. | When the batch has no cost. |
| margin % | Net sell against net cost — *not* shelf price minus cost, which overstates it by the VAT rate. | When either price is missing. |
| daily consumption rate | From real till sales; count-to-count where there are none. | Often. Carries a confidence: `insufficient` · `low` · `medium` · `high`. |
| days of cover | On hand ÷ daily rate. | Whenever the rate is unknown. Show "not enough data yet", never a guess. |
| variance | Counted − expected. Negative is shrinkage, positive is found stock. | Never. |
| days overdue | How long past its count frequency a product is. | Never counted reads as *due now*, not infinitely overdue. |

---

## 13. Every picker in the product

| Picker | Options | Default |
|---|---|---|
| Unit | each · kg · g · l · ml | each |
| VAT band | standard · reduced · super_reduced · zero | zero |
| Date type | use_by · best_before | use_by |
| Count frequency | weekly · biweekly · monthly · quarterly | monthly |
| Tender | cash · card | — |
| Role | owner · manager · staff | — |
| Movement type | receipt · consumption · count_adjustment · manual_adjustment · waste | — |
| Reason code | expired · damaged · theft · staff_use · sampling · supplier_return · correction · other | — |
| Sale status | completed · voided | completed |
| Count scope | full · category · supplier · custom | full |
| Count status | in_progress · completed · cancelled | in_progress |
| Location type | store · backroom · warehouse | store |
| Report period | 7 · 30 · 90 days | 30 |

---

## 14. CSV import — accepted column headers

A shop arriving with 2,000 products will not type them in. Headers are matched
loosely, including German names, because the input is wholesaler exports rather
than a template.

| Maps to | Header names accepted |
|---|---|
| `name` | name, product, productname, itemname, item, description, artikel, artikelname, bezeichnung |
| `gtin` | gtin, barcode, ean, ean13, upc, unitbarcode |
| `caseGtin` | casegtin, casebarcode, outerbarcode, outer, itf14 |
| `unitsPerCase` | unitspercase, packsize, casesize, perkarton |
| `sku` | sku, article, articleno, artikelnummer, code |
| `unit` | unit, uom, einheit |
| `costPrice` | cost, costprice, buyprice, ek, einkaufspreis |
| `sellPrice` | price, sellprice, retail, vk, verkaufspreis |
| `vatBand` | vatband, vat, vatrate, vatcode, taxcode, taxband, mwst |
| `minStock` | min, minstock, minimum |
| `shelfLifeDays` | shelflife, shelflifedays, mhd, haltbarkeit |
| `supplier` | supplier, vendor, lieferant |

> **Import is all-or-nothing, and the screen must say so first.** A failed
> import changes nothing. Errors are grouped by *problem*, not by row — "312
> prices use a comma" with the fix, not 312 separate errors. Rows match on
> barcode, so re-importing the same file updates rather than duplicating.

---

## 15. The four reports

| Report | Answers | Columns |
|---|---|---|
| Stock on hand | What I hold and what it is worth | product · barcode · on hand · unit · unit cost · value · incl. VAT |
| Expiry exposure | Money about to stop being sellable | product · expires · days left · lot · quantity · at risk |
| Low stock | What is under its minimum, and who to call | product · barcode · on hand · minimum · unit · supplier |
| Sales | What sold and what it brought in | product · barcode · quantity · unit · VAT · revenue |

Every report exports to CSV, and the export is re-importable. Expiry and Sales
are period-bounded (7 / 30 / 90 days); Stock and Low stock are point-in-time.

---

## 16. Four states per screen

A screen with only its success state is not finished. Each is a deliverable.

- **Loading** — skeletons mirroring the final row exactly (same height, same columns) so nothing shifts when data lands. Never a centred spinner.
- **Empty** — name the good news, then hand over the next job. *"Nothing expiring — not a single batch in the next 14 days. Keep it that way: the dairy shelf is due a count."*
- **Error** — what failed, reassurance about the data, one button. Never a raw exception.
- **Success** — the content. After a write, the affected row appears at the top of the list rather than a toast that vanishes.

---

## 17. Layout rules that constrain design

Two contexts. Every screen belongs to one, and that decides the layout.

**The aisle — phone.** Receiving, counting, scanning. One-handed, possibly
gloved, under bad fluorescent light, holding a product in the other hand.
44px minimum touch targets · primary action in the bottom third · one primary
action per screen · never a modal mid-scan.

**Back office — desktop.** Checkout, products, suppliers, reports, settings.
Denser scale (root font drops to 14px at `md`) · tables on desktop, stacked rows
on mobile · never a horizontally scrolling table.

The density switch stops exactly at that line: aisle screens keep full-size text
and 44px targets regardless of what any desktop reference shows, because those
are an accessibility requirement under the European Accessibility Act.

**Colour has exactly two meanings.** Warm hue = state of the world (expiry
urgency). Cool hue = your move (button, focus ring, active tab, link). They
never overlap. A headline figure like "€604 at risk" is **not red** — it is a
fact, not an alarm. "Complete" is **not green**.

**The urgency ladder — icon, word and hue, always all three**, because roughly
one man in twelve has red–green colour vision deficiency and this app's entire
signal is red–green:

| Tier | Form | Example |
|---|---|---|
| expired / negative stock | filled chip, tinted background | "Expired 2 days ago" |
| ≤ 3 days | tinted text + icon, no chip | "1 day left" |
| ≤ 14 days | muted text + icon | "9 days left" |
| beyond 14 days | plain text, no colour, no icon | "28 Aug" |

**Numbers:** number before label (`12 expiring`, not `Expiring: 12`) · unit
de-emphasised to 70% opacity · money through `Intl.NumberFormat` with the tenant
currency · three decimals for weighed goods (`0.750 l`) · `tabular-nums`,
right-aligned.

---

## 18. Do not design these

Several were **built and then deliberately removed**, so a reference design
showing them is not evidence they should return.

- **Reorder suggestions and purchase orders** — built, then pulled. The product answers "what is expiring", not "what should I order".
- **A standalone write-off screen** — also built and pulled. Loss surfaces through a count; that is the core thesis.
- **Real card processing** — tender type is recorded, nothing is charged.
- **Partial or line-level refunds** — whole-sale void only.
- Promotions or a pricing engine · shelf-edge label printing · accounting integrations · multi-location transfers · supplier portal · demand forecasting · offline mode · native apps · self-serve signup.

### Two genuinely open questions

- **Scale-printed barcodes.** A counter scale prints an EAN-13 in the GS1 restricted range encoding an item number plus a weight or a price — a per-country, per-vendor convention with no single standard. Decoding it wrong sells a €40 cheese for €4. Needs a real scale and a real store.
- **The cold start.** A shop facing a 2,000-product setup in week one is the biggest churn risk in the product. Unsolved.
