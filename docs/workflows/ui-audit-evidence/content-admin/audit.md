# UI audit evidence — content-admin as owner@fundhub.ai

Ran 2026-08-17T06:27:09.610Z against https://fundhub.ai. Login ok (role owner). Screen /app/content-admin.html → HTTP 200, final /app/content-admin.html, title "Fundhub — Content".

Shots: docs/workflows/ui-audit-evidence/content-admin/1440-fold.png · docs/workflows/ui-audit-evidence/content-admin/1440-full.png · docs/workflows/ui-audit-evidence/content-admin/390-full.png

## Load
- API calls: 4; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 2547px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Content · H2s: —
- Nav: 33 visible items · active: ▶ContentBETA · groups: Sales▾(6), Funding▾(4), Client ops▾(5), Watch▾(3), Automation▾(4), Marketing▾(4), Admin▾(5), Portals▾(2)
- Font sizes in use (14): 22px×4, 16px×1, 14.5px×1, 13px×11, 12.5px×9, 12px×13, 11.5px×18, 11px×14, 10.5px×2, 10px×21, 9.5px×13, 9px×7, 8px×2, 7.5px×1
- Primary-looking (filled) buttons: 4 — "+ Upload video (not available yet)", "Upload (not available yet)", "Card Stacking DFY", "Chat"
- Generic labels: none · targets under 40px: 11
- Off-8px-scale spacing values: 14px×6, 13px×3
- Uneven card rows: top 224: [1164,282,282,282,282]; top 344: [822,328]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: no videos yet
- Tables: none
- Metric-ish elements: "CN-00 / VIDEOS0in the library "@13px, "CN-00 / VIDEOS0in the library"@13px, "CN-00 / TIERS MAPPED0/4plus a "@13px, "CN-00 / LOCKED TILES0in this e"@13px, "CN-00 / LAST UPLOAD—no videos "@13px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 74 · api fails: 0

## Click sweep
- 8 clicked of 8 candidates (cap 80) · tally: OK=7, NOOP=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "Card Stacking DFY" | 122×24 | NOOP |  | docs/workflows/ui-audit-evidence/content-admin/clicks/02-NOOP-Card_Stacking_DFY.png |
| 3 | button "Consulting Services Package" | 183×24 | OK |  |  |
| 4 | button "Credit Repair Bundle" | 140×24 | OK |  |  |
| 5 | button "Inquiry Removal" | 110×24 | OK |  |  |
| 6 | button "Default" | 61×24 | OK |  |  |
| 7 | button "Search⌘K" | 99×36 | OK |  |  |
| 8 | button "Chat" | 52×52 | OK |  |  |
