# UI audit evidence — sales-floor-mlfix as sales@fundhub.ai

Ran 2026-08-17T19:37:59.424Z against https://fundhub.ai. Login ok (role sales_manager). Screen /app/sales-floor.html → HTTP 200, final /app/sales-floor.html, title "Sales floor · Fundhub".

Shots: docs/workflows/ui-audit-evidence/sales-floor-mlfix/1440-fold.png · docs/workflows/ui-audit-evidence/sales-floor-mlfix/1440-full.png · docs/workflows/ui-audit-evidence/sales-floor-mlfix/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 1881px (fold 900) · content width 1440px (div.app-shell) · sidebar 228px
- Top-left element: header "M-01 / Sales floor 0 closers on shift TEST — Sales Manager Role"
- H1: — · H2s: —
- Nav: 4 visible items · active: ▣Sales floor · groups: Sales▾(4), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (8): 28px×7, 14px×80, 13px×1, 12px×1, 11.5px×1, 11px×6, 10px×1, 9px×2
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 17px×6, 18px×6
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: Which belief failed
- Empty-state wording: 0 of 0 deposits funded | Live objection counts load here. Empty means none logged this month.
- Tables: none
- Metric-ish elements: "0"@28px/tnum, "—"@28px/tnum, "5"@14px/tnum, "0%"@14px/tnum, "—"@14px/tnum, "$5"@14px/tnum, "5"@14px/tnum, "0%"@14px/tnum, "0"@14px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: div.f, div.lb, div.vl, div.cv · text under 11px: 1 · api fails: 0

## Click sweep
- skipped: --no-clicks
