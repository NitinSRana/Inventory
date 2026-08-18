# Inventory Management SaaS — MVP Specification

**Target:** Independent grocery stores & small supermarkets, EU
**Model:** Multi-tenant SaaS, manually onboarded design partners first
**Platform:** Web app, mobile-responsive (phone browser is the in-store device)
**Depletion model:** POS-driven — real checkout sales are the primary consumption signal; counting is a shrinkage audit, with count-to-count derivation as the fallback for products with no sale history yet
**Date:** August 2026

---

## 1. Product thesis

An independent grocer's real pain is not "I don't know what I have." It's **spoilage going unnoticed**. Fresh product expires without anyone seeing it coming. Everything in this MVP serves one sentence:

> *Tell the owner what's about to expire, without them counting anything by hand.*

Reorder suggestions and purchase order management were built, then removed as a deliberate product decision — see §4 and the "Explicitly OUT" list. This section describes the product as it stands now, not as originally scoped.

Any feature that doesn't feed that sentence is a candidate for cutting.

---

## 2. The POS-driven model

Stock changes from three events staff already have a reason to perform:

| Event | Trigger | Captures |
|---|---|---|
| **Receiving** | A delivery arrives | Product, quantity, batch, expiry date, cost |
| **Counting** | Scheduled cycle count | Actual quantity on shelf |
| **Checkout** | A sale is rung up | Product, quantity, price, VAT, tender type |

There is no standalone write-off screen. A count's variance *is* the loss: the gap between what the ledger says should be on the shelf and what's physically counted gets posted as a correction, without anyone needing to have logged the loss as it happened.

Nobody types in a sale after the fact — that was always the trap ("nobody will enter 300-800 transactions a day"). Checkout records it as a side effect of the till doing its job, the same way receiving records a delivery.

**Consumption is exact where a till exists, derived where it doesn't.** A product with POS sale history gets its daily rate from a trailing window of real `consumption` movements — no inference needed, the ledger already says exactly what left the shelf. A product never rung up through the till (brand new, or a store not yet using checkout for everything) falls back to the original count-to-count formula:

```
consumption = opening count + receipts − waste − closing count
```

The `waste` term reads whatever the ledger already holds; nothing in the product writes a new `waste`-typed row any more, so it trends to zero for new count windows.

### Counting's job changed

Counting no longer derives consumption for a product with sale history — it audits it. The variance between what the POS-driven ledger says should be on the shelf and what's physically counted is **shrinkage**: theft, spoilage, or a miscount. That's a sharper, more valuable number than a consumption estimate, and it's the reason counting stays in the product even once checkout exists everywhere else.

### Why the expiry dashboard still doesn't need any of this

The core value prop is **independent of where consumption comes from**. A batch received on the 3rd with 10 days' shelf life expires on the 13th whether or not the system knows what sold. The expiry dashboard — the feature that sells the product — works at full fidelity regardless of sales data.

### Keeping the door open — this worked as designed

All stock depletion goes through a single internal interface (`StockDepletionSource`). The MVP shipped with exactly one implementation: count reconciliation. POS checkout is the second implementation, added without touching the ledger, the append-only rule, or the tenancy model — exactly the outcome this section originally described as the goal.

---

## 3. Architectural decisions (make these now, they're expensive later)

| Decision | Choice | Why |
|---|---|---|
| Tenancy | `organization_id` on every table + Postgres Row-Level Security | Retrofitting isolation is a rewrite. Adding it now is nearly free. |
| Stock model | `(product, location, batch) → quantity` | Every tenant has one location today. Chains later need many. Same schema, no migration. |
| Stock mutation | Append-only `stock_movements` ledger; quantities are derived | Auditability, EU traceability, and you can always reconstruct history. Never `UPDATE quantity`. |
| Depletion | Behind a `StockDepletionSource` interface | Let POS drop in later without touching the ledger — it did. |
| VAT | Per-tenant country + configurable rate bands, seeded per country | Country-agnostic launch, no hardcoded German 19%/7%. |
| i18n | `next-intl` from commit one, English-only strings at launch | Cheap now, painful later. |
| Data residency | EU region (Frankfurt) | GDPR posture matters to this buyer. Non-negotiable. |

### Stack

- **Next.js 15 (App Router) + TypeScript** — single codebase, server actions, mobile-responsive
- **Postgres via Supabase** (EU/Frankfurt) — auth, RLS, storage in one
- **Drizzle ORM** — handles RLS and raw SQL better than Prisma for this pattern
- **Tailwind + shadcn/ui** — fast, accessible, works on a phone
- **`html5-qrcode`** — EAN-13/EAN-8 scanning via browser camera
- **`next-intl`** — i18n
- **Resend**, plain HTTPS — invitation emails
- **Vercel** (EU region) or Railway

---

## 4. MVP feature list

**1. Auth, organizations, roles**
Email/password + magic link. Three roles: Owner (billing, settings, everything), Manager (products, counts, insights), Staff (scan, receive, count, sell). Manual org creation by you for the first partners.

**2. Product catalog**
EAN/GTIN (unit and case barcode), name, category, unit (each/kg/L), cost price, sell price, VAT band, supplier, min/max stock levels, shelf life in days, count frequency (weekly/monthly), sold-loose flag for weighed goods. CSV import — no store will type in 2,000 SKUs.

**3. Stock ledger + batch/expiry tracking**
Every movement is a row: receipt, count adjustment, consumption (sale), with reason and actor where relevant. Batches carry lot number and expiry date. FEFO (first-expired-first-out) when reconciling counts against batches.

**4. Barcode scanning**
Browser camera, EAN-8/12/13/14 (unit and case). Used in receiving, counting, and checkout — checkout also accepts a name search, since weighed goods have no barcode to scan. Must work one-handed on a phone in a cold aisle — this is a UX problem, not a technical one.

**5. Expiry dashboard**
The homepage. "Expiring in 3 / 7 / 14 days," sorted by value at risk. **This is the feature that sells the product.**

**6. Cycle counting**
Count sessions scoped to a shelf section, category, or supplier. Scan-and-enter, resumable, works with a flaky connection. Each product carries a count frequency; a "due for count" queue surfaces what's overdue. Variance report shows expected vs counted with value impact — this is a **shrinkage audit** (see §2), not the primary consumption source for a product with POS history, and it is also how loss gets corrected now that there is no separate write-off entry point. Counting must be genuinely fast — this is the highest-leverage UX work in the whole build.

**7. Consumption calculation**
Primary source is a trailing window of real POS `consumption` movements — exact, live, no inference. Falls back to the count-to-count formula only for a product with no sale history yet. Show "not enough data yet" rather than a wrong number either way.

**8. POS checkout**
Scan or search to add a line, running total with VAT computed from the product's VAT band, tender type recorded (cash/card — **no real card processing**, that's a separate later phase). Depletes stock FEFO on completion. Whole-sale void only; no partial/line-level refunds. This is the most frequent action in the app — staff-accessible, primary bottom nav.

**9. Categories**
Flat list, assigned per product, feeds cycle-count scoping (`scopeType: 'category'`) and reporting. Manager+.

**10. Suppliers**
Name, contact, email, lead time in days, minimum order value, delivery days. No purchase order flow reads these fields today — kept for the supplier CSV import match and available if ordering returns.

**11. Reports**
Four: stock on hand + value, expiry exposure, low stock, sales/revenue. CSV export on each.

**12. Insights**
Margin (from real batch cost, not list price), takings trend, top products, dead stock (on hand, unsold in the period), each with a period-over-period comparison. Manager+.

**13. VAT configuration**
Tenant picks country; standard and reduced bands seeded. Products assigned a band. Used in valuation and at checkout, not invoicing — you are not building a tax engine.

---

### Explicitly OUT of the MVP

Real card/payment processing (Stripe Terminal or similar) · accounting integrations (DATEV, Exact, Xero) · partial/line-level refunds · Stripe billing and self-serve signup · multi-location stock transfers (schema supports, no UI) · demand forecasting / AI reorder · shelf-edge label printing · native mobile apps · full offline mode · supplier portal · promotions and pricing engine · returns to supplier · custom report builder

**Removed after being built:** reorder suggestions and purchase order management (create, send, receive against, partial delivery) were implemented and then pulled as a deliberate product decision, along with the standalone write-off screen. The schema still carries what they used — `on_order_quantities`, `stock_movements.reference_type = 'purchase_order'`, the `waste` movement type — untouched; only the application code that created new rows through them is gone. Don't rebuild without confirming the decision has reversed.

---

## 5. Remaining scope warning

Superseded. This section estimated the cost of building full purchase orders (partial deliveries, discrepancy handling, supplier PDFs) as the largest remaining item. That work was done — POs, reorder suggestions, and receiving against an order all shipped — and was then removed as a deliberate product decision (§4, "Explicitly OUT"). Kept here as a historical record of the estimate, not as forward guidance: there is currently no purchasing work in scope to size.

---

## 6. Build sequence

| Phase | Contents |
|---|---|
| 0. Foundation | Repo, Next.js, Supabase EU, schema + RLS, auth, org/user/roles, i18n scaffold, seed data |
| 1. Catalog & stock | Products, CSV import, suppliers, stock ledger, batches, barcode scanning, manual adjustments |
| 2. The value loop | Expiry dashboard, waste/write-off, cycle counting + variance |
| 3. Consumption | Count-to-count consumption rates, low-stock alerts, reorder suggestions |
| 4. Inbound | Receiving with batch+expiry capture, then purchase orders |
| 5. Reports & polish | Four reports + CSV export, mobile UX pass on scanning and counting, error and empty states |
| 6. Pilot | Onboard 3-5 stores manually. Watch them count. Cut features nobody touches. |

Ship phases 0-3 to your first design partner before starting phase 4. Their feedback should decide what phase 4 actually contains.

Historical: this table describes what was planned and largely built. Waste/write-off (phase 2), reorder suggestions (phase 3) and purchase orders (phase 4) were all shipped and then removed — see §4's "Explicitly OUT" note. Treat this table as a record of the original plan, not a description of what to build next.

---

## 7. Open questions

1. **Do you have a design partner lined up?** Building this without one store willing to use it weekly is the main way this project fails. Now the top risk on the list.
2. **Will staff actually count?** Consumption for a product with POS history no longer depends on this, but shrinkage detection and the count-to-count fallback for a brand-new product do. Validate it with a real store — sit in and time someone counting a shelf section on their phone. If it takes 20 minutes instead of 2, the model needs rethinking.
3. **Default count frequencies.** Fresh/chilled weekly, ambient monthly is a reasonable default, but confirm against how a real store thinks about its sections.
4. **Kg/loose goods.** Weighed items (deli, produce) don't have a fixed EAN and don't scan cleanly. Decide whether MVP handles them or explicitly ignores them.
5. **Who does data entry at onboarding?** If a store must build a 2,000-SKU catalog before seeing value, they'll churn in week one. Consider an EAN lookup service or doing the import for them.
6. **Pricing?** Not needed for the build, but it shapes what "enough value" means. Comparable tools sit around €50-150/store/month.

---

## 8. Working with Claude Code

See `CLAUDE.md` at the repo root — it carries the stack, the RLS tenancy pattern, the append-only ledger rule, naming conventions, and the commands. Claude Code will otherwise re-derive these each session and drift.

Build phase by phase, one PR per feature area, and keep the schema in a single reviewed migration set. The data model comes first — everything else is downstream of it.
