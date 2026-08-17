# UI audit evidence — sales-floor as sales@fundhub.ai

Ran 2026-08-17T15:51:51.111Z against https://fundhub.ai. Login ok (role sales_manager). Screen /app/sales-floor.html → HTTP 200, final /app/sales-floor.html, title "Sales floor · Fundhub".

Shots: docs/workflows/ui-audit-evidence/sales-floor/1440-fold.png · docs/workflows/ui-audit-evidence/sales-floor/1440-full.png · docs/workflows/ui-audit-evidence/sales-floor/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 1639px (fold 900) · content width 1440px (div.app-shell) · sidebar 228px
- Top-left element: header "M-01 / Sales floor 0 closers on shift TEST — Sales Manager Role"
- H1: — · H2s: —
- Nav: 4 visible items · active: ▣Sales floor · groups: Sales▾(4), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (10): 44px×2, 25px×5, 13px×24, 12.5px×11, 12px×2, 11.5px×24, 11px×5, 10px×1, 9.5px×25, 9px×3
- Primary-looking (filled) buttons: 2 — "Flag to marketing", "Chat"
- Generic labels: none · targets under 40px: 5
- Off-8px-scale spacing values: 17px×6, 18px×6
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: Which belief failed
- Empty-state wording: 0 of 0 deposits funded | Live objection counts load here. Empty means none logged this month.
- Tables: none
- Metric-ish elements: "$5"@44px/tnum, "—"@44px/tnum, "5"@13px/tnum, "0%"@13px/tnum, "—"@13px/tnum, "$5"@13px/tnum, "5"@13px/tnum, "0%"@13px/tnum, "0"@13px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 26 · api fails: 0

## Click sweep
- 5 clicked of 5 candidates (cap 80) · tally: WRITE-INTERCEPTED=2, NOOP=1, OK=2

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Flag to marketing" | 131×31 | WRITE-INTERCEPTED | POST /api/marketing-flags 599 · WRITE POST /api/marketing-flags {belief,lead_source,setter_label,outcome_count,period_start,period_end,note} · dialog: alert "UI audit harness refused to send this write" · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/sales-floor/clicks/01-WRITE-INTERCEPTED-Flag_to_marketing.png |
| 2 | button "Today's recordings" | 141×31 | NOOP |  | docs/workflows/ui-audit-evidence/sales-floor/clicks/02-NOOP-Today_s_recordings.png |
| 3 | button "Refresh from Drive" | 139×31 | WRITE-INTERCEPTED | POST /api/company-brain/sync 599; GET /api/read/sales-floor 200; GET /api/auth/session 200 · WRITE POST /api/company-brain/sync {} · dialog: alert "UI audit harness refused to send this write" · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/sales-floor/clicks/03-WRITE-INTERCEPTED-Refresh_from_Drive.png |
| 4 | button "Search⌘K" | 99×36 | OK |  |  |
| 5 | button "Chat" | 52×52 | OK |  |  |
