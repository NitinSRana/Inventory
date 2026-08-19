# Backlog

Reviewed against `7734f04`, August 2026. Every item names the files, why it matters, and what "done" looks like, so it can be handed to Claude Code as-is.

## How to use this

One item per session. Paste the item's heading and its **Do** block, then `/clear` before the next one — unrelated items should not share a context window.

```
Read docs/backlog.md and CLAUDE.md. Work on P0-1 only.
Use plan mode first. Do not touch anything else in the file.
```

Before merging anything that touches the database or a server action, run `/rls-audit`. Before anything touching prices, VAT or totals, run `/money-audit`. Both are in `.claude/skills/`.

**Read CLAUDE.md's "Removed, not merely never built" section before proposing feature work.** Reorder suggestions, purchase orders and the write-off screen were built and then deliberately pulled. Several items below sit near that boundary and say so.

---

# P0 — Trust in the numbers

Things that make a shopkeeper stop believing the app.

## P0-1 · The till has no undo

`voidSale()` in `src/server/pos/checkout.ts` is implemented and has passing integration tests proving it restores stock exactly. **Nothing in the UI can reach it.** There is also no list of past sales, so a mis-rung sale needs SQL.

This is the first thing a real shop will hit, probably on day one, and a till you cannot correct reads as unfinished software.

**Do**
- Add `/sales` listing recent sales: number, time, tender, total, status.
- Add `/sales/[id]` showing the lines and a Void action (manager only).
- Void asks for confirmation and shows what stock will be restored.
- Voided sales stay visible, marked, never deleted — the ledger is append-only and the list should read the same way.

**Done when** a staff member can find a sale rung up five minutes ago and void it without help, and the stock returns to what it was.

**Effort** ~2 days. The hard part is already built and tested.

---

## P0-2 · A keying error can only be fixed by a full count

`adjustStock()` in `src/server/stock/movements.ts` exists and is unreachable from the UI. With the write-off screen deliberately gone, there is now **no way to correct a mistake at all** except running a count of that product.

Receive 100 cases instead of 10 and the only remedy is a stocktake. That is a real trap, and it is not the same decision as removing the write-off screen — CLAUDE.md's argument was that *loss* should be found by counting, not that *typos* should be.

**Do**
- On `/products/[id]`, manager-only: "Correct stock" → new quantity, required reason, posts a compensating `manual_adjustment` movement.
- Not a write-off. No waste reason codes. The reason is free text explaining the correction.
- Show it in the movement history distinctly from a count adjustment.

**Check first** whether this crosses the line CLAUDE.md draws. My reading is it does not — a compensating correction is exactly what the append-only ledger is designed for — but it is your call, and worth a sentence in CLAUDE.md either way once decided.

**Effort** ~1 day.

---

## P0-3 · Consumption rates are computed and never read

`recalculateConsumptionRates()` runs on every count review (`src/app/[locale]/(app)/count/review/page.tsx`) and writes to `consumption_rates`. Nothing anywhere reads it back. `getConsumptionRate`, `getDaysOfCover`, `consumptionForPeriod` and `suggestedOrderQuantity` have no callers outside their own files and tests.

The reorder screen that consumed them was removed in `3573f13`; this write survived it. So every count does work whose only effect is a database row nobody looks at.

**Decide, don't drift.** Two honest options:

- **Surface it.** Show days-of-cover on `/products/[id]` — "about 9 days left at recent rates," or "not enough data yet" below two counts. `getDaysOfCover()` already returns exactly this and is tested. This is *not* rebuilding reorder suggestions; it is one number on a page you already have. ~half a day.
- **Remove it.** Delete `src/server/consumption/`, drop the call from count review, and leave the `consumption_rates` table for later. ~1 hour.

The one thing not to do is leave it as-is, where it reads like a feature to whoever opens the file next.

---

# P1 — UK readiness

## P1-1 · Use-by and best-before are the same column

`batches.expiry_date` conflates them. In the UK these are legally different: selling past a **use by** date is a criminal offence; past **best before** is legal and routine, and shops mark that stock down rather than binning it.

Today the expiry dashboard treats both identically, so it either alarms about perfectly saleable bread or fails to flag illegal-to-sell chicken.

**Do**
- `batches.date_type` — `'use_by' | 'best_before'`, defaulting from the product.
- `products.date_type` so receiving pre-fills correctly.
- The expiry dashboard distinguishes them: use-by past date is a hard stop, best-before past date is a markdown prompt.
- The till should refuse to sell a batch past its **use by** date. It should not block best-before.

**Effort** ~2 days, and it gets more expensive every week there is live data.

---

## P1-2 · The rest of the UK localisation pass

VAT and currency are handled now. What remains is language, and it is cheap.

| Now | Should be |
|---|---|
| "Count" | **Stocktake** — "count" reads American to UK retail |
| "Receive" | **Goods in** or **Deliveries** |
| "Checkout" | **Till** — your own docs already call it that |
| Store settings address | UK postcode field, county not state |

All of it lives in `messages/en.json` plus `src/components/nav-items.ts`. No logic changes.

**Before doing this, go back to the prospect** and ask which screen felt wrong and what they expected. This list is my guess at "not easy to use for a UK person." Their actual answer is worth more than the guess, and it costs one email.

**Effort** ~half a day once you know what to change.

---

# P2 — Hygiene

Small, and none of it is urgent.

## P2-1 · Per-route loading and error states
There is exactly one `loading.tsx` and one `error.tsx`, both at the `(app)` group level. A slow products query shows a generic skeleton that matches nothing. Add route-level `loading.tsx` for the list-heavy routes — `/products`, `/reports/[slug]`, `/insights` — with skeletons shaped like their actual content. `data-list.tsx` already exports the skeleton primitives.

## P2-2 · `netFromGross()` is unused
`src/server/settings/valuation.ts` exports it; nothing calls it. The checkout does the same arithmetic inline at 4dp because `netFromGross` rounds to 2dp. Either widen the helper and use it, or delete it — two implementations of one rule will drift.

## P2-3 · `console.log` in `productview.itest.ts`
Three of them, lines 34, 43, 60. Test noise.

## P2-4 · e2e coverage
Seven tests across two specs for roughly twenty-four routes. The daily loop is covered, which is the right first choice. The gap worth closing next is the **money path**: ring up a mixed-VAT basket and assert the on-screen total — that is the class of bug that reached the demo, and no unit test catches it.

## P2-5 · Keep `docs/features.md` honest
It is currently correct (pointed at `3573f13`). Note that an older copy describing `/reorder`, `/orders` and `/waste` is still in circulation — that stale version is what got shared for review, and it cost a round of wrong advice. Worth deleting any copies outside the repo.

---

# P3 — The two big ones

Both were asked for at the demo. Both are weeks, not days. **Do not start either until P0 is done and the prospect has committed to a pilot.** Two months of solo work for one prospect who has not said yes is how this fails.

## P3-1 · Supplier invoice PDF ingestion
~3 weeks. Parse line items, match to products by barcode then name, **review screen before posting** — never auto-post. OCR runs 85-95% on line items, and a misread `12` as `1.2` corrupts an append-only ledger silently.

Worth more than it first appears: the review screen is also where unmatched lines become new products, which chips away at the cold-start problem one delivery at a time instead of demanding a 2,000-row CSV on day one.

## P3-2 · EposNow
2-4 weeks plus an unknown partner wait. **Email them for API access today** — it is the only item here entirely outside your control, and everything else can be built while you wait.

Do not frame it as replacing `/checkout`. A shop already running EposNow will never switch to your till; a shop with no EPOS finds your till a real differentiator. The under-rated win is that syncing *from* EposNow imports their catalogue and prices, which solves the cold start outright for that segment.

---

# Do not build

Per CLAUDE.md, unless the decision has explicitly reversed: reorder suggestions, purchase orders, a write-off screen, manual per-sale entry outside the till, real card processing, accounting integrations, partial refunds, multi-location transfers, label printing, offline mode, supplier portal, self-serve signup.

Scale-printed barcodes for weighed goods stay unbuilt on purpose — decoding a GS1 price-embedded EAN wrong sells a £40 cheese for £4, and it needs a real scale in a real shop before anyone writes that parser.

---

# What the review found clean

Worth recording, so nobody re-litigates it:

- No `service_role` anywhere in `src/`
- No database access outside `withTenant`
- No `organizationId` accepted from client input
- No `UPDATE`/`DELETE` against `stock_movements`
- Every server action re-checks its own role
- Auth rate limiting is database-backed and has integration tests
- Three `any` casts across 126 files; no TODOs; no dead imports

The risk in this codebase is not code quality. The VAT bug was valid TypeScript that passed every check and read as obviously correct — it was simply the wrong domain meaning. That is what `/money-audit` exists to catch, and it is the class of bug worth being slow and deliberate about.
