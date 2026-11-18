# ledger-app

Personal finance PWA on top of hledger journals stored in your own private GitHub repository.
No backend: the app reads and writes the journals through the GitHub API.

Start with `docs/11-new-user.md` to use it with your own data, `CLAUDE.md` and `docs/` to work on it.

## Setup

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

Install hledger 1.52.1 and put it on `PATH` (Windows: unzip `hledger-windows-x64.zip` from
https://github.com/simonmichael/hledger/releases/tag/1.52.1 into e.g. `C:\tools\hledger` and add
that folder to `PATH`), or point `HLEDGER` at the executable.

## Test locally with the website (no GitHub needed)

The dev server exposes your local `../ledger-data` checkout (plugin `vite-plugin-local-data.ts`).
The app reads and writes those files directly, and the "CI" badge runs the real
`hledger check --strict ordereddates` on your machine.

```sh
pnpm dev                                    # LEDGER_DATA_DIR defaults to ../ledger-data
HLEDGER=/path/to/hledger.exe pnpm dev       # if hledger is not on PATH
LOCAL_GIT_COMMIT=1 pnpm dev                 # also `git commit` every change in ledger-data
```

1. Open http://localhost:5173 → Settings → Source **Local folder (dev server)** → *Connect & load*.
2. Press **+** (or *New entry*), enter an amount, tap a category, Save.
3. The entry lands in `ledger-data/journals/<year>.journal` (and `include journals/<year>.journal`
   is added to `main.journal` the first time). The badge turns green when hledger accepts it.
4. Phone layout: browser dev tools → device toolbar, or open `http://<your-PC-IP>:5173` with
   `pnpm dev --host` from the phone on the same Wi-Fi.

**This writes to your real ledger-data folder.** Review with `git diff` there, and
`git checkout -- .` to throw test entries away.

## Test with the hledger CLI

```sh
cd ../ledger-data
hledger -f main.journal check --strict ordereddates     # must print nothing
hledger -f main.journal print -f journals/2026.journal  # what the app wrote (or: tail journals/2026.journal)
hledger -f main.journal bal assets:receivables liabilities      # who owes whom
hledger -f main.journal bal -X CHF --infer-market-prices
```

## Test with GitHub (the production path)

1. Create a private `ledger-data` repo (see `docs/11-new-user.md`); the app can set it up.
2. Create a fine-grained token: only that repo; Contents: Read and write, Actions: Read-only.
3. Settings → Source **GitHub repository** → token, owner, repo, branch, expiry → *Connect & load*.
4. Save an entry: it becomes one commit; the badge polls the check run (orange → green/red).
5. On the PC: `git pull` in ledger-data, then the hledger commands above.

## Automated tests

```sh
pnpm test        # unit + golden tests (parser/balances vs hledger JSON, formatter round-trip, builder recipes R1–R16)
pnpm lint        # eslint + vue-tsc
pnpm build       # production build (dist/) incl. service worker

# real data + real hledger: parse ledger-data, compare with `hledger bal`, write every kind and run `hledger check`
LEDGER_DATA_DIR=../ledger-data HLEDGER=hledger pnpm test

# browser end to end (phone + desktop viewports) on a made-up sample ledger (tests/e2e/sample-ledger.ts)
PW_CHANNEL=chrome HLEDGER=hledger pnpm test:e2e     # or: npx playwright install chromium
E2E_SOURCE_DIR=../ledger-data pnpm test:e2e         # on a temp copy of your own data instead

# GitHub API smoke test against a THROWAWAY repo
GH_SMOKE_TOKEN=github_pat_... GH_SMOKE_REPO=you/ledger-smoke pnpm gh:smoke

pnpm fixtures    # regenerate golden fixtures (needs hledger 1.52.x)
```

## Deploy

`wrangler.jsonc` serves `dist/` as static assets on Cloudflare Workers. Connect the repo in
Cloudflare → Workers → Create from Git (build `pnpm build`, deploy `npx wrangler deploy`).
See `docs/06-ci-and-deploy.md`.

## License

MIT, see `LICENSE`.
