# UI audit evidence — creative-factory as owner@fundhub.ai

Ran 2026-08-17T06:23:49.162Z against https://fundhub.ai. Login ok (role owner). Screen /app/creative-factory.html → HTTP 200, final /app/creative-factory.html, title "Fundhub — Creative Factory".

Shots: docs/workflows/ui-audit-evidence/creative-factory/1440-fold.png · docs/workflows/ui-audit-evidence/creative-factory/1440-full.png · docs/workflows/ui-audit-evidence/creative-factory/390-full.png

## Load
- API calls: 8; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 8777px (fold 900) · content width 2618px (table.grid) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Creative Factory · H2s: —
- Nav: 33 visible items · active: ✳Creative FactoryBETA · groups: Sales▾(6), Funding▾(4), Client ops▾(5), Watch▾(3), Automation▾(4), Marketing▾(4), Admin▾(5), Portals▾(2)
- Font sizes in use (12): 24px×5, 22px×5, 14.5px×1, 13px×2, 12.5px×153, 12px×15, 11.5px×134, 11px×259, 10.5px×48, 10px×88, 9.5px×128, 9px×106
- Primary-looking (filled) buttons: 9 — "all0", "all0", "any0", "any0", "all0", "all29", "all0", "Enqueue generation", "Chat"
- Generic labels: none · targets under 40px: 15
- Off-8px-scale spacing values: 14px×18, 13px×12, 20px×3
- Uneven card rows: top 120: [1164,223,223,223,223,223]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | PLACEHOLDER set in 052 — AWAITING SIGN-OFF
- Loading wording after settle: none
- Error wording: retrying after a retryable failure. error preserved, started_at set, finished_at NULL. up to 3 claims. | at least one asset stored, error cleared to NULL. never zero assets. | failed | src/creative/generate.mjs:31-32 (constants) · :102 (claim increments attempt) · :136-149 (in-process backoff) · :151-157 | queued | running | succeeded | failed | all — comma-separated multi-value supported ('succeeded,failed') | Pause and log when an ad reaches $500 spend with zero conversions. Set in 052 — derived, not sourced; tune against your  | error is returned on purpose — scrub() strips anything key-shaped before it is stored. cost_cents is not.
- Empty-state wording: empty on any real database — and that is correct
- Tables: [Job | Status | Asset kind | Formats | Variants | Attempt | Assets | Provider | Created | Finished] rows=1; numeric cols align: n/a ‖ [Provider key | ai_generated | synthetic_performer | How the flag is decided] rows=5; numeric cols align: n/a ‖ [Item | State | Subtype | Detail | Reasons | Budget | Offer | Platform | Flags | Updated] rows=1; numeric cols align: n/a ‖ [Code | Rule set | Match | Severity | Applies to | Citation] rows=29; numeric cols align: n/a ‖ [Endpoint | ?state= | Other params | Bad value behaviour] rows=4; numeric cols align: n/a ‖ [config | detail | rows_set | status | consequence] rows=7; numeric cols align: rows_set=start/tnum
- Metric-ish elements: "CF-00 / JOBS IN FLIGHT00 runni"@13px, "CF-00 / JOBS IN FLIGHT00 runni"@13px, "CF-00 / FAILED JOBS0all carry "@13px, "CF-00 / AWAITING REVIEW30 bloc"@13px, "CF-00 / LIBRARY ASSETS0non-arc"@13px, "CF-00 / ACTIVE BRAND KITS0of 0"@13px, "100"@12.5px/tnum, "10"@12.5px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: code, code, code, code, code, table#jobTable.grid · text under 11px: 372 · api fails: 0

## Click sweep
- 80 clicked of 83 candidates (cap 80) · tally: OK=43, NOOP=14, GONE=21, WRITE-INTERCEPTED=1, NAV=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "Show request URLs" | 138×51 | OK |  |  |
| 3 | button "CF-00 / JOBS IN FLIGHT00 running · 0 queued" | 223×124 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/clicks/03-NOOP-CF_00_JOBS_IN_FLIGHT00_running.png |
| 4 | button "CF-00 / FAILED JOBS0all carry a reason" | 223×124 | OK |  |  |
| 5 | button "CF-00 / AWAITING REVIEW30 blocked · 3 campaigns" | 223×124 | OK |  |  |
| 6 | button "CF-00 / LIBRARY ASSETS0non-archived · one limit-200 read" | 223×124 | OK |  |  |
| 7 | button "CF-00 / ACTIVE BRAND KITS0of 0 total" | 223×124 | OK |  |  |
| 8 | button "all0" | 50×24 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/clicks/08-NOOP-all0.png |
| 9 | button "queued0" | 68×24 | OK |  |  |
| 10 | button "running0" | 74×24 | OK |  |  |
| 11 | button "succeeded0" | 86×24 | OK |  |  |
| 12 | button "failed0" | 68×24 | OK |  |  |
| 13 | button "0queued · attempt 0never started. provider NULL, started_at " | 216×135 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/clicks/13-NOOP-0queued_attempt_0never_started.png |
| 14 | button "0queued · attempt > 0retrying after a retryable failure. err" | 216×135 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/clicks/14-NOOP-0queued_attempt_0retrying_afte.png |
| 15 | button "0runningclaimed, provider call in flight. attempt was increm" | 216×135 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/clicks/15-NOOP-0runningclaimed_provider_call_.png |
| 16 | button "0succeededat least one asset stored, error cleared to NULL. " | 216×135 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/clicks/16-NOOP-0succeededat_least_one_asset_s.png |
| 17 | button "0failedpermanent, finished_at stamped, and always with a rea" | 216×135 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/clicks/17-NOOP-0failedpermanent_finished_at_s.png |
| 18 | button "all0" | 50×24 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/clicks/18-NOOP-all0.png |
| 19 | button "pending0" | 74×24 | OK |  |  |
| 20 | button "passed0" | 68×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 21 | button "blocked0" | 74×24 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/clicks/21-NOOP-blocked0.png |
| 22 | button "approved0" | 80×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 23 | button "any0" | 50×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 24 | button "static0" | 68×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 25 | button "video0" | 62×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 26 | button "copy0" | 56×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 27 | button "any0" | 50×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 28 | button "1x10" | 50×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 29 | button "4x50" | 50×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 30 | button "9x160" | 56×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 31 | button "16x90" | 56×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 32 | button "all0" | 50×24 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/clicks/32-NOOP-all0.png |
| 33 | button "blocked0" | 74×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 34 | button "pending0" | 74×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 35 | button "awaiting_approval0" | 135×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 36 | button "all29" | 56×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 37 | button "croa6" | 56×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 38 | button "claims4" | 68×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 39 | button "disclosure2" | 92×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 40 | button "platform12" | 86×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 41 | button "approval2" | 80×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 42 | button "engine3" | 68×24 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 43 | button "all0" | 50×24 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/clicks/43-NOOP-all0.png |
| 44 | button "draft0" | 62×24 | OK |  |  |
| 45 | button "active0" | 68×24 | OK |  |  |
| 46 | button "archived0" | 80×24 | OK |  |  |
| 47 | button "Enqueue generation" | 165×35 | OK |  |  |
| 48 | button "Run queued jobs now" | 172×35 | WRITE-INTERCEPTED | POST /api/creative/run 599 · WRITE POST /api/creative/run {partner_id,max_jobs} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/creative-factory/clicks/48-WRITE-INTERCEPTED-Run_queued_jobs_now.png |
| 49 | button "Approve" | 82×35 | OK |  |  |
| 50 | button "Reject" | 75×35 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/clicks/50-NOOP-Reject.png |
| 51 | button "Archive" | 82×35 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/clicks/51-NOOP-Archive.png |
| 52 | a "Campaigns" | 61×14 | NAV | → /app/campaign-manager.html · GET /api/auth/session 200; GET /api/campaigns/list 400; GET /api/campaigns/fatigue 400; GET /api/campaigns/action-log 400; GET /api/health 200; GET /api/campaigns/spend 400; GET /api/org-brand 200; GET /api/campaigns/connections 400; GET /api/demo/mode 200 · console: Failed to load resource: the server responded with a status of 400 () / Failed to load resource: the server responded with a status of 400 () / Failed to load resource: the server responded with a status of 400 () / Failed to load resource: the server responded with a status of 400 () |  |
| 53 | button "Search⌘K" | 99×36 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/clicks/53-NOOP-Search_K.png |
| 54 | button "Chat" | 52×52 | OK |  |  |
| 55 | tr "▸guaranteed-score-increasecompliance_rules rowcroaregexblock" | 1349×63 | OK |  |  |
| 56 | tr "▸promise-to-remove-accurate-infocompliance_rules rowcroarege" | 1349×63 | OK |  |  |
| 57 | tr "▸remove-late-payments-collectionscompliance_rules rowcroareg" | 1349×63 | OK |  |  |
| 58 | tr "▸advance-feecompliance_rules rowcroaregexblockcompliance_rul" | 1349×63 | OK |  |  |
| 59 | tr "▸file-segregation-cpncompliance_rules rowcroaregexblockcompl" | 1349×63 | OK |  |  |
| 60 | tr "▸guaranteed-timelinecompliance_rules rowcroaregexblockcompli" | 1349×63 | OK |  |  |
| 61 | tr "▸guaranteed-approvalcompliance_rules rowclaimsregexblockcomp" | 1349×63 | OK |  |  |
| 62 | tr "▸guaranteed-funding-amountcompliance_rules rowclaimsregexblo" | 1349×63 | OK |  |  |
| 63 | tr "▸fabricated-testimonialcompliance_rules rowclaimsregexblockc" | 1349×63 | OK |  |  |
| 64 | tr "▸income-wealth-targeting-cuecompliance_rules rowclaimsregexb" | 1349×63 | OK |  |  |
| 65 | tr "▸croa-consumer-rightscompliance_rules rowdisclosurerequiredb" | 1349×63 | OK |  |  |
| 66 | tr "▸tiktok-credit-repair-prohibitedcompliance_rules rowplatform" | 1349×63 | OK |  |  |
| 67 | tr "▸screen_errorscreen.mjs · in no tableengine—nullno severity " | 1349×59 | OK |  |  |
| 68 | tr "▸offer_type_missingscreen.mjs · in no tableengine—nullno sev" | 1349×59 | OK |  |  |
| 69 | tr "▸platform_unknownscreen.mjs · in no tableengine—nullno sever" | 1349×59 | OK |  |  |
| 70 | tr "▸tiktok_credit_repair_prohibitedscreen.mjs · in no tableplat" | 1349×59 | OK |  |  |
| 71 | tr "▸special_ad_category_unsetscreen.mjs · in no tableplatform—n" | 1349×59 | OK |  |  |
| 72 | tr "▸synthetic_without_ai_flagscreen.mjs · in no tabledisclosure" | 1349×59 | OK |  |  |
| 73 | tr "▸human_approval_required_credit_repairscreen.mjs · in no tab" | 1349×59 | OK |  |  |
| 74 | tr "▸human_approval_required_settingscreen.mjs · in no tableappr" | 1349×59 | OK |  |  |
| 75 | tr "▸targeting_missingtargeting.mjs · in no tableplatform—nullno" | 1349×59 | OK |  |  |
| 76 | tr "▸targeting_malformedtargeting.mjs · in no tableplatform—null" | 1349×59 | OK |  |  |
| 77 | tr "▸zip_targetingtargeting.mjs · in no tableplatform—nullno sev" | 1349×59 | OK |  |  |
| 78 | tr "▸radius_too_smalltargeting.mjs · in no tableplatform—nullno " | 1349×59 | OK |  |  |
| 79 | tr "▸location_exclusiontargeting.mjs · in no tableplatform—nulln" | 1349×59 | OK |  |  |
| 80 | tr "▸age_rangetargeting.mjs · in no tableplatform—nullno severit" | 1349×59 | OK |  |  |
