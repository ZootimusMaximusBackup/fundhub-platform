# UI audit evidence — lenders/fixed as advisor@fundhub.ai

Ran 2026-08-17T10:24:46.622Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/lenders.html → HTTP 200, final /app/lenders.html, title "Fundhub · Lenders".

Shots: docs/workflows/ui-audit-evidence/lenders/fixed/1440-fold.png · docs/workflows/ui-audit-evidence/lenders/fixed/1440-full.png · docs/workflows/ui-audit-evidence/lenders/fixed/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "Fundhub/Lenders Mon, Aug 17, 6:24:53 AM EDT"
- H1: — · H2s: —
- Nav: 3 visible items · active: ⬡Lenders · groups: Sales▾(0), Funding▾(3), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (6): 18px×1, 14px×9, 13px×1, 12px×1, 11px×23, 10px×1
- Primary-looking (filled) buttons: 2 — "Add blank row", "Chat"
- Generic labels: none · targets under 40px: 9
- Off-8px-scale spacing values: 14px×1, 10px×3
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: The lender list starts empty on purpose. Export the seven Airtable product tables, then Import CSV here. Do not invent l | Empty — import from Airtable | No lenders yet. Import a CSV from Airtable.
- Tables: [Name | Table | Bureaus | Requirements | Tier | Status | State | Updated | Apply | ] rows=0; numeric cols align: n/a
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 4 · api fails: 0

## Click sweep
- 9 clicked of 9 candidates (cap 80) · tally: NOOP=1, OK=4, GONE=4

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Lender list" | 115×36 | NOOP |  | docs/workflows/ui-audit-evidence/lenders/fixed/clicks/01-NOOP-Lender_list.png |
| 2 | button "Bureau mismatch queue" | 194×36 | OK | GET /api/read/lender-observations 200 |  |
| 3 | button "AI bureau config" | 155×36 | OK | GET /api/read/ai-bureau-config 200 |  |
| 4 | button "Apply filters" | 111×35 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 5 | button "Export CSV" | 107×35 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 6 | button "Import CSV" | 107×35 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 7 | button "Add blank row" | 126×35 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 8 | button "Search⌘K" | 99×36 | OK |  |  |
| 9 | button "Chat" | 52×52 | OK |  |  |
