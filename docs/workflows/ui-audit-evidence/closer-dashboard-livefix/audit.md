# UI audit evidence — closer-dashboard-livefix as closer@fundhub.ai

Ran 2026-08-17T19:43:10.516Z against https://fundhub.ai. Login ok (role closer). Screen /app/closer-dashboard.html → HTTP 200, final /app/closer-dashboard.html, title "Fundhub — Closer Dashboard".

Shots: docs/workflows/ui-audit-evidence/closer-dashboard-livefix/1440-fold.png · docs/workflows/ui-audit-evidence/closer-dashboard-livefix/1440-full.png · docs/workflows/ui-audit-evidence/closer-dashboard-livefix/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "Fundhub / Closer Dashboard Org: Fundhub Mon, Aug 17, 3:43:15 PM EDT LIVE"
- H1: — · H2s: —
- Nav: 5 visible items · active: ★Closer Dashboard · groups: Sales▾(5), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (11): 16px×2, 14px×2, 13px×1, 12.5px×9, 12px×2, 11.5px×1, 11px×4, 10.5px×4, 10px×6, 9.5px×4, 7.5px×2
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 2
- Off-8px-scale spacing values: 9px×1, 18px×1, 14px×1
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Client | Stage | Next | When] rows=3; numeric cols align: n/a
- Metric-ish elements: "T— TEST — Closer Role closer C"@16px, "fundhub-closer · v1 org: fundh"@10px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 17 · api fails: 0

## Click sweep
- skipped: --no-clicks
