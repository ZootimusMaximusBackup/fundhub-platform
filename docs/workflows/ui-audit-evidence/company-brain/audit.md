# UI audit evidence — company-brain as advisor@fundhub.ai

Ran 2026-08-17T06:21:36.994Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/company-brain.html → HTTP 200, final /app/company-brain.html, title "Fundhub — Company Brain".

Shots: docs/workflows/ui-audit-evidence/company-brain/1440-fold.png · docs/workflows/ui-audit-evidence/company-brain/1440-full.png · docs/workflows/ui-audit-evidence/company-brain/390-full.png

## Load
- API calls: 3; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Company Brain · H2s: —
- Nav: 24 visible items · active: ◎Company BrainBETA · groups: Sales▾(3), Funding▾(3), Client ops▾(5), Watch▾(3), Automation▾(3), Marketing▾(4), Admin▾(3)
- Font sizes in use (8): 15px×1, 14.5px×1, 13px×4, 12.5px×1, 12px×1, 11px×5, 10.5px×1, 10px×4
- Primary-looking (filled) buttons: 2 — "Ask", "Chat"
- Generic labels: none · targets under 40px: 3
- Off-8px-scale spacing values: 13px×2, 14px×1
- Uneven card rows: top 120: [1164,1162]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 27 · api fails: 0

## Click sweep
- 4 clicked of 4 candidates (cap 80) · tally: NOOP=2, OK=2

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | NOOP |  | docs/workflows/ui-audit-evidence/company-brain/clicks/01-NOOP-Dismiss.png |
| 2 | button "Ask" | 53×42 | OK |  |  |
| 3 | button "Search⌘K" | 99×36 | NOOP |  | docs/workflows/ui-audit-evidence/company-brain/clicks/03-NOOP-Search_K.png |
| 4 | button "Chat" | 52×52 | OK |  |  |
