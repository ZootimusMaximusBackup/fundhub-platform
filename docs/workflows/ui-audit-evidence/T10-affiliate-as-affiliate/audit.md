# UI audit evidence — T10-affiliate-as-affiliate as affiliate@fundhub.ai

Ran 2026-08-19T10:58:06.968Z against https://fundhub.ai. Login ok (role affiliate). Screen /app/affiliate.html → HTTP 200, final /app/affiliate.html, title "Fundhub — Affiliate".

Shots: docs/workflows/ui-audit-evidence/T10-affiliate-as-affiliate/1440-fold.png · docs/workflows/ui-audit-evidence/T10-affiliate-as-affiliate/1440-full.png · docs/workflows/ui-audit-evidence/T10-affiliate-as-affiliate/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 1702px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: span "My Work"
- H1: Affiliate · H2s: —
- Nav: 1 visible items · active: ⇗Affiliate · groups: Portals▾(1)
- Font sizes in use (5): 32px×4, 20px×1, 16px×28, 13px×33, 11px×1
- Primary-looking (filled) buttons: 2 — "Ask", "Download Message Blaster"
- Generic labels: none · targets under 40px: 1
- Off-8px-scale spacing values: 14px×9, 13px×3
- Uneven card rows: top 360: [789,188,188,188,188]; top 624: [789,787]; top 840: [789,787]
- ALL-CAPS runs: 1 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Referred | Business | Status | First paid product | Basis | Commission | Payout] rows=1; numeric cols align: n/a
- Metric-ish elements: "REFERRED—lifetime leads · come"@16px, "REFERRED—lifetime leads · come"@16px, "CONVERTED—comes from your refe"@16px, "OWED$0.00accrued, not yet paid"@16px, "PAID—lifetime · comes from pas"@16px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table.grid, thead, tr, th, th, th · text under 11px: 0 · api fails: 0

## Click sweep
- 8 clicked of 8 candidates (cap 80) · tally: OK=7, NOOP=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Copy link" | 110×46 | OK |  |  |
| 2 | button "Copy code" | 110×46 | OK |  |  |
| 3 | summary "What you can see" | 759×24 | OK |  |  |
| 4 | button "Ask" | 58×46 | OK |  |  |
| 5 | button "Download Message Blaster" | 236×42 | OK | GET /api/gifts/message-blaster 200 |  |
| 6 | button "Referred leads" | 190×48 | NOOP |  | docs/workflows/ui-audit-evidence/T10-affiliate-as-affiliate/clicks/06-NOOP-Referred_leads.png |
| 7 | button "Payouts" | 108×48 | OK |  |  |
| 8 | button "Terms" | 84×48 | OK |  |  |
