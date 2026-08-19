# UI audit evidence — T5-messaging-before as owner@fundhub.ai

Ran 2026-08-19T02:47:45.026Z against https://fundhub.ai. Login ok (role owner). Screen /app/messaging.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → HTTP 200, final /app/messaging.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521, title "Fundhub — Messaging".

Shots: docs/workflows/ui-audit-evidence/T5-messaging-before/1440-fold.png · docs/workflows/ui-audit-evidence/T5-messaging-before/1440-full.png · docs/workflows/ui-audit-evidence/T5-messaging-before/390-full.png

## Load
- API calls: 9; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "Fundhub / Messaging Org: Fundhub Tue, Aug 18, 10:48:00 PM EDT LIVE Search⌘KTEST "
- H1: — · H2s: —
- Nav: 6 visible items · active: ✉Messaging · groups: Sales▾(0), Funding▾(0), Client ops▾(6), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (3): 16px×59, 13px×12, 11px×1
- Primary-looking (filled) buttons: 3 — "Needs reply 1", "Send", "Chat"
- Generic labels: none · targets under 40px: 2
- Off-8px-scale spacing values: 11px×1, 13px×1, 10px×2, 14px×1
- Uneven card rows: top 48: [288,622,300]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "fundhub-messaging · v1 org: fu"@13px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: span.cv-name, span.ch-tag · text under 11px: 0 · api fails: 0

## Click sweep
- 9 clicked of 9 candidates (cap 80) · tally: OK=6, NOOP=2, GONE=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Search⌘K" | 120×42 | OK |  |  |
| 2 | button "All 1" | 55×40 | OK | GET /api/read/inbox 200 |  |
| 3 | button "Needs reply 1" | 128×40 | NOOP |  | docs/workflows/ui-audit-evidence/T5-messaging-before/clicks/03-NOOP-Needs_reply_1.png |
| 4 | div "TCTEST Client Role5hSTOPEMAILWaiting on us" | 288×89 | OK |  |  |
| 5 | button "Send" | 79×40 | NOOP |  | docs/workflows/ui-audit-evidence/T5-messaging-before/clicks/05-NOOP-Send.png |
| 6 | summary "Their other threads" | 274×37 | OK |  |  |
| 7 | summary "Open elsewhere" | 274×37 | OK |  |  |
| 8 | a "Their file ↗" | 274×40 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 9 | button "Chat" | 52×52 | OK |  |  |
