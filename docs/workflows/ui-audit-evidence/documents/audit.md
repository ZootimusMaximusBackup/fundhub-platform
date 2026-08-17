# UI audit evidence — documents as advisor@fundhub.ai

Ran 2026-08-17T06:13:59.852Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/documents.html → HTTP 200, final /app/documents.html, title "Fundhub — Documents".

Shots: docs/workflows/ui-audit-evidence/documents/1440-fold.png · docs/workflows/ui-audit-evidence/documents/1440-full.png · docs/workflows/ui-audit-evidence/documents/390-full.png

## Load
- API calls: 5; failing: GET /api/demo/mode → 403
- Console errors: Failed to load resource: the server responded with a status of 403 ()

## DOM read (1440×900)
- Page height 932px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "WorkDocuments 0 past 14 days Pending only"
- H1: Documents · H2s: —
- Nav: 24 visible items · active: ▧Documents · groups: Sales▾(3), Funding▾(3), Client ops▾(5), Watch▾(3), Automation▾(3), Marketing▾(4), Admin▾(3)
- Font sizes in use (12): 22px×4, 19px×4, 14.5px×1, 13px×5, 12.5px×8, 12px×1, 11.5px×22, 11px×23, 10.5px×6, 10px×21, 9.5px×7, 9px×1
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 10
- Off-8px-scale spacing values: 14px×9, 13px×1
- Uneven card rows: top 80: [1164,282,282,282,282]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Document | Client | Class | Generated | Delivered | Signature | Age pending ↓] rows=4; numeric cols align: n/a
- Metric-ish elements: "DC-00 / TOTAL4across four clas"@13px, "DC-00 / TOTAL4across four clas"@13px, "DC-00 / AWAITING SIGNATURE4sen"@13px, "DC-00 / UNDELIVERED0generated,"@13px, "DC-00 / OLDEST PENDING0dFundin"@13px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: button.tab, button.tab, button.tab, table#tbl.grid, thead, tr · text under 11px: 57 · api fails: 1

## Click sweep
- 19 clicked of 19 candidates (cap 80) · tally: OK=16, NOOP=1, GONE=2

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Pending only" | 120×35 | OK |  |  |
| 2 | button "All" | 49×40 | NOOP |  | docs/workflows/ui-audit-evidence/documents/clicks/02-NOOP-All.png |
| 3 | button "Soft-pull authorizations" | 210×40 | OK |  |  |
| 4 | button "Contracts" | 95×40 | OK |  |  |
| 5 | button "Invoices" | 87×40 | OK |  |  |
| 6 | button "UnderwriteIQ deliverables" | 218×40 | OK |  |  |
| 7 | button "Search⌘K" | 99×36 | OK |  |  |
| 8 | button "Chat" | 52×52 | OK |  |  |
| 9 | div "DC-A / CLASSSoft-pull authorizations00 pending · 0 settledco" | 282×181 | OK |  |  |
| 10 | div "DC-B / CLASSContracts00 pending · 0 settledfunding agreement" | 282×181 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 11 | div "DC-C / CLASSInvoices00 pending · 0 settledissued against a p" | 282×181 | OK |  |  |
| 12 | div "DC-D / CLASSUnderwriteIQ deliverables00 pending · 0 settledt" | 282×181 | OK |  |  |
| 13 | th "Document" | 364×35 | OK |  |  |
| 14 | th "Client" | 161×35 | OK |  |  |
| 15 | th "Class" | 163×35 | OK |  |  |
| 16 | th "Generated" | 124×35 | OK |  |  |
| 17 | th "Delivered" | 101×35 | OK |  |  |
| 18 | th "Signature" | 116×35 | OK |  |  |
| 19 | th "Age pending ↓" | 132×35 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
