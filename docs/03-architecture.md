# 03 · Architecture

```
Phone / PC ── loads app ──► Cloudflare Workers (static assets only, no data)
    │
    │ GitHub REST API (fine-grained token)
    ▼
ledger-data (private repo) ── push ──► GitHub Actions: hledger check + JSON reports
    ▲
    └── PC: git pull/push, hledger CLI, importers
```

No server of my own. The phone only talks to Cloudflare (to load the app) and to
api.github.com (to read/write the journal). Each saved entry is one commit on `main`.

## Authentication

- Fine-grained personal access token, access to **only** `ledger-data`.
- Permissions: Contents read/write, Actions read (Metadata read is implicit). Fine-grained tokens
  have no "Checks" permission, so CI status comes from the Actions API.
- Expiry 1 year; the app warns 30 days before (`GET /user` is not needed; store the expiry date entered at setup).
- Stored in IndexedDB on each device. Entered once in Settings with owner/repo/branch.

## Reading

1. On start: `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` → list of files + blob `sha`.
2. Download only files whose `sha` changed since the cache:
   `GET /repos/{owner}/{repo}/contents/{path}` with header `Accept: application/vnd.github.raw+json`.
3. Resolve `include` lines from `main.journal` (simple globs like `journals/*.journal`).
4. Parse everything, cache the parsed result + file shas in IndexedDB. The app opens instantly
   from cache (also offline), then refreshes.

## Writing

1. Build `Transaction` → `validate()` → `format()` (docs/05).
2. Target file: `journals/<year of date>.journal` (create it and add an `include` line to
   `main.journal` if missing — two files, so use the Git Data API for a single commit, see 5).
3. Insert the text at its chronological position (after the last transaction with date ≤ new date).
4. `PUT /repos/{owner}/{repo}/contents/{path}` with base64 content, the file's current `sha`,
   and a message like `add: 2026-11-02 Migros 84.35 CHF` (`edit:` / `del:` for changes).
5. Multi-file changes (new year file + include, imports): Git Data API
   (create blobs → tree → commit → update ref) to produce one commit.
6. Edit / delete: rewrite only the line range `src.startLine..src.endLine` of that transaction.
7. On HTTP 409 (sha changed elsewhere): re-read the file, re-apply the change, retry once.
8. After success: store the returned commit sha, update cache, start CI polling.

## Offline

- Entries made offline go to an IndexedDB outbox, each with its ULID.
- Flush on the `online` event and on app start, in order, one commit per entry.
- Before appending, check that no transaction with the same `id:` tag already exists (idempotent replays).

## Validation layers

hledger cannot run on the phone. The app validates in TypeScript before committing; the real
`hledger check` runs in CI a few seconds later and the app shows the result.

| Layer | Where | When | Checks | On failure |
| --- | --- | --- | --- | --- |
| 1. Form | Zod schema in the form | While typing | Required fields, valid date, amount > 0 with ≤ 2 decimals, account exists, currency known, splits sum to amount | Save button disabled, message under the field |
| 2. Pre-commit | `src/ledger/validate.ts` | Before each commit | Balanced per currency (costs converted), ≤ 1 implicit amount, accounts and commodities declared, chronological insertion, whole file re-parses, assertions recomputed | No commit, entry kept as local draft |
| 3. CI (authoritative) | GitHub Actions `check.yml` | Every push | `hledger check --strict ordereddates` | Commit marked failed, GitHub email, red banner in the app with file:line from the log |
| 4. PC (optional) | git `pre-commit` hook | Local commit | Same command as CI | Commit refused |

### Reading the CI result

1. Keep the commit `sha` returned by the write.
2. Poll `GET /repos/{owner}/{repo}/actions/runs?head_sha={sha}` (workflow `check`) every 5 s for up to 90 s,
   then again on each app start.
3. CI also writes `reports/status.json`: `{ "sha", "ok", "checkedAt", "log" }`.
   Parse `file:line:col` from `log` (hledger error format) to link to the faulty transaction.
4. Home screen badge: green (last commit passed), orange (running), red (failed + link).

### Fixing from the phone

- **Edit**: open the transaction at the line hledger reported.
- **Undo**: restore the file content from before the last commit and commit it (a revert).

## Limits

- 5000 API requests/hour with a token: far above personal use.
- Contents API serves files up to 1 MB in standard mode; one file per year stays far below
  (≈ 150 bytes per transaction).
- GitHub Actions: 2000 free minutes/month for private repos; one run takes ≈ 20–30 s.

## Other files the app writes

`lists/*.md` (shopping list): not journal data, loaded with the journals and written with
`journal.saveFile(path, update, message)`: the change is applied to the current text and, on a
409, re-applied on the refreshed text. The list keeps its pending changes in localStorage until
they are committed.
