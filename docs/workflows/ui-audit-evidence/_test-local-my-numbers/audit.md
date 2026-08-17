# UI audit evidence — _test-local-my-numbers as closer@fundhub.ai

Ran 2026-08-17T06:55:10.867Z against http://localhost:8888. Login ok (role closer). Screen /app/my-numbers.html → HTTP 200, final /login.html?next=/app/my-numbers.html, title "Sign in | fundhub".

Shots: docs/workflows/ui-audit-evidence/_test-local-my-numbers/1440-fold.png · docs/workflows/ui-audit-evidence/_test-local-my-numbers/1440-full.png · docs/workflows/ui-audit-evidence/_test-local-my-numbers/390-full.png

## Load
- API calls: 4; failing: GET /api/read/my-numbers → 503; GET /api/auth/session → 503; GET /api/auth/session → 503
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 5 at first open · 9 across the whole run
- Console errors: Failed to load resource: the server responded with a status of 503 (Service Unavailable) | Failed to load resource: the server responded with a status of 503 (Service Unavailable) | Failed to load resource: the server responded with a status of 503 (Service Unavailable)

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
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 52 · api fails: 0

## Click sweep
- 3 clicked of 3 candidates (cap 80) · tally: NOOP=1, OK=1, NAV=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Sign in" | 266×33 | NOOP |  | docs/workflows/ui-audit-evidence/_test-local-my-numbers/clicks/01-NOOP-Sign_in.png |
| 2 | a "Forgot your password?" | 130×15 | OK |  |  |
| 3 | a "← Back to fundhub.ai" | 121×15 | NAV | → / |  |
