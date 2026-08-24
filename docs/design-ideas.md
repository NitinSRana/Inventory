# Design ideas — workflow innovations

Not a backlog item, not yet decided on. A set of concept proposals, written the
same way `docs/backlog.md` is (so any one of these can be pasted into a fresh
Claude Code session as-is), but nothing here has been approved to build.

**How to use this file:** pick one heading, paste it plus its **Do** block into
a new session with `CLAUDE.md` and `docs/mvp-spec.md` already loaded, and say
"work on this one, plan mode first." One idea per session, same discipline as
`docs/backlog.md`.

Every idea below was checked against the product's actual boundaries before
being written down — what's excluded (`CLAUDE.md`'s "Out of scope", `docs/
mvp-spec.md` §4's "Explicitly OUT") and what's explicitly still open (`CLAUDE.
md`'s "Open questions"). Where an idea brushes against a boundary, that's
named plainly rather than smoothed over — it's your call, not a decision made
for you by omission.

---

## Tier 1 — directly extends the core thesis

### 1. Markdown Assistant

**The gap.** `best_before` past its date is currently "advisory only" — the
dashboard flags it, and that's where the trail ends. The product's whole job
is to prevent unnoticed spoilage, and right now, noticing is where it stops.
`CLAUDE.md`'s own "Open questions" section names this directly: *"There is no
markdown-pricing feature — that's a distinct, unbuilt idea."*

**The idea.** A "Mark down" action on a `best_before` batch, reachable from the
expiry dashboard and the product page — not a pricing engine, a single manual
override on one batch. Owner picks a new price (or a %-off preset configured
per shop, e.g. "50% off at ≤1 day"), it's stored as a **batch-level price
override**, and checkout honours it automatically when that batch is the one
FEFO allocates from (the batch is already known at the point of sale — this is
new data, not new logic).

**Boundary check, named plainly.** `docs/mvp-spec.md` §4 lists "promotions and
pricing engine" as explicitly out. This is deliberately narrower than that: no
rules, no scheduling, no campaigns — one person, one batch, one override, the
same shape as `/products/[id]/correct`'s "typo, not a system" scoping. Worth
your explicit sign-off before building, not something to wave through on the
strength of that distinction alone.

**Shape of the build.**
- `batches.markdown_price` — nullable, `numeric(12,4)`, gross (same convention
  as `sell_price`).
- `checkout()` (`src/server/pos/checkout.ts`) uses the allocated batch's
  markdown price when set, instead of the product's list price, for that
  line's VAT extraction and total.
- A "Mark down" action next to each `best_before` row in the expiry dashboard
  and on the product page's batch list — manager-only, matching `/correct`'s
  gating.
- No label printing (stays excluded) — the confirmation screen shows the new
  price large enough to read off and write on a shelf ticket by hand.

**Effort:** ~2 days. Small migration, one checkout code path, two small UI
additions.

---

### 2. Today's Action Queue

**The gap.** A busy owner currently has three separate mental models to check:
what's expiring (dashboard), what's due for count (`/count`'s queue), and —
if Markdown Assistant ships — what's markdown-eligible. Three screens to
remember, on a phone, between customers.

**The idea.** One ranked list, "what's worth doing today," merging all three
into cards a thumb can act on directly: tap an expiry-risk card to open the
product, tap a due-count card to start that count, tap a markdown-candidate
card to open Markdown Assistant. Not a new data source — `getExpiringStock()`,
the due-for-count query behind `/count`, and (if built) markdown candidates
already exist; this is a merge-and-rank view over data the app already
computes.

**Shape of the build.** A new server function combining the three existing
queries into one `{ type, product, urgency, action }[]`, ranked by value at
risk / days overdue. Rendered as the existing `DataRow`/`UrgencyBadge`
pattern — no new visual language. Natural home: replaces or sits above the
expiry-dashboard section of `/`, since it answers a superset of that screen's
question.

**Effort:** ~1.5 days, assuming Markdown Assistant isn't a dependency (works
fine with just expiry + count-due).

---

### 3. Shrinkage Story

**The gap.** Count review already computes exactly what changed and why the
numbers landed where they did — POS sales, receipts, waste history, expected
vs counted — but shows only the raw variance figure. The story behind a "-8"
is buried in numbers a manager has to reconstruct by hand.

**The idea.** One generated sentence per line in count review: *"Milk: sold 34
via till, received 40, expected 46 → counted 38. Gap of 8 — check for theft or
spoilage."* Every number in that sentence is already computed for the variance
math; this is presentation, not new logic.

**Shape of the build.** A pure formatting function in
`src/server/counting/review.ts` (or wherever the variance is assembled),
turning the existing `{expected, counted, sold, received}` shape into a
templated sentence via `next-intl` (no hardcoded English per the project's own
i18n rule). Shown under each line on `/count/review`, collapsed by default so
it doesn't slow down a 40-item review.

**Effort:** ~half a day. No schema change, no new query — the riskiest part is
picking wording that reads naturally across plural/singular cases via ICU
message format.

---

## Tier 2 — smaller, still real

### 4. Point-of-sale expiry nudge

**The gap.** A cashier ringing up near-expiry stock has no way to know it —
FEFO depletes correctly behind the scenes, but nothing surfaces "this is the
one about to go" at the point where a human could act on it (offer it first,
mention it to the customer).

**The idea.** A small badge on a checkout line when the batch FEFO would
allocate from is within its urgency window — reusing `UrgencyBadge` exactly as
it renders elsewhere, not a new visual treatment.

**Shape of the build.** `checkout/page.tsx` already calls `getBatchStock()` to
resolve what a scan would allocate from; surface that batch's `daysRemaining`
next to the cart line. No new query.

**Effort:** ~half a day.

---

### 5. Cold-start onboarding wizard

**The gap.** `CLAUDE.md`'s own "Open questions" names this directly:
*"Onboarding data entry — a store facing a 2,000-SKU manual catalog build will
churn in week one. Unsolved."* Today, a freshly-created org lands on an empty
Products list with no guidance beyond `/products/import`.

**Boundary check.** This is **not** "self-serve signup," which stays excluded
— org creation stays manual, by design, for now. This is guided setup for an
org that already exists, after an owner is already signed in. Worth stating
explicitly since the two are easy to conflate at a glance.

**The idea.** A short guided sequence after first sign-in — currently
`FirstRun` (`src/components/first-run.tsx`) already detects "no products yet"
and nudges toward import; this extends that into an actual multi-step flow:
import catalogue → confirm VAT bands on a sample of imported rows → set count
frequencies for a couple of categories → done. Each step is a screen that
already exists (`/products/import`, VAT settings, categories) — the wizard is
sequencing and progress state, not new functionality underneath.

**Effort:** ~2 days for the sequencing shell; the underlying screens are
already built.

---

### 6. Weekly Owner Digest email

**The gap.** The product's thesis is "tell the owner without them counting by
hand" — but today that still requires opening the app. Resend and React Email
are already wired up for invitation mail (`src/server/email/`); nothing uses
that infrastructure for anything an owner didn't explicitly trigger.

**The idea.** A weekly email to each org's owner(s): value at risk this week,
markdown/shrinkage actions taken (if built), margin trend, one or two lines —
genuinely passive, no login required to get the headline.

**Shape of the build.** A scheduled job (needs a cron trigger — Vercel Cron or
similar, not currently in the stack) calling the same `overview.ts` /
`dashboard.tsx` queries already built, rendered via a new React Email template
matching the existing invitation email's style. The one real new piece is the
scheduling infrastructure itself.

**Effort:** ~1.5 days, plus whatever the chosen cron mechanism costs to wire
up — worth scoping that part first since it's the one genuinely new dependency
in this whole list.

---

## Stretch tier — speculative, not proposals to build yet

**Shelf-life confidence score.** The app now has real count-variance history
per product. A product whose actual count has consistently landed close to
its predicted shelf-life-based expiry is a "reliable" estimate; one that's
routinely off (spoils early, or is still fine well past the label) could get a
quiet confidence indicator. Interesting, but needs real data from a real store
before it's more than a guess about a guess.

**Aisle-tag spatial grouping.** A free-text "aisle" or "section" tag on
products, letting the expiry dashboard group by physical location instead of
a flat list — "Chiller 2: 4 items need attention" reads as a walking route,
not a spreadsheet. Cheap schema-wise (one nullable text column), but the value
depends entirely on staff actually keeping it accurate, which is exactly the
kind of assumption this product has been careful not to make without a real
store confirming it first.

---

## What's explicitly not reconsidered here

Reorder suggestions, purchase orders, a general write-off screen, real card
processing, a promotions/pricing *engine* (as opposed to Markdown Assistant's
narrow batch override), label printing, self-serve signup, multi-location
transfers, accounting integrations. Every idea above was checked against this
list while being written; none of them is a step toward rebuilding any of it.
