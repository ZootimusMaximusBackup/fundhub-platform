# UI audit evidence — hiring-repurpose-live as owner@fundhub.ai

Ran 2026-08-18T04:18:27.784Z against https://fundhub.ai. Login ok (role owner). Screen /app/hiring.html → HTTP 200, final /app/hiring.html, title "Fundhub — Hiring".

Shots: docs/workflows/ui-audit-evidence/hiring-repurpose-live/1440-fold.png · docs/workflows/ui-audit-evidence/hiring-repurpose-live/1440-full.png · docs/workflows/ui-audit-evidence/hiring-repurpose-live/390-full.png

## Load
- API calls: 10; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 2093px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Hiring · H2s: —
- Nav: 5 visible items · active: ⊕HiringBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(5), Portals▾(0)
- Font sizes in use (5): 28px×5, 18px×1, 14px×158, 13px×1, 11px×99
- Primary-looking (filled) buttons: 5 — "all stages0", "all states1", "all channels1", "all0", "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 14px×9, 13px×6, 10px×2
- Uneven card rows: top 144: [1164,282,282,282,282]; top 1120: [1164,1162]; top 1592: [1164,1162]
- ALL-CAPS runs: 1 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | 0 still open · 3 demo rows not counted | close to starting · 3 demo rows not counted | across all roles · 3 demo rows not counted | 3 Demo Mode rows are shown on the board with a demo label and counted in none of the numbers above
- Loading wording after settle: none
- Error wording: Rejected
- Empty-state wording: nothing here
- Tables: [Role | Bench (late-stage people) | Short by | Open applications | Awaiting screen | Awaiting group interview | Hiring manager | Flags] rows=3; numeric cols align: Short by=start, Open applications=start/tnum ‖ [Candidate | Role | Stage | Status | Average | Recommendation | Rubric | Why it is here | In stage] rows=1; numeric cols align: n/a ‖ [Posting | Role | Channel | Location | Status | Published | Posted | Applications | Last 7d | Last synced] rows=2; numeric cols align: Last 7d=start/tnum ‖ [Source | Role | Applications | Now at or past group interview | Now at or past 1:1 | Now at or past offer | Hired | Rejected | Hire rate %] rows=1; numeric cols align: Applications=start/tnum, Now at or past group interview=start/tnum, Now at or past 1:1=start/tnum, Now at or past offer=start/tnum, Hired=start/tnum, Rejected=start/tnum, Hire rate %=start/tnum ‖ [When | Decision | Move | Role | Source | Decided by | Recommendation at decision | Score | Followed?] rows=1; numeric cols align: n/a
- Metric-ish elements: "SHORT BY12people, across 3 rol"@14px, "SHORT BY12people, across 3 rol"@14px, "WAITING ON YOU00 still open · "@14px, "ON THE BENCH0 / 12close to sta"@14px, "OPEN APPLICATIONS0across all r"@14px, "0"@14px/tnum, "4"@14px/tnum, "0"@14px/tnum, "0not screened yet"@14px/tnum, "0at group interview"@14px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table#benchTbl.grid, thead, tr, th, th, th · text under 11px: 0 · api fails: 0

## Click sweep
- 38 clicked of 38 candidates (cap 80) · tally: OK=20, NOOP=18

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 77×40 | OK |  |  |
| 2 | button "Reset filters" | 127×40 | OK | GET /api/hiring/funnel 200 |  |
| 3 | button "Search⌘K" | 110×40 | OK |  |  |
| 4 | button "flagged only" | 134×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/04-NOOP-flagged_only.png |
| 5 | button "all stages0" | 130×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/05-NOOP-all_stages0.png |
| 6 | button "Applied0" | 101×40 | OK |  |  |
| 7 | button "Screening0" | 120×40 | OK |  |  |
| 8 | button "Group Interview0" | 177×40 | OK |  |  |
| 9 | button "1:1 Interview0" | 158×40 | OK |  |  |
| 10 | button "Offer0" | 82×40 | OK |  |  |
| 11 | button "Hired0" | 82×40 | OK |  |  |
| 12 | button "Onboarding0" | 130×40 | OK |  |  |
| 13 | button "Ramp (60-day trial)0" | 215×40 | OK |  |  |
| 14 | button "Performing0" | 130×40 | OK |  |  |
| 15 | button "Not Moving Forward0" | 206×40 | OK |  |  |
| 16 | button "Withdrawn0" | 120×40 | OK |  |  |
| 17 | button "all states1" | 130×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/17-NOOP-all_states1.png |
| 18 | button "draft0" | 82×40 | OK |  |  |
| 19 | button "posted1" | 92×40 | OK |  |  |
| 20 | button "paused0" | 92×40 | OK |  |  |
| 21 | button "closed0" | 92×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/21-NOOP-closed0.png |
| 22 | button "failed0" | 92×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/22-NOOP-failed0.png |
| 23 | button "all channels1" | 149×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/23-NOOP-all_channels1.png |
| 24 | button "linkedin0" | 111×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/24-NOOP-linkedin0.png |
| 25 | button "facebook0" | 111×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/25-NOOP-facebook0.png |
| 26 | button "job_board0" | 120×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/26-NOOP-job_board0.png |
| 27 | button "internal1" | 111×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/27-NOOP-internal1.png |
| 28 | summary "Reports — where applications come from, and every decision m" | 1164×49 | OK |  |  |
| 29 | button "all0" | 63×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/29-NOOP-all0.png |
| 30 | button "advance0" | 101×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/30-NOOP-advance0.png |
| 31 | button "reject0" | 92×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/31-NOOP-reject0.png |
| 32 | button "offer0" | 82×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/32-NOOP-offer0.png |
| 33 | button "offer_accepted ∅0" | 187×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/33-NOOP-offer_accepted_0.png |
| 34 | button "offer_declined ∅0" | 187×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/34-NOOP-offer_declined_0.png |
| 35 | button "withdraw ∅0" | 130×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/35-NOOP-withdraw_0.png |
| 36 | button "hold ∅0" | 92×40 | NOOP |  | docs/workflows/ui-audit-evidence/hiring-repurpose-live/clicks/36-NOOP-hold_0.png |
| 37 | button "Chat" | 52×52 | OK |  |  |
| 38 | tr "▸DEMO Closer — Cobalt Harbor Desk2a1ede40-2f71-43a1-924e-b69" | 1175×64 | OK |  |  |
