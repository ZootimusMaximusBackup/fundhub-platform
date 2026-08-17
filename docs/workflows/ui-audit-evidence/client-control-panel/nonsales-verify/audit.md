# UI audit evidence — client-control-panel/nonsales-verify as advisor@fundhub.ai

Ran 2026-08-17T19:43:53.281Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/client-control-panel.html → HTTP 503, final /app/client-control-panel.html, title "Site not available".

Shots: docs/workflows/ui-audit-evidence/client-control-panel/nonsales-verify/1440-fold.png · docs/workflows/ui-audit-evidence/client-control-panel/nonsales-verify/1440-full.png · docs/workflows/ui-audit-evidence/client-control-panel/nonsales-verify/390-full.png

## Load
- API calls: 0; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: Failed to load resource: the server responded with a status of 503 ()

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.main) · sidebar 0px
- Top-left element: div "Site not available This site was paused as it reached its usage limits. Please c"
- H1: Site not available · H2s: —
- Nav: 0 visible items · active: none marked · groups: 
- Font sizes in use (3): 22px×1, 16px×1, 14px×2
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
- Horizontal overflow: no · sidebar visible false (0px) · burger false · elements past right edge: none · text under 11px: 0 · api fails: 0

## Click sweep
- skipped: --no-clicks
