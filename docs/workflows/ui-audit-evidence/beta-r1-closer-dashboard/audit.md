# UI audit evidence — beta-r1-closer-dashboard as closer@fundhub.ai

Ran 2026-08-18T03:32:23.955Z against https://fundhub.ai. Login ok (role closer). Screen /app/closer-dashboard.html → HTTP 200, final /app/closer-dashboard.html, title "Fundhub — Closer Dashboard".

Shots: docs/workflows/ui-audit-evidence/beta-r1-closer-dashboard/1440-fold.png · docs/workflows/ui-audit-evidence/beta-r1-closer-dashboard/1440-full.png · docs/workflows/ui-audit-evidence/beta-r1-closer-dashboard/390-full.png

## Load
- API calls: 4; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "Fundhub / Closer Dashboard Org: Fundhub Mon, Aug 17, 11:32:47 PM EDT LIVE Search"
- H1: — · H2s: —
- Nav: 5 visible items · active: ★Closer Dashboard · groups: Sales▾(5), Funding▾(0), Client ops▾(0), Automation▾(0)
- Font sizes in use (4): 28px×4, 14px×53, 13px×1, 11px×32
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 1
- Off-8px-scale spacing values: 9px×1, 18px×1, 13px×2, 15px×2, 10px×10, 2px×6, 14px×1
- Uneven card rows: top 224: [1164,576,576]; top 328: [544,267,267]
- ALL-CAPS runs: 6 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Client | Stage | Next | When] rows=2; numeric cols align: n/a ‖ [Lender | Limit | Balance | Headroom | Draw] rows=3; numeric cols align: n/a ‖ [Method | 12mo | 24mo | 36mo] rows=4; numeric cols align: n/a ‖ [] rows=3; numeric cols align: n/a ‖ [Card | APR | Min. Payment] rows=1; numeric cols align: n/a
- Metric-ish elements: "T— TEST — Closer Role closer C"@14px, "Total Available Credit —"@14px, "Lender matches (live list) — I"@14px, "Net Cash to Client —"@14px, "Monthly Obligation —"@14px, "fundhub-closer · v1 org: fundh"@11px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: div.topbar-right, button#fh-shell-search-btn, span, div#fh-shell-chip, span, span#fh-shell-src · text under 11px: 0 · api fails: 0

## Click sweep
- 3 clicked of 3 candidates (cap 80) · tally: OK=3

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Search⌘K" | 110×40 | OK |  |  |
| 2 | summary "› Show breakdown per-lender waterfall · payback comparison ·" | 1162×38 | OK |  |  |
| 3 | button "Chat" | 52×52 | OK |  |  |
