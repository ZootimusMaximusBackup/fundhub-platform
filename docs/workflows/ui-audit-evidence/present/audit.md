# UI audit evidence — present as closer@fundhub.ai

Ran 2026-08-17T15:50:12.267Z against https://fundhub.ai. Login ok (role closer). Screen /app/present.html → HTTP 200, final /app/present.html, title "Closer · Present".

Shots: docs/workflows/ui-audit-evidence/present/1440-fold.png · docs/workflows/ui-audit-evidence/present/1440-full.png · docs/workflows/ui-audit-evidence/present/390-full.png

## Load
- API calls: 0; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div#app) · sidebar 0px
- Top-left element: span "Present"
- H1: Open Present from a contact. This page needs ?contact= on the URL. · H2s: —
- Nav: 0 visible items · active: none marked · groups: 
- Font sizes in use (3): 30px×1, 13px×1, 9.5px×1
- Primary-looking (filled) buttons: 0 — none
- Generic labels: none · targets under 40px: 1
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
- Horizontal overflow: no · sidebar visible false (0px) · burger false · elements past right edge: none · text under 11px: 1 · api fails: 0

## Click sweep
- 1 clicked of 1 candidates (cap 80) · tally: NAV=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | a "Back to the call cockpit" | 143×16 | NAV | → /app/closer-call.html |  |
