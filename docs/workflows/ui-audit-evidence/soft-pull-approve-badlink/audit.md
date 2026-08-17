# UI audit evidence — soft-pull-approve-badlink as client@fundhub.ai

Ran 2026-08-17T06:22:37.744Z against https://fundhub.ai. Login ok (role client). Screen /app/soft-pull-approve.html?org=00000000-0000-0000-0000-000000000000&client=8556bedc-46e1-4d85-b0cd-a24adfee1521&exp=1&sig=x → HTTP 200, final /app/soft-pull-approve.html?org=00000000-0000-0000-0000-000000000000&client=8556bedc-46e1-4d85-b0cd-a24adfee1521&exp=1&sig=x, title "Fundhub · Soft-pull approval".

Shots: docs/workflows/ui-audit-evidence/soft-pull-approve-badlink/1440-fold.png · docs/workflows/ui-audit-evidence/soft-pull-approve-badlink/1440-full.png · docs/workflows/ui-audit-evidence/soft-pull-approve-badlink/390-full.png

## Load
- API calls: 1; failing: GET /api/soft-pull-approve?org=00000000-0000-0000-0000-000000000000&client=8556bedc-46e1-4d85-b0cd-a24adfee1521&exp=1&sig=x → 401
- Console errors: Failed to load resource: the server responded with a status of 401 ()

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 560px (div#app.wrap) · sidebar 0px
- Top-left element: —
- H1: Link problem · H2s: —
- Nav: 0 visible items · active: none marked · groups: 
- Font sizes in use (4): 24px×1, 13.5px×1, 12.5px×1, 10px×1
- Primary-looking (filled) buttons: 0 — none
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: none
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible false (0px) · burger false · elements past right edge: none · text under 11px: 1 · api fails: 1

## Click sweep
- skipped: --no-clicks
