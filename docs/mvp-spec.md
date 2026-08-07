# Inventory Management SaaS — MVP Specification

**Target:** Independent grocery stores & small supermarkets, EU
**Model:** Multi-tenant SaaS, manually onboarded design partners first
**Platform:** Web app, mobile-responsive (phone browser is the in-store device)
**Depletion model:** Count-driven — no POS integration, no sales entry
**Date:** August 2026

---

## 1. Product thesis

An independent grocer's real pain is not "I don't know what I have." It's **spoilage and stockouts**. Fresh product expires unnoticed; fast movers run out on a Saturday. Everything in this MVP serves one sentence:

> *Tell the owner what's about to expire and what to order, without them counting anything by hand.*

Any feature that doesn't feed that sentence is a candidate for cutting.

---

## 2. The count-driven model

**Staff never record sales.** Stock changes only from three events they already have a reason to perform:

| Event | Trigger | Captures |
|---|---|---|
| **Receiving** | A delivery arrives | Product, quantity, batch, expiry date, cost |
| **Waste** | Something is binned | Product, quantity, reason code |
| **Counting** | Scheduled cycle count | Actual quantity on shelf |

Sales are **derived, never entered**:

```
consumption = opening count + receipts − waste − closing count
```

After two or three count cycles you have a real consumption rate per product, which is what drives reorder suggestions anyway. This is how physical inventory has worked for a century; you're just making it fast.

### Why this is acceptable

The core value prop is **completely independent of sales data**. A batch received on the 3rd with 10 days' shelf life expires on the 13th whether or not the system knows what sold. The expiry dashboard — the feature that sells the product — works at full fidelity with zero sales input.

### What it costs

On-hand quantities drift between counts. Low-stock alerts are therefore only as fresh as the last count of that product. The mitigation is not "count more" — it's **cycle counting**: fast movers and fresh categories weekly, ambient and slow stock monthly. Scanning one shelf section must take two minutes, not an afternoon. That is a UX problem you can solve. POS integration is a partnership problem you cannot.

### Keeping the door open

All stock depletion goes through a single internal interface (`StockDepletionSource`). The MVP has exactly one implementation: count reconciliation. A CSV sales importer or a real POS connector later becomes a second implementation, not a rewrite.

---

## 3. Architectural decisions (make these now, they're expensive later)

| Decision | Choice | Why |
|---|---|---|
| Tenancy | `organization_id` on every table + Postgres Row-Level Security | Retrofitting isolation is a rewrite. Adding it now is nearly free. |
| Stock model | `(product, location, batch) → quantity` | Every tenant has one location today. Chains later need many. Same schema, no migration. |
| Stock mutation | Append-only `stock_movements` ledger; quantities are derived | Auditability, EU traceability, and you can always reconstruct history. Never `UPDATE quantity`. |
| Depletion | Behind a `StockDepletionSource` interface | Lets POS or CSV drop in later without touching the ledger. |
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
Scan, quantity, reason code (expired, damaged, theft, staff use). Feeds the waste report and the consumption calculation.

**7. Cycle counting** *(now load-bearing — see §2)*
Count sessions scoped to a shelf section, category, or supplier. Scan-and-enter, resumable, works with a flaky connection. Each product carries a count frequency; a "due for count" queue surfaces what's overdue. Variance report shows expected vs counted with value impact, and posts adjustments to the ledger. Counting must be genuinely fast — this is the highest-leverage UX work in the whole build.

**8. Consumption calculation**
Derives per-product daily consumption rate from count-to-count deltas. Needs at least two counts before it produces a number; show "not enough data yet" rather than a wrong number. Handles the edge case where a count session covers only part of the catalog.

**9. Suppliers**
Name, contact, email, lead time in days, minimum order value, delivery days.

**10. Purchase orders**
Create PO (manual or from reorder suggestions), line items with cost, email PDF to supplier, receive against PO with partial delivery support, capture batch + expiry at receipt, flag discrepancies.

**11. Reorder suggestions**
Products below min level, using consumption rate × supplier lead time, accounting for stock on hand and quantities already on open POs. Grouped by supplier, one click to a draft PO. No forecasting — simple rate × lead time with a safety buffer.

**12. Reports**
Four, no more: stock on hand + value, waste by reason and period, expiry exposure, low stock. CSV export on each.

**13. VAT configuration**
Tenant picks country; standard and reduced bands seeded. Products assigned a band. Used in valuation, not invoicing — you are not building a tax engine.

---

### Explicitly OUT of the MVP

POS integration · CSV sales import · per-sale entry · Stripe billing and self-serve signup · multi-location stock transfers (schema supports, no UI) · demand forecasting / AI reorder · shelf-edge label printing · native mobile apps · full offline mode · supplier portal · promotions and pricing engine · accounting integrations (DATEV, Exact) · returns to supplier · custom report builder

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
2. **Will staff actually count?** The entire model rests on this. Validate it with a real store before phase 2 — sit in and time someone counting a shelf section on their phone. If it takes 20 minutes instead of 2, the model needs rethinking.
3. **Default count frequencies.** Fresh/chilled weekly, ambient monthly is a reasonable default, but confirm against how a real store thinks about its sections.
4. **Kg/loose goods.** Weighed items (deli, produce) don't have a fixed EAN and don't scan cleanly. Decide whether MVP handles them or explicitly ignores them.
5. **Who does data entry at onboarding?** If a store must build a 2,000-SKU catalog before seeing value, they'll churn in week one. Consider an EAN lookup service or doing the import for them.
6. **Pricing?** Not needed for the build, but it shapes what "enough value" means. Comparable tools sit around €50-150/store/month.

---

## 8. Working with Claude Code

See `CLAUDE.md` at the repo root — it carries the stack, the RLS tenancy pattern, the append-only ledger rule, naming conventions, and the commands. Claude Code will otherwise re-derive these each session and drift.

Build phase by phase, one PR per feature area, and keep the schema in a single reviewed migration set. The data model comes first — everything else is downstream of it.
