# UI audit evidence — journeys as owner@fundhub.ai

Ran 2026-08-17T06:12:17.281Z against https://fundhub.ai. Login ok (role owner). Screen /app/journeys.html → HTTP 200, final /app/journeys.html, title "Fundhub — Journeys".

Shots: docs/workflows/ui-audit-evidence/journeys/1440-fold.png · docs/workflows/ui-audit-evidence/journeys/1440-full.png · docs/workflows/ui-audit-evidence/journeys/390-full.png

## Load
- API calls: 5; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Client · H2s: —
- Nav: 33 visible items · active: ⇝JourneysBETA · groups: Sales▾(6), Funding▾(4), Client ops▾(5), Watch▾(3), Automation▾(4), Marketing▾(4), Admin▾(5), Portals▾(2)
- Font sizes in use (12): 22px×1, 15px×1, 13.5px×19, 13px×5, 12.5px×15, 12px×4, 11px×4, 10.5px×1, 10px×17, 9.5px×1, 9px×5, 8.5px×13
- Primary-looking (filled) buttons: 3 — "Apply to code", "Make the change", "Chat"
- Generic labels: none · targets under 40px: 14
- Off-8px-scale spacing values: none
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: button.jrow, span.nm, button.jrow, span.nm · text under 11px: 58 · api fails: 0

## Click sweep
- 32 clicked of 32 candidates (cap 80) · tally: NOOP=5, DIALOG=1, WRITE-INTERCEPTED=4, OK=22

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | NOOP |  | docs/workflows/ui-audit-evidence/journeys/clicks/01-NOOP-Dismiss.png |
| 2 | button "Save version" | 110×46 | DIALOG | dialog: prompt "Name this version" |  |
| 3 | button "Test against the code" | 170×46 | WRITE-INTERCEPTED | POST /api/journeys/run 599 · WRITE POST /api/journeys/run {} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/journeys/clicks/03-WRITE-INTERCEPTED-Test_against_the_code.png |
| 4 | button "Apply to code" | 117×46 | OK |  |  |
| 5 | button "Client13" | 189×38 | NOOP |  | docs/workflows/ui-audit-evidence/journeys/clicks/05-NOOP-Client13.png |
| 6 | button "Setter6" | 189×38 | OK |  |  |
| 7 | button "Closer9" | 189×38 | OK |  |  |
| 8 | button "Funding Advisor5" | 189×38 | OK |  |  |
| 9 | button "Affiliate3" | 189×38 | OK |  |  |
| 10 | button "White-Label Partner3" | 189×38 | OK |  |  |
| 11 | button "Make the change" | 135×32 | NOOP |  | docs/workflows/ui-audit-evidence/journeys/clicks/11-NOOP-Make_the_change.png |
| 12 | button "If they don’t confirm by 6pm, text them again at 8am" | 323×30 | WRITE-INTERCEPTED | POST /api/journeys/ask 599 · WRITE POST /api/journeys/ask {system,user} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/journeys/clicks/12-WRITE-INTERCEPTED-If_they_don_t_confirm_by_6pm_t.png |
| 13 | button "Add a 3-day check-in after the call" | 223×30 | WRITE-INTERCEPTED | POST /api/journeys/ask 599 · WRITE POST /api/journeys/ask {system,user} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/journeys/clicks/13-WRITE-INTERCEPTED-Add_a_3_day_check_in_after_the.png |
| 14 | button "Email a recap once the diagnostic is done" | 262×30 | WRITE-INTERCEPTED | POST /api/journeys/ask 599 · WRITE POST /api/journeys/ask {system,user} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/journeys/clicks/14-WRITE-INTERCEPTED-Email_a_recap_once_the_diagnos.png |
| 15 | button "Text them the survey linkSend a textHi {{first_name}} — Chri" | 340×88 | OK |  |  |
| 16 | button "Give the lead to a setterAssign toGoes to whichever Setter i" | 340×69 | OK |  |  |
| 17 | button "Wait two days for the surveyWaitNothing happens for 2 days" | 340×69 | OK |  |  |
| 18 | button "Did they finish the surveyAsk a questionTwo paths below, dep" | 340×69 | OK |  |  |
| 19 | button "Move them to Survey CompleteMove the cardTheir card moves to" | 295×108 | OK |  |  |
| 20 | button "Text them the booking linkSend a textThanks {{first_name}}. " | 295×88 | OK |  |  |
| 21 | button "Nudge them once moreSend a text{{first_name}} — still need t" | 295×88 | OK |  |  |
| 22 | button "Move them to BookedMove the cardTheir card moves to Booked i" | 340×69 | OK |  |  |
| 23 | button "Remind them the day beforeSend a text{{first_name}} — we're " | 340×88 | OK |  |  |
| 24 | button "Hand the call to a closerHand offThe Closer journey picks up" | 340×69 | OK |  |  |
| 25 | button "Take the $32 diagnosticTake paymentCharge $32.00 for Busines" | 340×69 | OK |  |  |
| 26 | button "Run UnderwriteIQRun an agentSoft pull, then score the file a" | 340×69 | OK |  |  |
| 27 | button "Email the resultsSend an emailYour Fundhub diagnostic is rea" | 340×88 | OK |  |  |
| 28 | button "Step" | 51×45 | NOOP |  | docs/workflows/ui-audit-evidence/journeys/clicks/28-NOOP-Step.png |
| 29 | button "Simulate" | 80×45 | OK |  |  |
| 30 | button "History" | 72×45 | OK |  |  |
| 31 | button "Search⌘K" | 99×36 | NOOP |  | docs/workflows/ui-audit-evidence/journeys/clicks/31-NOOP-Search_K.png |
| 32 | button "Chat" | 52×52 | OK |  |  |
