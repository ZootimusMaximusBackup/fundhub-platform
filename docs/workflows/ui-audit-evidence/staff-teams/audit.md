# UI audit evidence — staff-teams as owner@fundhub.ai

Ran 2026-08-17T06:19:19.909Z against https://fundhub.ai. Login ok (role owner). Screen /app/staff-teams.html → HTTP 200, final /app/staff-teams.html, title "Fundhub — Staff & Teams".

Shots: docs/workflows/ui-audit-evidence/staff-teams/1440-fold.png · docs/workflows/ui-audit-evidence/staff-teams/1440-full.png · docs/workflows/ui-audit-evidence/staff-teams/390-full.png

## Load
- API calls: 7; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "SetupStaff & Teams 0 on shift + Add person"
- H1: Staff & Teams · H2s: —
- Nav: 33 visible items · active: ⚇Staff & Teams · groups: Sales▾(6), Funding▾(4), Client ops▾(5), Watch▾(3), Automation▾(4), Marketing▾(4), Admin▾(5), Portals▾(2)
- Font sizes in use (11): 22px×4, 14.5px×1, 13px×1, 12.5px×1, 12px×1, 11.5px×11, 11px×11, 10.5px×5, 10px×7, 9.5px×6, 9px×1
- Primary-looking (filled) buttons: 2 — "+ Add person", "Chat"
- Generic labels: none · targets under 40px: 4
- Off-8px-scale spacing values: 14px×5, 13px×1
- Uneven card rows: top 80: [1164,282,282,282,282]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Person | Access — role preset | Consent | Clock | Status] rows=1; numeric cols align: n/a
- Metric-ish elements: "ST-00 / HEADCOUNT1across 6 rol"@13px, "ST-00 / HEADCOUNT1across 6 rol"@13px, "ST-00 / ON SHIFT0clocked in ri"@13px, "ST-00 / CONSENT0/1monitoring c"@13px, "ST-00 / PENDING0invited, not y"@13px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: button.tab, table#rosterTbl.grid, thead, tr, th, th · text under 11px: 55 · api fails: 0

## Click sweep
- 9 clicked of 9 candidates (cap 80) · tally: OK=6, NOOP=1, GONE=2

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "+ Add person" | 120×35 | OK |  |  |
| 2 | button "Roster" | 72×40 | NOOP |  | docs/workflows/ui-audit-evidence/staff-teams/clicks/02-NOOP-Roster.png |
| 3 | button "Advanced permissions" | 179×40 | OK |  |  |
| 4 | button "Clock & consent" | 141×40 | OK |  |  |
| 5 | button "Telemetry" | 95×40 | OK |  |  |
| 6 | button "Advanced permissions →" | 187×29 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 7 | tr "CSChris Stanbridgechris@fundhub.aiOwnerClients · Money · Mes" | 1162×56 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 8 | button "Search⌘K" | 99×36 | OK |  |  |
| 9 | button "Chat" | 52×52 | OK |  |  |
