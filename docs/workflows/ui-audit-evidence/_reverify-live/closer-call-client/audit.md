# UI audit evidence — _reverify-live/closer-call-client as closer@fundhub.ai

Ran 2026-08-17T20:13:47.447Z against https://fundhub.ai. Login ok (role closer). Screen /app/closer-call.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → HTTP 200, final /app/closer-call.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521, title "Closer · Call cockpit".

Shots: docs/workflows/ui-audit-evidence/_reverify-live/closer-call-client/1440-fold.png · docs/workflows/ui-audit-evidence/_reverify-live/closer-call-client/1440-full.png · docs/workflows/ui-audit-evidence/_reverify-live/closer-call-client/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 1172px (fold 900) · content width 1440px (div.app-shell) · sidebar 228px
- Top-left element: header "C-01 / Closer No open shift TEST — Closer Role"
- H1: TEST Client Role · H2s: —
- Nav: 5 visible items · active: ☎Call cockpit · groups: Sales▾(5), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (12): 24px×3, 22px×7, 14px×5, 13px×10, 12.5px×24, 12px×8, 11.5px×5, 11px×9, 10.5px×2, 10px×2, 9.5px×23, 9px×6
- Primary-looking (filled) buttons: 2 — "Save · next call", "Chat"
- Generic labels: none · targets under 40px: 15
- Off-8px-scale spacing values: 1px×3, 14px×6, 15px×2, 22px×3
- Uneven card rows: top 56: [1212,201,201,201,201,201,201]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: Belief failed
- Empty-state wording: none
- Tables: [] rows=1; numeric cols align: n/a ‖ [] rows=4; numeric cols align: n/a
- Metric-ish elements: "Cash today $0 0 deposits Calls"@14px, "Cash today $0 0 deposits"@14px, "Calls held 0 0 no-shows"@14px, "Close rate — this month"@14px, "Commission MTD — Open My numbe"@14px, "Pace to target — Open My numbe"@14px, "Unlogged 14 clear before next "@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 34 · api fails: 0

## Click sweep
- skipped: --no-clicks
