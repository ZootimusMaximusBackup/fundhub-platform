# UI audit evidence — client-control-panel/nonsales-fix as advisor@fundhub.ai

Ran 2026-08-17T19:28:51.253Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/client-control-panel.html → HTTP 200, final /app/client-control-panel.html, title "Fundhub — Client Control Panel".

Shots: docs/workflows/ui-audit-evidence/client-control-panel/nonsales-fix/1440-fold.png · docs/workflows/ui-audit-evidence/client-control-panel/nonsales-fix/1440-full.png · docs/workflows/ui-audit-evidence/client-control-panel/nonsales-fix/390-full.png

## Load
- API calls: 4; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "/ Client Control Panel"
- H1: — · H2s: —
- Nav: 5 visible items · active: ◎Client Control Panel · groups: Sales▾(0), Funding▾(0), Client ops▾(5), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (5): 14px×52, 13px×1, 12px×1, 11px×10, 10px×1
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 1
- Off-8px-scale spacing values: 5px×7, 11px×7, 3px×1, 10px×2, 13px×1, 14px×2, 9px×1, 7px×3, 6px×3
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Bureau pulls run from the closer deck. These buttons open the live file — they do not fake a pull.
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "—"@14px, "—"@14px/tnum, "—"@14px/tnum, "—"@14px/tnum, "—"@14px/tnum, "—"@14px/tnum, "—"@14px/tnum, "Credit —"@14px, "Credit —"@14px, "FUNDHUB-CCP · live ORG: — — no"@11px

## Mobile (390×844)
- Horizontal overflow: YES (scrollWidth 491) · sidebar visible true (228px) · burger true · elements past right edge: div.record-fields, div.rf-tile, div.rf-label, div, div.rf-tile, div.rf-label · text under 11px: 1 · api fails: 0

## Click sweep
- skipped: --no-clicks
