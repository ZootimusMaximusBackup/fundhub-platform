# UI audit evidence — closer-dashboard-client-livefix as closer@fundhub.ai

Ran 2026-08-17T19:37:45.208Z against https://fundhub.ai. Login ok (role closer). Screen /app/closer-dashboard.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → HTTP 200, final /app/closer-dashboard.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521, title "Fundhub — Closer Dashboard".

Shots: docs/workflows/ui-audit-evidence/closer-dashboard-client-livefix/1440-fold.png · docs/workflows/ui-audit-evidence/closer-dashboard-client-livefix/1440-full.png · docs/workflows/ui-audit-evidence/closer-dashboard-client-livefix/390-full.png

## Load
- API calls: 9; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "Fundhub / Closer Dashboard Org: Fundhub Mon, Aug 17, 3:37:56 PM EDT LIVE"
- H1: — · H2s: —
- Nav: 5 visible items · active: ★Closer Dashboard · groups: Sales▾(5), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (6): 28px×4, 14px×56, 13px×1, 12px×1, 11px×36, 10px×1
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 1
- Off-8px-scale spacing values: 9px×1, 18px×1, 13px×2, 15px×2, 10px×10, 2px×6, 14px×1
- Uneven card rows: top 304: [1164,576,576]; top 400: [544,267,267]
- ALL-CAPS runs: 6 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: Lender list is empty — import CSV on Lenders
- Tables: [Client | Stage | Next | When] rows=3; numeric cols align: n/a ‖ [Lender | Limit | Balance | Headroom | Draw] rows=3; numeric cols align: n/a ‖ [Method | 12mo | 24mo | 36mo] rows=4; numeric cols align: n/a ‖ [] rows=3; numeric cols align: ?=right ‖ [Card | APR | Min. Payment] rows=1; numeric cols align: n/a
- Metric-ish elements: "T— TEST — Closer Role closer C"@14px, "Total Available Credit —"@14px, "Lender matches (live list) 0 L"@14px, "Net Cash to Client $0"@14px, "Monthly Obligation $0 / mo"@14px, "fundhub-closer · v1 org: fundh"@11px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: div.stat-tiles, div.stat-tile, div.stat-label, div.stat-value, div.stat-tile, div.stat-label · text under 11px: 1 · api fails: 0

## Click sweep
- skipped: --no-clicks
