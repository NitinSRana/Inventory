# Feature inventory

Every screen in the product, what it is for, who can see it, and how finished it
looks. Written for design work: the logic behind all of this is built and tested,
so nothing here is a proposal — it is a description of what exists today.

Companion to `docs/design-brief.md`, which carries the constraints (touch,
colour, contrast, density) that any redesign has to hold. **Read the brief's §4
before changing anything**; several of those rules come from where the product is
used and one of them is a legal requirement.

Last updated against commit `064709c`.

---

## The two contexts

Which one a screen belongs to decides its layout, and it is the single most
useful thing to know before designing it.

| | **Back office** | **The aisle** |
|---|---|---|
| Device | Desktop browser | The worker's own phone |
| Share of hours | Most | Short bursts |
| Screens | Checkout, reorder, orders, products, suppliers, categories, reports, insights, settings | Receive, count, count review, write off |
| Design for | Width — tables, columns, a persistent sidebar | One hand, gloves, bad light, a product in the other hand |
| Constraints | Readable at a desk | 44px targets, primary action in the bottom third, no modals mid-scan |

Navigation follows the same split: a **sidebar** at ≥768px showing all fifteen
destinations, a **bottom tab bar** below that with five.

---

## Roles

Three, nesting. Every screen is gated server-side; hiding a control is
presentation, never enforcement.

- **staff** — scans, receives, counts, writes off, sells
- **manager** — the above, plus products, categories, purchase orders, insights
- **owner** — the above, plus team, VAT and store settings

---

## The daily loop

### Today — `/` · any signed-in member
The homepage and the screen that sells the product. Money at risk first, then
batches worst-first, grouped Expired / ≤3 days / ≤14 days with sticky headers
and a three-cell jump strip.

*State:* headline and buckets sit side by side from `md`; rows link to the
product. Uses the urgency ladder (icon + word + colour, never colour alone).

### Checkout — `/checkout` · staff
The till. Scan or search into a basket, take cash or card, complete. Every sale
depletes stock FEFO and feeds the reorder maths. Tender is **recorded, not
processed** — no card handling.

*Notable:* one input resolves two ways — a barcode if it is one, otherwise a
name search, which is how loose goods (deli, cheese, produce) get sold at all.
Cart state lives in the URL, so a reload cannot lose a basket. Two columns from
`lg` with the total pinned.

*Gap:* **no way to void a sale**, and no screen lists past sales. `voidSale()`
exists in the server layer and is reachable from nowhere.

### Receive — `/receive` · staff
A delivery arrives. Barcode → quantity, expiry, lot, unit cost.

*Notable:* scanning the **case** barcode finds the product and switches entry to
cases, converting by `units_per_case`. Expiry pre-fills from shelf life — the
field most likely to be skipped and most expensive to get wrong.

### Count — `/count` · staff
Scan-and-enter cycle counting: barcode → quantity → straight back to an empty
scanner. Shows a due-for-count queue when idle. Confirms the last line inline so
forty items is not forty moments of doubt.

*Notable:* one product can only be on one open count at a time, and the message
names whose count has it. Re-scanning overwrites, which is how a typo is fixed.

### Count review — `/count/review` · staff
Variance before committing: shrinkage or found stock, per line expected vs
counted. **The only screen that writes adjustments to the ledger** — everything
before it is reversible.

### Write off — `/waste` · staff
Bin something. Barcode → quantity → one of eight reason codes. Reached from the
sidebar or More, not the tab bar.

*Why it matters:* unrecorded waste is read as consumption, so the app reorders
what was thrown away. It is the only stock event with no natural trigger.

---

## Buying

### What to order — `/reorder` · manager
Grouped by supplier: suggested quantity, on hand, consumption rate, confidence.
Warns below a supplier's minimum order value. One tap creates a draft order.
Products without enough history say "no rate yet" rather than guessing.

### Purchase orders — `/orders` · staff · **detail** `/orders/[id]`
List with status (draft / sent / part delivered / complete / cancelled). Detail
shows received-of-ordered per line, records a partial delivery, and marks sent
or cancels (manager only). Over-delivery is recorded and flagged, never
rejected.

*Gap:* **"Mark as sent" sends nothing.** Suppliers have an email address and it
is never used — the order is retyped by hand into a mail client.

---

## Catalogue

### Products — `/products` · staff
Search by name or barcode. Dense rows on a phone, table on desktop. 500–2,000
rows is normal.

### Product — `/products/[id]` · staff
Stock on hand, price, the batches behind that number with expiry and lot, and
the last ten ledger movements. **Cost price is manager-only** — it is the shop's
buying position.

*Why the movements matter:* the ledger is the source of truth and was invisible
outside a SQL client. A miscount, a double-logged delivery and a theft look
identical on a total.

### Product form — `/products/new`, `/products/[id]/edit` · manager
Name, unit barcode, case barcode, units per case, sold-loose flag, unit, cost,
price, shelf life, supplier, category.

### CSV import — `/products/import` · manager
The onboarding moment. All-or-nothing: one bad row imports nothing, and errors
group by problem with line numbers. Column names are flexible (`Outer Barcode`,
`EAN`, German headings); semicolon files and Excel BOMs work.

*This screen decides whether a shop churns in week one.*

### Suppliers — `/suppliers` · staff · **form** manager
Name, contact, email, phone, lead time, minimum order value, delivery weekdays.

### Categories — `/categories` · manager
Product grouping with a default count frequency per category.

---

## Insight

### Insights — `/insights` · manager
Takings per day, write-offs per day, top five products, and where losses come
from, over 7/30/90 days. Losses are stated as a share of takings.

*Notable:* server-rendered SVG and CSS bars — no charting library, no client
JavaScript. Every figure appears as text as well as length. Empty state is
explicit rather than four blank charts.

### Reports — `/reports`, `/reports/[slug]` · staff
Five: stock on hand, waste by reason, expiry exposure, low stock, sales by
product. Each with CSV export; three are time-bounded.

*Notable:* rows stay raw so the CSV is re-importable; the screen formats money
and quantities at the last moment.

---

## Settings and account

| Screen | Route | Role |
|---|---|---|
| Store info | `/settings/store` | owner |
| Team | `/settings/team` | owner |
| VAT rates | `/settings/vat` | owner |
| More | `/more` | staff |
| Sign in | `/sign-in` | — |

**Team** invites by email with a role. The invitation grants access via a
database row; the email is only how someone finds out, and the screen says which
of sent / no provider / failed actually happened.

**Sign in** takes a password, or leaves it blank for a magic link. A refusal
never reveals whether an account exists.

**VAT** is per-tenant rows, never hardcoded rates.

---

## The shared kit

Anything redesigned here changes everywhere, which is usually the point.

| Component | Used for |
|---|---|
| `data-list` | `DataList` / `DataRow` / `DataGroupHeader` / `PageTitle` / `SectionHeading` / `HeadlineFigure` / skeletons — the list pattern every stock screen uses |
| `expiry-urgency` | The urgency ladder: icon, word and hue, always all three |
| `charts` | `TrendBars`, `RankedBars` — server-rendered, no dependency |
| `barcode-field` | Type it or scan it; typing is the primary path |
| `form` | `Field`, `FieldRow`, `NativeSelect`, `StickyAction` |
| `app-nav` / `app-sidebar` | The two navigations; destinations live in `nav-items.ts` |
| `empty-state`, `first-run`, `back-link` | |

**shadcn primitives installed:** button, input, label, badge, table, skeleton.
Anything else from shadcn can be added — name it. No second component library.

**Type scale** (documented at the top of `data-list.tsx`), each stepping up once
at `md`:

| Step | Classes |
|---|---|
| display | `text-5xl md:text-6xl font-semibold` |
| h1 | `text-2xl md:text-3xl font-semibold` |
| h2 | `text-lg md:text-xl font-semibold` |
| eyebrow | `text-xs font-medium uppercase tracking-wider` |
| body | `text-base`, secondary `text-sm` |

**Theme:** light and dark, following the device — no toggle. Dark is a designed
palette, not an inversion: an elevation ladder, urgency colours lightened, tints
at 16% rather than 10%. Measured contrast clears WCAG AA on both.

---

## Known gaps

Ranked as they would be picked up.

1. **The till has no undo and no memory.** `voidSale()` unreachable; no sales
   list; a mistake needs SQL, a customer return cannot be traced.
2. **"Mark as sent" does not send.** The supplier's email is on file and unused.
3. **The cold start.** A shop arrives with 2,000 SKUs and no prices. CSV import
   helps; where the price data comes from is unanswered.
4. **Empty, loading and error states** exist everywhere but read as grey
   sentences.
5. **Icons appear only in navigation.**
6. **Scale-printed barcodes** for weighed goods — deliberately unbuilt, needs a
   real scale in a real shop.

Also unbuilt and out of scope for now: real card processing, accounting
integrations, partial refunds, multi-location transfers, label printing, offline
mode, supplier portal, returns-to-supplier flow, price-change history.
