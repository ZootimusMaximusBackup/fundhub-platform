# UI audit evidence — present-client-livefix as closer@fundhub.ai

Ran 2026-08-17T19:33:47.915Z against https://fundhub.ai. Login ok (role closer). Screen /app/present.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → HTTP 200, final /app/present.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521, title "Closer · Present".

Shots: docs/workflows/ui-audit-evidence/present-client-livefix/1440-fold.png · docs/workflows/ui-audit-evidence/present-client-livefix/1440-full.png · docs/workflows/ui-audit-evidence/present-client-livefix/390-full.png

## Load
- API calls: 1; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div#app) · sidebar 0px
- Top-left element: div "TEST Client RoleYour numbers are not on this file yetClient screen only"
- H1: TEST Client Role · H2s: —
- Nav: 0 visible items · active: none marked · groups: 
- Font sizes in use (8): 52px×1, 13.5px×1, 13px×1, 12px×2, 11.5px×5, 11px×1, 9.5px×10, 9px×6
- Primary-looking (filled) buttons: 2 — "01", "Next screen"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: none
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "01 Intro1 / 24RapportSay thisH"@16px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible false (0px) · burger false · elements past right edge: none · text under 11px: 16 · api fails: 0

## Click sweep
- skipped: --no-clicks
