# UI audit evidence — sample-data as owner@fundhub.ai

Ran 2026-08-17T06:30:03.298Z against https://fundhub.ai. Login ok (role owner). Screen /app/sample-data.html → HTTP 200, final /app/sample-data.html, title "FundHub — Demo Mode".

Shots: docs/workflows/ui-audit-evidence/sample-data/1440-fold.png · docs/workflows/ui-audit-evidence/sample-data/1440-full.png · docs/workflows/ui-audit-evidence/sample-data/390-full.png

## Load
- API calls: 5; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Demo Mode · H2s: —
- Nav: 33 visible items · active: ⌗Demo ModeBETA · groups: Sales▾(6), Funding▾(4), Client ops▾(5), Watch▾(3), Automation▾(4), Marketing▾(4), Admin▾(5), Portals▾(2)
- Font sizes in use (7): 14.5px×1, 13px×9, 12px×3, 11.5px×4, 11px×5, 10.5px×1, 10px×1
- Primary-looking (filled) buttons: 3 — "Turn Demo Mode ON", "Wipe demo data…", "Chat"
- Generic labels: none · targets under 40px: 3
- Off-8px-scale spacing values: 14px×1, 13px×1
- Uneven card rows: top 120: [1164,1162]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | Demo Mode | Turn Demo Mode ON | Wipe demo data… | Demo Mode is OFF — demo rows are hidden.
- Loading wording after settle: Wipe demo data…
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 29 · api fails: 0

## Click sweep
- 6 clicked of 6 candidates (cap 80) · tally: NOOP=2, WRITE-INTERCEPTED=2, DIALOG=1, OK=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | NOOP |  | docs/workflows/ui-audit-evidence/sample-data/clicks/01-NOOP-Dismiss.png |
| 2 | button "Turn Demo Mode ON" | 159×40 | WRITE-INTERCEPTED | POST /api/demo/mode 599 · WRITE POST /api/demo/mode {enabled} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/sample-data/clicks/02-WRITE-INTERCEPTED-Turn_Demo_Mode_ON.png |
| 3 | button "Turn OFF (hide)" | 128×42 | WRITE-INTERCEPTED | POST /api/demo/mode 599 · WRITE POST /api/demo/mode {enabled} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/sample-data/clicks/03-WRITE-INTERCEPTED-Turn_OFF_hide_.png |
| 4 | button "Wipe demo data…" | 143×40 | DIALOG | dialog: confirm "Wipe ALL demo data for this org?" |  |
| 5 | button "Search⌘K" | 99×36 | NOOP |  | docs/workflows/ui-audit-evidence/sample-data/clicks/05-NOOP-Search_K.png |
| 6 | button "Chat" | 52×52 | OK |  |  |
