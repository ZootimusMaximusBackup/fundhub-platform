# T5 — Messaging, opt-out & inbound mail · evidence

Branch `fix/T5-messaging-optout-inbound`, off `origin/main` at `d3fb2c7`.

## How to read this

**The before-state was proven on the live site. The after-state was not, and cannot be.**
The fixes are on a branch. They are not deployed, and deploying is Chris's merge, not mine —
`/unsubscribe.html` and `/api/public/unsubscribe` still answer **404 on `https://fundhub.ai`**
as of the last check in this folder. So:

| What | How it was proven |
|---|---|
| Every defect still reproduces | Live: `https://fundhub.ai`, the production database, and public DNS |
| Every fix works | Local: 5712-test suite against a real Postgres, plus 12 real-browser checks |

Nothing in this folder was produced by writing to the production database. The probe is
`SELECT`-only and prints counts, booleans and ids — never an address, a phone number, a person's
name or a secret value.

## Files

| Path | What it is |
|---|---|
| `_probe.mjs` | The read-only production probe. `SELECT` only. |
| `before/db.json` | Production database state before the work |
| `after/db.json` | Same queries, re-run at the end — unchanged, which is the point |
| `before/baseline-test.txt` | The measured test baseline (see below) |
| `before/messaging-walk/` | Live walk of the Messaging screen as `owner@`, with screenshots |
| `playwright-check.mjs` | The browser check for both screens. Serves `public/` locally and stubs every API call. |
| `after/*.png` | What the two changed screens now do |
| `after/playwright-check.json` | 12/12 |

## The test baseline, and where it was measured

CLAUDE.md §12 warns that the recorded failure count has never been stable and that the
environment moves it. So it was measured here rather than quoted:

* **Baseline at `d3fb2c7`, before any edit: 5640 tests, 5637 pass, 3 fail, 0 skipped.**
* **After all six units: 5712 tests, 5709 pass, 3 fail, 0 skipped.**
* Same three failures, all pre-existing and none in T5's area:
  `the extraction is faithful to the code` · `an endpoint excused from the org filter still
  passes the session's org to its store` · `the app's database role holds no superuser-level
  privilege` (this last one is expected — the local role is a superuser, which is exactly what
  migration 104 exists to stop in production).
* Measured on **local PostgreSQL 16.14 (Homebrew), database `fundhub_t5`**, created for this
  work and migrated with `db/migrate.mjs` (160 migrations). Not the production database — the
  suite writes, and pg tests must never run against production.
* 72 tests added. 0 removed, 0 skipped, 0 weakened.

`npm run lint` clean (1302 files). `npm run journeys:check` and `npm run diagrams:check` both
report up to date. `npx tsc --noEmit` prints its help text and exits non-zero because this repo
has **no `tsconfig.json`** — it is plain JavaScript. That is the pre-existing baseline behaviour,
identical before and after, not a result of this work.

## What was proven live, per item

| Item | Proof |
|---|---|
| T5-01 email STOP records no opt-out | Message `e9a17306`, inbound email, body exactly `STOP`, received 2026-08-18 21:43 — and `opt_outs` held **0 rows**. Visible in the live walk as the thread `TCTEST Client Role · 5h · STOP · EMAIL · Waiting on us`. |
| T5-02 Mailgun `unsubscribed` ignored | `IGNORED_DELIVERY_EVENTS` contained it; the handler short-circuits on it before any opt-out logic. |
| T5-03 spam complaint does work | The `complained` branch writes an opt-out. Confirmed and **kept working** — its tests still pass untouched. |
| T5-04 reply lands on an arbitrary client | The matcher was `LIMIT 1` with **no `ORDER BY`** — not "the oldest", as recorded, but whichever row came back first. |
| T5-05 replies never arrive | Public DNS: `fundhub.ai` MX → `route{1,2,3}.mx.cloudflare.net`; `mg.fundhub.ai` MX → `mx{a,b}.mailgun.org`. Mail leaves from a domain nothing we run reads. |
| T5-06 router only knows YES/RESCHEDULE/CLOSE | Confirmed in code. **Not fixed — not T5's file.** |
| T5-07 SMS STOP untested | Confirmed. Also found: 2 of 32 live client phone records are not E.164, and the lookup was exact-text, so those clients' STOP resolved to nobody. |
| T5-08 / T5-12 no destination box | Live walk: 28 controls, exactly two text inputs — search and message body. No recipient control of any kind. |
| T5-09 A2P status unconfirmable | Unchanged. Vendor blocker. |
| T5-10 GoHighLevel still 401s | **Still armed.** Production has `GHL_API_KEY`, `GHL_RELAY_API_KEY` and `GHL_LOCATION_ID` set, and the adapter fence is OPEN, so the contact upsert really does fire. **Not fixed — not T5's files.** |
| T5-11 32 lorem templates | 32 of 237, all `compliance_passed = false`. They cannot be sent today; the guard added closes the one human step that would let them. |
| T5-13 test inbox is a real credit file | The bare test inbox resolves to exactly **1** client and it **is** `9af65808-…`. The test phone matches **7** clients, that file among them. Never used. |
| T5-14 173 templates promise a link | 173 email templates contain "unsubscribe" and **0** contain any URL at all. |
| T5-15 unsubscribe page missing | `/unsubscribe`, `/unsubscribe.html`, `/api/unsubscribe`, `/api/public/unsubscribe` — all 404. |
| T5-16 no proof a text lands | Email rows only ever reach `sent` or `failed`, never `delivered`. |
| T5-17 inbound reply appears in Messaging | Two inbound email rows, threaded to a client. **Works — and still works.** |

## Safety

Client `9af65808-a619-4e65-ae91-239766a006b7` was never opened, written to, emailed or texted.
No message was sent to anyone. No bureau was pulled. No card was charged. `INNGEST_EVENT_KEY`
was not touched. No deploy was run.
