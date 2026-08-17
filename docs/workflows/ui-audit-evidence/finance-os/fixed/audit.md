# UI audit evidence — finance-os/fixed as advisor@fundhub.ai

Ran 2026-08-17T10:25:08.564Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/finance-os.html → HTTP 200, final /app/finance-os.html, title "Fundhub — Finance OS".

Shots: docs/workflows/ui-audit-evidence/finance-os/fixed/1440-fold.png · docs/workflows/ui-audit-evidence/finance-os/fixed/1440-full.png · docs/workflows/ui-audit-evidence/finance-os/fixed/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Finance OS · H2s: —
- Nav: 3 visible items · active: ▩Finance OSBETA · groups: Sales▾(0), Funding▾(3), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (6): 18px×1, 14px×3, 13px×1, 12px×1, 11px×7, 10px×1
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 3
- Off-8px-scale spacing values: none
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 4 · api fails: 0

## Click sweep
- 3 clicked of 3 candidates (cap 80) · tally: OK=3

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "Search⌘K" | 99×36 | OK |  |  |
| 3 | button "Chat" | 52×52 | OK |  |  |
