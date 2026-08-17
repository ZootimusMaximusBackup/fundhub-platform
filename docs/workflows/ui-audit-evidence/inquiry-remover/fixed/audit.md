# UI audit evidence — inquiry-remover/fixed as inquiry@fundhub.ai

Ran 2026-08-17T10:25:52.624Z against https://fundhub.ai. Login ok (role inquiry_specialist). Screen /app/inquiry-remover.html → HTTP 200, final /app/inquiry-remover.html, title "Fundhub — Inquiry Remover".

Shots: docs/workflows/ui-audit-evidence/inquiry-remover/fixed/1440-fold.png · docs/workflows/ui-audit-evidence/inquiry-remover/fixed/1440-full.png · docs/workflows/ui-audit-evidence/inquiry-remover/fixed/390-full.png

## Load
- API calls: 7; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "/ Inquiry Remover Org: Fundhub Mon, Aug 17, 6:25:58 AM EDT LIVE"
- H1: — · H2s: —
- Nav: 5 visible items · active: ⊘Inquiry Remover · groups: Sales▾(0), Funding▾(0), Client ops▾(5), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (7): 28px×7, 18px×1, 14px×7, 13px×1, 12px×1, 11px×45, 10px×1
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 3
- Off-8px-scale spacing values: 9px×1, 18px×1, 10px×3, 5px×4, 2px×4, 14px×1
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Client | Bureau | Inquiry | Call State | Hold | Attempts | Status] rows=1; numeric cols align: n/a ‖ [Client | Bureau | Items | Status | Docs | Delivery | Call | Round] rows=1; numeric cols align: n/a
- Metric-ish elements: "T— TEST — Inquiry Specialist R"@16px, "Queue Left0 Worked0 Calls0 Con"@16px, "Queue Left0"@16px, "0"@28px/tnum, "Worked0"@16px, "0"@28px/tnum, "Calls0"@16px, "0"@28px/tnum, "Confirmed0"@16px, "0"@28px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table.queue, tbody, tr, th, th, tr#queue-status-row · text under 11px: 4 · api fails: 0

## Click sweep
- 6 clicked of 6 candidates (cap 80) · tally: OK=5, NAV=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Equifax 0 none in queue" | 150×87 | OK |  |  |
| 2 | button "TransUnion 0 none in queue" | 150×87 | OK |  |  |
| 3 | button "Experian 0 none in queue" | 150×87 | OK |  |  |
| 4 | a "All letters↗" | 1162×32 | NAV | → /app/documents.html · GET /api/auth/session 200; GET /api/read/documents 200; GET /api/health 200; GET /api/org-brand 200 |  |
| 5 | button "Search⌘K" | 99×36 | OK |  |  |
| 6 | button "Chat" | 52×52 | OK |  |  |
