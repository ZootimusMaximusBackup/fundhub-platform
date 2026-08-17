# BOARD-UPDATE-A — role-owner re-verify (agent A: Command Center, Hiring, route probe)

Board: `docs/workflows/fable-audit-2026-08-16.md`. Line numbers are 1-indexed as of the read on 2026-08-17T05:37Z. Auditor A did NOT edit the board; the parent applies these. Evidence prefix `E/` = `docs/workflows/e2e-verify-run5-evidence/role-owner/reverify/`. Live site `https://fundhub.ai` (shell.js fingerprint 1 = commit 2b1eed0), login `owner@fundhub.ai`, probe 2026-08-17T05:37:39Z, browser run 2026-08-17T05:44:14Z–05:44:57Z.

## Fixed rows re-verified

### Row A1 — Findings table, line 603 (S4 Command Center)

Original (verbatim):

```
| role-owner | S4 UI: landing screen detail | Command Center loads live data without failed calls; no controls the owner cannot use | leftover metric dashes []. Meta 16 active clients · 1 moved forward today. Holds empty, no chips. KPI $0 1 0 0 0 0. 503 rails empty+0 not dashes | docs/workflows/e2e-verify-run5-evidence/role-owner/fixed/ | FIXED-UNCLICKED | fixer |
```

Proposed replacement:

```
| role-owner | S4 UI: landing screen detail | Command Center loads live data without failed calls; no controls the owner cannot use | LIVE re-run: 12 API calls on load, all 200 (6× dashboard/pipeline 200 — no 503 rails on live). 0 hardcoded dashes: 70 metric nodes checked (.stage-count/.stage-dollar/.rail-total/.kpi-value/.hold-chip .count/#cc-pipeline-meta/#cc-active-clients/#holdsEmpty) + 0 leaf elements anywhere reading "—". Meta "16 active clients · 0 moved forward today · counts only". Holds "No holds. A hold will show here when a file is waiting." (empty state, "no holds feed yet" gone), 0 hold chips. 53 stage chips (sales total 16, other 5 rails 0). KPI $0 0 0 0 0 0. R-07 rail total blank with "No affiliate referrals or applicants in this summary yet." (empty state, not a dash). 0 pageerrors | docs/workflows/e2e-verify-run5-evidence/role-owner/reverify/command-center-shot.png · reverify/command-center-summary.json · reverify/command-center-network.json | CONFIRMED-FIXED | claude-fable-5 (reverify) |
```

### Row A2 — section "## role-owner (batch 1)" Steps table, line 854 (S4)

Original (verbatim):

```
| S4 UI: landing screen detail | Command Center loads its data without forbidden/failed API calls; no controls the owner cannot use | leftover metric dashes []. Meta 16 active clients · 1 moved forward today. Holds empty (no chips). KPI $0/1/0/0/0/0. 503 rails show empty + 0, not dashes | role-owner/fixed/command-center-shot.png · role-owner/fixed/command-center-network.json | FIXED-UNCLICKED |
```

Proposed replacement:

```
| S4 UI: landing screen detail | Command Center loads its data without forbidden/failed API calls; no controls the owner cannot use | LIVE re-run 2026-08-17T05:44Z: 12/12 API calls 200 (session, kpis, agents, health, org-brand, demo/mode, 6× pipeline). Leftover metric dashes 0/70 nodes; 0 dash-only leaf elements page-wide. Meta "16 active clients · 0 moved forward today · counts only". Holds empty state text, 0 chips. 53 stage chips; rail totals 16/0/0/0/0/0 + R-07 empty-state copy. KPI $0/0/0/0/0/0. 0 pageerrors, 0 console errors | role-owner/reverify/command-center-shot.png · role-owner/reverify/command-center-summary.json · role-owner/reverify/command-center-network.json | CONFIRMED-FIXED (claude-fable-5 reverify) |
```

### Row A3 — failure block, lines 859–863 (Command Center)

Original (verbatim):

```
**role-owner · S4 landing — Command Center pipeline summary and holds are unwired placeholders (MEDIUM)**
- Expected: every dash is live data or removed (no dead furniture).
- Observed (re-run 2026-08-17, owner@fundhub.ai, localhost:8888 `/app/command-center.html`): leftover metric dashes `[]`. Meta `16 active clients · 1 moved forward today · counts only`. Footer `16 active clients`. Holds empty copy, 0 hold chips. Stage chips painted from pipeline (16 chips; sales 200 + card-stacking 200; other rails 503 → "Could not load this board" + total 0). KPI values `$0 1 0 0 0 0`.
- Evidence: `role-owner/fixed/command-center-shot.png`, `role-owner/fixed/command-center-network.json`.
- Status: FIXED-UNCLICKED.
```

Proposed replacement (append one line; keep the fixer's lines as history):

```
**role-owner · S4 landing — Command Center pipeline summary and holds are unwired placeholders (MEDIUM)**
- Expected: every dash is live data or removed (no dead furniture).
- Observed (re-run 2026-08-17, owner@fundhub.ai, localhost:8888 `/app/command-center.html`): leftover metric dashes `[]`. Meta `16 active clients · 1 moved forward today · counts only`. Footer `16 active clients`. Holds empty copy, 0 hold chips. Stage chips painted from pipeline (16 chips; sales 200 + card-stacking 200; other rails 503 → "Could not load this board" + total 0). KPI values `$0 1 0 0 0 0`.
- Evidence: `role-owner/fixed/command-center-shot.png`, `role-owner/fixed/command-center-network.json`.
- Re-verified on LIVE (auditor A, 2026-08-17T05:44Z, real Chromium, https://fundhub.ai): 12/12 API calls 200 (all 6 pipeline rails 200 on live — no 503s), 0 dash metric nodes of 70, 0 dash-only leaf elements page-wide, Meta `16 active clients · 0 moved forward today · counts only`, Holds `No holds. A hold will show here when a file is waiting.` + 0 chips, 53 stage chips, KPI `$0 0 0 0 0 0`, R-07 total blank with empty-state copy (not a dash). Evidence: `role-owner/reverify/command-center-shot.png`, `role-owner/reverify/command-center-summary.json`, `role-owner/reverify/command-center-network.json`.
- Status: CONFIRMED-FIXED (claude-fable-5 reverify).
```

### Row A4 — failure block, lines 865–869 (Hiring)

Original (verbatim):

```
**role-owner · S5 UI walk — Hiring screen crashes on live rows (MEDIUM)**
- Expected: hiring.html renders the board from /api/hiring/candidates.
- Observed (re-run 2026-08-17, owner@fundhub.ai, localhost:8888 `/app/hiring.html`): GET `/api/hiring/candidates` 200. Board painted 3 cards. Mapped flags are `[]` (API still sends null). No pageerror `null (reading 'length')`.
- Evidence: `role-owner/fixed/hiring-shot.png`, `role-owner/fixed/hiring-network.json`.
- Status: FIXED-UNCLICKED. Left (not this ticket): a later pageerror `undefined (reading 'label')` can still leave the yellow "loading hiring…" bar after the board paints.
```

Proposed replacement (append one line; keep the fixer's lines as history):

```
**role-owner · S5 UI walk — Hiring screen crashes on live rows (MEDIUM)**
- Expected: hiring.html renders the board from /api/hiring/candidates.
- Observed (re-run 2026-08-17, owner@fundhub.ai, localhost:8888 `/app/hiring.html`): GET `/api/hiring/candidates` 200. Board painted 3 cards. Mapped flags are `[]` (API still sends null). No pageerror `null (reading 'length')`.
- Evidence: `role-owner/fixed/hiring-shot.png`, `role-owner/fixed/hiring-network.json`.
- Re-verified on LIVE (auditor A, 2026-08-17T05:44Z, same Chromium session, https://fundhub.ai): GET `/api/hiring/candidates?state=all&limit=200` 200, items 3, flags null 3/3 in the API body; board rendered 3 cards (`#board [data-app]`), APPS 3 with flags arrays 3/3; 8/8 API calls 200; pageerrors = 1: `Cannot read properties of undefined (reading 'label')` — no `reading 'length'`. Leftover still present: yellow `loading hiring…` bar stays on screen after the board paints (`#footNote` itself reads `hr · api/hiring/* · read-only · org: fundhub`). Evidence: `role-owner/reverify/hiring-shot.png`, `role-owner/reverify/hiring-board-shot.png`, `role-owner/reverify/hiring-summary.json`, `role-owner/reverify/hiring-network.json`.
- Status: CONFIRMED-FIXED for the `flags:null` crash (claude-fable-5 reverify). The `'label'` pageerror + stuck loading bar remain open, separate ticket.
```

### Row A5 — ticket table, line 1085 (ticket 3)

Original (verbatim):

```
| 3 | hiring screen crashes on flags: null | role-owner / owner@fundhub.ai | `public/app/hiring.html` | FIXED-UNCLICKED |
```

Proposed replacement:

```
| 3 | hiring screen crashes on flags: null | role-owner / owner@fundhub.ai | `public/app/hiring.html` | CONFIRMED-FIXED on live 2026-08-17T05:44Z (claude-fable-5 reverify; 3 cards render, no 'length' pageerror; 'label' pageerror + "loading hiring…" bar still open — not this ticket) |
```

### Row A6 — ticket table, line 1087 (ticket 5)

Original (verbatim):

```
| 5 | Command Center pipeline counts and Holds hardcoded dashes | role-owner / owner@fundhub.ai | `public/app/command-center.html` | FIXED-UNCLICKED |
```

Proposed replacement:

```
| 5 | Command Center pipeline counts and Holds hardcoded dashes | role-owner / owner@fundhub.ai | `public/app/command-center.html` | CONFIRMED-FIXED on live 2026-08-17T05:44Z (claude-fable-5 reverify; 0 dashes of 70 metric nodes, Holds empty state, 12/12 API 200) |
```

Note for the parent: Findings line 604 (S5 UI walk) also carries the hiring `null.length` clause. Agent B owns that row (ui-walk); when B's replacement is applied, the hiring clause should read "hiring.html: no `null.length` pageerror, board renders 3 cards; leftover `'label'` pageerror keeps the loading bar (reverify/hiring-summary.json)".

## Spot-checks (PASS rows) — from A's own probe run 2026-08-17T05:37:39Z (`reverify/route-probe.json`, `reverify/route-probe.md`) and the browser run

| Findings line | Section line | Step | Original Observed (short) | A's observed (live, own run) | Evidence | Verdict |
|---|---|---|---|---|---|---|
| 574 | 825 | S1 sign in | Login 200 ok=true role=owner token=true cookie=true; session 200 role=owner; browser sign-in left login.html, 0 API fails, localStorage role=owner | Login HTTP 200, ok=true, role=owner, token=true, cookie=true; /api/auth/session 200 role=owner; browser: POST /api/auth/login 200 → landed /app/command-center.html, localStorage fh_role=owner, hasToken=true; not-signed-in 6/6 → 401 | reverify/route-probe.json (login, session, unauth) · reverify/command-center-network.json (login) | PASS-STILL |
| 590 | 841 | S2 reach: Hiring (6/6) | 6/6 OK (5× 200; application 400 without id); candidates items(3) … | 6/6 OK: bench 200, candidates 200, decisions 200, funnel 200, postings 200, application 400 bad_request (no id). Browser: candidates body items 3 | reverify/route-probe.md (Every probe, hiring rows) · reverify/hiring-network.json | PASS-STILL |
| 596 | 847 | S2 reach: Reading data (42/43, banking-surface 403 config) | 42/43 OK; 1 FAIL banking-surface 403 plaid; 2 UNVERIFIED | Probe: 40 probed → 39 OK (28× 200, 11× 400 need client_id/param), 1 FAIL /api/read/banking-surface GET 403 "banking surface requires plaid configuration"; A's extra GETs: agent-context 400, agent-shadow-log 200, tradelines 400 → 42/43 OK total; 2 UNVERIFIED (company-brain, finance-ask POST-only). Owner-only reads staff, invoices, failed-events, commissions, my-numbers all 200 | reverify/route-probe.md (Failures — should reach; Every probe) · reverify/command-center-summary.json spotCheckExtraGets | PASS-STILL (same 1 known config 403, LOW) |
| 593 | 844 | S2 reach: privacy | erasure GET 200 | /api/privacy/erasure GET 200 | reverify/route-probe.md | PASS-STILL |
| 602 | 853 | S3 blocked 2/2 → 403 | chat/portal-message POST {} 403; read/company-brain-affiliate POST {} 403 | /api/chat/portal-message POST {} → 403 forbidden; /api/read/company-brain-affiliate POST {} → 403 forbidden (2/2, 0 FAIL) | reverify/route-probe.md (Should stay blocked 2/2) | PASS-STILL |

Whole-probe totals for reference: should reach 88/90 probed OK · 64 UNVERIFIED (write-only) · 2 FAIL (contracts/sign 404 by design — already UNVERIFIED on the board; banking-surface 403 config — already LOW on the board); should stay blocked 2/2 → 403; not signed in 6/6 → 401. Group counts intended vs actual unchanged from the board's Doc gaps row (line 605).

## Extra findings (not rows)

- Live differs from the fixer's localhost proof in the good direction: all 6 pipeline rails 200 (fixer saw 4× 503), so 53 stage chips instead of 16 and no "Could not load this board" text. CHANGED-NOT-REGRESSION.
- Hiring: `Cannot read properties of undefined (reading 'label')` pageerror still fires on live and the yellow `loading hiring…` bar stays at the bottom after the board paints (hiring-shot.png, hiring-board-shot.png). Known leftover, still open.
- Hiring KPI tile "Human Override Rate" shows `—` with caption "0 of 0 decisions differed" — a genuine 0÷0 no-data state on the hiring page, not the Command Center ticket.
