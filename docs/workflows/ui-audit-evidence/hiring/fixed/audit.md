# UI audit evidence — hiring/fixed as owner@fundhub.ai

Ran 2026-08-17T10:29:59.091Z against https://fundhub.ai. Login ok (role owner). Screen /app/hiring.html → HTTP 200, final /app/hiring.html, title "Fundhub — Hiring".

Shots: docs/workflows/ui-audit-evidence/hiring/fixed/1440-fold.png · docs/workflows/ui-audit-evidence/hiring/fixed/1440-full.png · docs/workflows/ui-audit-evidence/hiring/fixed/390-full.png

## Load
- API calls: 9; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: pageerror: g.hire_rate_pct.toFixed is not a function

## DOM read (1440×900)
- Page height 3912px (fold 900) · content width 1530px (table#rqTbl.grid) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Hiring · H2s: —
- Nav: 5 visible items · active: ⊕HiringBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(5), Portals▾(0)
- Font sizes in use (7): 28px×5, 18px×5, 14px×125, 13px×1, 12px×1, 11px×254, 10px×1
- Primary-looking (filled) buttons: 5 — "all stages3", "all states1", "all channels1", "all0", "Chat"
- Generic labels: none · targets under 40px: 15
- Off-8px-scale spacing values: 14px×11, 13px×7, 10px×5, 9px×3
- Uneven card rows: top 120: [1232,237,237,237,237,237]; top 1320: [267,255,265]; top 2368: [1232,1230]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | shortfall 12 across 3 active roles · 3 demo rows not counted | still open, across all roles · 3 demo rows not counted | flagged or not scored · 0 still open · 3 demo rows not counted | 3 Demo Mode rows are shown on the board with a demo label and counted in none of the numbers above | 0 applications shown · 3 demo | DEMO Candidate — Juniper Vale | demo row | DEMO Candidate — Cedar Holt | DEMO Candidate — Maple Crest | showing 3 of 3 loaded applications · 3 of them seeded by Demo Mode, labelled on the card and counted nowhere · up to 200 | 0 waiting · 0 open · 3 demo not counted
- Loading wording after settle: none
- Error wording: 0 failed · LinkedIn posting unconfirmed | Scores are advisory. No candidate may be rejected without a named human and a written reason; the database enforces this | When a posting fails, the message shown is the platform’s own words, kept word for word. Rewriting it as “posting failed | Rejected
- Empty-state wording: 0 of 0 decisions differed | Nothing here turns anyone down on its own | nothing here | nothing here records race, sex or any other protected characteristic — none is collected, so a fairness check by those g
- Tables: [Role | Bench (1:1 + offer, open) | Shortfall | Open applications | Awaiting screen | Awaiting group interview | Hiring manager | Flags] rows=3; numeric cols align: Shortfall=start, Open applications=start/tnum ‖ [Candidate | Role | Stage | Status | Average | Recommendation | Rubric | Why it is here | In stage] rows=3; numeric cols align: n/a ‖ [Posting | Role | Channel | Location | Status | Published | Posted | Applications | Last 7d | Last synced] rows=2; numeric cols align: Last 7d=start/tnum ‖ [Source | Role | Applications | Currently at or past group interview | Currently at or past 1:1 | Currently at or past offer | Hired | Rejected | Hire rate %] rows=0; numeric cols align: n/a ‖ [When | Decision | Move | Role | Source | Decided by | Recommendation at decision | Score | Followed?] rows=1; numeric cols align: n/a
- Metric-ish elements: "HR-00 / BENCH0 / 12shortfall 1"@14px, "HR-00 / BENCH0 / 12shortfall 1"@14px, "HR-00 / OPEN APPLICATIONS0stil"@14px, "HR-00 / NEEDS A HUMAN0flagged "@14px, "HR-00 / POSTINGS POSTED1 / 10 "@14px, "HR-00 / HUMAN OVERRIDE RATE—0 "@14px, "0"@14px/tnum, "4"@14px/tnum, "0"@14px/tnum, "0not screened yet"@14px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table#benchTbl.grid, thead, tr, th, tbody, tr.stripe-bad · text under 11px: 4 · api fails: 0

## Click sweep
- 43 clicked of 43 candidates (cap 80) · tally: OK=22, NOOP=18, GONE=3

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "Reset filters" | 127×35 | OK | GET /api/hiring/funnel 200 · console: pageerror: g.hire_rate_pct.toFixed is not a function |  |
| 3 | button "flagged = 1" | 102×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/03-NOOP-flagged_1.png |
| 4 | button "all stages3" | 107×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/04-NOOP-all_stages3.png |
| 5 | button "Applied1" | 85×27 | OK |  |  |
| 6 | button "Screening1" | 100×27 | OK |  |  |
| 7 | button "Group Interview1" | 145×27 | OK |  |  |
| 8 | button "1:1 Interview0" | 130×27 | OK |  |  |
| 9 | button "Offer0" | 70×27 | OK |  |  |
| 10 | button "Hired0" | 70×27 | OK |  |  |
| 11 | button "Onboarding0" | 107×27 | OK |  |  |
| 12 | button "Ramp (60-day trial)0" | 175×27 | OK |  |  |
| 13 | button "Performing0" | 107×27 | OK |  |  |
| 14 | button "Not Moving Forward0" | 167×27 | OK |  |  |
| 15 | button "Withdrawn0" | 100×27 | OK |  |  |
| 16 | button "DCDEMO Candidate — Juniper ValeCloser · inbound · platform_d" | 267×220 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 17 | button "DCDEMO Candidate — Cedar HoltCloser · inbound · platform_dem" | 255×220 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 18 | button "DCDEMO Candidate — Maple CrestCloser · inbound · platform_de" | 265×220 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 19 | button "all states1" | 107×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/19-NOOP-all_states1.png |
| 20 | button "draft0" | 70×27 | OK |  |  |
| 21 | button "posted1" | 77×27 | OK |  |  |
| 22 | button "paused0" | 77×27 | OK |  |  |
| 23 | button "closed0" | 77×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/23-NOOP-closed0.png |
| 24 | button "failed0" | 77×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/24-NOOP-failed0.png |
| 25 | button "all channels1" | 122×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/25-NOOP-all_channels1.png |
| 26 | button "linkedin0" | 92×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/26-NOOP-linkedin0.png |
| 27 | button "facebook0" | 92×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/27-NOOP-facebook0.png |
| 28 | button "job_board0" | 100×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/28-NOOP-job_board0.png |
| 29 | button "internal1" | 92×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/29-NOOP-internal1.png |
| 30 | button "all0" | 55×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/30-NOOP-all0.png |
| 31 | button "advance0" | 85×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/31-NOOP-advance0.png |
| 32 | button "reject0" | 77×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/32-NOOP-reject0.png |
| 33 | button "offer0" | 70×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/33-NOOP-offer0.png |
| 34 | button "offer_accepted ∅0" | 152×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/34-NOOP-offer_accepted_0.png |
| 35 | button "offer_declined ∅0" | 152×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/35-NOOP-offer_declined_0.png |
| 36 | button "withdraw ∅0" | 107×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/36-NOOP-withdraw_0.png |
| 37 | button "hold ∅0" | 77×27 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/fixed/clicks/37-NOOP-hold_0.png |
| 38 | button "Search⌘K" | 99×36 | OK |  |  |
| 39 | button "Chat" | 52×52 | OK |  |  |
| 40 | tr "DEMO Candidate — Juniper Vale demo row291d880e-eb62-47ef-b1c" | 1530×67 | OK | GET /api/hiring/application 200 |  |
| 41 | tr "DEMO Candidate — Cedar Holt demo row519e846b-8765-47af-b1bf-" | 1530×67 | OK | GET /api/hiring/application 200 |  |
| 42 | tr "DEMO Candidate — Maple Crest demo row688467d4-7490-4075-991c" | 1530×67 | OK | GET /api/hiring/application 200 |  |
| 43 | tr "▸DEMO Closer — Cobalt Harbor Desk2a1ede40-2f71-43a1-924e-b69" | 1230×64 | OK |  |  |
