# UI audit evidence — automations-mlfix as owner@fundhub.ai

Ran 2026-08-17T19:38:46.413Z against https://fundhub.ai. Login ok (role owner). Screen /app/automations.html → HTTP 200, final /app/automations.html, title "Fundhub — Automations".

Shots: docs/workflows/ui-audit-evidence/automations-mlfix/1440-fold.png · docs/workflows/ui-audit-evidence/automations-mlfix/1440-full.png · docs/workflows/ui-audit-evidence/automations-mlfix/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "/ Automations Org: Fundhub Mon, Aug 17, 3:38:53 PM EDT LIVE"
- H1: — · H2s: —
- Nav: 4 visible items · active: ⇄Automations · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(4), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (5): 14px×244, 13px×1, 12px×1, 11px×166, 10px×1
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
- Metric-ish elements: "51"@14px/tnum, "42 of 51"@14px/tnum, "FUNDHUB-AUTOMATIONS · v1 ORG: "@11px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table.wf, tbody, tr, th, tr, td · text under 11px: 1 · api fails: 0

## Click sweep
- skipped: --no-clicks
