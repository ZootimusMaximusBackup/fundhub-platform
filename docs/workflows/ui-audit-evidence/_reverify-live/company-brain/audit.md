# UI audit evidence — _reverify-live/company-brain as advisor@fundhub.ai

Ran 2026-08-17T20:17:11.186Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/company-brain.html → HTTP 200, final /app/company-brain.html, title "Fundhub — Company Brain".

Shots: docs/workflows/ui-audit-evidence/_reverify-live/company-brain/1440-fold.png · docs/workflows/ui-audit-evidence/_reverify-live/company-brain/1440-full.png · docs/workflows/ui-audit-evidence/_reverify-live/company-brain/390-full.png

## Load
- API calls: 3; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Company Brain · H2s: —
- Nav: 5 visible items · active: ◎Company BrainBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(5), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (6): 18px×2, 14px×4, 13px×1, 12px×1, 11px×9, 10px×1
- Primary-looking (filled) buttons: 2 — "Ask", "Chat"
- Generic labels: none · targets under 40px: 3
- Off-8px-scale spacing values: 13px×2, 14px×1
- Uneven card rows: top 120: [319,317]
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
- skipped: --no-clicks
