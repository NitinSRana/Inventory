# Design brief — Inventory

A brief for redesigning an existing, working application. **Every screen listed
here is built and functional.** The logic, data model and tenant isolation are
done and tested; the visual design is not. What exists today is correct, plain,
and unfinished — black text on white, one type size, almost no visual hierarchy.

Read this before designing anything. The constraints in §4 are not preferences;
several of them come from where this product is used and one of them is a legal
requirement.

---

## 1. What the product does

Inventory management for **independent European grocery stores and small
supermarkets** — one shop, one to six staff, 500–2,000 products.

It answers exactly two questions:

> **What is about to expire?** and **what should I order?**

It answers them **without anyone typing in sales by hand**. Stock changes from
four events: receiving a delivery, binning something, counting a shelf, and
**ringing an item through the checkout**. The till records sales as a side
effect of a sale — nobody types in 300–800 transactions a day.

POS sales are the **primary** consumption signal: exact, not inferred. Counting
is now a **shrinkage audit** — the gap between what the ledger says should be on
the shelf and what physically is, which is theft, spoilage, or a miscount. Only
a product with no sale history yet falls back to the old inference:

```
consumption = opening count + receipts − waste − closing count
```

This matters for design: **the app must earn its keep in seconds a day.** Nobody
is paid to enjoy using it.

## 2. Who uses it, and where

Two quite different people:

**Shop staff** — receiving deliveries, binning expired stock, counting shelves.
On their **own phone**, **one-handed**, standing in a **chilled aisle**,
sometimes wearing **gloves**, under bad fluorescent light, in a hurry, often
holding a product in the other hand. They did not choose this software and are
not paid to like it. If a task takes more than a few taps they will stop doing
it — and the ledger depends on them not stopping.

**The owner** — ringing up sales, checking what is at risk, deciding what to
order, reviewing waste and takings. Mostly at a **desktop browser**, on the
counter or in a back office. Cares about money and time, not features.

**The browser is the primary device.** Most hours in this product are spent at
a real screen — checkout runs there all day, and so does everything in §5 under
Buying, Catalogue, and Insight. The phone remains the device for the four aisle
tasks (receive, count, write off, scan) and those screens keep every touch and
reach constraint in §4.

The practical consequence: **stop designing every screen as a phone screen that
happens to be wide.** Desktop layouts should use the width they are given —
tables, side-by-side panels, a persistent sidebar — while the aisle screens stay
exactly as thumb-friendly as they are today.

## 3. The current state, honestly

- Tailwind v4 + shadcn/ui, neutral base, Geist font
- Light and dark themes both defined; contrast verified at WCAG AA in both
- Bottom tab bar on mobile, sticky header, back links on detail screens
- One shared list pattern (bordered container, divided rows)
- Icons only in navigation — nowhere else
- **One heading size. No cards, no visual rhythm, no motion, no toasts.**
- Confirmations are a line of grey text after a page reload

It reads as a prototype. It should read as a tool a shop trusts with its money.

## 4. Hard constraints

**These are not up for redesign.** They come from the usage context, the
regulatory environment, or the architecture.

### Touch and reach
- **44px minimum** on any control used while scanning, counting or receiving. Most are 48px today.
- The **primary action sits in the bottom third** of a phone screen, above the tab bar. Never top-right.
- **One primary action per screen.** If a screen seems to need two, it is two screens.
- **No modals** during a scan or count flow — modals need two hands.
- **No hover-dependent affordances.** There is no hover on a phone.

### Colour
- **Colour carries exactly one meaning: urgency of expiry.** Do not spend it elsewhere.
  - expired / negative stock → `destructive`
  - ≤ 3 days → `warning`
  - ≤ 14 days → `muted-foreground`
  - everything else → `foreground`
- **Never encode meaning in colour alone.** Every state needs an icon or a word too. This palette runs red→amber and roughly one man in twelve has red-green colour vision deficiency — a colour-only design fails a real share of shop staff outright.
- **WCAG AA, 4.5:1 minimum**, in both themes. Phone screens are read at an angle under fluorescent light. This is also a legal requirement: the **European Accessibility Act** applies to commercial software sold in the EU.

### Numbers
- All figures **tabular-nums**, right-aligned, so a column can be scanned by eye.
- **Number before label**: “12 expiring”, never “Expiring: 12”.
- Quantity keeps its unit adjacent and de-emphasised: `4.5` full contrast, `kg` at ~70% opacity.
- Money is formatted per the tenant's currency (EUR today) via `Intl`.

### Density
This is a **data tool, not a marketing site**. Component-library defaults are too
airy for it. A worker scanning twenty products for one number should not have to
scroll past whitespace. Lists are dense, divided rows — not stacks of floating
cards.

### Every screen needs four states
Loading (skeletons matching the final layout, never a centred spinner), empty
(explaining what goes here **and offering the action that fills it**), error
(what failed and what to do next — never a raw exception), and success.

### Technical
- **Next.js 16 App Router, React Server Components.** Almost everything is server-rendered with no client JavaScript. Designs that need heavy client state are expensive here — say so explicitly if a pattern requires it.
- **Tailwind v4 utilities only. No custom CSS files.** No arbitrary values (`w-[347px]`); stay on the scale. Spacing limited to `2 / 3 / 4 / 6 / 8 / 12`.
- **shadcn/ui only.** Do not introduce a second component library. Currently installed: `button`, `input`, `label`, `badge`, `table`, `skeleton`. Anything else from shadcn can be added — name what you need.
- Icons: **lucide-react** (ships with shadcn). SVG only, never emoji.
- **Every user-facing string goes through `next-intl`.** English only at launch, but German is next — allow for strings ~35% longer. No hardcoded text in components.
- Light and dark both required.
- Theme tokens already exist: `background foreground card muted muted-foreground accent border input ring primary secondary destructive warning`, plus `--radius`. Extend if needed; say which.

## 5. The screens

24 screens. Ordered by how much they matter.

### The daily loop — used every day, mostly on a phone

| Screen | Route | What it is for | Notes |
|---|---|---|---|
| **Expiry dashboard** | `/` | The homepage and **the feature that sells the product**. Money at risk stated first, then batches worst-first. | Headline figure `€604.10 at risk`, sub `12 batches expiring within 14 days`, then rows: product name, urgency badge (“Expired 2 days ago”, “1 day left”), value at risk, quantity on hand. This screen has to land in one glance. |
| **Receive** | `/receive` | A delivery arrives. Barcode → quantity, expiry, lot, unit cost. | Expiry is pre-filled from shelf life and is the field most likely to be skipped and most expensive to get wrong. |
| **Count** | `/count` | Scan-and-enter cycle counting. Barcode → quantity → **straight back to an empty scanner**. | The spec calls this *“the highest-leverage UX work in the whole build”*. Counting one shelf section must take two minutes, not twenty. Shows a “due for count” queue when idle. |
| **Count review** | `/count/review` | Variance before committing. Net value impact, per-line expected vs counted. | The only screen where “Post 3 adjustments” writes to the ledger. Everything before it is reversible. |
| **Write off** | `/waste` | Bin something. Barcode → quantity → reason code. | Eight reason codes: expired, damaged, theft, staff use, sampling, returned to supplier, correction, other. Reached from More, not the tab bar. |

### Checkout — the till, used all day on a desktop browser

| Screen | Route | What it is for | Notes |
|---|---|---|---|
| **Checkout** | `/checkout` | Scan items into a basket, take cash or card, complete the sale. Every sale depletes stock FEFO and feeds the reorder maths. | Cart state lives in the URL so a reload cannot lose a basket. Tender is recorded, not processed — no card handling in v1. Needs the most design attention after the dashboard: it is the screen someone stands at for hours. |

### Buying

| Screen | Route | Notes |
|---|---|---|
| **What to order** | `/reorder` | Grouped by supplier. Per line: suggested quantity, on hand, consumption rate/day, confidence. Warns when a group is below the supplier's minimum order value. One tap creates a draft order. Products without enough count history are reported as “no rate yet”, never guessed. |
| **Purchase orders** | `/orders` | List: supplier, PO number, status (Draft / Sent / Part delivered / Complete / Cancelled), total, line count. |
| **Order detail** | `/orders/[id]` | Lines with received-of-ordered, mark as sent, record a (possibly partial) delivery, cancel. Over-delivery is recorded and flagged, never rejected. |

### Catalogue

| Screen | Route | Notes |
|---|---|---|
| **Products** | `/products` | Search by name or barcode. Dense list on mobile, table on desktop. 500–2,000 rows is normal. |
| **Product new / edit** | `/products/new`, `/products/[id]` | Name, barcode, unit, cost, price, shelf life, supplier, min stock. |
| **CSV import** | `/products/import` | The onboarding moment — a store arrives with a 2,000-row wholesaler spreadsheet. All-or-nothing: one bad row imports nothing. Errors are grouped by problem with line numbers. **This screen decides whether a shop churns in week one.** |
| **Suppliers** | `/suppliers`, `/suppliers/new`, `/suppliers/[id]` | Name, contact, email, lead time, minimum order value. |

### Insight and settings

| Screen | Route | Notes |
|---|---|---|
| **Reports** | `/reports`, `/reports/[slug]` | Five: stock on hand, waste by reason, expiry exposure, low stock, and sales by product. Each with CSV export and, where relevant, 7/30/90-day switches. Still uses its own markup — **needs a lot of design attention**. |
| **More** | `/more` | Everything outside the daily loop, grouped. On desktop this is largely replaced by the sidebar. |
| **Categories** | `/categories`, `/categories/new`, `/categories/[id]` | Product grouping, with a default count frequency per category. Manager only. |
| **Team** | `/settings/team` | Invite by email, roles, pending invitations. Owner only. Note: inviting writes a row, it does not send mail — no email is implemented yet. |
| **Store info** | `/settings/store` | Name, country, currency, timezone. Owner only. |
| **VAT rates** | `/settings/vat` | Per-tenant rate bands. Owner only. |
| **Sign in** | `/sign-in` | Email plus optional password. Password signs in directly; leaving it blank sends a magic link instead. |
| **First run** | on `/` when empty | Three-step checklist: load products → receive a delivery → count a shelf. |

## 6. Realistic content

Design against these, not lorem ipsum. Real German grocery data, real lengths:

```
Products     Vollmilch 3,5% 1L · Milch, fettarm 1L · Bio Joghurt natur 500g
             Frischkäse Kräuter 200g · Bauernbrot 750g · Vollkornbrötchen 6er
             Kartoffeln 2,5kg · Passierte Tomaten 500g · Mineralwasser 6x1,5L
Suppliers    Molkerei Nord · Bäckerei Süd · Großhandel West
Barcodes     4001234567891 (EAN-13) · 96385074 (EAN-8)
Quantities   22.000 each · 4.5 kg · 0.750 l      (three decimals, weighed goods)
Money        €0.79 · €604.10 · €1,284.50
Urgency      "Expired 2 days ago" · "1 day left" · "9 days left"
Order status "Part delivered" · "Sent" · "Complete"
```

Note the long product names, the comma decimal separator inside names, and the
umlauts. Truncation behaviour matters.

## 7. What I want from you

In priority order:

1. **A type scale.** There is one heading size today. Define display / h1 / h2 / body / caption and where each is used.
2. **A density and rhythm system** — spacing, dividers, grouping — that makes a 40-row list scannable on a 375px screen.
3. **The expiry dashboard, designed properly.** It is the product. It should communicate money at risk in one glance and survive being read at arm's length.
4. **The counting flow.** Scan → quantity → next, with the least possible friction. This is the highest-leverage screen in the build.
5. **Feedback and motion.** Confirmations are currently grey text after a reload. Propose something — but note the RSC constraint in §4.
6. **Empty, loading and error states** with real personality rather than a grey sentence.
7. **Iconography** — where icons help scanning and where they are noise.
8. **Dark mode** as a designed thing, not an inversion. It will be used in cold storage and dim back rooms.

Deliver whatever form suits you — mockups, a component sheet, or annotated
tokens. If you give me Tailwind classes and shadcn component choices I can apply
them directly.

## 8. Please push back on

- **The tab bar** (Today · Checkout · Receive · Count · More). Still a guess at the daily loop, not validated with a real shop. On desktop it becomes a sidebar; the question of *which five* destinations earn a slot is open either way.
- **Colour reserved solely for expiry urgency.** Defensible, but it leaves the rest of the UI monochrome. If you disagree, argue it — just keep the colourblind and contrast rules.
- **Dense-over-airy.** Correct for a data tool, but it may be making things feel cheap rather than efficient.
- **The first-run checklist.** Onboarding is the single biggest churn risk and my version is three lines and a button.

## 9. What is not wanted

- A marketing landing page. There is no public site; the first screen is a sign-in.
- Anything that lowers contrast below 4.5:1 or relies on colour alone.
- Decorative animation. Motion must mean something; a worker in an aisle is not waiting for a fade.
- A second component library, custom CSS files, or arbitrary Tailwind values.
- Anything that puts a primary action out of thumb reach on a phone.

## 10. Reference

- Product scope and rationale: `docs/mvp-spec.md`
- Codebase rules: `CLAUDE.md`
- Existing UI rules, which this brief expands on: `.claude/rules/ui.md`
- Existing shared components: `src/components/` — `data-list`, `app-nav`, `expiry-urgency`, `barcode-field`, `first-run`, `back-link`

To see it running: `pnpm install && pnpm seed you@example.com && pnpm dev`. The
seed builds a shop with two weeks of history so every screen has real content.
