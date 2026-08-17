# client — proposed board updates (re-verify pass, claude-fable-5)

Board: `docs/workflows/fable-audit-2026-08-16.md` (not edited by me — parent applies).
All Observed text below is from MY run against LIVE https://fundhub.ai (build 2b1eed0, shell.js fingerprint 1, login.html writes fh_account) on 2026-08-17 05:38–05:42Z. Evidence paths are relative to `docs/workflows/e2e-verify-run5-evidence/client/reverify/` unless written in full.

Line numbers are 1-indexed as of the board at commit 2b1eed0.

## Fixed row (FIXED-UNCLICKED → CONFIRMED-FIXED)

### Findings table — line 500

Original:

```
| client | S4 UI: landing screen detail | signed-in client sees own portal (name, agreements, documents, pre-qual, tiles), no staff-only wording | Greeting 'Welcome back, TEST'; who-name 'TEST — Client Role'; banner 'live agreements · none yet · sample documents — not signed in for real data · live entitlements · 0 unlocked · 6 locked · live pre-qual · none yet'. GET /api/read/portal-summary?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → 200 {ok:true, prequal_amount:null, prequal_display:null, soft_pull_complete:false}. fh_account.clientId=8556bedc-46e1-4d85-b0cd-a24adfee1521. No 'Open this from a client file'. Check used local patched login.html; API https://fundhub.ai | docs/workflows/e2e-verify-run5-evidence/client/fixed/ | FIXED-UNCLICKED | claude-fable-5 |
```

Replacement:

```
| client | S4 UI: landing screen detail | signed-in client sees own portal (name, agreements, documents, pre-qual, tiles), no staff-only wording | LIVE login.html, real Chromium: left login.html → /app/client-portal.html. localStorage fh_account present (keys kind, accountId, orgId, email, name, clientId, affiliateId, partnerId), kind=client, clientId=8556bedc-46e1-4d85-b0cd-a24adfee1521 (UUID). GET /api/read/portal-summary?client_id=… → 200 {ok:true, prequal_amount:null, prequal_display:null, soft_pull_complete:false}. Greeting 'Welcome back, TEST'; who-name 'TEST — Client Role'; banner 'live pre-qual · none yet · sample documents — not signed in for real data · live entitlements · 0 unlocked · 6 locked · live agreements · none yet'. 'Open this from a client file' absent from body innerText. 12 API calls: 9 × 200, 3 × 401 (dashboard/client, consent/capture, read/documents — see extra finding) | docs/workflows/e2e-verify-run5-evidence/client/reverify/capture.json · portal-network.json · portal-summary.json · 01-landing.png | CONFIRMED-FIXED | claude-fable-5 (reverify) |
```

### Section table — line 650

Original:

```
| S4 UI: landing screen detail | signed-in client sees their own portal (name, agreements, documents, pre-qual, entitlement tiles) with no forbidden/failed calls and no staff-only wording | Greeting "Welcome back, TEST"; who-name "TEST — Client Role"; banner "live agreements · none yet · sample documents — not signed in for real data · live entitlements · 0 unlocked · 6 locked · live pre-qual · none yet". GET /api/read/portal-summary?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → 200 {ok:true, prequal_amount:null, prequal_display:null, soft_pull_complete:false}. fh_account.clientId set. No "Open this from a client file". Local patched login.html; API https://fundhub.ai | docs/workflows/e2e-verify-run5-evidence/client/fixed/ | FIXED-UNCLICKED |
```

Replacement:

```
| S4 UI: landing screen detail | signed-in client sees their own portal (name, agreements, documents, pre-qual, entitlement tiles) with no forbidden/failed calls and no staff-only wording | Re-run on LIVE https://fundhub.ai/login.html (real Chromium, no local files, no proxy) 2026-08-17T05:38:37Z: final URL /app/client-portal.html; fh_account stored by the live login page (kind=client, clientId=8556bedc-46e1-4d85-b0cd-a24adfee1521, a UUID); GET /api/read/portal-summary?client_id=… → 200 {ok:true, prequal_amount:null, prequal_display:null, soft_pull_complete:false}; greeting "Welcome back, TEST"; who-name "TEST — Client Role"; banner "live pre-qual · none yet · sample documents — not signed in for real data · live entitlements · 0 unlocked · 6 locked · live agreements · none yet"; "Open this from a client file" absent from body innerText. Not fully clean: 3 of 12 portal reads answered 401 (GET /api/dashboard/client?id=…, /api/consent/capture?client_id=…&kind=dispute_authorization, /api/read/documents?client_id=…) — documents tile falls back to sample, dispute-authorization wording says "The legal wording is not on this page" (see new failure block) | reverify/capture.json · reverify/portal-network.json · reverify/portal-summary.json · reverify/01-landing.png · reverify/screen-detail.json | CONFIRMED-FIXED (core) · 3 × 401 reads = new LOW |
```

### Failure block — lines 655–658

Original heading line 655: `**client · S4 landing — signed-in client sees an empty portal: "Open this from a client file" (FIXED-UNCLICKED)**`

Proposed: change the heading tag to `(CONFIRMED-FIXED — re-verified on LIVE 2026-08-17T05:38Z, claude-fable-5)` and append one line:

```
- Re-verify (LIVE login.html, real Chromium, no local files): fh_account.clientId=8556bedc-46e1-4d85-b0cd-a24adfee1521; portal-summary 200; "Open this from a client file" absent; greeting "Welcome back, TEST". Evidence: docs/workflows/e2e-verify-run5-evidence/client/reverify/capture.json, portal-network.json, 01-landing.png.
```

Proposed NEW failure block (append after line 658):

```
**client · S4 landing — 3 portal reads answer 401 to a signed-in client (LOW)**
- Expected: the client's own portal loads with no forbidden/failed calls.
- Observed (LIVE, 2026-08-17T05:38Z and 05:41Z, two separate logins): after sign-in the portal makes 12 API calls; 9 answer 200 (auth/login GET+POST, auth/session ×2, health, org-brand, read/portal-summary, read/entitlements, read/portal-contracts) and 3 answer 401: GET /api/dashboard/client?id=<clientId> (Bearer sent; api/dashboard/client.mjs gates on ROLE_SETS.STAFF), GET /api/read/documents?client_id=<clientId>&limit=200 (Bearer sent; api/read/documents.mjs roles: ROLE_SETS.STAFF via requireAuth — account tokens look like "no session"), GET /api/consent/capture?client_id=<clientId>&kind=dispute_authorization (NO Bearer header — the dispute-authorization block's local api() helper in public/app/client-portal.html L1691-1708 sends credentials:"same-origin" only, and the account login branch sets no cookie, api/auth/login.mjs L125-131). What the client sees: banner "sample documents — not signed in for real data"; dispute-authorization box "The legal wording is not on this page. It will show here once the server has it. You can still draw your signature." (element present, not visible in the first viewport). Greeting, who-name, pre-qual, entitlements, agreements are live. No data leaked; 3 console "Failed to load resource … 401" errors.
- Evidence: docs/workflows/e2e-verify-run5-evidence/client/reverify/portal-network.json, screen-detail.json (hasAuthHeader per failed request), 02-landing-full.png.
```

## Spot-checks (PASS rows re-run from my probe + UI walk)

| Board line | Step | Original Result | My verdict | My numbers | Evidence (reverify/) |
|---|---|---|---|---|---|
| 484 / 617 | S1 sign in | PASS | PASS-STILL (one delta, not worse) | POST /api/auth/login 200 ok=true token=true staff=null cookie=false; /api/auth/session 200 role=client; browser left login.html; fh_role=client. Delta: "0 API 4xx" is now 3 API 4xx after login (the 3 portal reads above — they only fire now that fh_account is stored; login itself is clean) | route-probe.json login/session · ui-walk.json login · shots/00-login-page.png · shots/01-landing.png |
| 485 / 618 | S1b landing | PASS | PASS-STILL | Landed /app/client-portal.html "Fundhub — Client Portal"; chip "TEST — Client Role · client · 1 tab · LIVE" (01-landing.png); shell fallback loop (/app/, pipeline, command-center) ended on /app/client-portal.html; 0 sidebar links | ui-walk.json landing.appShellUrl · shots/02-app-shell.png · 01-landing.png |
| 486 / 619 | S1c not signed in | PASS | PASS-STILL | 6/6 → 401 (consent/capture, finance/soft-pull, org-brand, read/entitlements, read/portal-contracts, read/portal-summary) | route-probe.md "Not signed in" |
| 495 / 628 | S2 reach: Reading data (1/3) | PASS | PASS-STILL | entitlements 200, portal-contracts 200, portal-summary 200 with bare client token (3/3) | route-probe.md "Every probe" |
| 496 / 629 | S2 reach: Everything else (3/6) | PASS (partial) | PASS-STILL | org-brand GET 200; soft-pull-approve GET 400 bad_token (reachable); health 200 seen in the browser's own portal load; climate OPTIONS, documents-upload POST, inngest — 3 UNVERIFIED (unchanged) | route-probe.md · portal-network.json |
| 498 / 633, 636, 647 | S3 blocked: Campaigns, Creative Factory, social | PASS | PASS-STILL | Campaigns 8/8 → 403; Creative Factory 7/7 → 403; social publish + schedule POST {} → 403; oauth UNVERIFIED (method "—") | route-probe.md "Every probe" |
| 501 / 651 | S5 UI walk | PASS | PASS-STILL | 0 visible / 0 total sidebar links; 0 screens opened; staff shells bounced back to client-portal.html; login-phase apiFails=3 (the same 3 portal reads, recorded in the walk's login step, not a screen) | ui-walk.md · ui-walk.json |
| 499 (LOW) | S3 blocked: 92 × 401 instead of 403 | LOW | CHANGED-NOT-REGRESSION | Now 29/120 → 403 and 91/120 → 401 (was 28/92). The one mover: POST /api/read/company-brain-affiliate {} → 403 forbidden (was 401) — api/read/company-brain-affiliate.mjs now uses requirePrincipal(["affiliate","partner"]). Everything else identical to the 04:01Z probe. 10 UNVERIFIED unchanged | route-probe.md "Failures — should be blocked but was not 403" (91 rows) · route-probe.json |

Suggested edits for the spot-check rows: keep Result/Severity as is; append ` · re-verified LIVE 2026-08-17T05:39Z (claude-fable-5 reverify): PASS-STILL` to Observed and add `docs/workflows/e2e-verify-run5-evidence/client/reverify/route-probe.md` / `ui-walk.md` to Evidence. For line 499 append `re-verify: 29 × 403 / 91 × 401 — company-brain-affiliate now 403`.

Header line 609 suggestion: append ` · Re-verify: 2026-08-17T05:38–05:42Z (LIVE, claude-fable-5) → docs/workflows/e2e-verify-run5-evidence/client/reverify/`. Login budget line 611: `+4 logins in re-verify, 0 × 429`.
