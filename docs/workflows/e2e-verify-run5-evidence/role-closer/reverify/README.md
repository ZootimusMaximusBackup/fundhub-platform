# role-closer — reverify pass (auditor, read-only)

**Who:** claude-fable-5 (reverify subagent) · **Login:** closer@fundhub.ai · **Target:** https://fundhub.ai (LIVE) · **Ran:** 2026-08-17 05:37Z – 05:44Z (UTC)

Nothing was edited outside this folder. No writes to the app: GET only on reach routes, empty `{}` POST only on routes expected to be 403 (same as the original batch-2 check). Only the login form was submitted. Password came from the gitignored `.env` via the tools; it is never printed.

## Live build check (before the first check)

```
curl -s "https://fundhub.ai/app/shell.js?nc=$RANDOM" | grep -c 'role !== "owner" && role !== "admin"'
# → 1   (2026-08-17T05:37:17Z)
```
`mountDemoBanner` on the live `shell.js` (line ~1577) reads `if (role !== "owner" && role !== "admin") return;` before its `fetch("/api/demo/mode")`. Live matches commit 2b1eed0.

## What ran, in order

| # | Command (from repo root) | Output |
|---|---|---|
| 1 | `node docs/workflows/e2e-verify-run5-evidence/role-closer/reverify/probe-role.mjs role-closer closer@fundhub.ai` — a copy of `_tools/probe-role.mjs` with ONLY the `OUT_DIR` line changed to `<journey>/reverify` (the tool derives the `-actual.md` path from the journey arg, so it could not be run with `role-closer/reverify` as the arg) | `route-probe.json`, `route-probe.md` (05:38:03Z) |
| 2 | `node docs/workflows/e2e-verify-run5-evidence/role-closer/reverify/ui-walk.mjs role-closer closer@fundhub.ai` — a copy of `_tools/ui-walk.mjs` with ONLY the `OUT_DIR` line changed the same way | `ui-walk.json`, `ui-walk.md`, `shots/00..28-*.png` (05:38:46Z) |
| 3 | `node docs/workflows/e2e-verify-run5-evidence/role-closer/reverify/demo-mode-requests.mjs` — new one-off script: signs in through the real login form, visits 11 screens, logs EVERY request/response to `/api/demo/mode` via `page.on('request')` + `page.on('response')`, and records the initiating script + line via CDP `Network.requestWillBeSent` | `demo-mode-requests.json`, `demo-mode-*.png` (05:42:06Z) |

## Headline results

* **Route probe:** login 200 ok role=closer token+cookie; session 200 role=closer; not-signed-in 6/6 → 401; should-reach 57/59 GET-probed OK (49 write-only UNVERIFIED; 2 FAIL = `/api/contracts/sign` 404, `/api/repair/exceptions` 403 — same as batch 2); should-stay-blocked 47/47 → 403, 1 UNVERIFIED (`/api/inquiry`). Identical numbers to the batch-2 run.
* **UI walk:** login left login.html, `fh_role=closer`, landed `/dashboard.html` "Loaded 27 clients", 0 API failures on landing. 27 visible / 34 sidebar links → 26 unique screens opened, all HTTP 200, 0 bounces.
* **`/api/demo/mode` across the whole walk:** **7 requests, all 403** — down from 26/26 screens (batch 2) but not zero. Screens still calling it: `closer-dashboard`, `closer-call`, `finance-os`, `client-control-panel`, `documents` (all from `/app/demo-client-bootstrap.js:23`), `ops-admin` (`/app/ops-admin.html:994` inline `load()`), `sample-data` (`/app/sample-data.html:374` inline `load()`). **Zero requests came from `shell.js`** — the shell fix is live and works on all 26 screens; the 3 other callers were never gated. Console: 7 "Failed to load resource … 403" errors (one per screen above); 0 console messages naming `demo/mode` (Chromium prints the status, not the URL, for these).
* **demo-mode-requests.mjs (the 5 requested screens):** `/dashboard.html` 0 · `/app/pipeline.html` 0 · `/app/command-center.html` 0 · `/app/ops-admin.html` **1 (403, initiator `/app/ops-admin.html:994 load`)** · `/app/staff-teams.html` 0. Login itself: 0.

See `BOARD-UPDATE.md` for the proposed board rows.
