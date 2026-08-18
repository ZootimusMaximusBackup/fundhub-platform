# UI audit evidence — ptr-partner-galaxy as partner@fundhub.ai

Ran 2026-08-18T03:42:38.390Z against https://fundhub.ai. Login FAILED (role —). Screen /app/partner-galaxy.html → HTTP 200, final /login.html?next=/app/partner-galaxy.html, title "Sign in | fundhub".

Shots: docs/workflows/ui-audit-evidence/ptr-partner-galaxy/1440-fold.png · docs/workflows/ui-audit-evidence/ptr-partner-galaxy/1440-full.png · docs/workflows/ui-audit-evidence/ptr-partner-galaxy/390-full.png

## Load
- API calls: 2; failing: GET /api/auth/session → 401
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 5 at first open · 5 across the whole run
- Console errors: pageerror: FHData is not defined | Failed to load resource: the server responded with a status of 401 ()

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.spectrum) · sidebar 0px
- Top-left element: —
- H1: fundhub · H2s: —
- Nav: 0 visible items · active: none marked · groups: 
- Font sizes in use (4): 15px×1, 13px×1, 12.5px×1, 12px×4
- Primary-looking (filled) buttons: 1 — "Sign in"
- Generic labels: none · targets under 40px: 4
- Off-8px-scale spacing values: 26px×2
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible false (0px) · burger false · elements past right edge: none · text under 11px: 0 · api fails: 1

## Click sweep
- skipped: login failed
