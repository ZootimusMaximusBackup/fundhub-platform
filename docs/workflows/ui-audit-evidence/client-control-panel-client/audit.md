# UI audit evidence — client-control-panel-client as advisor@fundhub.ai

Ran 2026-08-17T06:09:59.850Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/client-control-panel.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → HTTP 200, final /app/client-control-panel.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521, title "Fundhub — Client Control Panel".

Shots: docs/workflows/ui-audit-evidence/client-control-panel-client/1440-fold.png · docs/workflows/ui-audit-evidence/client-control-panel-client/1440-full.png · docs/workflows/ui-audit-evidence/client-control-panel-client/390-full.png

## Load
- API calls: 6; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "/ Client Control Panel Org: Fundhub Mon, Aug 17, 2:10:07 AM EDT LIVE"
- H1: — · H2s: —
- Nav: 24 visible items · active: ◎Client Control Panel · groups: Sales▾(3), Funding▾(3), Client ops▾(5), Watch▾(3), Automation▾(3), Marketing▾(4), Admin▾(3)
- Font sizes in use (12): 17px×2, 16px×1, 14px×4, 13.5px×5, 13px×2, 12.5px×2, 12px×12, 11px×21, 10.5px×7, 10px×6, 9.5px×1, 9px×7
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 12
- Off-8px-scale spacing values: 5px×7, 11px×7, 3px×1, 10px×2, 13px×1, 14px×2, 9px×1, 7px×3, 6px×3
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Bureau pulls run from the closer deck. These buttons open the live file — they do not fake a pull.
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: Lender list is empty — import CSV on Lenders.
- Tables: none
- Metric-ish elements: "—"@11px, "—"@13.5px, "—"@13.5px, "—"@13.5px, "—"@13.5px, "EX — · EQ — · TU —"@12px, "—"@13.5px, "Credit EX — · EQ — · TU —"@16px, "Credit EX — · EQ — · TU —"@11px, "FUNDHUB-CCP · live ORG: fb789b"@10px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 42 · api fails: 0

## Click sweep
- 11 clicked of 11 candidates (cap 80) · tally: OK=8, NAV=3

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Agent context collapsed by default ⌄" | 849×14 | OK |  |  |
| 2 | button "Credit & Hold Status collapsed ⌄" | 849×14 | OK |  |  |
| 3 | button "Details collapsed by default ⌄" | 849×14 | OK |  |  |
| 4 | button "Documents collapsed by default ⌄" | 849×14 | OK |  |  |
| 5 | a "Open Pipeline ↗" | 272×43 | NAV | → /app/pipeline.html · GET /api/auth/session 200; GET /api/health 200; GET /api/dashboard/pipeline 200; GET /api/org-brand 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200 |  |
| 6 | a "Open Messaging ↗" | 272×43 | NAV | → /app/messaging.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 · GET /api/auth/session 200; GET /api/read/inbox 200; GET /api/health 200; GET /api/org-brand 200; GET /api/read/conversations 200; GET /api/dashboard/client 200; GET /api/read/conversations 200; GET /api/dashboard/client 200 |  |
| 7 | summary "More ⌄" | 272×33 | OK |  |  |
| 8 | a "Open Funding Matrix ↗" | 272×33 | NAV | → /app/lenders.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 · GET /api/auth/session 200; GET /api/read/lender-observations 200; GET /api/read/lenders 200; GET /api/health 200; GET /api/org-brand 200 |  |
| 9 | button "System Facts collapsed ⌄" | 242×14 | OK |  |  |
| 10 | button "Search⌘K" | 99×36 | OK |  |  |
| 11 | button "Chat" | 52×52 | OK |  |  |
