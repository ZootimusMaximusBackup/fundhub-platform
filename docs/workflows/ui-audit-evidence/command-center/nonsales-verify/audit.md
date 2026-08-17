# UI audit evidence — command-center/nonsales-verify as owner@fundhub.ai

Ran 2026-08-17T19:42:23.221Z against https://fundhub.ai. Login ok (role owner). Screen /app/command-center.html → HTTP 200, final /app/command-center.html, title "Fundhub — Command Center".

Shots: docs/workflows/ui-audit-evidence/command-center/nonsales-verify/1440-fold.png · docs/workflows/ui-audit-evidence/command-center/nonsales-verify/1440-full.png · docs/workflows/ui-audit-evidence/command-center/nonsales-verify/390-full.png

## Load
- API calls: 12; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: — · H2s: —
- Nav: 3 visible items · active: ⌘Command CenterBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(3), Automation▾(0), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (8): 28px×59, 18px×7, 16px×1, 14px×29, 13px×1, 12px×1, 11px×210, 10px×1
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 15
- Off-8px-scale spacing values: 9px×23, 10px×71, 7px×22, 6px×47, 2px×22, 1px×2
- Uneven card rows: top 1104: [717,494]; top 1144: [466,230,230]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: none
- Error wording: Nothing to show yet. Bureau portals, job backlog, error rate and payment status will appear here once this screen reads 
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "Cash Collected Today $0 cash c"@16px, "Cash Collected Today $0 cash c"@16px, "$0"@28px/tnum, "Pipeline Movement 0 stage chan"@16px, "0"@28px/tnum, "Close Rate (30d) 0 booked → de"@16px, "Close Rate (30d)"@11px, "0"@28px/tnum, "Show Rate 0 booked calls with "@16px, "0"@28px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: div.kpi-tile, div.kpi-label, div.kpi-value, div.kpi-sub, div.kpi-tile, div.kpi-label · text under 11px: 4 · api fails: 0

## Click sweep
- skipped: --no-clicks
