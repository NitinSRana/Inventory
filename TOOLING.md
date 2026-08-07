# What to install in Claude Code — and what not to

Your three goals were: minimal well-structured code, top-notch design, and lowest possible token consumption.

The short version: **install two plugins.** Almost all the leverage is in configuration and habits, not installs. Every plugin adds context cost on *every turn* of *every session*, so a long install list works directly against goal #3.

---

## Install these two

### 1. `typescript-lsp` — the single highest-value install

```bash
npm install -g typescript-language-server typescript
# then, inside claude:
/plugin install typescript-lsp@claude-plugins-official
```

This one plugin serves all three of your goals at once:

- **Tokens:** Claude gets real symbol navigation — go-to-definition, find-references — instead of grepping and then reading four candidate files to find one function. One precise call replaces thousands of tokens of speculative file reading. On a TypeScript codebase this is the biggest single token saving available to you.
- **Code quality:** the language server reports type errors back automatically after every edit. Claude sees the mistake and fixes it in the same turn, without running `tsc` and without you reviewing a broken diff.

If you install nothing else, install this.

### 2. `security-guidance`

```
/plugin install security-guidance@claude-plugins-official
```

Reviews each change for common vulnerabilities as it's written. Worth it here specifically because this is a **multi-tenant app holding EU personal data**. The expensive failure mode in this codebase is a query that escapes tenant scoping, and a second pair of eyes on every diff is cheap insurance against it.

---

## Deliberately skip these

| Plugin | Why not |
|---|---|
| `github` | Use the `gh` CLI instead. CLI tools cost **zero** context — no per-tool listing at all. MCP servers always cost something. |
| `supabase` | Same reasoning: use the `supabase` CLI. |
| `figma` | Only useful if you're working from Figma files. If you aren't, it's pure overhead. |
| `linear` / `notion` / `asana` / `slack` | Not part of writing this app. |
| **Agent teams** | Roughly **7x the tokens** of a normal session. Off by default. Leave it off. |

Before installing anything, the `/plugin` detail pane shows a **Context cost** estimate. Read it. And check the **Not used recently** section in the Installed tab every few weeks — unused plugins still cost you on every turn.

---

## Token consumption: the habits matter more than the config

Ranked by actual impact:

**1. `/clear` between unrelated tasks.** This is the biggest lever by a wide margin, and it's free. Claude Code re-sends your entire conversation with every request. A session left open all day means a one-line question still draws usage for the whole history. Finish the count-session work, `/clear`, then start on purchase orders.

**2. Match the model to the job.** Sonnet handles almost all coding here. Reserve Opus for genuine architecture decisions — schema changes, the consumption algorithm. `/model` switches mid-session.

**3. Put context usage in your status line** so you can see it climbing rather than discovering it at the compaction warning. `/statusline` sets this up.

**4. Lower the effort level for routine work.** Extended thinking is billed as output tokens and the default budget runs to tens of thousands per request. Use `/effort` to drop it for CRUD screens; raise it for the ledger and reconciliation logic where reasoning actually pays.

**5. Plan mode (shift+tab) before anything touching the schema or the ledger.** Approving a wrong plan costs a few hundred tokens. Reviewing and reverting a wrong implementation costs tens of thousands.

**6. Be specific.** "Add expiry filtering to the dashboard query in `src/server/stock/expiry.ts`" reads one file. "Improve the dashboard" reads thirty.

The hooks in `.claude/settings.json` handle a chunk of this automatically — see below.

---

## What the hooks do

Already configured in `.claude/settings.json`:

**`format-edited.sh`** runs Prettier and `eslint --fix` on every file Claude edits. Claude never spends tokens on formatting, and your diffs contain no whitespace churn. Serves goals #1 and #3 together.

**`filter-noise.sh`** rewrites expensive commands before they run:

| Command | Claude sees |
|---|---|
| `pnpm test` | Failures only, 120 lines max |
| `pnpm typecheck` | `error TS` lines only |
| `pnpm build` | The failure, not the build log |
| `pnpm install` | Last 12 lines |

A failing Next.js build prints thousands of lines. Claude needs about eight of them. This routinely saves more per invocation than any plugin choice.

Verify both loaded with `/hooks` on first run. They need `jq` (`brew install jq`).

---

## Design: no tool will do this for you

This is worth being straight about. There is no plugin that makes design good, and the usual approach — have Claude screenshot the UI and iterate visually — is one of the most token-expensive things you can do. It's in direct tension with goal #3.

The cheaper approach, and the better one, is to **decide the design constraints once, in writing, and let them apply automatically.** That's `.claude/rules/ui.md`, which loads only when Claude touches `.tsx` files. It pins down touch targets, spacing scale, colour semantics, density, the four required screen states, and the Server-Component-by-default rule.

Concrete constraints beat taste every time here. "44px minimum touch target, primary action in the bottom third" produces a genuinely better result for a worker scanning shelves one-handed than "make it look modern" ever will — and it costs nothing per turn.

Two things to add yourself early:

1. **A component gallery route** (`/dev/gallery`) rendering every component in all four states. You review it in a browser yourself. Your eyes are free; Claude's screenshots are not.
2. **One reference screenshot** when you want a specific visual direction. Paste it once, ask Claude to write the tokens into `ui.md`, then never paste it again.

---

## Setup checklist

```bash
npm install -g typescript-language-server typescript
brew install jq                       # or apt-get install jq

claude
/plugin install typescript-lsp@claude-plugins-official
/plugin install security-guidance@claude-plugins-official
/hooks       # confirm both hooks are registered
/context     # confirm CLAUDE.md loaded
/statusline   # add context-usage display
```

Then, per session: pick one phase from `docs/mvp-spec.md`, plan mode for anything structural, `/clear` when you move to the next.
