# UI audit evidence — _reverify-live/sales-floor as sales@fundhub.ai

Ran 2026-08-17T20:15:56.042Z against https://fundhub.ai. Login ok (role sales_manager). Screen /app/sales-floor.html → HTTP 200, final /app/sales-floor.html, title "Sales floor · Fundhub".

Shots: docs/workflows/ui-audit-evidence/_reverify-live/sales-floor/1440-fold.png · docs/workflows/ui-audit-evidence/_reverify-live/sales-floor/1440-full.png · docs/workflows/ui-audit-evidence/_reverify-live/sales-floor/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 1639px (fold 900) · content width 1440px (div.app-shell) · sidebar 228px
- Top-left element: header "M-01 / Sales floor 0 closers on shift TEST — Sales Manager Role"
- H1: — · H2s: —
- Nav: 4 visible items · active: ▣Sales floor · groups: Sales▾(4), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (11): 44px×2, 25px×5, 14px×1, 13px×24, 12.5px×9, 12px×2, 11.5px×24, 11px×5, 10px×1, 9.5px×25, 9px×3
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 4
- Off-8px-scale spacing values: 17px×6, 18px×6
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: Which belief failed
- Empty-state wording: 0 of 0 deposits funded | Live objection counts load here. Empty means none logged this month.
- Tables: none
- Metric-ish elements: "0"@44px/tnum, "—"@44px/tnum, "5"@13px/tnum, "0%"@13px/tnum, "—"@13px/tnum, "$5"@13px/tnum, "5"@13px/tnum, "0%"@13px/tnum, "0"@13px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 26 · api fails: 0

## Click sweep
- skipped: --no-clicks
