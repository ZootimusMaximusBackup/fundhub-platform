# UI audit evidence — template-editor/fixed as owner@fundhub.ai

Ran 2026-08-17T10:35:51.374Z against https://fundhub.ai. Login ok (role owner). Screen /app/template-editor.html → HTTP 200, final /app/template-editor.html, title "Fundhub — Message Copy".

Shots: docs/workflows/ui-audit-evidence/template-editor/fixed/1440-fold.png · docs/workflows/ui-audit-evidence/template-editor/fixed/1440-full.png · docs/workflows/ui-audit-evidence/template-editor/fixed/390-full.png

## Load
- API calls: 6; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 8753px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "AutomationMessage Copy — live"
- H1: Message Copy · H2s: —
- Nav: 4 visible items · active: ✎Message Copy · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(4), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (7): 28px×5, 18px×1, 14px×209, 13px×1, 12px×1, 11px×232, 10px×1
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 2
- Off-8px-scale spacing values: 14px×7, 13px×2
- Uneven card rows: top 80: [1164,282,282,282,282]
- ALL-CAPS runs: 8 · centered paragraphs: 0
- Sample/demo/beta wording: placeholder copy — blocked from send
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "TE-00 / MESSAGES200pieces of c"@14px, "TE-00 / MESSAGES200pieces of c"@14px, "TE-00 / TEXTS18sent as SMS"@14px, "TE-00 / EMAILS182sent as email"@14px, "TE-00 / SWITCHED OFF190waiting"@14px, "TE-00 / DRAFT HAZARD2placehold"@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 4 · api fails: 0

## Click sweep
- 80 clicked of 203 candidates (cap 80) · tally: OK=80

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | summary "How this works" | 1162×50 | OK |  |  |
| 2 | button "Search⌘K" | 99×36 | OK |  |  |
| 3 | button "Chat" | 52×52 | OK |  |  |
| 4 | div "EMAIL-S02-FINISH-APPLICATIONDRAFToff" | 294×40 | OK |  |  |
| 5 | div "S-02DRAFToff" | 294×40 | OK |  |  |
| 6 | div "payment_link_noticeoff" | 294×40 | OK |  |  |
| 7 | div "SMS-AISET03-MSG1off" | 294×40 | OK |  |  |
| 8 | div "SMS-AISET03-MSG2off" | 294×40 | OK |  |  |
| 9 | div "SMS-AISET03-MSG3off" | 294×40 | OK |  |  |
| 10 | div "SMS-AISET04-HANDOFFon" | 294×40 | OK |  |  |
| 11 | div "SMS-AX07-FUNDING-PAUSEDoff" | 294×40 | OK |  |  |
| 12 | div "SMS-BLK-01-NEW-NEGATIVE-PAUSEDoff" | 294×40 | OK |  |  |
| 13 | div "SMS-BS01-01-BOOKEDon" | 294×40 | OK |  |  |
| 14 | div "SMS-BS01-01-CONFIRMATION-HUBoff" | 294×40 | OK |  |  |
| 15 | div "SMS-BS01-02-PRECALLon" | 294×40 | OK |  |  |
| 16 | div "SMS-BS01-02-PRECALL-NUDGEoff" | 294×40 | OK |  |  |
| 17 | div "SMS-BS01-03-DAYOFon" | 294×40 | OK |  |  |
| 18 | div "SMS-C06-DECLINEoff" | 294×40 | OK |  |  |
| 19 | div "SMS-DPC04-RESCHEDULE-REBOOKINGoff" | 294×40 | OK |  |  |
| 20 | div "SMS-DPC05-NO-PROGRESS-72Hoff" | 294×40 | OK |  |  |
| 21 | div "SMS-DS01-REPAIR-REFERRALoff" | 294×40 | OK |  |  |
| 22 | div "SMS-F02-01-PORTAL-IDoff" | 294×40 | OK |  |  |
| 23 | div "SMS-F02-02-PORTAL-ID-FOLLOWUPoff" | 294×40 | OK |  |  |
| 24 | div "AFoff" | 294×40 | OK |  |  |
| 25 | div "AF-06off" | 294×40 | OK |  |  |
| 26 | div "AF1off" | 294×40 | OK |  |  |
| 27 | div "AF2off" | 294×40 | OK |  |  |
| 28 | div "AF3off" | 294×40 | OK |  |  |
| 29 | div "AF4off" | 294×40 | OK |  |  |
| 30 | div "AR-PP1off" | 294×40 | OK |  |  |
| 31 | div "AR-PP2off" | 294×40 | OK |  |  |
| 32 | div "AR-PP3off" | 294×40 | OK |  |  |
| 33 | div "AR-PP4off" | 294×40 | OK |  |  |
| 34 | div "AR-PP5off" | 294×40 | OK |  |  |
| 35 | div "AR-PP6off" | 294×40 | OK |  |  |
| 36 | div "AR1off" | 294×40 | OK |  |  |
| 37 | div "AR2off" | 294×40 | OK |  |  |
| 38 | div "AR3off" | 294×40 | OK |  |  |
| 39 | div "AR4off" | 294×40 | OK |  |  |
| 40 | div "Begin LT-Cold-2off" | 294×40 | OK |  |  |
| 41 | div "Begin LT-Cold-3.off" | 294×40 | OK |  |  |
| 42 | div "BS-EMAIL-FUNDING-72HRoff" | 294×40 | OK |  |  |
| 43 | div "BS-EMAIL-REPAIR-72HRoff" | 294×40 | OK |  |  |
| 44 | div "BS-FUND-D1-E1-morningoff" | 294×40 | OK |  |  |
| 45 | div "BS-FUND-D1-E2-midmorningoff" | 294×40 | OK |  |  |
| 46 | div "BS-FUND-D1-E3-lunchoff" | 294×40 | OK |  |  |
| 47 | div "BS-FUND-D1-E4-afternoonoff" | 294×40 | OK |  |  |
| 48 | div "BS-FUND-D1-E5-eveningoff" | 294×40 | OK |  |  |
| 49 | div "BS-FUND-D1-E6-nightoff" | 294×40 | OK |  |  |
| 50 | div "BS-FUND-D2-E1-morningoff" | 294×40 | OK |  |  |
| 51 | div "BS-FUND-D2-E2-midmorningoff" | 294×40 | OK |  |  |
| 52 | div "BS-FUND-D2-E3-lunchoff" | 294×40 | OK |  |  |
| 53 | div "BS-FUND-D2-E4-afternoonoff" | 294×40 | OK |  |  |
| 54 | div "BS-FUND-D2-E5-eveningoff" | 294×40 | OK |  |  |
| 55 | div "BS-FUND-D2-E6-nightoff" | 294×40 | OK |  |  |
| 56 | div "BS-FUND-D3-E1-morningoff" | 294×40 | OK |  |  |
| 57 | div "BS-FUND-D3-E2-midmorningoff" | 294×40 | OK |  |  |
| 58 | div "BS-FUND-D3-E3-lunchoff" | 294×40 | OK |  |  |
| 59 | div "BS-FUND-D3-E4-afternoonoff" | 294×40 | OK |  |  |
| 60 | div "BS-FUND-D3-E5-eveningoff" | 294×40 | OK |  |  |
| 61 | div "BS-FUND-D3-E6-nightoff" | 294×40 | OK |  |  |
| 62 | div "BS-REPAIR-D1-E1-morningoff" | 294×40 | OK |  |  |
| 63 | div "BS-REPAIR-D1-E2-midmorningoff" | 294×40 | OK |  |  |
| 64 | div "BS-REPAIR-D1-E3-lunchoff" | 294×40 | OK |  |  |
| 65 | div "BS-REPAIR-D1-E4-afternoonoff" | 294×40 | OK |  |  |
| 66 | div "BS-REPAIR-D1-E5-eveningoff" | 294×40 | OK |  |  |
| 67 | div "BS-REPAIR-D2-E6-nightoff" | 294×40 | OK |  |  |
| 68 | div "BS-REPAIR-D3-E1-morningoff" | 294×40 | OK |  |  |
| 69 | div "BS-REPAIR-D3-E2-midmorningoff" | 294×40 | OK |  |  |
| 70 | div "BS-REPAIR-D3-E3-lunchoff" | 294×40 | OK |  |  |
| 71 | div "BS-REPAIR-D3-E4-afternoonoff" | 294×40 | OK |  |  |
| 72 | div "BS-REPAIR-D3-E5-eveningoff" | 294×40 | OK |  |  |
| 73 | div "BS-REPAIR-D3-E6-nightoff" | 294×40 | OK |  |  |
| 74 | div "C3off" | 294×40 | OK |  |  |
| 75 | div "CONTRACT-REMIND-EMAILon" | 294×40 | OK |  |  |
| 76 | div "CONTRACT-SEND-EMAILon" | 294×40 | OK |  |  |
| 77 | div "D1off" | 294×40 | OK |  |  |
| 78 | div "D2off" | 294×40 | OK |  |  |
| 79 | div "D3off" | 294×40 | OK |  |  |
| 80 | div "D4off" | 294×40 | OK |  |  |
