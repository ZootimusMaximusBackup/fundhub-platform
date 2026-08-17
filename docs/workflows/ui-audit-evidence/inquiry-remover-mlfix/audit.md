# UI audit evidence — inquiry-remover-mlfix as inquiry@fundhub.ai

Ran 2026-08-17T19:40:54.683Z against https://fundhub.ai. Login ok (role inquiry_specialist). Screen /app/inquiry-remover.html → HTTP 200, final /app/inquiry-remover.html, title "Fundhub — Inquiry Remover".

Shots: docs/workflows/ui-audit-evidence/inquiry-remover-mlfix/1440-fold.png · docs/workflows/ui-audit-evidence/inquiry-remover-mlfix/1440-full.png · docs/workflows/ui-audit-evidence/inquiry-remover-mlfix/390-full.png

## Load
- API calls: 7; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "/ Inquiry Remover Org: Fundhub Mon, Aug 17, 3:41:00 PM EDT LIVE"
- H1: — · H2s: —
- Nav: 5 visible items · active: ⊘Inquiry Remover · groups: Sales▾(0), Funding▾(0), Client ops▾(5), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (5): 14px×30, 13px×1, 12px×1, 11px×30, 10px×1
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 1
- Off-8px-scale spacing values: 9px×1, 18px×1, 10px×3, 5px×4, 2px×4, 14px×1
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Client | Bureau | Inquiry | Call State | Hold | Attempts | Status] rows=1; numeric cols align: n/a ‖ [Client | Bureau | Items | Status | Docs | Delivery | Call | Round] rows=1; numeric cols align: n/a
- Metric-ish elements: "T— TEST — Inquiry Specialist R"@14px, "Queue Left0 Worked0 Calls0 Con"@14px, "Queue Left0"@14px, "0"@14px/tnum, "Worked0"@14px, "0"@14px/tnum, "Calls0"@14px, "0"@14px/tnum, "Confirmed0"@14px, "0"@14px/tnum

## Mobile (390×844)
- Horizontal overflow: YES (scrollWidth 556) · sidebar visible true (228px) · burger true · elements past right edge: div.stat-tiles, div.stat-tile, div.stat-label, div.stat-value, div.stat-tile, div.stat-label · text under 11px: 1 · api fails: 0

## Click sweep
- skipped: --no-clicks
