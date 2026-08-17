# UI audit evidence — client-control-panel/fixed as advisor@fundhub.ai

Ran 2026-08-17T10:23:35.237Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/client-control-panel.html → HTTP 200, final /app/client-control-panel.html, title "Fundhub — Client Control Panel".

Shots: docs/workflows/ui-audit-evidence/client-control-panel/fixed/1440-fold.png · docs/workflows/ui-audit-evidence/client-control-panel/fixed/1440-full.png · docs/workflows/ui-audit-evidence/client-control-panel/fixed/390-full.png

## Load
- API calls: 3; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "/ Client Control Panel Org: Fundhub Mon, Aug 17, 6:23:42 AM EDT LIVE"
- H1: — · H2s: —
- Nav: 5 visible items · active: ◎Client Control Panel · groups: Sales▾(0), Funding▾(0), Client ops▾(5), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (7): 18px×2, 16px×1, 14px×12, 13px×1, 12px×1, 11px×53, 10px×1
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 13
- Off-8px-scale spacing values: 5px×7, 11px×7, 3px×1, 10px×2, 13px×1, 14px×2, 9px×1, 7px×3, 6px×3
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Bureau pulls run from the closer deck. These buttons open the live file — they do not fake a pull.
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "—"@11px, "—"@14px/tnum, "—"@14px/tnum, "—"@14px/tnum, "—"@14px/tnum, "—"@11px/tnum, "—"@14px/tnum, "Credit —"@16px, "Credit —"@11px, "FUNDHUB-CCP · live ORG: — — no"@11px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 4 · api fails: 0

## Click sweep
- 12 clicked of 12 candidates (cap 80) · tally: NAV=4, OK=8

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | a "pick a client on Pipeline" | 165×14 | NAV | → /app/pipeline.html · GET /api/auth/session 200; GET /api/dashboard/pipeline 200; GET /api/health 200; GET /api/org-brand 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200 |  |
| 2 | button "Agent context collapsed by default ⌄" | 849×14 | OK |  |  |
| 3 | button "Credit & Hold Status collapsed ⌄" | 849×14 | OK |  |  |
| 4 | button "Details collapsed by default ⌄" | 849×14 | OK |  |  |
| 5 | button "Documents collapsed by default ⌄" | 849×14 | OK |  |  |
| 6 | a "Open Pipeline ↗" | 272×43 | NAV | → /app/pipeline.html · GET /api/auth/session 200; GET /api/health 200; GET /api/org-brand 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200 |  |
| 7 | a "Open Messaging ↗" | 272×43 | NAV | → /app/messaging.html · GET /api/auth/session 200; GET /api/read/inbox 200; GET /api/health 200; GET /api/org-brand 200 |  |
| 8 | summary "More ⌄" | 272×32 | OK |  |  |
| 9 | a "Open Funding Matrix ↗" | 272×32 | NAV | → /app/lenders.html · GET /api/auth/session 200; GET /api/read/lender-observations 200; GET /api/read/lenders 200; GET /api/health 200; GET /api/org-brand 200 |  |
| 10 | button "System Facts collapsed ⌄" | 242×14 | OK |  |  |
| 11 | button "Search⌘K" | 99×36 | OK |  |  |
| 12 | button "Chat" | 52×52 | OK |  |  |
