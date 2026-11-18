# ledger-app

Personal finance PWA (phone first, Android) on top of plain-text accounting.
Single user. No backend: data lives in a private GitHub repo (`ledger-data`) as hledger
journals; the app reads/writes them through the GitHub REST API; GitHub Actions runs the
real `hledger check`; the app is static files on Cloudflare Workers.

Goal: what a budgeting app does (multi-currency accounts, categories with icons/colors, loans,
scheduled payments, charts) plus "whose money is this" tracking for money kept for someone.

## Read before coding

| Topic | File |
| --- | --- |
| Goals, scope, principles | `docs/01-overview.md` |
| **Data model, accounts, posting recipes (most important)** | `docs/02-data-model.md` |
| GitHub storage, sync, offline, validation layers | `docs/03-architecture.md` |
| Screens, features, charts | `docs/04-features.md` |
| Parser, formatter, posting builder, tests | `docs/05-ledger-core.md` |
| CI workflows, Cloudflare deploy | `docs/06-ci-and-deploy.md` |
| `app.config.json` schema | `docs/08-app-config.md` |
| A new user with their own data repository (setup from the app) | `docs/11-new-user.md` |

The data repo has its own `CLAUDE.md` with hledger commands and file layout.

## Stack

Vue 3 (latest stable, `<script setup lang="ts">`) · Vite 8 · Tailwind CSS 4 (CSS-first config,
no tailwind.config.js) · Nuxt UI v4 in plain-Vue mode · Vue Router · Pinia · Zod 4 · decimal.js ·
vite-plugin-pwa · idb-keyval · vue-echarts · date-fns · Vitest · Playwright · Wrangler 4.
Node 24 LTS, pnpm.

Nuxt UI in plain Vue (no Nuxt):
- `vite.config.ts`: `import ui from '@nuxt/ui/vite'` → `plugins: [vue(), ui()]` (it brings Tailwind;
  no separate `@tailwindcss/vite` needed).
- `main.ts`: `import ui from '@nuxt/ui/vue-plugin'` → `app.use(router); app.use(ui)`.
- `src/assets/main.css`: `@import "tailwindcss"; @import "@nuxt/ui";`
- `App.vue` wraps everything in `<UApp>`; `index.html` root is `<div id="app" class="isolate">`.
- With pnpm, install `tailwindcss` and `vue-router` at the root (or `shamefully-hoist=true`).
- Use semantic colors (`primary`, `neutral`, …), not raw Tailwind palette classes.
- For real slot names, read `node_modules/.nuxt-ui/ui/<component>.ts` instead of guessing.
- Official Claude Code skill: `skills/nuxt-ui` in github.com/nuxt/ui (install into `~/.claude/skills/`).

## Commands

```sh
pnpm dev            # local dev server
pnpm test           # vitest (unit + golden tests against hledger output)
pnpm test:e2e       # playwright
pnpm build          # production build to dist/
pnpm lint           # eslint + vue-tsc
npx wrangler deploy # deploy dist/ (normally done by Cloudflare Workers Builds on push)
```

hledger 1.52.1 must be installed locally to regenerate golden test fixtures
(`pnpm fixtures`, see docs/05-ledger-core.md).

## Layout

```
src/
  ledger/        pure TypeScript, no Vue: parser, formatter, posting builder, validation, reports
  lists/         pure TypeScript: shopping list (Markdown checklist in ledger-data)
  github/        GitHub REST client (tree, contents, check-runs)
  offline/       IndexedDB cache + outbox queue
  stores/        Pinia: journal, sync, settings
  pages/         one file per screen
  components/
  assets/main.css   @import "tailwindcss"; @import "@nuxt/ui";
tests/
  fixtures/      *.journal + expected hledger JSON output
```

## Hard rules

1. **Never use floats for money.** Use decimal.js everywhere amounts are parsed, summed or compared.
2. **The journal text is the source of truth.** The app never stores financial data elsewhere
   (IndexedDB is only a cache + outbox). Anything the app writes must pass
   `hledger check --strict ordereddates`.
3. **Generic forms, no hidden rules**: the app writes exactly the accounts the user picks.
4. **Never generate free text into the journal.** Build a typed `Transaction`, run
   `validate()`, then `format()`. Only the formatter writes journal syntax.
5. **Every posting goes to a declared leaf account** from `accounts.journal`.
6. **Each transaction must balance per currency** (or via `@@` cost). Validate before commit.
7. `src/ledger/` has no Vue/DOM dependencies and is fully unit-tested.
8. Insert new transactions at their chronological position in `journals/<year>.journal`.
9. Tag every app-written transaction with `via:app` and `id:<ULID>`.
10. UI text in English for now (i18n later). Mobile first: bottom tab bar on phone,
   `UDashboardSidebar` on desktop.

## Glossary

- **kept for**: your money kept for a person in their pockets (`assets:<who>:...`, a label in the
  books only); received for / spent for them: `income:transfers:family:<who>` / `expenses:transfers:family:<who>`.
- **person account**: `assets:receivables:<who>` (they owe you), `liabilities:people:<who>` (a real debt).
- **pocket**: one currency balance inside an institution (e.g. `assets:neo:eur`).

