# UI audit evidence — T6-automations as owner@fundhub.ai

Ran 2026-08-19T02:42:54.576Z against https://fundhub.ai. Login ok (role owner). Screen /app/automations.html → HTTP 200, final /app/automations.html, title "Fundhub — Automations".

Shots: docs/workflows/ui-audit-evidence/T6-automations/1440-fold.png · docs/workflows/ui-audit-evidence/T6-automations/1440-full.png · docs/workflows/ui-audit-evidence/T6-automations/390-full.png

## Load
- API calls: 4; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "/ Automations Org: Fundhub Tue, Aug 18, 10:43:09 PM EDT LIVE Search⌘KTEST — Owne"
- H1: — · H2s: —
- Nav: 4 visible items · active: ⇄Workflows · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(4), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (2): 16px×249, 13px×164
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 5px×3, 14px×1
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Workflow | Trigger | Trigger Last Seen | Status] rows=1; numeric cols align: n/a ‖ [Workflow | Trigger | Trigger Last Seen | Status] rows=1; numeric cols align: n/a ‖ [Workflow | Trigger | Trigger Last Seen | Status] rows=1; numeric cols align: n/a ‖ [Workflow | Trigger | Trigger Last Seen | Status] rows=1; numeric cols align: n/a ‖ [Workflow | Trigger | Trigger Last Seen | Status] rows=1; numeric cols align: n/a ‖ [Workflow | Trigger | Trigger Last Seen | Status] rows=1; numeric cols align: n/a
- Metric-ish elements: "51"@16px/tnum, "49 of 51"@16px/tnum, "FUNDHUB-AUTOMATIONS · v1 ORG: "@13px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table.wf, tbody, tr, th, th, tr · text under 11px: 0 · api fails: 0

## Click sweep
- 12 clicked of 53 candidates (cap 12) · tally: OK=12

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Search⌘K" | 120×42 | OK |  |  |
| 2 | button "Chat" | 52×52 | OK |  |  |
| 3 | tr "▸AF-02 — Referral Ownership Captureaf-02-referral-ownership-" | 1162×57 | OK |  |  |
| 4 | tr "▸AI-SET-03 — No-Answer SMS Cadenceai-set-03-no-answer-cadenc" | 1162×57 | OK |  |  |
| 5 | tr "▸AI-SET-04 — 3-Way Text Handoffai-set-04-3way-handoffon book" | 1162×57 | OK |  |  |
| 6 | tr "▸AT-01 — First Touch Captureat-01-first-touch-captureon entr" | 1162×57 | OK |  |  |
| 7 | tr "▸BC-01 — Customer Responsiveness Classifierbc-01-customer-re" | 1162×77 | OK |  |  |
| 8 | tr "▸BC-02 — Customer Friction Level Detectorbc-02-customer-fric" | 1162×57 | OK |  |  |
| 9 | tr "▸BS-01 — Pre-Call Backend Launcherbs-01-precall-launcheron b" | 1162×57 | OK |  |  |
| 10 | tr "▸C-00 — CRS Soft Pull Requestc-00-crs-soft-pull-requeston di" | 1162×57 | OK |  |  |
| 11 | tr "▸C-02 — Inquiry Createdc-02-inquiry-createdon analysis.compl" | 1162×57 | OK |  |  |
| 12 | tr "▸C-02B — Inquiry Removal Requestedc-02b-inquiry-removal-requ" | 1162×57 | OK |  |  |
