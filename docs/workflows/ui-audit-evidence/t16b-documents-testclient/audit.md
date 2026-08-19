# UI audit evidence — t16b-documents-testclient as owner@fundhub.ai

Ran 2026-08-19T02:55:52.206Z against https://fundhub.ai. Login ok (role owner). Screen /app/documents.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → HTTP 200, final /app/documents.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521, title "Fundhub — Documents".

Shots: docs/workflows/ui-audit-evidence/t16b-documents-testclient/1440-fold.png · docs/workflows/ui-audit-evidence/t16b-documents-testclient/1440-full.png · docs/workflows/ui-audit-evidence/t16b-documents-testclient/390-full.png

## Load
- API calls: 6; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 1871px (fold 900) · content width 1603px (table#tbl.grid) · sidebar 228px
- Top-left element: div "WorkDocuments 0 past 14 days Pending only Search⌘KTEST — Owner Role · owner · 32"
- H1: Documents · H2s: —
- Nav: 6 visible items · active: ▧Documents · groups: Sales▾(0), Funding▾(0), Client ops▾(6), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (5): 32px×4, 20px×1, 16px×54, 13px×88, 11px×1
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 14px×9, 13px×1
- Uneven card rows: top 80: [1164,282,282,282,282]
- ALL-CAPS runs: 2 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Document | Client | Class | Generated | Delivered | Signature | Age pending ↓ | Contract] rows=11; numeric cols align: n/a
- Metric-ish elements: "DC-00 / TOTAL11across four cla"@16px, "DC-00 / TOTAL11across four cla"@16px, "DC-00 / AWAITING SIGNATURE3sen"@16px, "DC-00 / UNDELIVERED4generated,"@16px, "DC-00 / OLDEST PENDING2dSoft P"@16px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table#tbl.grid, thead, tr, th, th, th · text under 11px: 0 · api fails: 0

## Click sweep
- skipped: --no-clicks
