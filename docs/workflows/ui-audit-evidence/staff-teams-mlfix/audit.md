# UI audit evidence — staff-teams-mlfix as owner@fundhub.ai

Ran 2026-08-17T19:38:10.124Z against https://fundhub.ai. Login ok (role owner). Screen /app/staff-teams.html → HTTP 200, final /app/staff-teams.html, title "Fundhub — Staff & Teams".

Shots: docs/workflows/ui-audit-evidence/staff-teams-mlfix/1440-fold.png · docs/workflows/ui-audit-evidence/staff-teams-mlfix/1440-full.png · docs/workflows/ui-audit-evidence/staff-teams-mlfix/390-full.png

## Load
- API calls: 7; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "SetupStaff & Teams 0 on shift + Add person"
- H1: Staff & Teams · H2s: —
- Nav: 5 visible items · active: ⚇Staff & Teams · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(5), Portals▾(0)
- Font sizes in use (7): 28px×4, 18px×1, 14px×8, 13px×1, 12px×1, 11px×31, 10px×1
- Primary-looking (filled) buttons: 2 — "+ Add person", "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 14px×5, 13px×1
- Uneven card rows: top 80: [1164,282,282,282,282]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Person | Role | Consent | Clock | Status] rows=1; numeric cols align: n/a
- Metric-ish elements: "ST-00 / HEADCOUNT1on the roste"@14px, "ST-00 / HEADCOUNT1on the roste"@14px, "ST-00 / ON SHIFT0clocked in ri"@14px, "ST-00 / CONSENT0/1monitoring c"@14px, "ST-00 / PENDING0invited, not y"@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table#rosterTbl.grid, thead, tr, th, th, th · text under 11px: 1 · api fails: 0

## Click sweep
- skipped: --no-clicks
