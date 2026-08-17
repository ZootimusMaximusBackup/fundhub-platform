# UI audit evidence — _reverify-live/calendar as sales@fundhub.ai

Ran 2026-08-17T20:16:31.546Z against https://fundhub.ai. Login ok (role sales_manager). Screen /app/calendar.html → HTTP 200, final /app/calendar.html, title "Fundhub — Calendar".

Shots: docs/workflows/ui-audit-evidence/_reverify-live/calendar/1440-fold.png · docs/workflows/ui-audit-evidence/_reverify-live/calendar/1440-full.png · docs/workflows/ui-audit-evidence/_reverify-live/calendar/390-full.png

## Load
- API calls: 6; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "Fundhub / Calendar Org: Fundhub Mon, Aug 17, 4:16:37 PM EDT LIVE"
- H1: — · H2s: —
- Nav: 4 visible items · active: ▦Calendar · groups: Sales▾(4), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (14): 22px×1, 16px×1, 15px×1, 14px×2, 13px×8, 12.5px×2, 12px×4, 11.5px×11, 11px×14, 10.5px×4, 10px×9, 9.5px×14, 9px×10, 8.5px×6
- Primary-looking (filled) buttons: 2 — "Client file", "Chat"
- Generic labels: none · targets under 40px: 10
- Off-8px-scale spacing values: 7px×3, 11px×5, 6px×3, 14px×1
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: double-booking alert · empty day · open hour
- Tables: none
- Metric-ish elements: "Booked2 Done0 No-show— Show ra"@16px, "Booked2"@16px, "Done0"@16px, "No-show—"@16px, "Show rate—"@16px, "Left today2"@16px, "16"@11.5px, "17"@11.5px, "18"@11.5px, "19"@11.5px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: div.stat-tiles, div.stat, div.l, div#statNoshow.v, div.stat, div.l · text under 11px: 42 · api fails: 0

## Click sweep
- skipped: --no-clicks
