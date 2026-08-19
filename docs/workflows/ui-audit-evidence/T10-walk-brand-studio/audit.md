# UI audit evidence — T10-walk-brand-studio as partner@fundhub.ai

Ran 2026-08-19T06:58:35.896Z against https://fundhub.ai. Login ok (role partner). Screen /app/brand-studio.html?partner_id=9defaf28-47c5-43a0-8f5e-f41ef90f360a → HTTP 200, final /app/brand-studio.html?partner_id=9defaf28-47c5-43a0-8f5e-f41ef90f360a, title "Fundhub — Brand Studio".

Shots: docs/workflows/ui-audit-evidence/T10-walk-brand-studio/1440-fold.png · docs/workflows/ui-audit-evidence/T10-walk-brand-studio/1440-full.png · docs/workflows/ui-audit-evidence/T10-walk-brand-studio/390-full.png

## Load
- API calls: 6; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: pageerror: FHData is not defined

## DOM read (1440×900)
- Page height 3393px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "SetupBrand Studio Draft Reset TEST — White-Label Partner Role · partner · 4 tabs"
- H1: Brand Studio · H2s: —
- Nav: 1 visible items · active: ◆Brand Studio · groups: Home▾(0), Marketing▾(0), Admin▾(1)
- Font sizes in use (4): 32px×6, 20px×1, 16px×46, 13px×79
- Primary-looking (filled) buttons: 3 — "Create pages from selected funnels", "Write page copy", "Save & apply"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 14px×11, 13px×7, 6px×3, 10px×1, 9px×4
- Uneven card rows: top 80: [1164,282,282,282,282]; top 224: [1164,728,420]; top 624: [348,170,170]; top 2464: [698,166,166]
- ALL-CAPS runs: 1 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "BS-00 / BRAND—wordmark + token"@16px, "BS-00 / BRAND—wordmark + token"@16px, "BS-00 / DOMAIN—not connected"@16px, "BS-00 / FUNNELS SELECTED1ticke"@16px, "BS-00 / COMPLIANCELockedmaster"@16px, "8 values, everything renders f"@13px, "Writing left248542this month, "@16px, "Writing left248542this month, "@16px, "Pages live0published on our si"@16px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 0 · api fails: 0

## Click sweep
- 18 clicked of 18 candidates (cap 40) · tally: DIALOG=1, NOOP=1, WRITE-INTERCEPTED=9, OK=2, GONE=5

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Reset" | 74×40 | DIALOG | dialog: confirm "Discard unsaved brand changes in this browser?

Your saved brand is not changed — this only clears edits that were never written to the server." |  |
| 2 | button "Presets" | 92×40 | NOOP |  | docs/workflows/ui-audit-evidence/T10-walk-brand-studio/clicks/02-NOOP-Presets.png |
| 3 | button "Create pages from selected funnels" | 331×40 | WRITE-INTERCEPTED | POST /api/partner-pages 599; GET /api/partner-pages 200 · WRITE POST /api/partner-pages {partner_id,funnel_key} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/T10-walk-brand-studio/clicks/03-WRITE-INTERCEPTED-Create_pages_from_selected_fun.png |
| 4 | button "Publish" | 92×40 | WRITE-INTERCEPTED | PATCH /api/partner-pages 599; GET /api/partner-marketing/copy-history 200; GET /api/partner-pages 200 · WRITE PATCH /api/partner-pages {id,status} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/T10-walk-brand-studio/clicks/04-WRITE-INTERCEPTED-Publish.png |
| 5 | button "Write page copy" | 155×42 | WRITE-INTERCEPTED | POST /api/partner-marketing/generate-copy 599; GET /api/partner-marketing/copy-history 200 · WRITE POST /api/partner-marketing/generate-copy {page_id,section_id} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/T10-walk-brand-studio/clicks/05-WRITE-INTERCEPTED-Write_page_copy.png |
| 6 | button "Make a wordmark from the name" | 282×42 | WRITE-INTERCEPTED | POST /api/partner-marketing/generate-logo 599; GET /api/partner-marketing/usage 200 · WRITE POST /api/partner-marketing/generate-logo {partner_id,name} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/T10-walk-brand-studio/clicks/06-WRITE-INTERCEPTED-Make_a_wordmark_from_the_name.png |
| 7 | button "Use this version" | 171×40 | WRITE-INTERCEPTED | POST /api/partner-marketing/copy-history 599; GET /api/partner-marketing/copy-history 200 · WRITE POST /api/partner-marketing/copy-history {page_id,version_id} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/T10-walk-brand-studio/clicks/07-WRITE-INTERCEPTED-Use_this_version.png |
| 8 | button "Use this version" | 171×40 | WRITE-INTERCEPTED | POST /api/partner-marketing/copy-history 599; GET /api/partner-pages 200; GET /api/partner-marketing/usage 200; GET /api/partner-pages 200 · WRITE POST /api/partner-marketing/copy-history {page_id,version_id} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/T10-walk-brand-studio/clicks/08-WRITE-INTERCEPTED-Use_this_version.png |
| 9 | button "Use this version" | 171×40 | WRITE-INTERCEPTED | POST /api/partner-marketing/copy-history 599; GET /api/partner-marketing/usage 200; GET /api/partner-marketing/copy-history 200; GET /api/partner-marketing/copy-history 200; GET /api/partner-pages 200; GET /api/partner-marketing/usage 200 · WRITE POST /api/partner-marketing/copy-history {page_id,version_id} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/T10-walk-brand-studio/clicks/09-WRITE-INTERCEPTED-Use_this_version.png |
| 10 | button "Use this version" | 171×40 | WRITE-INTERCEPTED | POST /api/partner-marketing/copy-history 599; GET /api/partner-pages 200; GET /api/partner-marketing/copy-history 200; GET /api/partner-marketing/usage 200 · WRITE POST /api/partner-marketing/copy-history {page_id,version_id} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/T10-walk-brand-studio/clicks/10-WRITE-INTERCEPTED-Use_this_version.png |
| 11 | button "Use this version" | 171×40 | WRITE-INTERCEPTED | POST /api/partner-marketing/copy-history 599; GET /api/partner-marketing/copy-history 200; GET /api/partner-pages 200; GET /api/partner-marketing/usage 200; GET /api/partner-marketing/copy-history 200 · WRITE POST /api/partner-marketing/copy-history {page_id,version_id} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/T10-walk-brand-studio/clicks/11-WRITE-INTERCEPTED-Use_this_version.png |
| 12 | button "Save & apply" | 129×42 | OK |  |  |
| 13 | button "Submit for approval" | 198×40 | OK |  |  |
| 14 | div "✓Application funnelHero, process, engine, options, apply for" | 226×128 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 15 | div "Diagnostic funnelStraight to the assessment offer. Lowest fr" | 226×128 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 16 | div "Education funnelTwo-program structure with curriculum and en" | 226×128 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 17 | div "Affiliate recruitTwo-track partner page. Recruits under your" | 226×128 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 18 | div "Booking funnelStraight to calendar. For warm and referral tr" | 226×128 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
