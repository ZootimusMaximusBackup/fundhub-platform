# role-owner re-verify — agent A (route probe, Command Center, Hiring)

Read-only re-check of two FIXED-UNCLICKED rows plus 5 PASS spot-checks, on the **live site** `https://fundhub.ai`, signed in as `owner@fundhub.ai`. Nothing edited outside this folder. No production writes: GET only on reach routes; empty `{}` POST only to the 2 routes that must answer 403; the only form submitted was the login form.

Files owned by A in this folder: `probe-role.mjs` (copy of `_tools/probe-role.mjs`, only `OUT_DIR` changed), `route-probe.json`, `route-probe.md`, `command-center-prove.mjs`, `command-center-shot.png`, `command-center-network.json`, `command-center-summary.json`, `hiring-shot.png`, `hiring-board-shot.png`, `hiring-network.json`, `hiring-summary.json`, `README-A.md`, `BOARD-UPDATE-A.md`. Everything else here (ui-walk*, shots/, staff-teams-*, ops-admin-*, messages-*, README-B, BOARD-UPDATE-B) belongs to agent B.

## Live build check

```
date -u                                     # Mon Aug 17 05:37:26 UTC 2026
curl -s "https://fundhub.ai/app/shell.js?nc=$RANDOM" | grep -c 'role !== "owner" && role !== "admin"'   # → 1
```
Result `1` = the shell.js on live carries the 2b1eed0 fingerprint.

## Commands (all from repo root)

| When (UTC) | Command | Output |
|---|---|---|
| 2026-08-17T05:37:39Z | `node docs/workflows/e2e-verify-run5-evidence/role-owner/reverify/probe-role.mjs role-owner owner@fundhub.ai` | `route-probe.json`, `route-probe.md` |
| 2026-08-17T05:44:14Z → 05:44:57Z (final run) | `node docs/workflows/e2e-verify-run5-evidence/role-owner/reverify/command-center-prove.mjs` | `command-center-*.{png,json}`, `hiring-*.{png,json}` |

`command-center-prove.mjs` is my own script (selectors learned from the fixer's `fixed/command-center-prove.mjs` and `fixed/hiring-prove.mjs`; nothing copied from `fixed/` output). One real Chromium session: `/login.html` → fill email + password → click Sign in → landed on `/app/command-center.html` (owner HOME) → network idle + 2 s → measure + screenshot → same session `/app/hiring.html` → network idle + 2 s → measure + 2 screenshots. It was run 4 times while I corrected my own recorder (over-eager `key=` redaction, then the raw `items` shape of `/api/hiring/candidates`, then adding the scrolled board shot); the files on disk are from the last run. Owner logins by A in total: 5 (1 probe + 4 browser), all HTTP 200. The rate limiter counts failures only (`src/auth/login.mjs` LIMITS), so this cost nothing.

`POST /api/auth/login` body shows `parse: failed` in `command-center-network.json` only because the page navigated away before Playwright could read the body; status 200 + landing on command-center + `localStorage fh_role=owner` prove the sign-in.

## Results in one screen

| Check | Result |
|---|---|
| Command Center (ticket 5) | **CONFIRMED-FIXED** — 12 API calls on load, all 200 (session, kpis, agents, health, org-brand, demo/mode, 6× dashboard/pipeline). 0 metric nodes whose text is a dash (checked 70 nodes: .stage-count, .stage-dollar, .rail-total, .kpi-value, .hold-chip .count, #cc-pipeline-meta, #cc-active-clients, #holdsEmpty) and 0 leaf elements anywhere on the page whose text is exactly `—`/`-`/`–`. Meta `16 active clients · 0 moved forward today · counts only`. Holds panel `No holds. A hold will show here when a file is waiting.` (empty state; "no holds feed yet" absent), 0 hold chips. 53 stage chips across 6 rails (sales 10 stages total 16; the other 5 rails 200 with total 0). KPI values `$0, 0, 0, 0, 0, 0`. Rail totals `16,0,0,0,0,0` + R-07 blank with copy "No affiliate referrals or applicants in this summary yet." (empty state, not a dash). 0 pageerrors, 0 console errors. |
| Hiring (ticket 3) | **CONFIRMED-FIXED** — GET `/api/hiring/candidates?state=all&limit=200` 200, items 3, flags null on all 3 (API still sends null); board rendered 3 cards (`#board [data-app]`), APPS mapped 3 with flags as arrays 3/3. No `reading 'length'` pageerror. Leftover (not this ticket): 1 pageerror `Cannot read properties of undefined (reading 'label')` and the yellow `loading hiring…` bar is still on screen after the board paints; `#footNote` reads `hr · api/hiring/* · read-only · org: fundhub`. 8 API calls on load, all 200. |
| Spot-checks | login 200 ok role=owner token+cookie; session 200 role=owner; not-signed-in 6/6 → 401; Hiring 6/6 OK (5× 200, application 400 without id); Reading data 39/40 probe OK + 3/3 extra GETs OK (agent-context 400, agent-shadow-log 200, tradelines 400) = 42/43, 1 FAIL banking-surface 403 plaid-config (unchanged), 2 UNVERIFIED (POST-only); privacy/erasure 200; blocked 2/2 → 403 (chat/portal-message POST {}, read/company-brain-affiliate POST {}). |

Live vs the fixer's localhost proof (differences, none worse): all 6 pipeline rails answer 200 on live (fixer saw 4 rails 503 locally), so 53 stage chips instead of 16 and no "Could not load this board" copy; meta says `0 moved forward today` (fixer: 1) — time-of-day data.
