# UI audit evidence — products-commissions-mlfix as owner@fundhub.ai

Ran 2026-08-17T19:38:22.766Z against https://fundhub.ai. Login ok (role owner). Screen /app/products-commissions.html → HTTP 200, final /app/products-commissions.html, title "Fundhub — Products & Commissions".

Shots: docs/workflows/ui-audit-evidence/products-commissions-mlfix/1440-fold.png · docs/workflows/ui-audit-evidence/products-commissions-mlfix/1440-full.png · docs/workflows/ui-audit-evidence/products-commissions-mlfix/390-full.png

## Load
- API calls: 6; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "SetupProducts & Commissions View payout ledger → + Add product"
- H1: Products & Commissions · H2s: —
- Nav: 5 visible items · active: ⛁Products & Commissions · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(5), Portals▾(0)
- Font sizes in use (7): 28px×4, 18px×1, 14px×29, 13px×1, 12px×1, 11px×43, 10px×1
- Primary-looking (filled) buttons: 2 — "+ Add product", "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 14px×5, 13px×1
- Uneven card rows: top 80: [1164,282,282,282,282]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Product | Category | Default price | Variable | Min | Max | Rails] rows=5; numeric cols align: Product=start, Default price=right/tnum, Min=right/tnum, Max=right/tnum
- Metric-ish elements: "PC-00 / PRODUCTS53 with variab"@14px, "PC-00 / PRODUCTS53 with variab"@14px, "PC-00 / ACTIVE RULES0front-end"@14px, "PC-00 / ACCRUED$0owed, not yet"@14px, "PC-00 / PAID MTD$0august 2026"@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table.grid, thead, tr, th, th, th · text under 11px: 1 · api fails: 0

## Click sweep
- skipped: --no-clicks
