# UI audit evidence — T12-repro-sales-floor as owner@fundhub.ai

Ran 2026-08-19T06:19:39.549Z against https://fundhub.ai. Login ok (role owner). Screen /app/sales-floor.html → HTTP 200, final /app/sales-floor.html, title "Sales floor · Fundhub".

Shots: docs/workflows/ui-audit-evidence/T12-repro-sales-floor/1440-fold.png · docs/workflows/ui-audit-evidence/T12-repro-sales-floor/1440-full.png · docs/workflows/ui-audit-evidence/T12-repro-sales-floor/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 3555px (fold 900) · content width 1440px (div.app-shell) · sidebar 228px
- Top-left element: div "M-01 / Sales floor 0 closers on shift"
- H1: — · H2s: —
- Nav: 6 visible items · active: ▣Sales floor · groups: Sales▾(6), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (6): 32px×7, 16px×160, 13px×21, 12px×1, 11px×3, 10px×1
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 17px×6, 18px×6
- Uneven card rows: none detected
- ALL-CAPS runs: 2 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: Which belief failed
- Empty-state wording: 0 of 0 deposits funded | Live objection counts load here. Empty means none logged this month.
- Tables: none
- Metric-ish elements: "0"@32px/tnum, "—"@32px/tnum, "2"@16px/tnum, "$33"@16px/tnum, "$33"@16px/tnum, "1"@16px/tnum, "$3,000"@16px/tnum, "$10,200"@16px/tnum, "1"@16px/tnum, "$1,000"@16px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: div.f, div.lb, div.vl, div.cv · text under 11px: 1 · api fails: 0

## Click sweep
- 0 clicked of 4 candidates (cap 0) · tally: 

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
