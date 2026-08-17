# UI audit evidence — sample-data/fixed as owner@fundhub.ai

Ran 2026-08-17T10:31:10.475Z against https://fundhub.ai. Login ok (role owner). Screen /app/sample-data.html → HTTP 200, final /app/sample-data.html, title "FundHub — Demo Mode".

Shots: docs/workflows/ui-audit-evidence/sample-data/fixed/1440-fold.png · docs/workflows/ui-audit-evidence/sample-data/fixed/1440-full.png · docs/workflows/ui-audit-evidence/sample-data/fixed/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Demo Mode · H2s: —
- Nav: 5 visible items · active: ⌗Demo ModeBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(5), Portals▾(0)
- Font sizes in use (6): 18px×1, 14px×10, 13px×1, 12px×1, 11px×12, 10px×1
- Primary-looking (filled) buttons: 2 — "Turn Demo Mode ON", "Chat"
- Generic labels: none · targets under 40px: 3
- Off-8px-scale spacing values: 14px×1, 13px×2
- Uneven card rows: top 120: [899,897]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | Demo Mode | Turn Demo Mode ON | Demo Mode is OFF — demo rows are hidden. | Deletes the demo rows counted above and the demo records linked to them, and turns Demo Mode off. This cannot be undone. | Wipe demo data…
- Loading wording after settle: Wipe demo data…
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 4 · api fails: 0

## Click sweep
- 5 clicked of 5 candidates (cap 80) · tally: OK=3, WRITE-INTERCEPTED=1, DIALOG=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "Turn Demo Mode ON" | 169×41 | WRITE-INTERCEPTED | POST /api/demo/mode 599 · WRITE POST /api/demo/mode {enabled} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/sample-data/fixed/clicks/02-WRITE-INTERCEPTED-Turn_Demo_Mode_ON.png |
| 3 | button "Wipe demo data…" | 153×43 | DIALOG | dialog: confirm "Delete 7 demo rows for this org?

7 clients. The demo records linked to them go too, and Demo Mode turns off.

This cannot be undone." |  |
| 4 | button "Search⌘K" | 99×36 | OK |  |  |
| 5 | button "Chat" | 52×52 | OK |  |  |
