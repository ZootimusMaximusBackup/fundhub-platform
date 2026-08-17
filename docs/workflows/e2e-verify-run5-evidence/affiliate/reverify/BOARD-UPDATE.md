# affiliate — proposed board updates (reverify pass, claude-fable-5)

Board: `docs/workflows/fable-audit-2026-08-16.md`. Line numbers are 1-indexed as of the board at commit 2b1eed0 (read 2026-08-17T05:37Z). The parent applies these; the auditor did not edit the board.
Evidence root for every row below: `docs/workflows/e2e-verify-run5-evidence/affiliate/reverify/`.
Live build confirmed before the first check: shell.js fingerprint grep = 1, md5 identical to `git show 2b1eed0:public/app/shell.js`.

## Fixed row re-verified

### Findings table — line 534

**Original (verbatim):**

```
| affiliate | S4 UI: landing screen detail | screen loads its data without forbidden/failed API calls; no controls the principal cannot use | Session/org-brand/affiliates OK. Footer race still on the card vs strip (separate LOW). Company Brain Ask: POST /api/read/company-brain-affiliate {} as affiliate@fundhub.ai on localhost:8888 → 400 question_required (not 401). Handler now uses requirePrincipal(["affiliate","partner"]) | docs/workflows/e2e-verify-run5-evidence/affiliate/fixed/ | FIXED-UNCLICKED | fixer |
```

**Proposed replacement:**

```
| affiliate | S4 UI: landing screen detail | screen loads its data without forbidden/failed API calls; no controls the principal cannot use | LIVE https://fundhub.ai (shell.js = 2b1eed0), 2026-08-17T05:38Z: POST /api/read/company-brain-affiliate {} with affiliate token → 400 {ok:false,error:"question_required"}; same POST with no token → 401 unauthorized. Chromium landing /app/affiliate.html: 7 /api calls (auth/login GET+POST, read/affiliates, auth/session ×2, health, org-brand) all 200, 0 console errors; Ask control visible (#brainBtn "Ask", card "Ask approved partner docs"). Footer strip race vs AFF-000001 still present (separate LOW, unchanged) | docs/workflows/e2e-verify-run5-evidence/affiliate/reverify/ask-network.json · reverify/landing-network.json · reverify/ask-shot.png | CONFIRMED-FIXED | claude-fable-5 (reverify) |
```

### Section table — line 715

**Original (verbatim):**

```
| S4 UI: landing screen detail | screen loads its data without forbidden/failed API calls; no controls the principal cannot use | Page calls /api/auth/session, /api/org-brand, /api/read/affiliates — all OK. Footer strip race vs AFF-000001 still LOW (separate). Company Brain Ask: POST {} → 400 question_required (not 401) as affiliate@fundhub.ai on localhost:8888 | affiliate/fixed/ask-network.json · affiliate/fixed/ask-shot.png | FIXED-UNCLICKED |
```

**Proposed replacement:**

```
| S4 UI: landing screen detail | screen loads its data without forbidden/failed API calls; no controls the principal cannot use | Re-verified on LIVE 2026-08-17T05:38Z (claude-fable-5 reverify): POST /api/read/company-brain-affiliate {} with token → 400 question_required; without token → 401 unauthorized. Landing /api calls all 200 (session, org-brand, read/affiliates, health, login), 0 console errors. Ask control visible. Footer strip race vs AFF-000001 still LOW (separate) | affiliate/reverify/ask-network.json · affiliate/reverify/landing-network.json · affiliate/reverify/ask-shot.png | CONFIRMED-FIXED |
```

### Failure block — lines 720-724 (append one bullet; do not delete history)

**Original block heading (verbatim):** `**affiliate · S4 landing — Company Brain "Ask" cannot work for an affiliate session (MEDIUM)**`
Original last line (verbatim): `- Status: FIXED-UNCLICKED.`

**Proposed:** replace the `- Status:` line with:

```
- Re-verified LIVE 2026-08-17T05:38Z (claude-fable-5 reverify): token POST {} → 400 question_required; no-token POST {} → 401; Ask control visible on /app/affiliate.html. Evidence: `affiliate/reverify/ask-network.json`, `affiliate/reverify/landing-network.json`, `affiliate/reverify/ask-shot.png`.
- Status: CONFIRMED-FIXED.
```

## Spot-checks (PASS rows re-run on live)

| Board line (Findings / Section) | Step | Original result | Observed now (reverify) | Evidence (reverify/) | Verdict |
|---|---|---|---|---|---|
| 503 / 684 | S1 sign in | PASS | POST /api/auth/login 200 ok=true token=true staff=null cookie=false (keys ok,token,expiresAt,principal,account); /api/auth/session 200 role=affiliate; browser left login.html, fh_role=affiliate, 0 API fails, 0 console errors | route-probe.json login/session · ui-walk.json login · shots/00-login-page.png | PASS-STILL |
| 504 / 685 | S1b landing | PASS | Landed /app/affiliate.html "Fundhub — Affiliate"; chip "TEST — Affiliate Role · affiliate · 1 tab · LIVE"; sidebar Portals → Affiliate only | shots/01-landing.png · shots/02-app-shell.png · ui-walk.json landing | PASS-STILL |
| 511 / 692 | S2 reach: Reading data (/api/read/affiliates) | PASS | GET 200 with token; also 401 without token (unauth sample 2/2 correct: org-brand, read/affiliates) | route-probe.md "Every probe" · route-probe.json reach/unauth | PASS-STILL |
| 531 / 712 | S3 blocked: social | PASS (partial) — 2/2 probed · 1 UNVERIFIED | publish POST {} → 403 forbidden; schedule POST {} → 403 forbidden; oauth UNVERIFIED (no method) | route-probe.json blocked · route-probe.md | PASS-STILL |
| 535 / 716 | S5 UI walk | PASS | 2 visible / 34 links (logo → /app/affiliate.html, Portals → Affiliate); 1 distinct screen, HTTP 200, 0 bounced, 0 API 4xx/5xx, 0 console errors | ui-walk.md · shots/03-_app_affiliate.html.png · shots/04-affiliate.html.png | PASS-STILL |
| 536 (LOW) | S3 blocked cross-group: 92 routes 401 not 403 | LOW | 91/126 → 401, 34 → 403, 1 → 400 (company-brain-affiliate, the fixed route). Only status diff vs original probe is that one route. Split did not move materially | route-probe.md "Failures — should be blocked but was not 403" (91 rows) | CHANGED-NOT-REGRESSION (92 → 91; the moved one is the fix) |

Suggested touch-up for line 536 Observed (optional): "91/126 probed blocked routes → 401 ... (34 → 403; 1 → 400 = company-brain-affiliate, now reachable per its gate)". Severity stays LOW.

## Not changed by this pass

- Row 537 (footer strip race, LOW): still visible on live in reverify/ask-shot.png ("affiliate roster loaded · no code for this session" under AFF-000001). Not re-graded; unchanged.
- Row 529 / 710 (S3 blocked: Reading data): the parenthetical "incl. /api/read/company-brain-affiliate POST {} → 401" is now stale — that route answers 400 question_required. Counts become 4/42 → 403, 37/42 → 401, 1/42 → 400. Optional wording fix only.
- Row 538 (Doc gaps): -actual.md still lists /api/read/company-brain-affiliate under **blocked** with gate "affiliate, partner"; live now honours the gate (affiliate reaches it), so the row belongs in the reach table. Doc gap remains — not touched by this pass.
