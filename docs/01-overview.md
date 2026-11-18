# 01 · Overview

## What it is

A Progressive Web App that reads and writes an hledger journal stored in a private GitHub
repository. It is made for a phone, to record an expense in a few seconds, and works on a PC
for review and charts.

It covers what a budgeting app does (accounts in several currencies, categories with icons and
colors, loans, scheduled payments, charts), plus one thing they rarely do: knowing whose money is
whose when you keep money for someone else in your own accounts.

## Principles

1. Plain text is the source of truth. Everything stays readable and editable with the
   hledger CLI and a text editor. The app is only an interface.
2. Zero paid hosting: Cloudflare Workers (static assets), GitHub API (storage),
   GitHub Actions (validation and reports).
3. Single user, one device at a time: no conflict-resolution UI, a personal access token is enough.
4. Money is never a float: decimal arithmetic everywhere.
5. Know at any time whose money is whose, in every currency.

## Currencies

One reference currency (CHF by default) and any others. One institution can hold several
(e.g. a bank with a CHF and a EUR pocket). Totals are converted with daily rates written to
`prices.journal` by CI.

## Out of scope

Automatic bank sync, multi-user, end-to-end encryption, GPS location.

## Decisions

| Topic | Decision |
| --- | --- |
| Other people's money | Money kept for someone stays yours in the books, in pockets labelled with their name; optional reminder of what to put back. Receivables for who owes you, liabilities only for real debts (see 02). |
| Repositories | `ledger-data` (private, the journals) and `ledger-app` (this app) |
| Phone | PWA installed from the browser |
| Component library | Nuxt UI v4 (plain Vue mode), Material 3 Expressive look |
| Hosting | Cloudflare Workers with static assets |
