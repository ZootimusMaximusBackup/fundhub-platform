# UI audit evidence — _reverify-live/documents as advisor@fundhub.ai

Ran 2026-08-17T20:14:16.484Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/documents.html → HTTP 200, final /app/documents.html, title "Fundhub — Documents".

Shots: docs/workflows/ui-audit-evidence/_reverify-live/documents/1440-fold.png · docs/workflows/ui-audit-evidence/_reverify-live/documents/1440-full.png · docs/workflows/ui-audit-evidence/_reverify-live/documents/390-full.png

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
- Metric-ish elements: "DC-00 / TOTAL4across four clas"@14px, "DC-00 / TOTAL4across four clas"@14px, "DC-00 / AWAITING SIGNATURE4sen"@14px, "DC-00 / UNDELIVERED0generated,"@14px, "DC-00 / OLDEST PENDING1dFundin"@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 4 · api fails: 0

## Click sweep
- skipped: --no-clicks
