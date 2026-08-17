# UI audit evidence — subscriptions as owner@fundhub.ai

Ran 2026-08-17T06:24:41.183Z against https://fundhub.ai. Login ok (role owner). Screen /app/subscriptions.html → HTTP 200, final /app/subscriptions.html, title "Fundhub — Subscriptions".

Shots: docs/workflows/ui-audit-evidence/subscriptions/1440-fold.png · docs/workflows/ui-audit-evidence/subscriptions/1440-full.png · docs/workflows/ui-audit-evidence/subscriptions/390-full.png

## Load
- API calls: 4; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 4947px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Subscriptions / Subscriptions / Payment links · H2s: —
- Nav: 33 visible items · active: ◍SubscriptionsBETA · groups: Sales▾(6), Funding▾(4), Client ops▾(5), Watch▾(3), Automation▾(4), Marketing▾(4), Admin▾(5), Portals▾(2)
- Font sizes in use (7): 22px×2, 14.5px×1, 13px×8, 12px×4, 11px×6, 10.5px×1, 10px×3
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 4
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
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: code, code · text under 11px: 32 · api fails: 0

## Click sweep
- 5 clicked of 5 candidates (cap 80) · tally: OK=1, NAV=2, NOOP=2

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | a "← Command Center" | 63×42 | NAV | → /app/command-center.html · GET /api/auth/session 200; GET /api/read/agents 200; GET /api/dashboard/pipeline 200; GET /api/health 200; GET /api/org-brand 200; GET /api/dashboard/kpis 200; GET /api/demo/mode 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200 |  |
| 3 | a "← Client hub" | 35×42 | NAV | → /app/finance-os.html · GET /api/auth/session 200; GET /api/auth/session 200; GET /api/health 200; GET /api/dashboard/clients 200; GET /api/demo/mode 200; GET /api/org-brand 200; GET /api/demo/mode 200 |  |
| 4 | button "Search⌘K" | 99×36 | NOOP |  | docs/workflows/ui-audit-evidence/subscriptions/clicks/04-NOOP-Search_K.png |
| 5 | button "Chat" | 52×52 | NOOP |  | docs/workflows/ui-audit-evidence/subscriptions/clicks/05-NOOP-Chat.png |
