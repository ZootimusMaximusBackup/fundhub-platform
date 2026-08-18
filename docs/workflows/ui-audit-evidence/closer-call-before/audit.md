# UI audit evidence — closer-call-before as closer@fundhub.ai

Ran 2026-08-18T03:32:39.390Z against https://fundhub.ai. Login ok (role closer). Screen /app/closer-call.html → HTTP 200, final /app/closer-call.html, title "Closer · Call cockpit".

Shots: docs/workflows/ui-audit-evidence/closer-call-before/1440-fold.png · docs/workflows/ui-audit-evidence/closer-call-before/1440-full.png · docs/workflows/ui-audit-evidence/closer-call-before/390-full.png

## Load
- API calls: 4; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 1059px (fold 900) · content width 1440px (div.app-shell) · sidebar 228px
- Top-left element: header "C-01 / Closer — Closer"
- H1: No call right now · H2s: —
- Nav: 5 visible items · active: ☎Call cockpit · groups: Sales▾(5), Funding▾(0), Client ops▾(0), Automation▾(0)
- Font sizes in use (12): 24px×3, 22px×7, 14px×5, 13px×22, 12.5px×8, 12px×8, 11.5px×4, 11px×9, 10.5px×2, 10px×2, 9.5px×16, 9px×6
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 1px×3, 14px×6, 15px×2, 22px×3
- Uneven card rows: top 56: [1212,201,201,201,201,201,201]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Live numbers only — no sample funding story. | No sample story. Live survey + pull only.
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [] rows=5; numeric cols align: n/a ‖ [] rows=5; numeric cols align: n/a
- Metric-ish elements: "Cash today — — Calls held — — "@14px, "Cash today — —"@14px, "Calls held — —"@14px, "Close rate — —"@14px, "Commission MTD — see My number"@14px, "Pace to target — —"@14px, "Unlogged — clear before next c"@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 24 · api fails: 0

## Click sweep
- skipped: --no-clicks
