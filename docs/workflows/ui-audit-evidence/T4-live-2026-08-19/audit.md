# UI audit evidence — T4-live-2026-08-19 as inquiry@fundhub.ai

Ran 2026-08-19T11:01:21.307Z against https://fundhub.ai. Login ok (role inquiry_specialist). Screen /app/inquiry-remover.html → HTTP 200, final /app/inquiry-remover.html, title "Fundhub — Specialist".

Shots: docs/workflows/ui-audit-evidence/T4-live-2026-08-19/1440-fold.png · docs/workflows/ui-audit-evidence/T4-live-2026-08-19/1440-full.png · docs/workflows/ui-audit-evidence/T4-live-2026-08-19/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "/ Specialist Org: Fundhub Wed, Aug 19, 7:01:28 AM EDT LIVE Search⌘KTEST — Inquir"
- H1: — · H2s: —
- Nav: 4 visible items · active: ⊘Specialist · groups: Sales▾(0), Client ops▾(4), Automation▾(0), Admin▾(0)
- Font sizes in use (2): 16px×46, 13px×33
- Primary-looking (filled) buttons: 2 — "Inquiries", "Chat"
- Generic labels: none · targets under 40px: 1
- Off-8px-scale spacing values: 9px×1, 18px×1, 10px×3, 5px×4, 2px×6, 14px×1
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: Loading inquiry queue…
- Error wording: none
- Empty-state wording: none
- Tables: [Client | Bureau | Items | Status | Docs | Delivery | Call | Round] rows=4; numeric cols align: Items=start ‖ [Client | Bureau | Inquiry | Call State | Hold | Attempts | Status] rows=2; numeric cols align: n/a
- Metric-ish elements: "T— TEST — Inquiry Specialist R"@16px, "Need me— Worked— Calls— Confir"@16px, "Need me—"@16px, "—"@16px/tnum, "Worked—"@16px, "—"@16px/tnum, "Calls—"@16px, "—"@16px/tnum, "Confirmed—"@16px, "—"@16px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table#caseQueueTable.queue, thead, tr, th, th, th · text under 11px: 0 · api fails: 0

## Click sweep
- 10 clicked of 10 candidates (cap 80) · tally: OK=3, NOOP=1, GONE=6

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Search⌘K" | 120×42 | OK |  |  |
| 2 | button "Inquiries" | 101×40 | NOOP |  | docs/workflows/ui-audit-evidence/T4-live-2026-08-19/clicks/02-NOOP-Inquiries.png |
| 3 | button "Repair" | 84×40 | OK | GET /api/read/repair-cases 200; GET /api/repair/exceptions 200 |  |
| 4 | button "Equifax 0 none in queue" | 150×83 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 5 | button "TransUnion 0 none in queue" | 150×83 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 6 | button "Experian 0 none in queue" | 150×83 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 7 | a "All letters↗" | 1162×35 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 8 | button "Chat" | 52×52 | OK |  |  |
| 9 | tr "▶TEST Client Role—0QueuedcompleteLetter——" | 1163×41 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 10 | tr "▶TEST Client Role—0QueuedcompleteLetter——" | 1163×41 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
