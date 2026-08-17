# UI audit evidence — index as owner@fundhub.ai

Ran 2026-08-17T06:23:13.049Z against https://fundhub.ai. Login ok (role owner). Screen /app/index.html → HTTP 200, final /app/command-center.html **BOUNCED**, title "Fundhub — Command Center".

Shots: docs/workflows/ui-audit-evidence/index/1440-fold.png · docs/workflows/ui-audit-evidence/index/1440-full.png · docs/workflows/ui-audit-evidence/index/390-full.png

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
- skipped: --no-clicks
