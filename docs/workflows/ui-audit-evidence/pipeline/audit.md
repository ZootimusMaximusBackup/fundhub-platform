# UI audit evidence — _test-pipeline as closer@fundhub.ai

Ran 2026-08-17T06:04:16.618Z against https://fundhub.ai. Login ok (role closer). Screen /app/pipeline.html → HTTP 200, final /app/pipeline.html, title "Fundhub — Pipeline".

Shots: docs/workflows/ui-audit-evidence/_test-pipeline/1440-fold.png · docs/workflows/ui-audit-evidence/_test-pipeline/1440-full.png · docs/workflows/ui-audit-evidence/_test-pipeline/390-full.png

## Load
- API calls: 11; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "Fundhub / Pipeline Org: Fundhub Mon, Aug 17, 2:04:26 AM EDT LIVE"
- H1: — · H2s: —
- Nav: 26 visible items · active: ▤Pipeline · groups: Sales▾(5), Funding▾(3), Client ops▾(5), Watch▾(3), Automation▾(3), Marketing▾(4), Admin▾(3)
- Font sizes in use (13): 16px×1, 14px×1, 13px×1, 12.5px×11, 12px×15, 11.5px×6, 11px×14, 10.5px×18, 10px×20, 9.5px×1, 9px×6, 8.5px×6, 7.5px×5
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 9
- Off-8px-scale spacing values: 7px×5, 9px×5, 14px×1
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: mid-drag preview · blocked move · empty rail
- Tables: none
- Metric-ish elements: "fundhub-pipeline · v1 org: fun"@10px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: div.rail-tab, div.rail-tab, div.rail-tab, div.rail-tab, div.rail-tab, div.rail-tab · text under 11px: 137 · api fails: 0

## Click sweep
- 9 clicked of 9 candidates (cap 80) · tally: OK=9

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "⚟ Filter0" | 60×28 | OK |  |  |
| 2 | button "Demonstration states mid-drag preview · blocked move · empty" | 1212×25 | OK |  |  |
| 3 | button "Search⌘K" | 99×36 | OK |  |  |
| 4 | button "Chat" | 52×52 | OK |  |  |
| 5 | span "MOVE" | 40×15 | OK |  |  |
| 6 | span "MOVE" | 40×15 | OK |  |  |
| 7 | span "MOVE" | 40×15 | OK |  |  |
| 8 | span "MOVE" | 40×15 | OK |  |  |
| 9 | span "MOVE" | 40×15 | OK |  |  |
