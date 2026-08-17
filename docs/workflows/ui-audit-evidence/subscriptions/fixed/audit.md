# UI audit evidence — subscriptions/fixed as owner@fundhub.ai

Ran 2026-08-17T10:29:24.499Z against https://fundhub.ai. Login ok (role owner). Screen /app/subscriptions.html → HTTP 200, final /app/subscriptions.html, title "Fundhub — Subscriptions".

Shots: docs/workflows/ui-audit-evidence/subscriptions/fixed/1440-fold.png · docs/workflows/ui-audit-evidence/subscriptions/fixed/1440-full.png · docs/workflows/ui-audit-evidence/subscriptions/fixed/390-full.png

## Load
- API calls: 4; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 957px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Subscriptions / Subscriptions / Payment links · H2s: —
- Nav: 4 visible items · active: ◍SubscriptionsBETA · groups: Sales▾(0), Funding▾(4), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (6): 18px×3, 14px×12, 13px×1, 12px×1, 11px×11, 10px×1
- Primary-looking (filled) buttons: 2 — "Find a client", "Chat"
- Generic labels: none · targets under 40px: 6
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
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 4 · api fails: 0

## Click sweep
- 6 clicked of 6 candidates (cap 80) · tally: OK=4, NAV=2

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | a "← Command Center" | 133×17 | NAV | → /app/command-center.html · GET /api/auth/session 200; GET /api/read/agents 200; GET /api/dashboard/kpis 200; GET /api/health 200; GET /api/dashboard/pipeline 200; GET /api/org-brand 200; GET /api/demo/mode 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200 |  |
| 3 | a "← Client hub" | 84×17 | NAV | → /app/finance-os.html · GET /api/auth/session 200; GET /api/demo/mode 200; GET /api/health 200; GET /api/dashboard/clients 200; GET /api/auth/session 200; GET /api/org-brand 200; GET /api/demo/mode 200 |  |
| 4 | button "Find a client" | 112×34 | OK |  |  |
| 5 | button "Search⌘K" | 99×36 | OK |  |  |
| 6 | button "Chat" | 52×52 | OK |  |  |
