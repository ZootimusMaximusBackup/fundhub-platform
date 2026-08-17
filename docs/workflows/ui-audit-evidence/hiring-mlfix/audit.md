# UI audit evidence — hiring-mlfix as owner@fundhub.ai

Ran 2026-08-17T19:38:57.755Z against https://fundhub.ai. Login ok (role owner). Screen /app/hiring.html → HTTP 200, final /app/hiring.html, title "Fundhub — Hiring".

Shots: docs/workflows/ui-audit-evidence/hiring-mlfix/1440-fold.png · docs/workflows/ui-audit-evidence/hiring-mlfix/1440-full.png · docs/workflows/ui-audit-evidence/hiring-mlfix/390-full.png

## Load
- API calls: 9; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: pageerror: g.hire_rate_pct.toFixed is not a function

## DOM read (1440×900)
- Page height 4288px (fold 900) · content width 1496px (table#rqTbl.grid) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Hiring · H2s: —
- Nav: 5 visible items · active: ⊕HiringBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(5), Portals▾(0)
- Font sizes in use (7): 28px×7, 18px×1, 14px×223, 13px×1, 12px×1, 11px×158, 10px×1
- Primary-looking (filled) buttons: 5 — "all stages3", "all states1", "all channels1", "all0", "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 14px×11, 13px×7, 10px×5, 9px×3
- Uneven card rows: top 144: [1232,299,299,299,299]; top 1264: [1232,1230]; top 1504: [267,255,265]; top 2632: [1232,1230]
- ALL-CAPS runs: 4 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | shortfall 12 across 3 active roles · 3 demo rows not counted | still open, across all roles · 3 demo rows not counted | flagged or not scored · 0 still open · 3 demo rows not counted | 3 Demo Mode rows are shown on the board with a demo label and counted in none of the numbers above | 0 applications shown · 3 demo | DEMO Candidate — Juniper Vale | demo row | DEMO Candidate — Cedar Holt | DEMO Candidate — Maple Crest | showing 3 of 3 loaded applications · 3 of them seeded by Demo Mode, labelled on the card and counted nowhere · up to 200 | 0 waiting · 0 open · 3 demo not counted
- Loading wording after settle: none
- Error wording: 0 failed · LinkedIn posting unconfirmed | Scores are advisory. No candidate may be rejected without a named human and a written reason; the database enforces this | When a posting fails, the message shown is the platform’s own words, kept word for word. Rewriting it as “posting failed | Rejected
- Empty-state wording: 0 of 0 decisions differed | Nothing here turns anyone down on its own | nothing here | nothing here records race, sex or any other protected characteristic — none is collected, so a fairness check by those g
- Tables: [Role | Bench (1:1 + offer, open) | Shortfall | Open applications | Awaiting screen | Awaiting group interview | Hiring manager | Flags] rows=3; numeric cols align: Shortfall=start, Open applications=start/tnum ‖ [Candidate | Role | Stage | Status | Average | Recommendation | Rubric | Why it is here | In stage] rows=3; numeric cols align: n/a ‖ [Posting | Role | Channel | Location | Status | Published | Posted | Applications | Last 7d | Last synced] rows=2; numeric cols align: Last 7d=start/tnum ‖ [Source | Role | Applications | Currently at or past group interview | Currently at or past 1:1 | Currently at or past offer | Hired | Rejected | Hire rate %] rows=0; numeric cols align: n/a ‖ [When | Decision | Move | Role | Source | Decided by | Recommendation at decision | Score | Followed?] rows=1; numeric cols align: n/a
- Metric-ish elements: "HR-00 / BENCH0 / 12shortfall 1"@14px, "HR-00 / BENCH0 / 12shortfall 1"@14px, "HR-00 / OPEN APPLICATIONS0stil"@14px, "HR-00 / NEEDS A HUMAN0flagged "@14px, "HR-00 / POSTINGS POSTED1 / 10 "@14px, "HR-00 / HUMAN OVERRIDE RATE—0 "@14px, "0"@14px/tnum, "4"@14px/tnum, "0"@14px/tnum, "0not screened yet"@14px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table#benchTbl.grid, thead, tr, th, tbody, tr.stripe-bad · text under 11px: 1 · api fails: 0

## Click sweep
- skipped: --no-clicks
