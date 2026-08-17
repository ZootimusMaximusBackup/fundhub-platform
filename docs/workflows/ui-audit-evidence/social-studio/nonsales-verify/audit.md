# UI audit evidence — social-studio/nonsales-verify as owner@fundhub.ai

Ran 2026-08-17T19:41:42.835Z against https://fundhub.ai. Login ok (role owner). Screen /app/social-studio.html → HTTP 200, final /app/social-studio.html, title "Fundhub — Social Studio".

Shots: docs/workflows/ui-audit-evidence/social-studio/nonsales-verify/1440-fold.png · docs/workflows/ui-audit-evidence/social-studio/nonsales-verify/1440-full.png · docs/workflows/ui-audit-evidence/social-studio/nonsales-verify/390-full.png

## Load
- API calls: 4; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 2809px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Social Studio · H2s: —
- Nav: 4 visible items · active: ◉Social StudioBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(4), Admin▾(0), Portals▾(0)
- Font sizes in use (7): 28px×5, 18px×1, 14px×49, 13px×1, 12px×1, 11px×102, 10px×1
- Primary-looking (filled) buttons: 2 — "Queue post", "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 14px×8, 13px×8
- Uneven card rows: top 144: [1164,282,282,282,282]; top 1136: [778,372]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: none
- Error wording: failed
- Empty-state wording: Type a caption and pick an offer type. Nothing is screened until both exist — an empty offer_type is itself a block. | ss · oauth/schedule/publish live · no list API · empty panes
- Tables: none
- Metric-ish elements: "SS-00 / CHANNELS —no partner s"@14px, "SS-00 / CHANNELS —no partner s"@14px, "SS-00 / QUEUED —no partner sel"@14px, "SS-00 / BLOCKED —no partner se"@14px, "SS-00 / FAILED —no partner sel"@14px, "SS-00 / POSTED —no partner sel"@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: span.badge, aside#drawer.drawer, div.drawer-hd, div.eyebrow, div#drawerBody.drawer-bd, div.drawer-ft · text under 11px: 1 · api fails: 0

## Click sweep
- skipped: --no-clicks
