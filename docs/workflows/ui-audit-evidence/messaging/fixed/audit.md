# UI audit evidence — messaging/fixed as advisor@fundhub.ai

Ran 2026-08-17T10:24:22.899Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/messaging.html → HTTP 200, final /app/messaging.html, title "Fundhub — Messaging".

Shots: docs/workflows/ui-audit-evidence/messaging/fixed/1440-fold.png · docs/workflows/ui-audit-evidence/messaging/fixed/1440-full.png · docs/workflows/ui-audit-evidence/messaging/fixed/390-full.png

## Load
- API calls: 4; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "Fundhub / Messaging Org: Fundhub Mon, Aug 17, 6:24:29 AM EDT LIVE"
- H1: — · H2s: —
- Nav: 5 visible items · active: ✉Messaging · groups: Sales▾(0), Funding▾(0), Client ops▾(5), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (7): 18px×1, 16px×1, 14px×16, 13px×1, 12px×1, 11px×59, 10px×1
- Primary-looking (filled) buttons: 3 — "All 8", "Send", "Chat"
- Generic labels: none · targets under 40px: 8
- Off-8px-scale spacing values: 11px×1, 13px×1, 10px×1, 14px×1
- Uneven card rows: top 48: [288,622,300]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "fundhub-messaging · v1 org: fu"@11px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 4 · api fails: 0

## Click sweep
- 15 clicked of 15 candidates (cap 80) · tally: OK=7, GONE=8

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "All 8" | 44×22 | OK | GET /api/read/inbox 200 |  |
| 2 | button "Needs reply 0" | 94×22 | OK | GET /api/read/inbox 200 |  |
| 3 | div "KEKarl Elliott16hHi Karl, your Fundhub soft-pull: pay $32 ht" | 288×85 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 4 | div "KEKarl Elliott16hHi Karl, On our call — next step is your $3" | 288×85 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 5 | div "CPChris ProveFunding1dHi Chris, Fundhub Repair test run (fir" | 288×85 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 6 | div "CPChris ProveFunding1dHi Chris, Here's the Repair test run (" | 288×85 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 7 | div "CPChris Prem2dYour Funding Letter Pack is ready ✅ Hey Chris," | 288×85 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 8 | div "CFChris Fpr2dYour Funding Letter Pack is ready ✅ Hey Chris, " | 288×85 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 9 | div "CFChris Full2dYour Funding Letter Pack is ready ✅ Hey Chris," | 288×85 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 10 | div "CRChris Repair2dHey Chris, As promised — your correction let" | 288×85 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 11 | summary "Their other threads" | 274×31 | OK |  |  |
| 12 | summary "Open elsewhere" | 274×31 | OK |  |  |
| 13 | button "Reference who-sent-it colour key ▾" | 1212×26 | OK |  |  |
| 14 | button "Search⌘K" | 99×36 | OK |  |  |
| 15 | button "Chat" | 52×52 | OK |  |  |
