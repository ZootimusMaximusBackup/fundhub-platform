# UI audit evidence — hiring as owner@fundhub.ai

Ran 2026-08-17T06:28:07.581Z against https://fundhub.ai. Login ok (role owner). Screen /app/hiring.html → HTTP 200, final /app/hiring.html, title "Fundhub — Hiring".

Shots: docs/workflows/ui-audit-evidence/hiring/1440-fold.png · docs/workflows/ui-audit-evidence/hiring/1440-full.png · docs/workflows/ui-audit-evidence/hiring/390-full.png

## Load
- API calls: 8; failing: none
- Console errors: pageerror: Cannot read properties of undefined (reading 'label')

## DOM read (1440×900)
- Page height 3373px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Hiring · H2s: —
- Nav: 33 visible items · active: ⊕HiringBETA · groups: Sales▾(6), Funding▾(4), Client ops▾(5), Watch▾(3), Automation▾(4), Marketing▾(4), Admin▾(5), Portals▾(2)
- Font sizes in use (15): 22px×4, 18px×1, 15px×2, 14.5px×1, 13px×7, 12.5px×28, 12px×6, 11.5px×85, 11px×147, 10.5px×19, 10px×16, 9.5px×69, 9px×36, 8.5px×12, 8px×3
- Primary-looking (filled) buttons: 2 — "all stages3", "Chat"
- Generic labels: none · targets under 40px: 15
- Off-8px-scale spacing values: 14px×11, 13px×7, 10px×5, 9px×3
- Uneven card rows: top 120: [1164,223,223,223,223,223]; top 1360: [244,234,242]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | DEMO Candidate — Juniper Vale | DEMO Candidate — Cedar Holt | DEMO Candidate — Maple Crest
- Loading wording after settle: loading hiring…
- Error wording: 0 failed · LinkedIn unverified | Scores are advisory. No candidate may be rejected without a named human and a written reason; the database enforces this | Rejected | >= 4 AND stage_key <> 'rejected' | rejected
- Empty-state wording: 0 of 0 decisions differed | nothing here
- Tables: [Role | Bench (1:1 + offer, open) | Shortfall | Open applications | Awaiting screen | Awaiting group interview | Hiring manager | Flags] rows=3; numeric cols align: Shortfall=start, Open applications=start/tnum ‖ [Candidate | Role | Stage | Status | Average | Recommendation | Rubric | Why it is here | In stage] rows=0; numeric cols align: n/a ‖ [Posting | Role | Channel | Location | Status | Published | Posted | Applications | Last 7d | Last synced] rows=0; numeric cols align: n/a ‖ [Source | Role | Applications | Currently at or past group interview | Currently at or past 1:1 | Currently at or past offer | Hired | Rejected | Hire rate %] rows=0; numeric cols align: n/a ‖ [When | Decision | Move | Role | Source | Decided by | Recommendation at decision | Score | Followed?] rows=0; numeric cols align: n/a
- Metric-ish elements: "HR-00 / BENCH0 / 12shortfall 1"@13px, "HR-00 / BENCH0 / 12shortfall 1"@13px, "HR-00 / OPEN APPLICATIONS3stat"@13px, "HR-00 / NEEDS A HUMAN3flagged "@13px, "HR-00 / POSTINGS POSTED1 / 10 "@13px, "HR-00 / HUMAN OVERRIDE RATE—0 "@13px, "0"@12.5px/tnum, "4"@12.5px/tnum, "3"@12.5px/tnum, "1stage applied"@12.5px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table#benchTbl.grid, thead, tr, th, th, th · text under 11px: 174 · api fails: 0

## Click sweep
- 20 clicked of 20 candidates (cap 80) · tally: OK=13, NOOP=4, GONE=3

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "Reset filters" | 123×51 | NOOP | console: pageerror: Cannot read properties of undefined (reading 'label') | docs/workflows/ui-audit-evidence/hiring/clicks/02-NOOP-Reset_filters.png |
| 3 | button "flagged = 1" | 87×24 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/clicks/03-NOOP-flagged_1.png |
| 4 | button "all stages3" | 92×24 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/clicks/04-NOOP-all_stages3.png |
| 5 | button "Applied1" | 74×24 | OK |  |  |
| 6 | button "Screening1" | 86×24 | OK |  |  |
| 7 | button "Group Interview1" | 123×24 | OK |  |  |
| 8 | button "1:1 Interview0" | 111×24 | OK |  |  |
| 9 | button "Offer0" | 62×24 | OK |  |  |
| 10 | button "Hired0" | 62×24 | NOOP |  | docs/workflows/ui-audit-evidence/hiring/clicks/10-NOOP-Hired0.png |
| 11 | button "Onboarding0" | 92×24 | OK |  |  |
| 12 | button "Ramp (60-day trial)0" | 147×24 | OK |  |  |
| 13 | button "Performing0" | 92×24 | OK |  |  |
| 14 | button "Not Moving Forward0" | 141×24 | OK |  |  |
| 15 | button "Withdrawn0" | 86×24 | OK |  |  |
| 16 | button "DCDEMO Candidate — Juniper ValeCloser · inbound · platform_d" | 244×196 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 17 | button "DCDEMO Candidate — Cedar HoltCloser · inbound · platform_dem" | 234×196 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 18 | button "DCDEMO Candidate — Maple CrestCloser · inbound · platform_de" | 242×196 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 19 | button "Search⌘K" | 99×36 | OK |  |  |
| 20 | button "Chat" | 52×52 | OK |  |  |
