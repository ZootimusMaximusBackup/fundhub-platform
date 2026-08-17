# UI audit evidence — inquiry-remover as inquiry@fundhub.ai

Ran 2026-08-17T06:23:24.551Z against https://fundhub.ai. Login ok (role inquiry_specialist). Screen /app/inquiry-remover.html → HTTP 200, final /app/inquiry-remover.html, title "Fundhub — Inquiry Remover".

Shots: docs/workflows/ui-audit-evidence/inquiry-remover/1440-fold.png · docs/workflows/ui-audit-evidence/inquiry-remover/1440-full.png · docs/workflows/ui-audit-evidence/inquiry-remover/390-full.png

## Load
- API calls: 7; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "/ Inquiry Remover Org: Fundhub Mon, Aug 17, 2:23:31 AM EDT LIVE"
- H1: — · H2s: —
- Nav: 24 visible items · active: ⊘Inquiry Remover · groups: Sales▾(3), Funding▾(3), Client ops▾(5), Watch▾(3), Automation▾(3), Marketing▾(4), Admin▾(3)
- Font sizes in use (13): 20px×3, 16px×2, 14px×4, 13px×1, 12.5px×5, 12px×2, 11.5px×3, 11px×7, 10.5px×9, 10px×6, 9.5px×15, 9px×4, 7.5px×2
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
- Metric-ish elements: "T— TEST — Inquiry Specialist R"@16px, "Queue Left0 Worked0 Calls0 Con"@16px, "Queue Left0"@16px, "0"@14px, "Worked0"@16px, "0"@14px, "Calls0"@16px, "0"@14px, "Confirmed0"@16px, "0"@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table.queue, tbody, tr, th, th, tr#queue-status-row · text under 11px: 57 · api fails: 0

## Click sweep
- 6 clicked of 6 candidates (cap 80) · tally: OK=5, FORBIDDEN=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Equifax 0 none in queue" | 150×75 | OK |  |  |
| 2 | button "TransUnion 0 none in queue" | 150×75 | OK |  |  |
| 3 | button "Experian 0 none in queue" | 150×75 | OK |  |  |
| 4 | a "All letters↗" | 1162×29 | FORBIDDEN | → /app/documents.html · GET /api/demo/mode 403; GET /api/auth/session 200; GET /api/read/documents 200; GET /api/health 200; GET /api/org-brand 200 · console: Failed to load resource: the server responded with a status of 403 () | docs/workflows/ui-audit-evidence/inquiry-remover/clicks/04-FORBIDDEN-All_letters_.png |
| 5 | button "Search⌘K" | 99×36 | OK |  |  |
| 6 | button "Chat" | 52×52 | OK |  |  |
