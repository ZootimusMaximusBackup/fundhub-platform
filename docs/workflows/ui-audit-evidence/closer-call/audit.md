# UI audit evidence — closer-call as closer@fundhub.ai

Ran 2026-08-17T15:46:27.543Z against https://fundhub.ai. Login ok (role closer). Screen /app/closer-call.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → HTTP 200, final /app/closer-call.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521, title "Closer · Call cockpit".

Shots: docs/workflows/ui-audit-evidence/closer-call/1440-fold.png · docs/workflows/ui-audit-evidence/closer-call/1440-full.png · docs/workflows/ui-audit-evidence/closer-call/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 1172px (fold 900) · content width 1440px (div.app-shell) · sidebar 228px
- Top-left element: header "C-01 / Closer No open shift TEST — Closer Role"
- H1: TEST Client Role · H2s: —
- Nav: 5 visible items · active: ☎Call cockpit · groups: Sales▾(5), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (12): 24px×3, 22px×7, 14px×5, 13px×10, 12.5px×25, 12px×8, 11.5px×6, 11px×9, 10.5px×3, 10px×2, 9.5px×23, 9px×6
- Primary-looking (filled) buttons: 5 — "Join call", "Present", "Send contract", "Save · next call", "Chat"
- Generic labels: none · targets under 40px: 15
- Off-8px-scale spacing values: 1px×3, 14px×6, 15px×2, 22px×3
- Uneven card rows: top 56: [1212,201,201,201,201,201,201]; top 456: [431,431,239]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: Belief failed
- Empty-state wording: none
- Tables: [] rows=1; numeric cols align: n/a ‖ [] rows=4; numeric cols align: n/a
- Metric-ish elements: "Cash today $0 0 deposits Calls"@14px, "Cash today $0 0 deposits"@14px, "Calls held 0 0 no-shows"@14px, "Close rate — this month"@14px, "Commission MTD — Open My numbe"@14px, "Pace to target — Open My numbe"@14px, "Unlogged 12 clear before next "@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 35 · api fails: 0

## Click sweep
- 18 clicked of 18 candidates (cap 80) · tally: NOOP=13, OK=4, WRITE-INTERCEPTED=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Present" | 73×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call/clicks/01-NOOP-Present.png |
| 2 | button "Send contract" | 111×31 | OK |  |  |
| 3 | button "1Deposit" | 85×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call/clicks/03-NOOP-1Deposit.png |
| 4 | button "2Downsell" | 94×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call/clicks/04-NOOP-2Downsell.png |
| 5 | button "3Callback" | 91×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call/clicks/05-NOOP-3Callback.png |
| 6 | button "4No show" | 92×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call/clicks/06-NOOP-4No_show.png |
| 7 | button "5Not a fit" | 87×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call/clicks/07-NOOP-5Not_a_fit.png |
| 8 | button "pain" | 53×31 | OK | GET /api/read/contracts 200 |  |
| 9 | button "doubt" | 62×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call/clicks/09-NOOP-doubt.png |
| 10 | button "cost" | 53×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call/clicks/10-NOOP-cost.png |
| 11 | button "desire" | 64×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call/clicks/11-NOOP-desire.png |
| 12 | button "money" | 68×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call/clicks/12-NOOP-money.png |
| 13 | button "support" | 74×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call/clicks/13-NOOP-support.png |
| 14 | button "trust" | 55×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call/clicks/14-NOOP-trust.png |
| 15 | button "None" | 60×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call/clicks/15-NOOP-None.png |
| 16 | button "Save · next call" | 117×31 | WRITE-INTERCEPTED | POST /api/call-outcomes 599 · WRITE POST /api/call-outcomes {client_id,outcome,belief_failed,task_id,transaction_id} · dialog: alert "UI audit harness refused to send this write" · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/closer-call/clicks/16-WRITE-INTERCEPTED-Save_next_call.png |
| 17 | button "Search⌘K" | 99×36 | OK |  |  |
| 18 | button "Chat" | 52×52 | OK |  |  |
