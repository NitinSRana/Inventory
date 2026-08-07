# Getting this into Claude Code

Delete this file once you're up and running — it's setup instructions, not project docs.

## What's in here

```
CLAUDE.md                              # loaded into EVERY session
.claude/rules/database.md              # loads only when Claude touches src/db, src/server, supabase
docs/mvp-spec.md                       # read on demand, not auto-loaded
src/db/schema.ts                       # Drizzle schema
supabase/migrations/0001_init.sql      # verified against Postgres 16
supabase/migrations/0001_init.test.sql # 15 checks incl. RLS isolation
```

The split matters. Claude Code loads `CLAUDE.md` in full at the start of every session, and files over ~200 lines measurably reduce how well the instructions are followed. So the root file stays lean, the database detail is path-scoped so it only enters context when relevant, and the spec is referenced by path (in backticks, so it isn't auto-imported) for Claude to read when it needs it.

## 1. Scaffold and drop these in

```bash
npx create-next-app@latest inventory --typescript --tailwind --app --src-dir
cd inventory
git init && git add -A && git commit -m "scaffold"

# copy the contents of this folder over the top, then:
git add -A && git commit -m "Add CLAUDE.md, rules, schema, spec"
```

Committing the scaffold first means you can `git diff` everything Claude does from here.

## 2. Install dependencies

```bash
pnpm add drizzle-orm postgres decimal.js next-intl html5-qrcode @supabase/supabase-js
pnpm add -D drizzle-kit tsx
```

## 3. Add the db:test script

`pnpm db:test` is referenced in CLAUDE.md, so create it or Claude will hit a missing command:

```jsonc
// package.json
"scripts": {
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:test": "createdb inv_test_$$ && psql -v ON_ERROR_STOP=1 -d inv_test_$$ -f supabase/migrations/0001_init.sql -f supabase/migrations/0001_init.test.sql; dropdb inv_test_$$"
}
```

## 4. Start Claude Code

```bash
claude
```

Then verify the setup actually loaded — this takes five seconds and saves real confusion:

```
/context
```

`CLAUDE.md` should appear under **Memory files**. If it doesn't, Claude can't see any of your rules and will happily ignore all of them.

Don't run `/init` — you already have a CLAUDE.md. It won't overwrite (it suggests improvements instead), but there's nothing for it to discover yet.

## 5. First prompts

Give it the spec explicitly on the first substantive task, since `docs/mvp-spec.md` isn't auto-loaded:

```
Read docs/mvp-spec.md and CLAUDE.md. Then set up src/db/tenant.ts with the
withTenant helper described in .claude/rules/database.md, plus the Drizzle
client and Supabase connection. Nothing else yet.
```

Then work down the phases in the spec, one at a time:

```
Phase 1 from docs/mvp-spec.md: the product catalog. Start with the server
layer in src/server/catalog/ — no UI yet. Use plan mode first.
```

Press **shift+tab** to enter plan mode for anything touching the schema or the ledger. It makes Claude produce a plan for approval before writing code, which is much cheaper than reviewing a large diff after the fact.

## 6. As you go

When you correct Claude on the same thing twice, that's the signal to add it to `CLAUDE.md` — or to `.claude/rules/` if it only applies to part of the codebase. Just say "add that to CLAUDE.md" and it will.

Auto memory is on by default and will accumulate build commands and debugging notes on its own. `/memory` shows you what it's saved.

## One thing to watch

The rules in `CLAUDE.md` are *context*, not enforcement — Claude reads them and tries to follow them, but there's no hard guarantee. The two rules where a violation is expensive (writing to `stock_movements` with UPDATE, and querying without tenant context) are both enforced by the **database** rather than by instructions: a trigger and an RLS policy. That's deliberate. If you add another invariant that really must hold, put it in Postgres, not just in CLAUDE.md.
