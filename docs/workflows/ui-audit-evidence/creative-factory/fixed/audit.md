# UI audit evidence — creative-factory/fixed as owner@fundhub.ai

Ran 2026-08-17T10:38:26.565Z against https://fundhub.ai. Login ok (role owner). Screen /app/creative-factory.html → HTTP 200, final /app/creative-factory.html, title "Fundhub — Creative Factory".

Shots: docs/workflows/ui-audit-evidence/creative-factory/fixed/1440-fold.png · docs/workflows/ui-audit-evidence/creative-factory/fixed/1440-full.png · docs/workflows/ui-audit-evidence/creative-factory/fixed/390-full.png

## Load
- API calls: 4; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 5563px (fold 900) · content width 2768px (table.grid) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Creative Factory · H2s: —
- Nav: 2 visible items · active: ✳Creative FactoryBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(2), Admin▾(0), Portals▾(0)
- Font sizes in use (6): 18px×1, 14px×164, 13px×1, 12px×1, 11px×321, 10px×1
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 15
- Off-8px-scale spacing values: 13px×10, 20px×3, 14px×9
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | PLACEHOLDER set in 052 — AWAITING SIGN-OFF
- Loading wording after settle: none
- Error wording: failed | Pause and log when an ad reaches $500 spend with zero conversions. Set in 052 — derived, not sourced; tune against your 
- Empty-state wording: empty on purpose — nothing is metered yet
- Tables: [Job | Status | Asset kind | Formats | Variants | Attempt | Assets | Provider | Created | Finished] rows=1; numeric cols align: n/a ‖ [Provider key | ai_generated | synthetic_performer | How the flag is decided] rows=5; numeric cols align: n/a ‖ [Item | State | Subtype | Detail | Reasons | Budget | Offer | Platform | Flags | Updated] rows=1; numeric cols align: n/a ‖ [Code | Rule set | Match | Severity | Applies to | Citation] rows=29; numeric cols align: n/a ‖ [config | detail | rows_set | status | consequence] rows=7; numeric cols align: rows_set=start/tnum ‖ [event_type | period | events | quantity | billable_cents | voided_cents] rows=1; numeric cols align: n/a
- Metric-ish elements: "100"@14px/tnum, "10"@14px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table.grid, thead, tr, th, tbody#flagBody, tr · text under 11px: 4 · api fails: 0

## Click sweep
- 67 clicked of 67 candidates (cap 80) · tally: OK=48, NOOP=9, GONE=10

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "Show request URLs" | 127×51 | OK |  |  |
| 3 | button "all" | 42×27 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/fixed/clicks/03-NOOP-all.png |
| 4 | button "queued" | 65×27 | OK |  |  |
| 5 | button "running" | 72×27 | OK |  |  |
| 6 | button "succeeded" | 87×27 | OK |  |  |
| 7 | button "failed" | 65×27 | OK |  |  |
| 8 | button "all" | 42×27 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/fixed/clicks/08-NOOP-all.png |
| 9 | button "pending" | 72×27 | OK |  |  |
| 10 | button "passed" | 65×27 | OK |  |  |
| 11 | button "blocked" | 72×27 | OK |  |  |
| 12 | button "approved" | 80×27 | OK |  |  |
| 13 | button "any" | 42×27 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/fixed/clicks/13-NOOP-any.png |
| 14 | button "static" | 65×27 | OK |  |  |
| 15 | button "video" | 57×27 | OK |  |  |
| 16 | button "copy" | 50×27 | OK |  |  |
| 17 | button "any" | 42×27 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/fixed/clicks/17-NOOP-any.png |
| 18 | button "1x1" | 42×27 | OK |  |  |
| 19 | button "4x5" | 42×27 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/fixed/clicks/19-NOOP-4x5.png |
| 20 | button "9x16" | 50×27 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/fixed/clicks/20-NOOP-9x16.png |
| 21 | button "16x9" | 50×27 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/fixed/clicks/21-NOOP-16x9.png |
| 22 | button "all" | 42×27 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/fixed/clicks/22-NOOP-all.png |
| 23 | button "blocked" | 72×27 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 24 | button "pending" | 72×27 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 25 | button "awaiting_approval" | 147×27 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 26 | button "all29" | 62×27 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 27 | button "croa6" | 62×27 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 28 | button "claims4" | 77×27 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 29 | button "disclosure2" | 107×27 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 30 | button "platform12" | 100×27 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 31 | button "approval2" | 92×27 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 32 | button "engine3" | 77×27 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 33 | button "all" | 42×27 | NOOP |  | docs/workflows/ui-audit-evidence/creative-factory/fixed/clicks/33-NOOP-all.png |
| 34 | button "draft" | 57×27 | OK |  |  |
| 35 | button "active" | 65×27 | OK |  |  |
| 36 | button "archived" | 80×27 | OK |  |  |
| 37 | button "Search⌘K" | 99×36 | OK |  |  |
| 38 | button "Chat" | 52×52 | OK |  |  |
| 39 | tr "▸guaranteed-score-increaseeditable rulecroaregexblockcredit_" | 1362×65 | OK |  |  |
| 40 | tr "▸promise-to-remove-accurate-infoeditable rulecroaregexblockc" | 1362×65 | OK |  |  |
| 41 | tr "▸remove-late-payments-collectionseditable rulecroaregexblock" | 1362×65 | OK |  |  |
| 42 | tr "▸advance-feeeditable rulecroaregexblockcredit_repairCROA 15 " | 1362×65 | OK |  |  |
| 43 | tr "▸file-segregation-cpneditable rulecroaregexblockcredit_repai" | 1362×65 | OK |  |  |
| 44 | tr "▸guaranteed-timelineeditable rulecroaregexblockcredit_repair" | 1362×65 | OK |  |  |
| 45 | tr "▸guaranteed-approvaleditable ruleclaimsregexblockall offersF" | 1362×65 | OK |  |  |
| 46 | tr "▸guaranteed-funding-amounteditable ruleclaimsregexblockall o" | 1362×65 | OK |  |  |
| 47 | tr "▸fabricated-testimonialeditable ruleclaimsregexblockall offe" | 1362×65 | OK |  |  |
| 48 | tr "▸income-wealth-targeting-cueeditable ruleclaimsregexblockall" | 1362×65 | OK |  |  |
| 49 | tr "▸croa-consumer-rightseditable ruledisclosurerequiredblockcre" | 1362×65 | OK |  |  |
| 50 | tr "▸tiktok-credit-repair-prohibitededitable ruleplatformregexbl" | 1362×65 | OK |  |  |
| 51 | tr "▸screen_errorbuilt in · not editableengine——counts as a hard" | 1362×65 | OK |  |  |
| 52 | tr "▸offer_type_missingbuilt in · not editableengine——counts as " | 1362×65 | OK |  |  |
| 53 | tr "▸platform_unknownbuilt in · not editableengine——counts as a " | 1362×65 | OK |  |  |
| 54 | tr "▸tiktok_credit_repair_prohibitedbuilt in · not editableplatf" | 1362×65 | OK |  |  |
| 55 | tr "▸special_ad_category_unsetbuilt in · not editableplatform——c" | 1362×65 | OK |  |  |
| 56 | tr "▸synthetic_without_ai_flagbuilt in · not editabledisclosure—" | 1362×65 | OK |  |  |
| 57 | tr "▸human_approval_required_credit_repairbuilt in · not editabl" | 1362×65 | OK |  |  |
| 58 | tr "▸human_approval_required_settingbuilt in · not editableappro" | 1362×65 | OK |  |  |
| 59 | tr "▸targeting_missingplatform term · not editableplatform——coun" | 1362×65 | OK |  |  |
| 60 | tr "▸targeting_malformedplatform term · not editableplatform——co" | 1362×65 | OK |  |  |
| 61 | tr "▸zip_targetingplatform term · not editableplatform——counts a" | 1362×65 | OK |  |  |
| 62 | tr "▸radius_too_smallplatform term · not editableplatform——count" | 1362×65 | OK |  |  |
| 63 | tr "▸location_exclusionplatform term · not editableplatform——cou" | 1362×65 | OK |  |  |
| 64 | tr "▸age_rangeplatform term · not editableplatform——counts as a " | 1362×65 | OK |  |  |
| 65 | tr "▸gender_restrictionplatform term · not editableplatform——cou" | 1362×65 | OK |  |  |
| 66 | tr "▸lookalike_audienceplatform term · not editableplatform——cou" | 1362×65 | OK |  |  |
| 67 | tr "▸detailed_targeting_expansionplatform term · not editablepla" | 1362×64 | OK |  |  |
