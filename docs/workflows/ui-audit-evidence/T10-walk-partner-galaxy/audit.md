# UI audit evidence — T10-walk-partner-galaxy as partner@fundhub.ai

Ran 2026-08-19T06:55:09.144Z against https://fundhub.ai. Login ok (role partner). Screen /app/partner-galaxy.html → HTTP 200, final /app/partner-galaxy.html, title "Your Galaxy — Partner View".

Shots: docs/workflows/ui-audit-evidence/T10-walk-partner-galaxy/1440-fold.png · docs/workflows/ui-audit-evidence/T10-walk-partner-galaxy/1440-full.png · docs/workflows/ui-audit-evidence/T10-walk-partner-galaxy/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "Fundhub / Galaxy Your page · https://fundhub.ai/sites/9defaf28-47c5-43a0-8f5e-f4"
- H1: — · H2s: —
- Nav: 1 visible items · active: ⌂Home · groups: Home▾(1), Marketing▾(0), Admin▾(0)
- Font sizes in use (3): 16px×22, 13px×2, 11px×2
- Primary-looking (filled) buttons: 1 — "Download"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 14px×1
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: i, i, i, i, i, i · text under 11px: 0 · api fails: 0

## Click sweep
- 2 clicked of 2 candidates (cap 40) · tally: NAV=1, OK=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | a "https://fundhub.ai/sites/9defaf28-47c5-43a0-8f5e-f41ef90f360" | 326×42 | NAV | → /app/brand-studio.html?partner_id=9defaf28-47c5-43a0-8f5e-f41ef90f360a · GET /api/partner-pages 200; GET /api/partner-marketing/usage 200; GET /api/auth/session 200; GET /api/health 200; GET /api/partner-marketing/copy-history 200; GET /api/org-brand 200 · console: pageerror: FHData is not defined |  |
| 2 | button "Download" | 108×40 | OK | GET /api/gifts/message-blaster 200 |  |
