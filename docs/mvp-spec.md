# Inventory Management SaaS — MVP Specification

**Target:** Independent grocery stores & small supermarkets, EU
**Model:** Multi-tenant SaaS, manually onboarded design partners first
**Platform:** Web app, mobile-responsive (phone browser is the in-store device)
**Depletion model:** POS-driven — real checkout sales are the primary consumption signal; counting is a shrinkage audit, with count-to-count derivation as the fallback for products with no sale history yet
**Date:** August 2026

---

## 1. Product thesis

An independent grocer's real pain is not "I don't know what I have." It's **spoilage and stockouts**. Fresh product expires unnoticed; fast movers run out on a Saturday. Everything in this MVP serves one sentence:

> *Tell the owner what's about to expire and what to order, without them counting anything by hand.*

Any feature that doesn't feed that sentence is a candidate for cutting.

---

## 2. The POS-driven model

Stock changes from four events staff already have a reason to perform:

| Event | Trigger | Captures |
|---|---|---|
| **Receiving** | A delivery arrives | Product, quantity, batch, expiry date, cost |
| **Waste** | Something is binned | Product, quantity, reason code |
| **Counting** | Scheduled cycle count | Actual quantity on shelf |
| **Checkout** | A sale is rung up | Product, quantity, price, VAT, tender type |

Nobody types in a sale after the fact — that was always the trap ("nobody will enter 300-800 transactions a day"). Checkout records it as a side effect of the till doing its job, the same way receiving records a delivery.

**Consumption is exact where a till exists, derived where it doesn't.** A product with POS sale history gets its daily rate from a trailing window of real `consumption` movements — no inference needed, the ledger already says exactly what left the shelf. A product never rung up through the till (brand new, or a store not yet using checkout for everything) falls back to the original count-to-count formula:

```
consumption = opening count + receipts − waste − closing count
```

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
- **Resend + React Email** — PO emails to suppliers
- **Vercel** (EU region) or Railway

---

## 4. MVP feature list

**1. Auth, organizations, roles**
Email/password + magic link. Three roles: Owner (billing, settings, everything), Manager (products, POs, counts), Staff (scan, receive, count, write off). Manual org creation by you for the first partners.

**2. Product catalog**
EAN/GTIN, name, category, unit (each/kg/L), cost price, sell price, VAT band, supplier, min/max stock levels, shelf life in days, count frequency (weekly/monthly). CSV import — no store will type in 2,000 SKUs.

**3. Stock ledger + batch/expiry tracking**
Every movement is a row: receipt, waste, count adjustment, with reason and actor. Batches carry lot number and expiry date. FEFO (first-expired-first-out) when reconciling counts against batches.

**4. Barcode scanning**
Browser camera, EAN-13/EAN-8. Used in receiving, counting, waste, and lookup. Must work one-handed on a phone in a cold aisle — this is a UX problem, not a technical one.

**5. Expiry dashboard**
The homepage. "Expiring in 3 / 7 / 14 days," sorted by value at risk. Actionable: mark down, move to front, write off. **This is the feature that sells the product.**

**6. Waste / write-off**
Scan, quantity, reason code (expired, damaged, theft, staff use). Feeds the waste report.

**7. Cycle counting**
Count sessions scoped to a shelf section, category, or supplier. Scan-and-enter, resumable, works with a flaky connection. Each product carries a count frequency; a "due for count" queue surfaces what's overdue. Variance report shows expected vs counted with value impact — this is now a **shrinkage audit** (see §2), not the primary consumption source for a product with POS history. Counting must be genuinely fast — this is the highest-leverage UX work in the whole build.

**8. Consumption calculation**
Primary source is a trailing window of real POS `consumption` movements — exact, live, no inference. Falls back to the count-to-count formula only for a product with no sale history yet. Show "not enough data yet" rather than a wrong number either way.

**9. POS checkout**
Scan or search to add a line, running total with VAT computed from the product's VAT band, tender type recorded (cash/card — **no real card processing**, that's a separate later phase). Depletes stock FEFO on completion, same as waste. Whole-sale void only; no partial/line-level refunds. This is now the most frequent action in the app — staff-accessible, primary bottom nav.

**10. Categories**
Flat list, assigned per product, feeds cycle-count scoping (`scopeType: 'category'`) and reporting. Manager+.

**11. Suppliers**
Name, contact, email, lead time in days, minimum order value, delivery days.

**12. Purchase orders**
Create PO (manual or from reorder suggestions), line items with cost, email PDF to supplier, receive against PO with partial delivery support, capture batch + expiry at receipt, flag discrepancies.

**13. Reorder suggestions**
Products below min level, using consumption rate × supplier lead time, accounting for stock on hand and quantities already on open POs. Grouped by supplier, one click to a draft PO. No forecasting — simple rate × lead time with a safety buffer.

**14. Reports**
Five: stock on hand + value, waste by reason and period, expiry exposure, low stock, sales/revenue. CSV export on each.

**15. VAT configuration**
Tenant picks country; standard and reduced bands seeded. Products assigned a band. Used in valuation and at checkout, not invoicing — you are not building a tax engine.

---

### Explicitly OUT of the MVP

Real card/payment processing (Stripe Terminal or similar) · accounting integrations (DATEV, Exact, Xero) · partial/line-level refunds · Stripe billing and self-serve signup · multi-location stock transfers (schema supports, no UI) · demand forecasting / AI reorder · shelf-edge label printing · native mobile apps · full offline mode · supplier portal · promotions and pricing engine · returns to supplier · custom report builder

---

## 5. Remaining scope warning

Dropping POS removed the schedule risk. **Full purchase orders is now the largest single item** — POs with partial deliveries, discrepancy handling, and supplier PDFs is roughly 3-4 weeks on its own.

If you need to hit a date, ship receiving + reorder suggestions first and add PO creation in v1.1. Receiving + alerts delivers most of the owner's time savings for a fraction of the work. If the timeline is flexible, keep POs in.

**Rough estimate:** 8-10 weeks to a pilot-ready build with POs; 6-7 weeks without.

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

---

## 7. Open questions

1. **Do you have a design partner lined up?** Building this without one store willing to use it weekly is the main way this project fails. Now the top risk on the list.
2. **Will staff actually count?** Consumption for a product with POS history no longer depends on this, but shrinkage detection and new-product reorder do. Validate it with a real store — sit in and time someone counting a shelf section on their phone. If it takes 20 minutes instead of 2, the model needs rethinking.
3. **Default count frequencies.** Fresh/chilled weekly, ambient monthly is a reasonable default, but confirm against how a real store thinks about its sections.
4. **Kg/loose goods.** Weighed items (deli, produce) don't have a fixed EAN and don't scan cleanly. Decide whether MVP handles them or explicitly ignores them.
5. **Who does data entry at onboarding?** If a store must build a 2,000-SKU catalog before seeing value, they'll churn in week one. Consider an EAN lookup service or doing the import for them.
6. **Pricing?** Not needed for the build, but it shapes what "enough value" means. Comparable tools sit around €50-150/store/month.

---

## 8. Working with Claude Code

See `CLAUDE.md` at the repo root — it carries the stack, the RLS tenancy pattern, the append-only ledger rule, naming conventions, and the commands. Claude Code will otherwise re-derive these each session and drift.

Build phase by phase, one PR per feature area, and keep the schema in a single reviewed migration set. The data model comes first — everything else is downstream of it.
