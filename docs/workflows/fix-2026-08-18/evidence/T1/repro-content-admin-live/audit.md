# UI audit evidence — T1-repro-content-admin as owner@fundhub.ai

Ran 2026-08-19T06:51:56.999Z against https://fundhub.ai. Login ok (role owner). Screen /app/content-admin.html → HTTP 200, final /app/content-admin.html, title "Fundhub — Content".

Shots: docs/workflows/ui-audit-evidence/T1-repro-content-admin/1440-fold.png · docs/workflows/ui-audit-evidence/T1-repro-content-admin/1440-full.png · docs/workflows/ui-audit-evidence/T1-repro-content-admin/390-full.png

## Load
- API calls: 4; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 4021px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "SetupContent 6 tiles on Save changes Search⌘KTEST — Owner Role · owner · 32 tabs"
- H1: Content · H2s: —
- Nav: 4 visible items · active: ▭Content · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(4), Admin▾(0), Portals▾(0)
- Font sizes in use (4): 32px×4, 20px×1, 16px×83, 13px×68
- Primary-looking (filled) buttons: 5 — "Save changes", "Upload", "Save tiles", "$32 Diagnostic", "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 14px×6, 13px×3, 9px×6, 7px×6
- Uneven card rows: top 80: [1164,282,282,282,282]; top 224: [822,328]; top 1624: [822,820]
- ALL-CAPS runs: 1 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: no videos yet | No videos yet. Upload one above and it will stay after you reload.
- Tables: none
- Metric-ish elements: "CN-00 / VIDEOS0in the library "@16px, "CN-00 / VIDEOS0in the library"@16px, "CN-00 / TIERS MAPPED0/7plus a "@16px, "CN-00 / LOCKED TILES6in this e"@16px, "CN-00 / LAST UPLOAD—no videos "@16px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 0 · api fails: 0

## Click sweep
- 0 clicked of 13 candidates (cap 0) · tally: 

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
