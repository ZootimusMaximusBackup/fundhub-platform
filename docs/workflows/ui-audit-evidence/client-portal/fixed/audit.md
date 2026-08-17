# UI audit evidence — client-portal/fixed as client@fundhub.ai

Ran 2026-08-17T10:41:35.334Z against https://fundhub.ai. Login ok (role client). Screen /app/client-portal.html → HTTP 200, final /app/client-portal.html, title "Fundhub — Client Portal".

Shots: docs/workflows/ui-audit-evidence/client-portal/fixed/1440-fold.png · docs/workflows/ui-audit-evidence/client-portal/fixed/1440-full.png · docs/workflows/ui-audit-evidence/client-portal/fixed/390-full.png

## Load
- API calls: 10; failing: GET /api/read/documents?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521&limit=200 → 401; GET /api/dashboard/client?id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → 401
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: Failed to load resource: the server responded with a status of 401 () | Failed to load resource: the server responded with a status of 401 ()

## DOM read (1440×900)
- Page height 901px (fold 900) · content width 1440px (div.shell) · sidebar 0px
- Top-left element: header "Client Portal State Before call In progress Just funded T— TEST — Client Role"
- H1: — · H2s: Metro 2 Dispute Letter Pack — Rounds 2 & 3 / Your call
- Nav: 0 visible items · active: none marked · groups: 
- Font sizes in use (7): 28px×8, 18px×5, 14px×57, 13px×2, 12.5px×1, 12px×2, 11px×48
- Primary-looking (filled) buttons: 3 — "Chat", "Message staff", "Send"
- Generic labels: none · targets under 40px: 15
- Off-8px-scale spacing values: 14px×4, 18px×1, 15px×9, 20px×3, 22px×2, 17px×2, 10px×2
- Uneven card rows: top 848: [732,730]; top 1312: [686,221,221,221]
- ALL-CAPS runs: 0 · centered paragraphs: 1
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: No payments yet | your files are not listed here — your advisor sends them · live entitlements · 0 unlocked · 6 locked · live pre-qual · n
- Tables: none
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible false (0px) · burger false · elements past right edge: div.step, span.line, div.lbl · text under 11px: 3 · api fails: 2

## Click sweep
- 26 clicked of 26 candidates (cap 80) · tally: OK=13, NOOP=10, GONE=3

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Unlock" | 187×41 | OK |  |  |
| 2 | button "Talk to an advisor" | 187×21 | NOOP |  | docs/workflows/ui-audit-evidence/client-portal/fixed/clicks/02-NOOP-Talk_to_an_advisor.png |
| 3 | button "Unlock" | 187×41 | OK |  |  |
| 4 | button "Talk to an advisor" | 187×21 | NOOP |  | docs/workflows/ui-audit-evidence/client-portal/fixed/clicks/04-NOOP-Talk_to_an_advisor.png |
| 5 | button "Unlock" | 187×41 | OK |  |  |
| 6 | button "Talk to an advisor" | 187×21 | NOOP |  | docs/workflows/ui-audit-evidence/client-portal/fixed/clicks/06-NOOP-Talk_to_an_advisor.png |
| 7 | button "Unlock" | 187×41 | OK |  |  |
| 8 | button "Talk to an advisor" | 187×21 | NOOP |  | docs/workflows/ui-audit-evidence/client-portal/fixed/clicks/08-NOOP-Talk_to_an_advisor.png |
| 9 | button "Unlock" | 187×41 | OK |  |  |
| 10 | button "Talk to an advisor" | 187×21 | NOOP |  | docs/workflows/ui-audit-evidence/client-portal/fixed/clicks/10-NOOP-Talk_to_an_advisor.png |
| 11 | button "Unlock" | 187×41 | OK |  |  |
| 12 | button "Talk to an advisor" | 187×21 | NOOP |  | docs/workflows/ui-audit-evidence/client-portal/fixed/clicks/12-NOOP-Talk_to_an_advisor.png |
| 13 | summary "› Account & history Payments · Agreements · Documents · Acti" | 730×51 | OK |  |  |
| 14 | button "Payments" | 94×35 | NOOP |  | docs/workflows/ui-audit-evidence/client-portal/fixed/clicks/14-NOOP-Payments.png |
| 15 | button "Agreements" | 110×35 | OK |  |  |
| 16 | button "Documents" | 104×35 | OK |  |  |
| 17 | button "Activity" | 79×35 | OK |  |  |
| 18 | button "Messages" | 96×35 | OK |  |  |
| 19 | button "Ask for a call" | 118×45 | NOOP |  | docs/workflows/ui-audit-evidence/client-portal/fixed/clicks/19-NOOP-Ask_for_a_call.png |
| 20 | button "✕" | 27×27 | NOOP |  | docs/workflows/ui-audit-evidence/client-portal/fixed/clicks/20-NOOP-_.png |
| 21 | button "Ask an advisor about this" | 384×38 | NOOP |  | docs/workflows/ui-audit-evidence/client-portal/fixed/clicks/21-NOOP-Ask_an_advisor_about_this.png |
| 22 | button "✕" | 27×27 | OK |  |  |
| 23 | button "Chat" | 52×52 | OK |  |  |
| 24 | button "Close" | 33×15 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 25 | button "Message staff" | 358×27 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 26 | button "Send" | 54×37 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
