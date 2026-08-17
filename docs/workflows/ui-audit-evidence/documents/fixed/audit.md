# UI audit evidence — documents/fixed as advisor@fundhub.ai

Ran 2026-08-17T10:21:58.645Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/documents.html → HTTP 200, final /app/documents.html, title "Fundhub — Documents".

Shots: docs/workflows/ui-audit-evidence/documents/fixed/1440-fold.png · docs/workflows/ui-audit-evidence/documents/fixed/1440-full.png · docs/workflows/ui-audit-evidence/documents/fixed/390-full.png

## Load
- API calls: 4; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 975px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "WorkDocuments 0 past 14 days Pending only"
- H1: Documents · H2s: —
- Nav: 5 visible items · active: ▧Documents · groups: Sales▾(0), Funding▾(0), Client ops▾(5), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (7): 28px×8, 18px×1, 14px×12, 13px×1, 12px×1, 11px×79, 10px×1
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
- Metric-ish elements: "DC-00 / TOTAL4across four clas"@14px, "DC-00 / TOTAL4across four clas"@14px, "DC-00 / AWAITING SIGNATURE4sen"@14px, "DC-00 / UNDELIVERED0generated,"@14px, "DC-00 / OLDEST PENDING0dFundin"@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 4 · api fails: 0

## Click sweep
- 19 clicked of 19 candidates (cap 80) · tally: OK=17, NOOP=1, GONE=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Pending only" | 120×35 | OK |  |  |
| 2 | button "All" | 50×41 | NOOP |  | docs/workflows/ui-audit-evidence/documents/fixed/clicks/02-NOOP-All.png |
| 3 | button "Soft-pull authorizations" | 219×41 | OK |  |  |
| 4 | button "Contracts" | 98×41 | OK |  |  |
| 5 | button "Invoices" | 90×41 | OK |  |  |
| 6 | button "UnderwriteIQ deliverables" | 227×41 | OK |  |  |
| 7 | button "Search⌘K" | 99×36 | OK |  |  |
| 8 | button "Chat" | 52×52 | OK |  |  |
| 9 | div "DC-A / CLASSSoft-pull authorizations22 pending · 0 settledco" | 282×195 | OK |  |  |
| 10 | div "DC-B / CLASSContracts22 pending · 0 settledfunding agreement" | 282×195 | OK |  |  |
| 11 | div "DC-C / CLASSInvoices00 pending · 0 settledissued against a p" | 282×195 | OK |  |  |
| 12 | div "DC-D / CLASSUnderwriteIQ deliverables00 pending · 0 settledt" | 282×195 | OK |  |  |
| 13 | th "Document" | 370×37 | OK |  |  |
| 14 | th "Client" | 162×37 | OK |  |  |
| 15 | th "Class" | 160×37 | OK |  |  |
| 16 | th "Generated" | 120×37 | OK |  |  |
| 17 | th "Delivered" | 103×37 | OK |  |  |
| 18 | th "Signature" | 112×37 | OK |  |  |
| 19 | th "Age pending ↓" | 136×37 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
