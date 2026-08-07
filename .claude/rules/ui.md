---
paths:
  - "src/components/**"
  - "src/app/**"
  - "**/*.tsx"
---

# UI rules

## Who is using this, and where

A shop worker, one-handed, on their own phone, standing in a chilled aisle, possibly wearing gloves, in a hurry. Not a designer at a desk.

Every design decision follows from that. When a choice is unclear, pick the one that survives a cold aisle.

- **Touch targets: 44px minimum.** No exceptions on any control used during scanning, counting, or receiving.
- **Primary action sits in the bottom third** of the screen, thumb-reachable. Never top-right.
- **One primary action per screen.** If a screen appears to need two, it's two screens.
- **Never block on a modal** during a scan or count flow. Modals need two hands.
- **No hover-dependent affordances.** There is no hover on a phone.

## Density

This is a data tool, not a marketing site. Generic component-library defaults are too airy for it.

- Lists of stock are **tables on desktop, stacked cards on mobile** — never a horizontally scrolling table.
- Numbers are **tabular-nums**, right-aligned, so columns line up when scanned by eye.
- Show the number before the label. `12 expiring` not `Expiring: 12`.
- Quantities keep their unit adjacent and de-emphasised: `4.5` in full contrast, `kg` at 70% opacity.

## Colour

- Colour carries **one** meaning in this product: urgency of expiry. Don't spend it elsewhere.
  - Expired / negative stock → destructive
  - ≤3 days → warning
  - ≤14 days → muted accent
  - Everything else → default foreground
- **Never encode meaning in colour alone.** Every state needs an icon or text label too. A meaningful share of male shoppers and staff have red-green colour vision deficiency, and this app's entire signal is red-green.
- Contrast: WCAG AA (4.5:1) minimum. Phone screens in a cold-store are viewed under bad fluorescent light at an angle.

## Components

- **shadcn/ui only.** Don't hand-roll a component that exists there. Don't install a second component library.
- **No custom CSS files.** Tailwind utilities only. If a utility combination repeats three times, extract a component — not a CSS class.
- No arbitrary values (`w-[347px]`). Stay on the Tailwind scale so spacing stays consistent by construction.
- Spacing: use `2 / 3 / 4 / 6 / 8 / 12` only. Six values is enough and prevents drift.

## Every screen needs four states

Build all four, every time. A screen with only the success state is not finished:

1. **Loading** — skeletons matching final layout, never a centred spinner (it causes layout shift)
2. **Empty** — explain what goes here and give the action that fills it. "No products yet" plus an Import CSV button.
3. **Error** — what failed, and what to do next. Never a raw exception.
4. **Success** — the actual content

## Minimal code

- Server Components by default. `'use client'` only for genuine interactivity — scanning, forms, live filters — and push it as far down the tree as possible.
- No state management library. Server state via server actions, URL state via `searchParams`, local state via `useState`.
- No `useEffect` for data fetching. Fetch in a Server Component.
- If a component exceeds ~120 lines, it's doing two things. Split it.
- Delete code rather than commenting it out. Git remembers.

## Accessibility

Not optional — this ships into the EU, where the European Accessibility Act applies to commercial software.

- Every input has a real `<label>`, not just a placeholder.
- Every icon-only button has an `aria-label`.
- Focus states visible and never removed.
- The scan flow must be completable without the camera, by typing a barcode. Cameras fail, and some staff won't grant permission.
