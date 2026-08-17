# UI audit evidence — products-commissions as owner@fundhub.ai

Ran 2026-08-17T06:22:07.117Z against https://fundhub.ai. Login ok (role owner). Screen /app/products-commissions.html → HTTP 200, final /app/products-commissions.html, title "Fundhub — Products & Commissions".

Shots: docs/workflows/ui-audit-evidence/products-commissions/1440-fold.png · docs/workflows/ui-audit-evidence/products-commissions/1440-full.png · docs/workflows/ui-audit-evidence/products-commissions/390-full.png

## Load
- API calls: 6; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "SetupProducts & Commissions Effective 2026-07-27 View payout ledger → + Add prod"
- H1: Products & Commissions · H2s: —
- Nav: 33 visible items · active: ⛁Products & Commissions · groups: Sales▾(6), Funding▾(4), Client ops▾(5), Watch▾(3), Automation▾(4), Marketing▾(4), Admin▾(5), Portals▾(2)
- Font sizes in use (11): 22px×4, 14.5px×1, 13px×1, 12.5px×20, 12px×1, 11.5px×10, 11px×16, 10.5px×3, 10px×17, 9.5px×7, 9px×1
- Primary-looking (filled) buttons: 2 — "+ Add product", "Chat"
- Generic labels: none · targets under 40px: 2
- Off-8px-scale spacing values: 14px×5, 13px×1
- Uneven card rows: top 80: [1164,282,282,282,282]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Product | Category | Default price | Variable | Min | Max | Rails] rows=5; numeric cols align: Product=start, Default price=start/tnum, Min=start/tnum, Max=start/tnum
- Metric-ish elements: "PC-00 / PRODUCTS53 with variab"@13px, "PC-00 / PRODUCTS53 with variab"@13px, "PC-00 / ACTIVE RULES0front-end"@13px, "PC-00 / ACCRUED$0owed, not yet"@13px, "PC-00 / PAID MTD$0july 2026"@13px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table.grid, thead, tr, th, th, th · text under 11px: 62 · api fails: 0

## Click sweep
- 11 clicked of 11 candidates (cap 80) · tally: OK=7, GONE=2, NOOP=2

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "View payout ledger →" | 152×51 | OK |  |  |
| 2 | button "+ Add product" | 109×51 | OK |  |  |
| 3 | button "Products" | 87×40 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 4 | button "Commission rules" | 149×40 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 5 | button "Search⌘K" | 99×36 | OK |  |  |
| 6 | button "Chat" | 52×52 | OK |  |  |
| 7 | tr "$32 Diagnosticdiagnosticdiagnostic$32Fixed$32$32—" | 1162×57 | OK |  |  |
| 8 | tr "Card Stacking DFYcard-stacking-dfyfunding$3,000Variable$3,00" | 1162×57 | NOOP |  | docs/workflows/ui-audit-evidence/products-commissions/clicks/08-NOOP-Card_Stacking_DFYcard_stacking.png |
| 9 | tr "Consulting Services Packageconsulting-packageconsulting$1,00" | 1162×57 | OK |  |  |
| 10 | tr "Credit Repair Bundlerepair-bundlerepair$2,000Variable$2,000$" | 1162×57 | NOOP |  | docs/workflows/ui-audit-evidence/products-commissions/clicks/10-NOOP-Credit_Repair_Bundlerepair_bun.png |
| 11 | tr "Inquiry Removalinquiry-removalinquiry_removal$0Variable$0$0—" | 1162×56 | OK |  |  |
