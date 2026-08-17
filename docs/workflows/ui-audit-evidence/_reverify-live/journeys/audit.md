# UI audit evidence — _reverify-live/journeys as owner@fundhub.ai

Ran 2026-08-17T20:17:09.648Z against https://fundhub.ai. Login ok (role owner). Screen /app/journeys.html → HTTP 200, final /app/journeys.html, title "Fundhub — Journeys".

Shots: docs/workflows/ui-audit-evidence/_reverify-live/journeys/1440-fold.png · docs/workflows/ui-audit-evidence/_reverify-live/journeys/1440-full.png · docs/workflows/ui-audit-evidence/_reverify-live/journeys/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Client · H2s: —
- Nav: 4 visible items · active: ⇝JourneysBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(4), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (6): 18px×1, 14px×42, 13px×1, 12px×1, 11px×40, 10px×1
- Primary-looking (filled) buttons: 2 — "Make the change", "Chat"
- Generic labels: none · targets under 40px: 14
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
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: button.jrow, span.nm, button.jrow, span.nm · text under 11px: 4 · api fails: 0

## Click sweep
- skipped: --no-clicks
