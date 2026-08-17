# UI audit evidence — automations as owner@fundhub.ai

Ran 2026-08-17T06:08:49.731Z against https://fundhub.ai. Login ok (role owner). Screen /app/automations.html → HTTP 200, final /app/automations.html, title "Fundhub — Automations".

Shots: docs/workflows/ui-audit-evidence/automations/1440-fold.png · docs/workflows/ui-audit-evidence/automations/1440-full.png · docs/workflows/ui-audit-evidence/automations/390-full.png

## Load
- API calls: 5; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "/ Automations Org: Fundhub Mon, Aug 17, 2:09:01 AM EDT LIVE"
- H1: — · H2s: —
- Nav: 33 visible items · active: ⇄Workflows · groups: Sales▾(6), Funding▾(4), Client ops▾(5), Watch▾(3), Automation▾(4), Marketing▾(4), Admin▾(5), Portals▾(2)
- Font sizes in use (10): 16px×1, 14px×3, 13px×1, 12.5px×156, 12px×2, 11.5px×14, 11px×3, 10.5px×67, 10px×55, 9px×111
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 2
- Off-8px-scale spacing values: 5px×3, 14px×1
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Workflow | Trigger | Last Fired | Status] rows=1; numeric cols align: n/a ‖ [Workflow | Trigger | Last Fired | Status] rows=1; numeric cols align: n/a ‖ [Workflow | Trigger | Last Fired | Status] rows=1; numeric cols align: n/a ‖ [Workflow | Trigger | Last Fired | Status] rows=1; numeric cols align: n/a ‖ [Workflow | Trigger | Last Fired | Status] rows=1; numeric cols align: n/a ‖ [Workflow | Trigger | Last Fired | Status] rows=1; numeric cols align: n/a
- Metric-ish elements: "51"@14px, "42 of 51"@14px, "FUNDHUB-AUTOMATIONS · v1 ORG: "@10px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table.wf, tbody, tr, th, tr, td · text under 11px: 209 · api fails: 0

## Click sweep
- 53 clicked of 53 candidates (cap 80) · tally: OK=53

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Search⌘K" | 99×36 | OK |  |  |
| 2 | button "Chat" | 52×52 | OK |  |  |
| 3 | tr "▸AF-02 — Referral Ownership Captureaf-02-referral-ownership-" | 1162×51 | OK |  |  |
| 4 | tr "▸AI-SET-03 — No-Answer SMS Cadenceai-set-03-no-answer-cadenc" | 1162×48 | OK |  |  |
| 5 | tr "▸AI-SET-04 — 3-Way Text Handoffai-set-04-3way-handoffon book" | 1162×48 | OK |  |  |
| 6 | tr "▸AT-01 — First Touch Captureat-01-first-touch-captureon entr" | 1162×48 | OK |  |  |
| 7 | tr "▸BC-01 — Customer Responsiveness Classifierbc-01-customer-re" | 1162×48 | OK |  |  |
| 8 | tr "▸BC-02 — Customer Friction Level Detectorbc-02-customer-fric" | 1162×48 | OK |  |  |
| 9 | tr "▸BS-01 — Pre-Call Backend Launcherbs-01-precall-launcheron b" | 1162×48 | OK |  |  |
| 10 | tr "▸C-00 — CRS Soft Pull Requestc-00-crs-soft-pull-requeston di" | 1162×48 | OK |  |  |
| 11 | tr "▸C-02 — Inquiry Createdc-02-inquiry-createdon analysis.compl" | 1162×48 | OK |  |  |
| 12 | tr "▸C-02B — Inquiry Removal Requestedc-02b-inquiry-removal-requ" | 1162×48 | OK |  |  |
| 13 | tr "▸C-03 — Inquiry Removedc-03-inquiry-removed-resume-or-holdon" | 1162×48 | OK |  |  |
| 14 | tr "▸C-05 — Pre-Funding Review Logicc-05-pre-funding-reviewon ro" | 1162×48 | OK |  |  |
| 15 | tr "▸C-06 — CRS Results Routerc-06-crs-results-routeron analysis" | 1162×48 | OK |  |  |
| 16 | tr "▸DPC-01 — Analyzer Lockdpc-01-analyzer-lockon analysis.compl" | 1162×48 | OK |  |  |
| 17 | tr "▸DPC-02 — Call Outcome Enforcementdpc-02-call-outcome-enforc" | 1162×48 | OK |  |  |
| 18 | tr "▸DPC-03 — Inbound Reply Routerdpc-03-inbound-reply-routeron " | 1162×48 | OK |  |  |
| 19 | tr "▸DPC-05 — 72-Hour No-Progress Escalationdpc-05-no-progress-e" | 1162×48 | OK |  |  |
| 20 | tr "▸DS-01 — Repair Referralds-01-repair-referralon call.complet" | 1162×48 | OK |  |  |
| 21 | tr "▸DS-02 — DIY Lettersds-02-diy-letterson payment.received1d a" | 1162×48 | OK |  |  |
| 22 | tr "▸F-01 — Funding Intakef-01-funding-intakeon round.started19h" | 1162×48 | OK |  |  |
| 23 | tr "▸F-02 — Portal / ID Missingf-02-portal-id-missingon round.st" | 1162×48 | OK |  |  |
| 24 | tr "▸F-03 — Round Submittedf-03-round-submittedon round.submitte" | 1162×48 | OK |  |  |
| 25 | tr "▸F-04 — Round Approvalsf-04-round-approvalson round.approved" | 1162×48 | OK |  |  |
| 26 | tr "▸F-05 — Inquiry Cleanup Gatef-05-inquiry-cleanup-gateon roun" | 1162×48 | OK |  |  |
| 27 | tr "▸F-06 — Funding Conditions / Missing Docsf-06-funding-condit" | 1162×48 | OK |  |  |
| 28 | tr "▸F-07 — Funding Lockedf-07-funding-lockedon round.funded19h " | 1162×48 | OK |  |  |
| 29 | tr "▸F-08 — Post-Funding Monitoringf-08-post-funding-monitoringo" | 1162×48 | OK |  |  |
| 30 | tr "▸F-09 — Funding Declined / No Pathf-09-funding-declined-no-p" | 1162×48 | OK |  |  |
| 31 | tr "▸F-10 — Client Funding Inbox Provisionerf-10-client-funding-" | 1162×48 | OK |  |  |
| 32 | tr "▸F-11 — Bank Email Event Routerf-11-bank-email-event-routero" | 1162×48 | OK |  |  |
| 33 | tr "▸N-01 — Long-Term Cold Nurturen-01-cold-nurtureon entry.capt" | 1162×48 | OK |  |  |
| 34 | tr "▸N-02 — Long-Term Warm Nurturen-02-warm-nurtureon survey.sub" | 1162×48 | OK |  |  |
| 35 | tr "▸N-03 — Long-Term Hot Nurturen-03-hot-nurtureon booking.crea" | 1162×48 | OK |  |  |
| 36 | tr "▸N-04 — Post-Funding Nurturen-04-post-funding-nurtureon roun" | 1162×48 | OK |  |  |
| 37 | tr "▸N-06 — Renewal / Second-Wave Fundingn-06-renewal-second-wav" | 1162×48 | OK |  |  |
| 38 | tr "▸Contracts — chase unsignedcontract-chasercron 0 10 * * *—NE" | 1162×48 | OK |  |  |
| 39 | tr "▸Message dispatch sweepermessage-dispatch-sweepercron */5 * " | 1162×48 | OK |  |  |
| 40 | tr "▸Round Started — Client Notifyround-started-client-notifyon " | 1162×48 | OK |  |  |
| 41 | tr "▸S-NOBOOK — Never Booked Chases-nobook-chaseon survey.submit" | 1162×48 | OK |  |  |
| 42 | tr "▸S-01 — New Lead / Intakes-01-new-lead-intakeon entry.captur" | 1162×48 | OK |  |  |
| 43 | tr "▸S-04 — Call Bookeds-04-call-bookedon booking.created1d agoL" | 1162×48 | OK |  |  |
| 44 | tr "▸S-04B — Booking Confirm + Reminderss-04b-booking-reminderso" | 1162×48 | OK |  |  |
| 45 | tr "▸S-05a — No-Show Recoverys-05a-no-show-recoveryon booking.no" | 1162×48 | OK |  |  |
| 46 | tr "▸S-06 — Post-Call Outcome: Funding Purchaseds-06-post-call-f" | 1162×48 | OK |  |  |
| 47 | tr "▸S-08 — Post-Call: Funding Didn't Buys-08-post-call-funding-" | 1162×48 | OK |  |  |
| 48 | tr "▸SYS-01 — Client Value Calculatorsys-01-client-value-calcula" | 1162×48 | OK |  |  |
| 49 | tr "▸SYS-01-LTV — Lifetime Value Calculatorsys-01-ltv-calculator" | 1162×48 | OK |  |  |
| 50 | tr "▸U-02 — Analyzer Complete Deliveryu-02-analyzer-complete-del" | 1162×48 | OK |  |  |
| 51 | tr "▸U-03 — CRS Snapshot Syncu-03-crs-snapshot-syncon analysis.c" | 1162×48 | OK |  |  |
| 52 | tr "▸U-04 — Promote CRS as Primary Snapshotu-04-promote-crs-prim" | 1162×48 | OK |  |  |
| 53 | tr "▸U-05 — UnderwriteIQ Data Health Monitoru-05-data-health-mon" | 1162×48 | OK |  |  |
