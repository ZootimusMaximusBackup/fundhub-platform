# UI audit evidence — journeys/fixed as owner@fundhub.ai

Ran 2026-08-17T10:34:32.535Z against https://fundhub.ai. Login ok (role owner). Screen /app/journeys.html → HTTP 200, final /app/journeys.html, title "Fundhub — Journeys".

Shots: docs/workflows/ui-audit-evidence/journeys/fixed/1440-fold.png · docs/workflows/ui-audit-evidence/journeys/fixed/1440-full.png · docs/workflows/ui-audit-evidence/journeys/fixed/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Client · H2s: —
- Nav: 4 visible items · active: ⇝JourneysBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(4), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (6): 18px×1, 14px×42, 13px×1, 12px×1, 11px×40, 10px×1
- Primary-looking (filled) buttons: 2 — "Make the change", "Chat"
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
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: button.jrow, span.nm, button.jrow, span.nm · text under 11px: 4 · api fails: 0

## Click sweep
- 31 clicked of 31 candidates (cap 80) · tally: OK=23, DIALOG=1, WRITE-INTERCEPTED=4, NOOP=3

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "Save version" | 110×49 | DIALOG | dialog: prompt "Name this version" |  |
| 3 | button "Test against the code" | 170×49 | WRITE-INTERCEPTED | POST /api/journeys/run 599 · WRITE POST /api/journeys/run {} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/journeys/fixed/clicks/03-WRITE-INTERCEPTED-Test_against_the_code.png |
| 4 | button "Apply to code" | 116×49 | OK |  |  |
| 5 | button "Client13" | 189×39 | NOOP |  | docs/workflows/ui-audit-evidence/journeys/fixed/clicks/05-NOOP-Client13.png |
| 6 | button "Setter6" | 189×39 | OK |  |  |
| 7 | button "Closer9" | 189×39 | OK |  |  |
| 8 | button "Funding Advisor5" | 189×39 | OK |  |  |
| 9 | button "Affiliate3" | 189×39 | OK |  |  |
| 10 | button "White-Label Partner3" | 189×39 | OK |  |  |
| 11 | button "If they don’t confirm by 6pm, text them again at 8am" | 372×33 | WRITE-INTERCEPTED | POST /api/journeys/ask 599 · WRITE POST /api/journeys/ask {system,user} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/journeys/fixed/clicks/11-WRITE-INTERCEPTED-If_they_don_t_confirm_by_6pm_t.png |
| 12 | button "Add a 3-day check-in after the call" | 255×33 | WRITE-INTERCEPTED | POST /api/journeys/ask 599 · WRITE POST /api/journeys/ask {system,user} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/journeys/fixed/clicks/12-WRITE-INTERCEPTED-Add_a_3_day_check_in_after_the.png |
| 13 | button "Email a recap once the diagnostic is done" | 301×33 | WRITE-INTERCEPTED | POST /api/journeys/ask 599 · WRITE POST /api/journeys/ask {system,user} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/journeys/fixed/clicks/13-WRITE-INTERCEPTED-Email_a_recap_once_the_diagnos.png |
| 14 | button "Text them the survey linkSend a textHi {{first_name}} — Chri" | 340×93 | OK |  |  |
| 15 | button "Give the lead to a setterAssign toGoes to whichever Setter i" | 340×72 | OK |  |  |
| 16 | button "Wait two days for the surveyWaitNothing happens for 2 days" | 340×72 | OK |  |  |
| 17 | button "Did they finish the surveyAsk a questionTwo paths below, dep" | 340×72 | OK |  |  |
| 18 | button "Move them to Survey CompleteMove the cardTheir card moves to" | 295×114 | OK |  |  |
| 19 | button "Text them the booking linkSend a textThanks {{first_name}}. " | 295×114 | OK |  |  |
| 20 | button "Nudge them once moreSend a text{{first_name}} — still need t" | 295×93 | OK |  |  |
| 21 | button "Move them to BookedMove the cardTheir card moves to Booked i" | 340×72 | OK |  |  |
| 22 | button "Remind them the day beforeSend a text{{first_name}} — we're " | 340×93 | OK |  |  |
| 23 | button "Hand the call to a closerHand offThe Closer journey picks up" | 340×72 | OK |  |  |
| 24 | button "Take the $32 diagnosticTake paymentCharge $32.00 for Busines" | 340×93 | OK |  |  |
| 25 | button "Run UnderwriteIQRun an agentSoft pull, then score the file a" | 340×72 | OK |  |  |
| 26 | button "Email the resultsSend an emailYour Fundhub diagnostic is rea" | 340×93 | OK |  |  |
| 27 | button "Step" | 54×47 | NOOP |  | docs/workflows/ui-audit-evidence/journeys/fixed/clicks/27-NOOP-Step.png |
| 28 | button "Simulate" | 85×47 | OK |  |  |
| 29 | button "History" | 77×47 | OK |  |  |
| 30 | button "Search⌘K" | 99×36 | NOOP |  | docs/workflows/ui-audit-evidence/journeys/fixed/clicks/30-NOOP-Search_K.png |
| 31 | button "Chat" | 52×52 | OK |  |  |
