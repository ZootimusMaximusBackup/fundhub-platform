# UI audit evidence — payment-success-mlfix as client@fundhub.ai

Ran 2026-08-17T19:35:22.293Z against https://fundhub.ai. Login ok (role client). Screen /app/payment-success.html → HTTP 200, final /app/payment-success.html, title "Fundhub · Payment received".

Shots: docs/workflows/ui-audit-evidence/payment-success-mlfix/1440-fold.png · docs/workflows/ui-audit-evidence/payment-success-mlfix/1440-full.png · docs/workflows/ui-audit-evidence/payment-success-mlfix/390-full.png

## Load
- API calls: 0; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 420px (div.card) · sidebar 0px
- Top-left element: —
- H1: Payment received · H2s: —
- Nav: 0 visible items · active: none marked · groups: 
- Font sizes in use (3): 18px×1, 14px×4, 11px×1
- Primary-looking (filled) buttons: 0 — none
- Generic labels: none · targets under 40px: 1
- Off-8px-scale spacing values: 28px×1
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible false (0px) · burger false · elements past right edge: none · text under 11px: 0 · api fails: 0

## Click sweep
- skipped: --no-clicks
