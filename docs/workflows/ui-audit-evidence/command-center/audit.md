# UI audit evidence — command-center as owner@fundhub.ai

Ran 2026-08-17T06:08:53.726Z against https://fundhub.ai. Login ok (role owner). Screen /app/command-center.html → HTTP 200, final /app/command-center.html, title "Fundhub — Command Center".

Shots: docs/workflows/ui-audit-evidence/command-center/1440-fold.png · docs/workflows/ui-audit-evidence/command-center/1440-full.png · docs/workflows/ui-audit-evidence/command-center/390-full.png

## Load
- API calls: 12; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: — · H2s: —
- Nav: 33 visible items · active: ⌘Command CenterBETA · groups: Sales▾(6), Funding▾(4), Client ops▾(5), Watch▾(3), Automation▾(4), Marketing▾(4), Admin▾(5), Portals▾(2)
- Font sizes in use (14): 17px×6, 16px×1, 15px×53, 14px×1, 13px×10, 12.5px×16, 12px×24, 11.5px×16, 11px×13, 10.5px×34, 10px×20, 9.5px×81, 9px×30, 7.5px×15
- Primary-looking (filled) buttons: 3 — "All", "All", "Chat"
- Generic labels: Done · targets under 40px: 15
- Off-8px-scale spacing values: 9px×16, 10px×51, 7px×14, 2px×14, 6px×30, 1px×5
- Uneven card rows: top 928: [717,494]; top 968: [689,466,230,230]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: none
- Error wording: Equifax portal timeout — 3 retries failed | 112 done today · 3 working now · none failed | Error rate (24h)
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "Queue backed up: 11 waiting"@10.5px, "Calls today: 34 · Bookings: 6 "@10.5px, "112 done today · 3 working now"@10.5px, "Invoices sent today: 14 · Fail"@10.5px, "Messages sent today: 89"@10.5px, "Docs requested: 3"@10.5px, "Checked today: 27 · Flagged: 4"@10.5px, "Files reconciled today: 61"@10.5px, "Pulls today: 48"@10.5px, "Cash Collected Today $0 cash c"@16px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: div.kpi-tile, div.kpi-label, div.kpi-value, div.kpi-sub, div.kpi-tile, div.kpi-label · text under 11px: 197 · api fails: 0

## Click sweep
- 29 clicked of 29 candidates (cap 80) · tally: OK=16, NAV=8, NOOP=5

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | a "Open the board ↗" | 110×21 | NAV | → /app/pipeline.html · GET /api/auth/session 200; GET /api/dashboard/pipeline 200; GET /api/health 200; GET /api/org-brand 200; GET /api/demo/mode 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200 |  |
| 3 | button "▾" | 5×12 | OK |  |  |
| 4 | a "Open board ↗" | 78×15 | NAV | → /app/pipeline.html · GET /api/auth/session 200; GET /api/dashboard/pipeline 200; GET /api/health 200; GET /api/org-brand 200; GET /api/demo/mode 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200 |  |
| 5 | button "▾" | 5×12 | OK |  |  |
| 6 | a "Open board ↗" | 78×15 | NAV | → /app/pipeline.html · GET /api/auth/session 200; GET /api/dashboard/pipeline 200; GET /api/health 200; GET /api/dashboard/pipeline 200; GET /api/org-brand 200; GET /api/demo/mode 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200 |  |
| 7 | button "▾" | 5×12 | OK |  |  |
| 8 | a "Open board ↗" | 78×15 | NAV | → /app/pipeline.html · GET /api/auth/session 200; GET /api/dashboard/pipeline 200; GET /api/health 200; GET /api/org-brand 200; GET /api/demo/mode 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200 |  |
| 9 | button "▾" | 5×12 | OK |  |  |
| 10 | a "Open board ↗" | 78×15 | NAV | → /app/pipeline.html · GET /api/auth/session 200; GET /api/health 200; GET /api/dashboard/pipeline 200; GET /api/org-brand 200; GET /api/dashboard/pipeline 200; GET /api/demo/mode 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200 |  |
| 11 | button "▾" | 5×12 | OK |  |  |
| 12 | a "Open board ↗" | 78×15 | NAV | → /app/pipeline.html · GET /api/auth/session 200; GET /api/dashboard/pipeline 200; GET /api/health 200; GET /api/org-brand 200; GET /api/demo/mode 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200 |  |
| 13 | button "▾" | 5×12 | OK |  |  |
| 14 | a "Open board ↗" | 78×15 | NAV | → /app/pipeline.html · GET /api/auth/session 200; GET /api/dashboard/pipeline 200; GET /api/health 200; GET /api/org-brand 200; GET /api/demo/mode 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200 |  |
| 15 | button "▾" | 5×12 | OK |  |  |
| 16 | a "Open board ↗" | 78×15 | NAV | → /app/pipeline.html · GET /api/auth/session 200; GET /api/dashboard/pipeline 200; GET /api/health 200; GET /api/dashboard/pipeline 200; GET /api/org-brand 200; GET /api/demo/mode 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200; GET /api/dashboard/pipeline 200 |  |
| 17 | button "All" | 37×18 | NOOP |  | docs/workflows/ui-audit-evidence/command-center/clicks/17-NOOP-All.png |
| 18 | button "Money" | 50×18 | OK |  |  |
| 19 | button "Moves" | 50×18 | NOOP |  | docs/workflows/ui-audit-evidence/command-center/clicks/19-NOOP-Moves.png |
| 20 | button "Agents" | 57×18 | NOOP |  | docs/workflows/ui-audit-evidence/command-center/clicks/20-NOOP-Agents.png |
| 21 | button "Holds" | 50×18 | NOOP |  | docs/workflows/ui-audit-evidence/command-center/clicks/21-NOOP-Holds.png |
| 22 | summary "› 13 agents nominal 8 active · 3 idle · 2 done" | 687×33 | OK |  |  |
| 23 | button "All" | 37×18 | NOOP |  | docs/workflows/ui-audit-evidence/command-center/clicks/23-NOOP-All.png |
| 24 | button "Active" | 57×18 | OK |  |  |
| 25 | button "Idle" | 44×18 | OK |  |  |
| 26 | button "Done" | 44×18 | OK |  |  |
| 27 | summary "›All systems" | 466×23 | OK |  |  |
| 28 | button "Search⌘K" | 99×36 | OK |  |  |
| 29 | button "Chat" | 52×52 | OK |  |  |
