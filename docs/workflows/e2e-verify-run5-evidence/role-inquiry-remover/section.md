## role-inquiry-remover (batch 2)

**Model:** claude-fable-5  ·  **Login:** inquiry@fundhub.ai  ·  **Ran:** 2026-08-17T03:42:07Z (probe 03:36:59Z, UI walk 03:37:44Z)  ·  **Evidence:** docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/

### Steps

| Step | Expected | Observed | Evidence | Result |
|---|---|---|---|---|
| S1 sign in | login 200, ok=true, role=inquiry_specialist, token + cookie set; session 200 | HTTP 200, ok=true, role=inquiry_specialist, token=true, cookie=true; /api/auth/session 200 role=inquiry_specialist | route-probe.json login + shots/00-login-page.png, shots/01-landing.png | PASS |
| S1b landing | lands on inquiry-remover.html (shell.js HOME map) | landed at /app/inquiry-remover.html, title "Fundhub — Inquiry Remover"; header "TEST — Inquiry Specialist Role · inquiry_specialist · 24 tabs · LIVE"; empty state ("No inquiries in the database yet.", "No active cases.", queue 0/0/0); one blank red-bordered strip above "Queue by Bureau" | shots/01-landing.png, shots/02-app-shell.png | PASS |
| S2 reach: Signing in and out (intended 6, actual 6) | all 6 routes answer not 401/403/404 | 1/1 probed OK (/api/auth/login GET 200), 5 unverified (write-only) | route-probe.md | PASS |
| S2 reach: banking (intended 1, actual 1) | all 1 answer not 401/403/404 | 1/1 probed OK (400 client_id required) | route-probe.md | PASS |
| S2 reach: Campaigns (intended 6, actual 8) | all 8 answer not 401/403/404 | 6/6 probed OK (all 400 partner_id_required), 2 unverified (write-only) | route-probe.md | PASS |
| S2 reach: chat (intended 0, actual 3) | all 3 answer not 401/403/404 | 2/2 probed OK (messages 200, peers 200), 1 unverified (write-only) | route-probe.md | PASS |
| S2 reach: climate (intended 0, actual 2) | all 2 answer not 401/403/404 | 0 probed, 2 unverified (OPTIONS/none) | route-probe.md | UNVERIFIED |
| S2 reach: contracts (intended 1, actual 1) | /api/contracts/sign answers not 404 | GET without a signed link → 404 not_found (handler returns 404 by design when no valid signature is presented; api/contracts/sign.mjs line 51) | route-probe.md | UNVERIFIED |
| S2 reach: Creative Factory (intended 4, actual 7) | all 7 answer not 401/403/404 | 4/4 probed OK (all 400 partner_id_required), 3 unverified (write-only) | route-probe.md | PASS |
| S2 reach: The dashboard (intended 4, actual 6) | all 6 answer not 401/403/404 | 0 probed, 6 unverified (method "—" in actual.md) | route-probe.md | UNVERIFIED |
| S2 reach: Documents (intended 1, actual 1) | 1 answers not 401/403/404 | 0 probed, 1 unverified (POST only) | route-probe.md | UNVERIFIED |
| S2 reach: Finance (intended 4, actual 4) | all 4 answer not 401/403/404 | 3/3 probed OK (alerts 200, entities 400, liabilities 400), 1 unverified (write-only) | route-probe.md | PASS |
| S2 reach: public (intended 0, actual 3) | all 3 answer not 401/403/404 | 1/1 probed OK (partner-page 400), 2 unverified (write-only) | route-probe.md | PASS |
| S2 reach: Reading data (intended 19, actual 35) | all 35 answer not 401/403/404 | 29/30 probed OK, 5 unverified; 1 FAIL: /api/read/my-numbers GET → 403 "My numbers is for closers" (second gate in api/read/my-numbers.mjs lines 42-46 not shown in actual.md) | route-probe.md | FAIL (doc gap, not role-defining) |
| S2 reach: repair (intended 0, actual 2) | all 2 answer not 401/403/404 | 0/1 probed OK; 1 FAIL: /api/repair/exceptions GET → 403 role_forbidden (handler restricts to owner/admin at api/repair/exceptions.mjs lines 8-24, actual.md says "staff"); 1 unverified (POST) | route-probe.md | FAIL (doc gap) |
| S2 reach: social (intended 0, actual 3) | all 3 answer not 401/403/404 | 0 probed, 3 unverified (write-only / method "—") | route-probe.md | UNVERIFIED |
| S2 reach: Everything else (intended 12, actual 23) | all 23 answer not 401/403/404 | 7/7 probed OK (applications 400, inquiries 400, org-brand 200, pii 400, shifts 200, soft-pull-approve 400 bad_token, tasks 200), 16 unverified (write-only). Extra one-off: /api/inquiry?action=cases GET → 503 not_configured (INQUIRY_API_SECRET not set on this deploy) | route-probe.md; scratch one-off (status + shape only) | PASS with note |
| S2 reach: Incoming webhooks (intended 1, actual 1) | 1 answers not 401/403/404 | 0 probed, 1 unverified (signature-gated) | route-probe.md | UNVERIFIED |
| S3 blocked: Signing in and out (intended 1, actual 3) | all 3 answer 403 | 3/3 → 403 | route-probe.md | PASS |
| S3 blocked: banking (intended 2, actual 2) | all 2 answer 403 | 2/2 → 403 | route-probe.md | PASS |
| S3 blocked: chat (intended 0, actual 1) | 1 answers 403 | 1/1 → 403 | route-probe.md | PASS |
| S3 blocked: company-brain (intended 0, actual 2) | all 2 answer 403 | 2/2 → 403 | route-probe.md | PASS |
| S3 blocked: consent (intended 1, actual 1) | 1 answers 403 | 1/1 → 403 | route-probe.md | PASS |
| S3 blocked: demo (intended 0, actual 2) | all 2 answer 403 | 2/2 → 403 | route-probe.md | PASS |
| S3 blocked: Finance (intended 6, actual 6) | all 6 answer 403 | 6/6 → 403 | route-probe.md | PASS |
| S3 blocked: Hiring (intended 6, actual 6) | all 6 answer 403 | 6/6 → 403 | route-probe.md | PASS |
| S3 blocked: journeys (intended 2, actual 2) | all 2 answer 403 | 2/2 → 403 | route-probe.md | PASS |
| S3 blocked: partner-brand (intended 0, actual 1) | 1 answers 403 | 1/1 → 403 | route-probe.md | PASS |
| S3 blocked: privacy (intended 1, actual 1) | 1 answers 403 | 1/1 → 403 | route-probe.md | PASS |
| S3 blocked: proxy (intended 0, actual 2) | all 2 answer 403 | 2/2 → 403 | route-probe.md | PASS |
| S3 blocked: Reading data (intended 7, actual 11) | all 11 answer 403 | 11/11 → 403 | route-probe.md | PASS |
| S3 blocked: staff (intended 0, actual 2) | all 2 answer 403 | 2/2 → 403 | route-probe.md | PASS |
| S3 blocked: Everything else (intended 3, actual 8) | all 8 answer 403 | 8/8 → 403 | route-probe.md | PASS |
| S4 not signed in | 401 | 6/6 → 401 | route-probe.md "Not signed in" | PASS |
| S5 UI walk | every visible sidebar screen opens without a forbidden/failed API call | 24 screens opened (25 visible links; command-center listed twice), 0 bounced, 24/24 had at least one API 4xx/5xx. Distinct endpoints: GET /api/demo/mode → 403 (every screen + login/landing); GET /api/read/staff → 403 (ops-admin, agent-editor, staff-teams); GET /api/read/failed-events → 403, GET /api/read/invoices → 403, GET /api/read/messages?status=blocked → 400 (ops-admin); GET /api/read/commissions → 403 (products-commissions); GET /api/campaigns/{fatigue,list,connections,action-log,spend} → 400 partner_id_required (campaign-manager) | ui-walk.md, ui-walk.json | FAIL |

### Failure blocks (capped)

**role-inquiry-remover · S5 UI walk — /api/demo/mode 403 on every screen**
- Expected: shell loads a screen without a forbidden API call.
- Observed: public/app/shell.js mountDemoBanner (line 1582) calls GET /api/demo/mode for every staff role; api/demo/mode admits only owner/admin, so inquiry_specialist gets 403 on all 24 screens plus login and landing. Handled silently (banner not mounted); one console error per page.
- Evidence: docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/ui-walk.md (every row), ui-walk.json login.apiFails.
- Severity: LOW (cosmetic/console noise; one finding, not 26).

**role-inquiry-remover · S5 UI walk — admin screens shown in sidebar but their data APIs are 403 for this role**
- Expected: a screen the role can open loads its data, or is not offered.
- Observed: sidebar shows Ops & Admin, Agent Editor, Staff & Teams, Products & Commissions, Demo Mode to inquiry_specialist (ROLE_TABS inquiry_specialist: "staff", shell.js line 207). On open: ops-admin → /api/read/failed-events 403, /api/read/invoices 403, /api/read/staff 403; agent-editor → /api/read/staff 403; staff-teams → /api/read/staff 403 (headcount 0, "No one matches that filter"); products-commissions → /api/read/commissions 403 (product ladder real, ledger sample). Banners read "not signed in for real data" although the user is signed in — public/app/data.js line 107 folds 403 into "unauthorized".
- Evidence: shots/16-ops-admin.html.png, shots/17-agent-editor.html.png, shots/24-staff-teams.html.png, shots/25-products-commissions.html.png, ui-walk.md.
- Severity: MEDIUM (screens half-work).

**role-inquiry-remover · S2 reach: Everything else — /api/inquiry answers 503 not_configured on production**
- Expected: role-defining route /api/inquiry (inquiry_specialist, admin, owner) answers 200 for GET ?action=cases.
- Observed: 503 {ok:false, error:"not_configured"} — api/inquiry.mjs lines 31-41: INQUIRY_API_SECRET is unset on this deploy, so the phone-inquiry runtime is unreachable. Owner-set 2026-08-15: inquiry phone remover is ON HOLD (.serena/memories/inquiry-phone-remover-on-hold.md). Recorded as fact; the inquiry-remover.html screen itself does not call /api/inquiry on load (it uses /api/inquiries, /api/pii, /api/read/inquiry-cases, all reachable: inquiry-cases 200 cases[0], read/inquiries 200 items[0], pii 400 client_id required).
- Evidence: scratch one-off GET (status + shape only, no token printed); route-probe.md row /api/inquiry UNVERIFIED.
- Severity: MEDIUM per rubric (5xx from a role-defining route), consistent with owner hold.

**role-inquiry-remover · S2 reach: Reading data + repair — two routes actual.md lists as reachable answer 403**
- Expected: /api/read/my-numbers and /api/repair/exceptions answer not 403 (actual.md gate: STAFF / staff).
- Observed: /api/read/my-numbers GET → 403 "My numbers is for closers" (second gate: closer or FINANCE only, api/read/my-numbers.mjs lines 42-46). /api/repair/exceptions GET → 403 role_forbidden (owner/admin only, api/repair/exceptions.mjs lines 8-24). The journey generator reads only the first gate; the actual.md rows are wrong for both.
- Evidence: route-probe.md "Failures — should reach" table.
- Severity: DOC-GAP (LOW impact for this role; neither is role-defining for inquiry_specialist).

**role-inquiry-remover · S5 UI walk — campaign-manager sends staff reads without partner_id**
- Expected: Campaigns screen loads live data or an honest empty state.
- Observed: 5 reads (fatigue, list, connections, action-log, spend) → 400 partner_id_required; screen shows sample numbers for "Ironwood Capital Group" with "badrequest" markers and footer "campaigns · spend:badrequest · list:badrequest …".
- Evidence: shots/20-campaign-manager.html.png, ui-walk.md.
- Severity: LOW (incomplete query from the screen; sample furniture shown).

**role-inquiry-remover · S1b landing — blank red strip on Inquiry Remover screen**
- Expected: no error box when there is no error.
- Observed: an empty red-bordered pill above "Queue by Bureau". public/app/inquiry-remover.html line 352 `<div class="system-alert" id="systemAlert" hidden>`; CSS line 91 sets `.system-alert{display:flex}` which overrides `hidden`; no JS references systemAlert, so it is always drawn empty.
- Evidence: shots/01-landing.png, shots/13-inquiry-remover.html.png.
- Severity: LOW (cosmetic).

### Doc gaps (intended vs actual)

- Reach counts differ: Campaigns 6 → 8; Creative Factory 4 → 7; The dashboard 4 → 6; Reading data 19 → 35; Everything else 12 → 23. Intended file (generated 2026-08-02) is stale against code.
- Reach groups only in actual: chat (3), climate (2), public (3), repair (2), social (3).
- Blocked counts differ: Signing in and out 1 → 3; Reading data 7 → 11; Everything else 3 → 8.
- Blocked groups only in actual: chat (1), company-brain (2), demo (2), partner-brand (1), proxy (2), staff (2).
- Totals: intended 59 reach / 29 blocked; actual 106 reach / 50 blocked (156 routes).
- actual.md itself is wrong for 2 rows: /api/read/my-numbers (listed as STAFF, code adds a closer/FINANCE-only gate) and /api/repair/exceptions (listed as staff, code allows owner/admin only). The generator does not see second-stage gates.
- Intended file carries the 2026-08-02 warning that it was copied from actual.md, not hand-authored; no human judgment has replaced it yet.
