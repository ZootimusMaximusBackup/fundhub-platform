# UI audit evidence — calendar-mlfix as sales@fundhub.ai

Ran 2026-08-17T19:37:45.807Z against https://fundhub.ai. Login ok (role sales_manager). Screen /app/calendar.html → HTTP 200, final /app/calendar.html, title "Fundhub — Calendar".

Shots: docs/workflows/ui-audit-evidence/calendar-mlfix/1440-fold.png · docs/workflows/ui-audit-evidence/calendar-mlfix/1440-full.png · docs/workflows/ui-audit-evidence/calendar-mlfix/390-full.png

## Load
- API calls: 6; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "Fundhub / Calendar Org: Fundhub Mon, Aug 17, 3:37:55 PM EDT LIVE"
- H1: — · H2s: —
- Nav: 4 visible items · active: ▦Calendar · groups: Sales▾(4), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (6): 28px×1, 14px×66, 13px×1, 12px×1, 11px×13, 10px×1
- Primary-looking (filled) buttons: 2 — "Client file", "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 7px×3, 11px×5, 6px×3, 14px×1
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "Booked2 Done0 No-show— Show ra"@14px, "Booked2"@14px, "Done0"@14px, "No-show—"@14px, "Show rate—"@14px, "Left today2"@14px, "16"@14px, "17"@14px, "18"@14px, "19"@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: div.stat-tiles, div.stat, div.l, div#statDone.v, div.stat, div.l · text under 11px: 1 · api fails: 0

## Click sweep
- skipped: --no-clicks
