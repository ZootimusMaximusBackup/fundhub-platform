# UI audit evidence — lenders-mlfix as advisor@fundhub.ai

Ran 2026-08-17T19:36:02.599Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/lenders.html → HTTP 200, final /app/lenders.html, title "Fundhub · Lenders".

Shots: docs/workflows/ui-audit-evidence/lenders-mlfix/1440-fold.png · docs/workflows/ui-audit-evidence/lenders-mlfix/1440-full.png · docs/workflows/ui-audit-evidence/lenders-mlfix/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "Fundhub/Lenders LIVEMon, Aug 17, 3:36:12 PM EDT"
- H1: — · H2s: —
- Nav: 3 visible items · active: ⬡Lenders · groups: Sales▾(0), Funding▾(3), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (5): 14px×14, 13px×1, 12px×1, 11px×20, 10px×1
- Primary-looking (filled) buttons: 2 — "Import CSV", "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 14px×1, 10px×3
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: The lender list starts empty on purpose. Export the seven Airtable product tables, then Import CSV here. Do not invent l | Empty — import from Airtable | No lenders yet. Import a CSV from Airtable.
- Tables: [Name | Table | Bureaus | Requirements | Tier | Status | State | Updated | Apply | ] rows=0; numeric cols align: n/a
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 1 · api fails: 0

## Click sweep
- skipped: --no-clicks
