# role-owner re-verify — agent B (claude-fable-5, read-only)

Live site only: `https://fundhub.ai`. No localhost. Nothing clicked except the login form and sidebar links. No writes: only GETs, plus the login POST. Password read by the tools from the gitignored `.env`; never printed.

Live build check (before the first check): `curl -s "https://fundhub.ai/app/shell.js?nc=$RANDOM" | grep -c 'role !== "owner" && role !== "admin"'` → `1` at 2026-08-17T05:37:13Z (fingerprint of commit 2b1eed0).

## What agent B owns in this folder

- `ui-walk.json`, `ui-walk.md`, `shots/*.png` — from `_tools/ui-walk.mjs`
- `staff-teams-capture.mjs`, `staff-teams-footer.json`, `staff-teams-shot.png` — ticket 2 (footer "[object Promise]")
- `messages-capture.mjs`, `messages-network.json`, `messages-api.json`, `ops-admin-shot.png` — ticket 4 (compliance gate / `read/messages?status=blocked`)
- `README-B.md`, `BOARD-UPDATE-B.md`

Sibling agent A owns `route-probe.*`, `command-center-*`, `hiring-*`, `probe-role.mjs`.

## Commands (run from repo root), UTC

| When | Command | Result |
|---|---|---|
| 05:38 | `node docs/workflows/e2e-verify-run5-evidence/role-owner/reverify/staff-teams-capture.mjs` | footer `live roster · 1 staff · signed-in user not on roster · consent 0/1`; GET /api/read/staff?limit=200 → 200; roster table 1 row; 0 API 4xx/5xx; 0 console errors → CONFIRMED-FIXED |
| 05:38 | `node docs/workflows/e2e-verify-run5-evidence/role-owner/reverify/messages-capture.mjs` | browser: GET /api/read/messages?status=blocked&limit=30 → 200 `{ok,count:0,items:[]}`; panel shows "No messages stopped by the compliance gate", no "Loading"; failed-events 200, invoices 200, staff 200; 0 API 4xx/5xx. direct API (bearer): 200, keys ok/count/limit/offset/hasMore/items, items 0 → CONFIRMED-FIXED |
| 05:39–05:42 | `node docs/workflows/e2e-verify-run5-evidence/_tools/ui-walk.mjs role-owner/reverify owner@fundhub.ai` | login left login.html, fh_role=owner, 0 API fails; landed /app/command-center.html; 34 visible / 34 links; 33 unique screens opened (command-center.html appears twice in the sidebar — same as the original run); 0 bounced; 0 403; 31/33 screens clean |

Logins used by agent B: 4 (staff-teams browser, messages browser, messages direct API, ui-walk). No rate limit hit.

## UI walk diff vs original `docs/workflows/e2e-verify-run5-evidence/role-owner/ui-walk.md`

| Screen | Original | Now | Verdict |
|---|---|---|---|
| ops-admin.html | GET /api/read/messages?status=blocked → 400 (1 fail) | 0 API fails, 0 console errors | CONFIRMED-FIXED |
| campaign-manager.html | 5× GET /api/campaigns/{spend,fatigue,connections,list,action-log} → 400 partner_id_required | same 5× 400; sample book "Ironwood Capital Group" still shown | PASS-STILL (LOW, unchanged) |
| hiring.html | pageerror `Cannot read properties of null (reading 'length')` | pageerror `Cannot read properties of undefined (reading 'label')`; footer bar still "loading hiring…"; KPI tiles render (open applications 3, needs a human 3, postings 1/1); 0 API fails | CHANGED — different error, reported for agent A's hiring grade |
| staff-teams.html | footer "[object Promise]" | 0 API fails, 0 console errors; footer is a roster sentence (see staff-teams-footer.json) | CONFIRMED-FIXED |
| all other 29 screens | clean | clean | PASS-STILL |

No new failing endpoint appeared on any previously-clean screen.

## Extra observations (not graded here)

- ops-admin.html fires `POST /api/messages-outbound` `{action:"status"}` on load (200) — a status read shaped as a POST (public/app/ops-admin.html:790). Not new, not a write. Recorded because this run logged all /api calls, not only 4xx.
- ops-admin.html period label still reads "Last 7 Days — Jul 20–26" on 2026-08-17 (already noted in the original S5 row as hardcoded). Company KPI tiles show "—" for cash collected / funded / close rate / cost per funded / new clients; "Failed events awaiting retry 2".
