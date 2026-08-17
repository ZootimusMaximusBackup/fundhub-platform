# UI audit evidence — content-admin-mlfix as owner@fundhub.ai

Ran 2026-08-17T19:42:51.950Z against https://fundhub.ai. Login ok (role owner). Screen /app/content-admin.html → HTTP 200, final /app/content-admin.html, title "Fundhub — Content".

Shots: docs/workflows/ui-audit-evidence/content-admin-mlfix/1440-fold.png · docs/workflows/ui-audit-evidence/content-admin-mlfix/1440-full.png · docs/workflows/ui-audit-evidence/content-admin-mlfix/390-full.png

## Load
- API calls: 4; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 2492px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Content · H2s: —
- Nav: 4 visible items · active: ▶ContentBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(4), Admin▾(0), Portals▾(0)
- Font sizes in use (7): 28px×4, 18px×1, 14px×25, 13px×1, 12px×1, 11px×71, 10px×1
- Primary-looking (filled) buttons: 2 — "Card Stacking DFY", "Chat"
- Generic labels: none · targets under 40px: 8
- Off-8px-scale spacing values: 14px×6, 13px×3
- Uneven card rows: top 200: [1164,282,282,282,282]; top 328: [822,328]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: no videos yet | No videos yet. There is no way to add one from this screen — the video library has not been built. When it is, your vide
- Tables: none
- Metric-ish elements: "CN-00 / VIDEOS0in the library "@14px, "CN-00 / VIDEOS0in the library"@14px, "CN-00 / TIERS MAPPED0/4plus a "@14px, "CN-00 / LOCKED TILES0in this e"@14px, "CN-00 / LAST UPLOAD—no videos "@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 4 · api fails: 0

## Click sweep
- skipped: --no-clicks
