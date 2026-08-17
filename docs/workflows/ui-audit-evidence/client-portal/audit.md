# UI audit evidence — client-portal as client@fundhub.ai

Ran 2026-08-17T06:15:34.707Z against https://fundhub.ai. Login ok (role client). Screen /app/client-portal.html → HTTP 200, final /app/client-portal.html, title "Fundhub — Client Portal".

Shots: docs/workflows/ui-audit-evidence/client-portal/1440-fold.png · docs/workflows/ui-audit-evidence/client-portal/1440-full.png · docs/workflows/ui-audit-evidence/client-portal/390-full.png

## Load
- API calls: 10; failing: GET /api/consent/capture?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521&kind=dispute_authorization → 401; GET /api/dashboard/client?id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → 401; GET /api/read/documents?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521&limit=200 → 401
- Console errors: Failed to load resource: the server responded with a status of 401 () | Failed to load resource: the server responded with a status of 401 () | Failed to load resource: the server responded with a status of 401 ()

## DOM read (1440×900)
- Page height 902px (fold 900) · content width 1440px (div.shell) · sidebar 0px
- Top-left element: header "Client Portal State Before call In progress Just funded T— TEST — Client Role"
- H1: — · H2s: Metro 2 Dispute Letter Pack — Rounds 2 & 3 / Book a call
- Nav: 0 visible items · active: none marked · groups: 
- Font sizes in use (18): 22px×1, 21px×1, 20px×1, 17px×2, 16px×1, 15px×7, 14.5px×1, 14px×3, 13.5px×11, 13px×9, 12.5px×14, 12px×28, 11.5px×15, 11px×6, 10.5px×10, 10px×4, 9.5px×1, 9px×13
- Primary-looking (filled) buttons: 13 — "Unlock", "Unlock", "Unlock", "Unlock", "Unlock", "Unlock", "Payments", "Book a call", "Unlock — pay now", "Pick a time", "Chat", "Message staff", "Send"
- Generic labels: none · targets under 40px: 15
- Off-8px-scale spacing values: 14px×4, 18px×1, 15px×9, 20px×3, 22px×2, 17px×2, 10px×2
- Uneven card rows: top 832: [732,730]; top 1296: [686,221,221,221]
- ALL-CAPS runs: 0 · centered paragraphs: 1
- Sample/demo/beta wording: sample documents — not signed in for real data · live pre-qual · none yet · live entitlements · 0 unlocked · 6 locked · 
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: No payments yet | sample documents — not signed in for real data · live pre-qual · none yet · live entitlements · 0 unlocked · 6 locked · 
- Tables: none
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible false (0px) · burger false · elements past right edge: none · text under 11px: 25 · api fails: 3

## Click sweep
- 29 clicked of 29 candidates (cap 80) · tally: OK=19, NOOP=6, GONE=4

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Unlock" | 187×37 | OK |  |  |
| 2 | button "Talk to an advisor" | 187×17 | OK |  |  |
| 3 | button "Unlock" | 187×37 | OK |  |  |
| 4 | button "Talk to an advisor" | 187×17 | OK |  |  |
| 5 | button "Unlock" | 187×37 | OK |  |  |
| 6 | button "Talk to an advisor" | 187×17 | OK |  |  |
| 7 | button "Unlock" | 187×37 | OK |  |  |
| 8 | button "Talk to an advisor" | 187×17 | OK |  |  |
| 9 | button "Unlock" | 187×37 | OK |  |  |
| 10 | button "Talk to an advisor" | 187×17 | OK |  |  |
| 11 | button "Unlock" | 187×37 | OK |  |  |
| 12 | button "Talk to an advisor" | 187×17 | OK |  |  |
| 13 | summary "› Account & history Payments · Agreements · Documents · Acti" | 730×50 | OK |  |  |
| 14 | button "Payments" | 84×32 | NOOP |  | docs/workflows/ui-audit-evidence/client-portal/clicks/14-NOOP-Payments.png |
| 15 | button "Agreements" | 98×32 | OK |  |  |
| 16 | button "Documents" | 93×32 | OK |  |  |
| 17 | button "Activity" | 72×32 | OK |  |  |
| 18 | button "Messages" | 86×32 | OK |  |  |
| 19 | button "Text" | 57×37 | NOOP |  | docs/workflows/ui-audit-evidence/client-portal/clicks/19-NOOP-Text.png |
| 20 | button "Call" | 53×37 | NOOP |  | docs/workflows/ui-audit-evidence/client-portal/clicks/20-NOOP-Call.png |
| 21 | button "Book a call" | 96×42 | OK |  |  |
| 22 | button "✕" | 27×27 | NOOP |  | docs/workflows/ui-audit-evidence/client-portal/clicks/22-NOOP-_.png |
| 23 | button "Unlock — pay now" | 384×36 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 24 | button "Talk to an advisor first" | 384×36 | NOOP |  | docs/workflows/ui-audit-evidence/client-portal/clicks/24-NOOP-Talk_to_an_advisor_first.png |
| 25 | button "✕" | 27×27 | NOOP |  | docs/workflows/ui-audit-evidence/client-portal/clicks/25-NOOP-_.png |
| 26 | button "Chat" | 52×52 | OK |  |  |
| 27 | button "Close" | 33×15 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 28 | button "Message staff" | 358×27 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 29 | button "Send" | 54×37 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
