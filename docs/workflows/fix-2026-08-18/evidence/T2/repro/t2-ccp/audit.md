# UI audit evidence — t2-ccp as owner@fundhub.ai

Ran 2026-08-19T02:48:49.584Z against https://fundhub.ai. Login ok (role owner). Screen /app/client-control-panel.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → HTTP 200, final /app/client-control-panel.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521, title "Fundhub — Client Control Panel".

Shots: docs/workflows/ui-audit-evidence/t2-ccp/1440-fold.png · docs/workflows/ui-audit-evidence/t2-ccp/1440-full.png · docs/workflows/ui-audit-evidence/t2-ccp/390-full.png

## Load
- API calls: 8; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "/ Client Control Panel"
- H1: — · H2s: —
- Nav: 6 visible items · active: ◎Client Control Panel · groups: Sales▾(0), Funding▾(0), Client ops▾(6), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (2): 16px×84, 13px×8
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 3
- Off-8px-scale spacing values: 5px×7, 11px×7, 3px×1, 10px×2, 13px×1, 14px×2, 9px×4, 7px×3, 6px×3
- Uneven card rows: top 56: [136,170,158]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: Lender list is empty — import CSV on Lenders.
- Tables: none
- Metric-ish elements: "—"@16px/tnum, "—"@16px/tnum, "0"@16px/tnum, "EX — · EQ — · TU —"@16px/tnum, "—"@16px/tnum, "Credit EX — · EQ — · TU —"@16px, "Credit EX — · EQ — · TU —"@16px, "FUNDHUB-CCP · live ORG: fb789b"@13px

## Mobile (390×844)
- Horizontal overflow: YES (scrollWidth 691) · sidebar visible true (228px) · burger true · elements past right edge: div.record-id, div.record-pick, select#ccp-pick, div.record-fields, div.rf-tile, div.rf-label · text under 11px: 0 · api fails: 0

## Click sweep
- 0 clicked of 19 candidates (cap 0) · tally: 

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
