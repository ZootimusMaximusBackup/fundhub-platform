# UI audit evidence — products-commissions/fixed as owner@fundhub.ai

Ran 2026-08-17T10:28:49.213Z against https://fundhub.ai. Login ok (role owner). Screen /app/products-commissions.html → HTTP 200, final /app/products-commissions.html, title "Fundhub — Products & Commissions".

Shots: docs/workflows/ui-audit-evidence/products-commissions/fixed/1440-fold.png · docs/workflows/ui-audit-evidence/products-commissions/fixed/1440-full.png · docs/workflows/ui-audit-evidence/products-commissions/fixed/390-full.png

## Load
- API calls: 6; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "SetupProducts & Commissions View payout ledger → + Add product"
- H1: Products & Commissions · H2s: —
- Nav: 5 visible items · active: ⛁Products & Commissions · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(5), Portals▾(0)
- Font sizes in use (7): 28px×4, 18px×1, 14px×20, 13px×1, 12px×1, 11px×52, 10px×1
- Primary-looking (filled) buttons: 2 — "+ Add product", "Chat"
- Generic labels: none · targets under 40px: 4
- Off-8px-scale spacing values: 14px×5, 13px×1
- Uneven card rows: top 80: [1164,282,282,282,282]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Product | Category | Default price | Variable | Min | Max | Rails] rows=5; numeric cols align: Product=start, Default price=start/tnum, Min=start/tnum, Max=start/tnum
- Metric-ish elements: "PC-00 / PRODUCTS53 with variab"@14px, "PC-00 / PRODUCTS53 with variab"@14px, "PC-00 / ACTIVE RULES0front-end"@14px, "PC-00 / ACCRUED$0owed, not yet"@14px, "PC-00 / PAID MTD$0august 2026"@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table.grid, thead, tr, th, th, th · text under 11px: 4 · api fails: 0

## Click sweep
- 11 clicked of 11 candidates (cap 80) · tally: OK=7, GONE=2, NOOP=2

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "View payout ledger →" | 180×35 | OK |  |  |
| 2 | button "+ Add product" | 127×35 | OK |  |  |
| 3 | button "Products" | 90×41 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 4 | button "Commission rules" | 154×41 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 5 | button "Search⌘K" | 99×36 | OK |  |  |
| 6 | button "Chat" | 52×52 | OK |  |  |
| 7 | tr "$32 Diagnosticdiagnosticdiagnostic$32Fixed$32$32—" | 1162×61 | OK |  |  |
| 8 | tr "Card Stacking DFYcard-stacking-dfyfunding$3,000Variable$3,00" | 1162×61 | NOOP |  | docs/workflows/ui-audit-evidence/products-commissions/fixed/clicks/08-NOOP-Card_Stacking_DFYcard_stacking.png |
| 9 | tr "Consulting Services Packageconsulting-packageconsulting$1,00" | 1162×61 | OK |  |  |
| 10 | tr "Credit Repair Bundlerepair-bundlerepair$2,000Variable$2,000$" | 1162×61 | NOOP |  | docs/workflows/ui-audit-evidence/products-commissions/fixed/clicks/10-NOOP-Credit_Repair_Bundlerepair_bun.png |
| 11 | tr "Inquiry Removalinquiry-removalinquiry_removal$0Variable$0$0—" | 1162×60 | OK |  |  |
