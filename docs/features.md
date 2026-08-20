# Feature inventory

Every screen in the product, what it is for, who can see it, and how finished it
looks. Written for design work: the logic behind all of this is built and tested,
so nothing here is a proposal — it is a description of what exists today.

Companion to `docs/design-brief.md`, which carries the constraints (touch,
colour, contrast, density) that any redesign has to hold. **Read the brief's §4
before changing anything**; several of those rules come from where the product is
used and one of them is a legal requirement.

Last updated against commit `be55e0c`.

---

## The two contexts

Which one a screen belongs to decides its layout, and it is the single most
useful thing to know before designing it.

| | **Back office** | **The aisle** |
|---|---|---|
| Device | Desktop browser | The worker's own phone |
| Share of hours | Most | Short bursts |
| Screens | Checkout, products, suppliers, categories, reports, insights, settings | Receive, count, count review |
| Design for | Width — tables, columns, a persistent sidebar | One hand, gloves, bad light, a product in the other hand |
| Constraints | Readable at a desk | 44px targets, primary action in the bottom third, no modals mid-scan |

Navigation follows the same split: a **sidebar** at ≥768px showing all thirteen
destinations, a **bottom tab bar** below that with five.

---

## Roles

Three, nesting. Every screen is gated server-side; hiding a control is
presentation, never enforcement.

- **staff** — scans, receives, counts, sells
- **manager** — the above, plus products, categories, insights, voiding a sale, correcting a keying error on stock
- **owner** — the above, plus team, VAT and store settings

---

## The daily loop

### Today — `/` · any signed-in member
The homepage and the screen that sells the product. Money at risk first, then
batches worst-first, grouped Expired / ≤3 days / ≤14 days with sticky headers
and a three-cell jump strip.

*State:* headline and buckets sit side by side from `md`; rows link to the
product. Uses the urgency ladder (icon + word + colour, never colour alone).

*Notable:* an expired row's wording depends on the batch's date type — **use
by** reads "do not sell", **best before** reads "mark down". Same urgency
tier and colour either way; only the words change, since selling past a
use-by date is a criminal offence in the UK and past best-before is routine.

### Checkout — `/checkout` · staff
The till. Scan or search into a basket, take cash or card, complete. Every sale
depletes stock FEFO. Tender is **recorded, not processed** — no card handling.
Completing a sale shows a full receipt: lines, VAT broken out by band, sale
number, tender.

*Notable:* one input resolves two ways — a barcode if it is one, otherwise a
name search, which is how loose goods (deli, cheese, produce) get sold at all.
Cart state lives in the URL, so a reload cannot lose a basket. Two columns from
`lg` with the total pinned. A completed sale's receipt links straight through
to its entry in Sales, below.

*Notable — use-by:* a batch past its **use-by** date is refused at checkout,
not just flagged; FEFO skips it and pulls the next in-date batch instead.
**Best-before** past date is routine and still sells — that distinction is
advisory only, surfaced on Today and the product page.

### Sales — `/sales`, `/sales/[id]` · staff · **void** manager
Recent sales, newest first: number, time, tender, total, status. Opening one
shows its lines and VAT breakdown exactly as charged. A manager can void a
completed sale from `/sales/[id]/void`, which names what stock will be
restored before it commits — the sale stays visible afterward, marked voided,
never deleted.

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

---

## Catalogue

### Products — `/products` · staff
Search by name or barcode. Dense rows on a phone, table on desktop. 500–2,000
rows is normal.

### Product — `/products/[id]` · staff
Stock on hand, price with its VAT band, days of cover at recent sales rates (or
"not enough data yet" below two counts), the batches behind that number with
expiry, lot and use-by/best-before, and the last ten ledger movements. **Cost
price is manager-only** — it is the shop's buying position.

*Why the movements matter:* the ledger is the source of truth and was invisible
outside a SQL client. A miscount, a double-logged delivery and a theft look
identical on a total.

### Correct stock — `/products/[id]/correct` · manager
For a keying error, not a loss — received 100 cases instead of 10, or a typo.
New quantity plus a required free-text reason, posted as a compensating
`manual_adjustment` movement. Deliberately not a write-off: no reason-code
picker, no path back to anything resembling waste tracking. If stock actually
went missing, that surfaces through a count instead.

### Product form — `/products/new`, `/products/[id]/edit` · manager
Name, unit barcode, case barcode, units per case, sold-loose flag, unit, cost,
price, VAT band (shown with its real rate), date type (use-by / best-before),
shelf life, supplier, category.

### CSV import — `/products/import` · manager
The onboarding moment. All-or-nothing: one bad row imports nothing, and errors
group by problem with line numbers. Column names are flexible (`Outer Barcode`,
`EAN`, German headings); semicolon files and Excel BOMs work.

*This screen decides whether a shop churns in week one.*

### Suppliers — `/suppliers` · staff · **form** manager
Name, contact, email, phone, lead time, minimum order value, delivery weekdays.
Lead time and minimum order value are collected but nothing currently reads
them — they fed reorder suggestions, which were removed. Kept because a
supplier record and the catalogue CSV's supplier-match both still need the
supplier to exist.

### Categories — `/categories` · manager
Product grouping with a default count frequency per category.

---

## Insight

### Insights — `/insights` · manager
Gross margin (from the real batch cost of what was sold, not the product's
current list cost), takings trend, top five products by revenue, and dead
stock — on hand, unsold in the period, ranked by what it's worth. Every
headline carries its change against the previous period of the same length,
over 7/30/90 days.

*Notable:* server-rendered SVG and CSS bars — no charting library, no client
JavaScript. Every figure appears as text as well as length. Empty state is
explicit rather than blank charts. Margin is computed from `stock_movements`
consumption rows joined to the batch that was actually depleted, so a later
change to a product's list cost never rewrites a past period's margin.

### Reports — `/reports`, `/reports/[slug]` · staff
Four: stock on hand, expiry exposure, low stock, sales by product. Each with
CSV export; two are time-bounded.

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

1. **The cold start.** A shop arrives with 2,000 SKUs and no prices. CSV import
   helps; where the price data comes from is unanswered.
2. **Empty, loading and error states** exist everywhere but read as grey
   sentences.
3. **Icons appear only in navigation.**
4. **Scale-printed barcodes** for weighed goods — deliberately unbuilt, needs a
   real scale in a real shop.

Also unbuilt and out of scope for now: real card processing, accounting
integrations, partial refunds, multi-location transfers, label printing, offline
mode, supplier portal, returns-to-supplier flow, price-change history, reorder
suggestions and purchase order management (built, then removed as a deliberate
product decision — see `CLAUDE.md`).
