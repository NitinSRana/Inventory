# Handover

The one file to open first. Where the project stands, what is unverified, and what to do next.

**Last updated:** 18 August 2026, against `7734f04` plus uncommitted work.

---

## Read this before anything else

There is uncommitted work in the tree that **has never been run**. I could not execute the toolchain — pnpm's Windows symlinks do not resolve inside the Linux sandbox I was working from — so every test below is unverified on your machine.

```bash
pnpm typecheck
pnpm test
pnpm db:migrate            # applies 0010 and 0011
pnpm test:integration      # checkout + the new POS sync tests
pnpm test:e2e
```

Do this before building on any of it. If an integration test fails, check the expected numbers in `docs/uk-vat-changes.md` before changing code — they were worked out by hand and independently verified, so a failure more likely means a wiring mistake than wrong arithmetic.

---

## What changed, and what backs it up

### Money — the bug that reached the demo

The till treated `sellPrice` as **net** and added VAT on top. A £1.20 chocolate bar rang up at **£1.44**. UK and EU retail prices are display-inclusive by law; this was wrong for Germany too, it just never came up.

VAT is now extracted from the shelf price, and taken as the **remainder** after deriving net — so `net + vat === gross` exactly, with no penny drift on prices that do not divide cleanly.

Three things had to be wrong at once for a UK shop, and all three were: no `GB` in the VAT seeds, no band field on the product form, and a default of `'standard'`. Every UK product sat silently at 20% while the till added 20% on top. On £1,000 of ordinary groceries — nearly all zero-rated in the UK — the till charged £1,200 and recorded £200 of VAT never owed.

- `checkout.ts` extracts VAT instead of adding it
- `GB` seed added: 20% / 5% / 0%
- `products.vat_band` default `'standard'` → `'zero'` (migration `0010`)
- VAT band select on the product form, showing real rates
- `vat_band` CSV column, plus a UK import template with verified check digits
- Cost and price now labelled ex- and inc-VAT

**Verified:** 12 arithmetic checks including 400 adversarial price/quantity pairs at 20%, zero drift.
**Not verified:** `checkout.itest.ts`, rewritten by hand.

### Case barcodes

`ean.ts` validated GTIN-14 and had a *passing test*, but the camera was configured for EAN-13/EAN-8 only. Case barcodes are ITF-14 — a different symbology — so every case scan failed silently while the tests stayed green. ITF, UPC-A and UPC-E are now enabled.

**Not verified:** needs a real case from a real wholesaler.

### External POS shell

Everything except the HTTP. Four TODOs in `sources/epos-now.ts` stand between this and a live EposNow integration. Full rationale in `docs/epos-integration.md`.

**Verified against Postgres 16:** all 11 migrations apply in order; the idempotency index refuses a duplicate `external_ref` and permits two till sales with null refs; the composite FK refuses a cross-tenant location; `ON DELETE SET NULL` clears only its own column. `allocateFefoPartial` and `windowSince` verified standalone.
**Not verified:** `sync.itest.ts` — 13 tests, never run.

---

## Do this next, in this order

| | Action | Why now |
|---|---|---|
| 1 | **Run the test suite** | Everything above is unproven on your machine |
| 2 | **Email EposNow for API access** | 4-8 weeks typical, blocks nothing else, costs one email |
| 3 | **Ask the prospect what "not easy for a UK person" meant** | The most important feedback and the least actionable. Which screen? What did they expect? One email, worth more than a week of guessing |
| 4 | **P0 in `docs/backlog.md`** | ~3 days. The till has no undo, and a keying error can only be fixed by a full stocktake |
| 5 | Demo again, ask for a pilot commitment | |
| 6 | Only then start invoice OCR / EposNow | ~2 months solo. Do not spend it before someone has said yes |

That last line is the one I would push hardest on. Solo, the failure mode is not bad code — it is two months building the right thing for a customer who never signs.

---

## Decisions waiting on you

**Consumption rates are computed and never read.** `recalculateConsumptionRates()` runs on every count review and writes to `consumption_rates`. Nothing reads it back. The reorder screen that consumed it was removed in `3573f13`; the write survived. Either surface days-of-cover on the product page (half a day — *not* rebuilding reorder, just one number on a page you have) or delete `src/server/consumption/`. Leaving it reads like a feature to whoever opens the file next.

**Stock corrections.** `adjustStock()` exists and is unreachable. With the write-off screen deliberately gone, receiving 100 cases instead of 10 has no remedy except a full stocktake. I think that is an unintended consequence rather than the decision `CLAUDE.md` describes — its argument was that *loss* should be found by counting, not that *typos* should. Your call, but write the answer into `CLAUDE.md` either way.

**Use-by vs best-before.** One `expiry_date` column for two legally distinct things. Selling past a use-by date is a criminal offence in the UK; past best-before is routine and gets marked down. Today the dashboard either alarms about saleable bread or fails to flag illegal chicken. One column now, painful migration later.

---

## The documents

| File | What it is | Keep? |
|---|---|---|
| `CLAUDE.md` | Rules loaded into every Claude Code session. **The three rules are load-bearing** | Permanent |
| `.claude/rules/database.md` | RLS and ledger patterns, loads only for `src/db`, `src/server`, `supabase` | Permanent |
| `.claude/rules/ui.md` | Design constraints, loads only for `.tsx` | Permanent |
| `docs/mvp-spec.md` | Scope and rationale | Permanent |
| `docs/features.md` | Every screen, current as of `3573f13` | Permanent |
| `docs/design-brief.md` | Visual constraints | Permanent |
| `docs/backlog.md` | Prioritised work, one item per session | Living |
| `docs/epos-integration.md` | How the POS shell works and how to finish it | Until EposNow ships |
| `docs/uk-vat-changes.md` | What the VAT fix did and the expected test numbers | Delete once merged |
| `HANDOVER.md` | This file | Delete once caught up |

**One warning about `docs/features.md`.** An older copy describing `/reorder`, `/orders` and `/waste` is still circulating. Those screens were deliberately removed. That stale copy is what got shared for review and it cost a round of wrong advice — delete any copies outside the repo.

---

## Working with Claude Code on this

**One item per session.** Paste a backlog heading and its Do block, then `/clear`. Unrelated work should not share a context window — Claude Code re-sends the whole conversation with every request, so a session left open all day bills for its entire history.

```
Read docs/backlog.md and CLAUDE.md. Work on P0-1 only.
Use plan mode first. Do not touch anything else.
```

**Plan mode (shift+tab) for anything touching the schema or the ledger.** Approving a wrong plan costs a few hundred tokens; reverting a wrong implementation costs tens of thousands.

**Before merging:**

- `/rls-audit` — anything touching the database or a server action
- `/money-audit` — anything touching prices, VAT or totals

Both live in `.claude/skills/`.

**Installed plugins:** `typescript-lsp` (the biggest token saver available — symbol navigation instead of grep-then-read, plus automatic type diagnostics after every edit), `security-guidance`, `commit-commands`, `supabase`. Setup and rationale in `TOOLING.md`.

---

## The thing worth remembering

Your codebase is in good shape. The review found no `service_role` in `src/`, no database access outside `withTenant`, no client-supplied organisation IDs, no ledger mutations, every server action guarding itself, three `any` casts across 126 files, and no TODOs.

None of that caught the VAT bug — because `sellPrice × (1 + rate)` is valid TypeScript, passes every check, and reads as obviously correct. It was simply the wrong domain meaning.

No linter, type system or code review catches that class of bug. Only one thing does: **state the expected result the way the person affected would state it.** "A £1.20 milk and a £1.20 chocolate bar total £3.60" is a specification. "subtotal equals 2.58" is just an echo of whatever the code already does.

That is what `/money-audit` is for, and it is the habit worth keeping after every document here is deleted.
