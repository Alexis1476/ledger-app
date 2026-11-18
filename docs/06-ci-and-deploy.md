# 06 · CI and deployment

## ledger-data workflows (already written, in `ledger-data/.github/workflows/`)

| Workflow | Trigger | Does |
| --- | --- | --- |
| `check.yml` | Every push to `main` (except `reports/**`) | Installs hledger 1.52.1 (cached), runs `hledger check --strict ordereddates`, writes `reports/status.json` (+ `balances.json`, `monthly.json` when green), commits reports, fails the run if the check failed |
| `rates.yml` | Daily 05:17 UTC + manual | Fetches CHF-based rates for EUR, USD, COP from fawazahmed0/exchange-api (no key), appends `P` lines to `prices.journal`, commits |

Notes:
- Commits made with `GITHUB_TOKEN` do not trigger other workflows, so no loops.
- `rates.yml` could not be tested where it was written (network sandbox): run it once with
  "Run workflow" and check `prices.journal`; then add `include prices.journal` to `main.journal`.
- One run ≈ 20–30 s; 2000 free minutes/month for private repos.

## ledger-app CI (to create: `.github/workflows/ci.yml`)

On push and PR: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm test`, `pnpm build`.
Install hledger 1.52.1 the same way as `check.yml` so fixture checks can run
(`tests/fixtures/regenerate.sh` must leave the git tree unchanged).

## Cloudflare deployment

Workers with static assets, no server code:

```jsonc
// wrangler.jsonc
{
  "name": "ledger",
  "compatibility_date": "2026-11-01",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

1. Cloudflare dashboard → Workers → create from Git, select `ledger-app` (private repo OK).
   Build command `pnpm build`, deploy command `npx wrangler deploy`.
2. Every push to `main` deploys; other branches get preview URLs.
3. Optional: Cloudflare Access in front of the URL (free for personal use) so the app
   itself asks for a login. The app holds no data, this only hides it.
4. Optional: a custom domain with automatic HTTPS (Cloudflare → the Worker → Domains & Routes).
   (the domain's DNS must be on Cloudflare).

## PWA

vite-plugin-pwa: manifest (name, icons, `display: standalone`, theme color, `shortcuts`),
service worker precaching the app shell. API calls to api.github.com are never cached by
the service worker (the app manages its own IndexedDB cache).
