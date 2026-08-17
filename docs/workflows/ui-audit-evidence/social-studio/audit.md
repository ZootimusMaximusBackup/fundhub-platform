# UI audit evidence — social-studio as owner@fundhub.ai

Ran 2026-08-17T06:21:57.697Z against https://fundhub.ai. Login ok (role owner). Screen /app/social-studio.html → HTTP 200, final /app/social-studio.html, title "Fundhub — Social Studio".

Shots: docs/workflows/ui-audit-evidence/social-studio/1440-fold.png · docs/workflows/ui-audit-evidence/social-studio/1440-full.png · docs/workflows/ui-audit-evidence/social-studio/390-full.png

## Load
- API calls: 5; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 3250px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Social Studio · H2s: —
- Nav: 33 visible items · active: ◉Social StudioBETA · groups: Sales▾(6), Funding▾(4), Client ops▾(5), Watch▾(3), Automation▾(4), Marketing▾(4), Admin▾(5), Portals▾(2)
- Font sizes in use (11): 22px×5, 14.5px×1, 13px×5, 12.5px×18, 12px×21, 11.5px×48, 11px×96, 10.5px×14, 10px×28, 9.5px×28, 9px×4
- Primary-looking (filled) buttons: 5 — "+ Compose", "Run guardrail preview", "Publish due now", "Queue0", "Chat"
- Generic labels: none · targets under 40px: 15
- Off-8px-scale spacing values: 14px×9, 13px×17, 11px×8
- Uneven card rows: top 120: [1164,223,223,223,223,223]; top 912: [778,372]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: none
- Error wording: failed
- Empty-state wording: 0 of 0 posts match | netlify/functions/api.mjs ROUTES · api/campaigns/action-log.mjs · empty SOCIAL_CHANNELS/POSTS in this page | ss · oauth/schedule/publish live · no list API · empty panes
- Tables: none
- Metric-ish elements: "SS-00 / CHANNELS 0 / 80 active"@13px, "SS-00 / CHANNELS 0 / 80 active"@13px, "SS-00 / QUEUED 00 due now · 0 "@13px, "SS-00 / BLOCKED 00 reasons sto"@13px, "SS-00 / FAILED 00 open tasks ·"@13px, "SS-00 / POSTED 0no engagement "@13px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: span.badge, aside#drawer.drawer, div.drawer-hd, div.eyebrow, div#drawerBody.drawer-bd, div.drawer-ft · text under 11px: 102 · api fails: 0

## Click sweep
- 21 clicked of 21 candidates (cap 80) · tally: OK=9, NOOP=3, GONE=5, API-FAIL=2, DIALOG=1, WRITE-INTERCEPTED=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "+ Compose" | 82×51 | NOOP |  | docs/workflows/ui-audit-evidence/social-studio/clicks/02-NOOP-_Compose.png |
| 3 | button "SS-00 / CHANNELS 0 / 80 active · 0 cannot publish" | 223×107 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 4 | button "SS-00 / QUEUED 00 due now · 0 would be skipped" | 223×107 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 5 | button "SS-00 / BLOCKED 00 reasons stored · terminal" | 223×107 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 6 | button "SS-00 / FAILED 00 open tasks · attempt = 3" | 223×107 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 7 | button "SS-00 / POSTED 0no engagement data exists" | 223×107 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 8 | button "Connect Facebook" | 142×37 | API-FAIL | GET /api/social/oauth 404 · console: Failed to load resource: the server responded with a status of 404 () | docs/workflows/ui-audit-evidence/social-studio/clicks/08-API-FAIL-Connect_Facebook.png |
| 9 | button "Connect Instagram" | 144×37 | API-FAIL | GET /api/social/oauth 404 · console: Failed to load resource: the server responded with a status of 404 () | docs/workflows/ui-audit-evidence/social-studio/clicks/09-API-FAIL-Connect_Instagram.png |
| 10 | button "Connect LinkedIn" | 134×37 | DIALOG | dialog: prompt "LinkedIn organization id or URN (required)" |  |
| 11 | button "Run guardrail preview" | 187×35 | NOOP |  | docs/workflows/ui-audit-evidence/social-studio/clicks/11-NOOP-Run_guardrail_preview.png |
| 12 | button "Queue post" | 105×35 | OK |  |  |
| 13 | button "Publish due now" | 142×35 | WRITE-INTERCEPTED | POST /api/social/publish 599 · WRITE POST /api/social/publish {partner_id} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/social-studio/clicks/13-WRITE-INTERCEPTED-Publish_due_now.png |
| 14 | button "Clear" | 67×35 | OK |  |  |
| 15 | button "Queue0" | 90×32 | NOOP |  | docs/workflows/ui-audit-evidence/social-studio/clicks/15-NOOP-Queue0.png |
| 16 | button "Review queue0" | 133×32 | OK |  |  |
| 17 | button "Failed0" | 87×32 | OK |  |  |
| 18 | button "Published0" | 110×32 | OK |  |  |
| 19 | button "Audit trail0" | 108×32 | OK |  |  |
| 20 | button "Search⌘K" | 99×36 | OK |  |  |
| 21 | button "Chat" | 52×52 | OK |  |  |
