# Design review — desktop layout audit

A screen-by-screen audit at desktop width, prompted by "why is there too much
white space" on `/checkout`. Nothing here has been changed yet. Pick the items
worth fixing; each one names the file and the shape of the fix.

**How to use this file:** paste one heading plus its **Fix** block into a fresh
session and say "do this one." Same discipline as `docs/backlog.md`.

## The one-line diagnosis

The container is capped (`max-w-5xl`, ~896px at the app's 14px desktop root) but
**nothing inside it is**. Not a single `<Input>` in the codebase carries a
`max-w`, so every field grows to whatever its parent gives it — which on a
desktop is the full 896px, for a 13-character barcode.

That container width is deliberate and correct (`layout.tsx:77` explains why: a
narrower cap made a 1920px monitor render a phone column, and tables need the
room). **The fix is not to shrink the container.** It is to cap the *controls*
while letting tables and lists keep using the width.

---

## P0 — structural, visible on every screen

### 1. No form control has a maximum width

**Where.** Every form in the app. `src/components/form.tsx` (`Field`),
`src/components/ui/input.tsx`, and each caller. Confirmed by survey: every
`<Input>` className in the repo is some combination of `h-12` / `font-mono` /
`text-right tabular-nums` — no width constraint anywhere.

**Why it matters.** `.claude/rules/ui.md` states it directly: *"a form field
stretched across 1900px is as broken as one crushed into 320."* A barcode is 8–14
characters; a "units per case" is 1–3. Rendering either at 896px reads as a
mistake, and it is the single biggest source of the white space complaint.

**Fix.** Cap the field stack, not each input — one change rather than forty. Give
the form column something like `md:max-w-md` (a form is a reading measure, not a
table), keeping full width below `md` so aisle screens keep their 44px targets.
Candidates: add it to `Field`, or to each form's outer `<form className="flex
flex-col gap-4">`. Prefer the latter — a `Field` inside a `FieldRow` should still
share the row's width.

---

### 2. Checkout's idle state is its worst-looking state

**Where.** `src/app/[locale]/(app)/checkout/page.tsx:215` and `:354`.

**Why it matters.** The layout is `lg:flex-row` — scan column beside a totals
`<aside>`. But the aside is wrapped in `{lines.length > 0 && …}`, so with an
empty cart **there is no second column at all**, and the remaining column is
`lg:flex-1` — it takes the entire 896px. The till sits in exactly this state all
day between customers, so the emptiest layout is also the most-seen one.

**Fix.** Give the scan column its own max width so it does not depend on the
aside existing to look right. A reserved (not rendered-empty) right column is the
alternative, but that trades one kind of empty for another — capping the left
column is smaller and better.

---

### 3. `EmptyState` is a full-width dashed box with `py-12`

**Where.** `src/components/empty-state.tsx:28`.

**Why it matters.** At 896px wide with 48px of vertical padding, an empty state
becomes a large rectangle containing a 24px icon and two short lines — visible on
Categories, the empty cart, and an empty Products list. It reads as a rendering
fault rather than a deliberate "nothing here yet."

**Fix.** Cap it (`max-w-md` or similar) and consider `py-8` at desktop. The
component already gets the important part right — left-aligned, with an action —
so this is a width change, not a redesign.

---

## P1 — mobile correctness, not only appearance

### 4. `FieldRow` is two columns at every width, including 320px

**Where.** `src/components/form.tsx:53` — `grid grid-cols-2 gap-3`, no
breakpoint.

**Why it matters.** This is the one item here that is a **correctness** problem,
not an aesthetic one. On `/receive` it puts "Lot number" and "Unit cost" side by
side on a phone — an aisle screen, where `.claude/rules/ui.md` requires 44px
targets and one-handed operation, gloved, in a cold aisle. Two inputs sharing a
375px row leaves each about 170px wide. Same on the product form (case barcode +
units per case) and the receive quantity/unit pair.

**Fix.** `grid-cols-1 sm:grid-cols-2`. One line, and it is the smallest diff in
this document.

---

## P1 — desktop density

### 5. The Today KPI row leaves the right half empty

**Where.** `src/app/[locale]/(app)/overview.tsx:63` — `flex flex-wrap gap-6`.

**Why it matters.** Three content-sized blocks (Inventory value · Products · Avg
margin) sit left-aligned, so on a wide screen roughly half the row is empty while
the figures crowd the left edge. Visible in the current Today screenshot.

**Fix.** `grid grid-cols-3` (or `grid-cols-1 sm:grid-cols-3`), so the three
figures distribute across the row and each gets a consistent column. This also
fixes their ragged alignment when one value is much longer than the others.

---

### 6. Only one screen has a desktop table

**Where.** `products/page.tsx:104` is the only `hidden sm:table`. Sales,
Suppliers, Categories, the Reports index and the dashboard batch list all render
`DataList` at full container width on every viewport.

**Why it matters.** `DataList` rows are `grid-cols-[1fr_auto]` — identity left,
number right. At 896px that puts a product name and its value about 800px apart,
so the eye has to travel the width of the screen to pair two facts that belong
together. `.claude/rules/ui.md` asks for *"tables on desktop, stacked cards on
mobile"*; today it is stacked cards everywhere.

**Fix.** Two options, and this is the one worth a decision rather than a default:
either cap `DataList` width on desktop (cheap, keeps one markup), or add `md:`
table variants per screen (more work, matches the stated rule and reads better
for Sales and Suppliers). Products already shows what the second looks like.

---

## P2 — polish, once the above land

### 7. Sparse charts render mostly-empty plots

`TrendBars` with one populated month out of six draws a single bar against five
empty slots (visible on Today now). Consider not rendering a trend until at least
two points carry data — an empty chart makes a new shop look broken rather than
new.

### 8. A single-category mix bar says nothing

`Category mix` at "Uncategorized 100.0%" is a full-width bar carrying no
information. Hide the block below two categories.

### 9. Uniform vertical gaps flatten the hierarchy

Nearly every screen is `flex flex-col gap-6`. The design handoff's §3 argues the
opposite — dense rows with one generous "chapter" break — and notes that
uniformity, not density, is what reads cheap. Worth a pass once widths are fixed,
since capping widths will change how the rhythm looks anyway.

---

## Explicitly not flagged

- **The container width** (`max-w-5xl`). Deliberate, documented at
  `layout.tsx:77`, and correct for tables. The problem is the uncapped contents.
- **The sidebar.** Reads correctly at desktop width in every screenshot.
- **Sign-in.** Already capped (`max-w-sm`) and is the one screen with a
  proportionate form.
- **Insights.** Already uses `md:grid-cols-2` for its lower panels and bordered
  sections throughout — the closest thing in the app to the intended desktop
  density.
