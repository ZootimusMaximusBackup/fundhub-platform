# UI audit evidence — finance-os-client as advisor@fundhub.ai

Ran 2026-08-17T06:19:15.883Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/finance-os.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → HTTP 200, final /app/finance-os.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521, title "Fundhub — Finance OS".

Shots: docs/workflows/ui-audit-evidence/finance-os-client/1440-fold.png · docs/workflows/ui-audit-evidence/finance-os-client/1440-full.png · docs/workflows/ui-audit-evidence/finance-os-client/390-full.png

## Load
- API calls: 12; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 5969px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Finance OS · H2s: Credit — from the latest pull / Bank & investment accounts / Cards & credit lines / Recent transactions / Where it goes / Recurring bills / What the engine says / Text me when / Deal calculator / Ask it
- Nav: 24 visible items · active: ▩Finance OSBETA · groups: Sales▾(3), Funding▾(3), Client ops▾(5), Watch▾(3), Automation▾(3), Marketing▾(4), Admin▾(3)
- Font sizes in use (12): 30px×1, 16px×3, 14.5px×1, 13px×20, 12.5px×6, 12px×10, 11.5px×9, 11px×8, 10.5px×1, 10px×1, 9px×13, 8px×4
- Primary-looking (filled) buttons: 4 — "30d", "Run", "Ask", "Chat"
- Generic labels: none · targets under 40px: 8
- Off-8px-scale spacing values: none
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | No transactions on file for this window. Bank transactions only exist once an account has real (or sample) history behin
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: div.fos-hseg, button, div.fos-sv, div.k, div.v, div.fos-sv · text under 11px: 48 · api fails: 0

## Click sweep
- 9 clicked of 9 candidates (cap 80) · tally: OK=2, GONE=4, WRITE-INTERCEPTED=1, NOOP=2

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "Soft pull" | 54×56 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 3 | button "30d" | 44×27 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 4 | button "90d" | 43×27 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 5 | button "180d" | 48×27 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 6 | button "Run" | 53×37 | WRITE-INTERCEPTED | POST /api/finance/model 599 · WRITE POST /api/finance/model {client_id} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/finance-os-client/clicks/06-WRITE-INTERCEPTED-Run.png |
| 7 | button "Ask" | 53×37 | NOOP |  | docs/workflows/ui-audit-evidence/finance-os-client/clicks/07-NOOP-Ask.png |
| 8 | button "Search⌘K" | 99×36 | OK |  |  |
| 9 | button "Chat" | 52×52 | NOOP |  | docs/workflows/ui-audit-evidence/finance-os-client/clicks/09-NOOP-Chat.png |
