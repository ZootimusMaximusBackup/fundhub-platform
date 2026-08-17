# role-sales-manager — re-verify after ship commit 2b1eed0 (fix-induced-regression spot-check)

Read-only auditor pass. Nothing under `../fixed/` was reused. Every number here comes from these runs.

| | |
|---|---|
| Target | https://fundhub.ai (live) |
| Live build check | `curl -s "https://fundhub.ai/app/shell.js?nc=$RANDOM" \| grep -c 'role !== "owner" && role !== "admin"'` → **1** at 2026-08-17T05:47:51Z |
| Login | sales@fundhub.ai (password read from gitignored `.env` by the tools; never printed) |
| Model | claude-fable-5 (reverify) |
| Ran (UTC) | probe 2026-08-17T05:48:39Z · ui-walk 2026-08-17T05:49:12Z · spot-check 2026-08-17T05:52:01Z |
| Baseline compared against | `../route-probe.{json,md}`, `../ui-walk.{json,md}` (batch 2, 2026-08-17T03:37Z) and board `docs/workflows/fable-audit-2026-08-16.md` lines 116-135 + 372-474 |

## Commands (run from repo root)

```
# scratch copies of the _tools scripts; ONLY the OUT_DIR line was changed so output lands in reverify/
node docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/probe-role.mjs role-sales-manager sales@fundhub.ai
node docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/ui-walk.mjs role-sales-manager sales@fundhub.ai
# my own one-off: demo/mode per screen, ops-admin messages?status=blocked, localStorage fh_account, landing chip
node docs/workflows/e2e-verify-run5-evidence/role-sales-manager/reverify/spot-check.mjs
```

No writes: only GET on reach routes; empty `{}` POST only on the "should stay blocked" routes exactly as the original probe did; only the login form was submitted.

## Files

- `route-probe.json` / `route-probe.md` — 125 reach routes (72 probed, 53 write-only unverified), 31 blocked routes (30 probed), 6 unauth.
- `ui-walk.json` / `ui-walk.md` / `shots/00..27-*.png` — login → landing → 25 sidebar screens.
- `spot-check.json` / `spot-check.md` / `shots/spot-*.png` — the four side-effect checks (a)(b)(d) + landing details; (c) is white-label only, n/a here.
- `BOARD-UPDATE.md` — proposed row replacements for the parent to apply.

## Headline

- Route probe: byte-for-byte same statuses as the original (0 diffs across 72 reach + 30 blocked + 6 unauth probes). Same 3 "bad" reach rows (contracts/sign 404, banking-surface 403 plaid, repair/exceptions 403) — none are new.
- UI walk: 25 screens, 0 bounced, all HTTP 200, sidebar 26/34 — same as original. **No new failing endpoint on any screen.** Failures that disappeared: shell.js `GET /api/demo/mode → 403` on 19 screens + login + landing; `GET /api/read/messages?status=blocked → 400` on ops-admin.
- `/api/demo/mode` 403 still fires on 6 screens — from page-level code, not shell.js: closer-dashboard, finance-os, client-control-panel, documents (all load `demo-client-bootstrap.js`), ops-admin (own fetch), sample-data (own fetch). Each once (was twice on those screens before). 25→6 screens, 27→6 calls.
- ops-admin: `GET /api/read/messages?status=blocked&limit=30` → **200**; panel reads "No messages stopped by the compliance gate"; no "Loading blocked messages", no "request was rejected". `GET /api/read/failed-events` still 403 (owner/admin only; not in the fix set) so KPIs remain dashes.
- localStorage after login: keys `fh_role`, `fh_token` only. `fh_account` **absent** for this staff role (login response carries no `account`; login.html removes the key). fh_role = sales_manager.
- hiring.html direct-URL for sales_manager bounces to /app/sales-floor.html (shell.js HIRING_ONLY, unchanged in 2b1eed0; the sidebar row was already hidden in the original walk).
