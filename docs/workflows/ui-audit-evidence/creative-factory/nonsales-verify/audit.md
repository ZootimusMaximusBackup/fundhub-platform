# UI audit evidence — creative-factory/nonsales-verify as owner@fundhub.ai

Ran 2026-08-17T19:42:04.860Z against https://fundhub.ai. Login ok (role owner). Screen /app/creative-factory.html → HTTP 200, final /app/creative-factory.html, title "Fundhub — Creative Factory".

Shots: docs/workflows/ui-audit-evidence/creative-factory/nonsales-verify/1440-fold.png · docs/workflows/ui-audit-evidence/creative-factory/nonsales-verify/1440-full.png · docs/workflows/ui-audit-evidence/creative-factory/nonsales-verify/390-full.png

## Load
- API calls: 4; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 6019px (fold 900) · content width 1655px (table.grid) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Creative Factory · H2s: —
- Nav: 4 visible items · active: ✳Creative FactoryBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(4), Admin▾(0), Portals▾(0)
- Font sizes in use (6): 18px×1, 14px×143, 13px×1, 12px×1, 11px×347, 10px×1
- Primary-looking (filled) buttons: 2 — "Enqueue generation", "Chat"
- Generic labels: none · targets under 40px: 1
- Off-8px-scale spacing values: 13px×11, 20px×3, 14px×10
- Uneven card rows: top 400: [1232,1230]; top 1816: [1232,1230]; top 2136: [1232,1230]; top 4136: [1232,1230]
- ALL-CAPS runs: 1 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | Placeholder — not signed off
- Loading wording after settle: none
- Error wording: failed | Pause when an ad spends $500 with zero conversions.
- Empty-state wording: empty on purpose — nothing is metered yet
- Tables: [Job | Status | Asset kind | Formats | Variants | Attempt | Assets | Provider | Created | Finished] rows=1; numeric cols align: n/a ‖ [Provider | AI-generated | Synthetic performer | How it is decided] rows=5; numeric cols align: n/a ‖ [Item | State | Subtype | Detail | Reasons | Budget | Offer | Platform | Flags | Updated] rows=1; numeric cols align: n/a ‖ [Code | Rule set | Match | Severity | Applies to | Citation] rows=29; numeric cols align: n/a ‖ [Setting | Detail | Rows set | Status | What happens] rows=7; numeric cols align: Rows set=start/tnum ‖ [Event | Period | Events | Quantity | Billable | Voided] rows=1; numeric cols align: n/a
- Metric-ish elements: "3"@14px/tnum, "0"@14px/tnum, "0"@14px/tnum, "0"@14px/tnum, "0"@14px/tnum, "0"@14px/tnum, "0"@14px/tnum, "100"@14px/tnum, "10"@14px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table.grid, thead, tr, th, tbody#flagBody, tr · text under 11px: 4 · api fails: 0

## Click sweep
- skipped: --no-clicks
