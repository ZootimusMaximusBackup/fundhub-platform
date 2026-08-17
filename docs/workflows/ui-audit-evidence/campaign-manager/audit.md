# UI audit evidence — campaign-manager as owner@fundhub.ai

Ran 2026-08-17T06:18:39.422Z against https://fundhub.ai. Login ok (role owner). Screen /app/campaign-manager.html → HTTP 200, final /app/campaign-manager.html, title "Fundhub — Campaigns".

Shots: docs/workflows/ui-audit-evidence/campaign-manager/1440-fold.png · docs/workflows/ui-audit-evidence/campaign-manager/1440-full.png · docs/workflows/ui-audit-evidence/campaign-manager/390-full.png

## Load
- API calls: 9; failing: GET /api/campaigns/list?state=all&limit=200 → 400; GET /api/campaigns/spend?state=all → 400; GET /api/campaigns/connections?state=all → 400; GET /api/campaigns/fatigue?state=all&days=7 → 400; GET /api/campaigns/action-log?state=all&limit=200 → 400
- Console errors: Failed to load resource: the server responded with a status of 400 () | Failed to load resource: the server responded with a status of 400 () | Failed to load resource: the server responded with a status of 400 () | Failed to load resource: the server responded with a status of 400 () | Failed to load resource: the server responded with a status of 400 ()

## DOM read (1440×900)
- Page height 6636px (fold 900) · content width 2431px (table.grid) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Campaigns · H2s: —
- Nav: 33 visible items · active: ◇CampaignsBETA · groups: Sales▾(6), Funding▾(4), Client ops▾(5), Watch▾(3), Automation▾(4), Marketing▾(4), Admin▾(5), Portals▾(2)
- Font sizes in use (13): 24px×4, 22px×5, 15px×1, 14.5px×1, 13px×2, 12.5px×274, 12px×5, 11.5px×91, 11px×188, 10.5px×36, 10px×55, 9.5px×129, 9px×82
- Primary-looking (filled) buttons: 7 — "all7", "Sync Meta now", "all11", "all11", "all4", "all16", "Chat"
- Generic labels: none · targets under 40px: 15
- Off-8px-scale spacing values: 14px×12, 13px×7, 18px×3, 11px×3
- Uneven card rows: top 120: [1164,223,223,223,223,223]; top 2056: [1164,1162]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | sample
- Loading wording after settle: last_error · Error validating access token: Session has expired on Saturday, 25-Jul-2… | ad dba77a58… | ad ffa4a51d… | ad 794152fa… | ad 16930515… | ad c04f9a28… | ad e4ad8953… | ad c180e04a… | ad 2ba87e4f… | ad 2cf93b54… | ad 812d5104… | ad 953fef0d…
- Error wording: badrequest | request rejected (staff sessions must name a partner_id; partner sessions are scoped to their own) | Actions failed or never executed | action-log?state=failed · execute_error IS NOT NULL OR executed_at IS NULL | 1,500.00 | last_error · Error validating access token: Session has expired on Saturday, 25-Jul-2… | Paused: TikTok rejected the ad group budget and we are re-costing the offer. | cm · api/campaigns/* · read-only · spend:badrequest · list:badrequest · fatigue:badrequest · conn:badrequest · log:badre | campaigns · spend:badrequest · list:badrequest · fatigue:badrequest · conn:badrequest · log:badrequest
- Empty-state wording: none
- Tables: [Panel | Endpoint | Source | Rows] rows=6; numeric cols align: n/a ‖ [Scope | Campaign | Platform | Daily limit | Spend today | Headroom | % of ceiling | Max daily increase | Flags] rows=7; numeric cols align: Daily limit=start/tnum, Spend today=start/tnum, Headroom=start/tnum, % of ceiling=start, Max daily increase=start/tnum ‖ [Campaign | Platform | Offer | Approval state | Strategy | Budget / day | Spend yesterday | ROAS 7d | Ad sets | Ads | Disclosure | Status] rows=11; numeric cols align: Budget / day=start/tnum, Spend yesterday=start/tnum, Ad sets=start/tnum, Ads=start/tnum ‖ [Ad | Campaign | Platform | Spend | Impressions | Frequency | CTR | ROAS | Last date | Rotated | Next rotation | Recommendation] rows=11; numeric cols align: Spend=start/tnum, Impressions=start/tnum, Frequency=start/tnum, CTR=start/tnum, ROAS=start/tnum ‖ [Platform | Ad account | Connection state | Verification | Token | Campaigns | Can launch | Credit offer | Blockers] rows=4; numeric cols align: Campaigns=start/tnum ‖ [When | Actor | Target | Rule | Reason | Change | Outcome | Revert] rows=16; numeric cols align: n/a
- Metric-ish elements: "CM-00 / SPEND TODAY964.3064.29"@13px, "CM-00 / SPEND TODAY964.3064.29"@13px, "CM-00 / HEADROOM TODAY535.70pa"@13px, "CM-00 / SPEND YESTERDAY1,113.7"@13px, "CM-00 / LIVE CAMPAIGNS3 / 11ap"@13px, "CM-00 / ROAS 7D1.33unweighted "@13px, "280.00"@12.5px/tnum, "284.50"@12.5px/tnum, "0.00"@12.5px/tnum, "101.61%"@11px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table.grid, thead, tr, th, th, th · text under 11px: 400 · api fails: 5

## Click sweep
- 67 clicked of 67 candidates (cap 80) · tally: OK=46, API-FAIL=12, NOOP=6, GONE=3

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "Reload" | 75×35 | API-FAIL | GET /api/campaigns/spend 400; GET /api/campaigns/action-log 400; GET /api/campaigns/connections 400; GET /api/campaigns/list 400; GET /api/campaigns/fatigue 400 · console: Failed to load resource: the server responded with a status of 400 () / Failed to load resource: the server responded with a status of 400 () / Failed to load resource: the server responded with a status of 400 () / Failed to load resource: the server responded with a status of 400 () | docs/workflows/ui-audit-evidence/campaign-manager/clicks/02-API-FAIL-Reload.png |
| 3 | button "CM-00 / SPEND TODAY964.3064.29% of the partner ceiling" | 223×124 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager/clicks/03-NOOP-CM_00_SPEND_TODAY964_3064_29_o.png |
| 4 | button "CM-00 / HEADROOM TODAY535.70partner scope · never negative" | 223×124 | OK |  |  |
| 5 | button "CM-00 / SPEND YESTERDAY1,113.7211 campaigns · CURRENT_DATE −" | 223×124 | OK |  |  |
| 6 | button "CM-00 / LIVE CAMPAIGNS3 / 11approval_state = live" | 223×124 | OK |  |  |
| 7 | button "CM-00 / ROAS 7D1.33unweighted mean of 6 campaign averages" | 223×124 | OK |  |  |
| 8 | button "1Breached ceilingsspend?state=breached · breached_at IS NOT " | 274×121 | OK |  |  |
| 9 | button "4Actions failed or never executedaction-log?state=failed · e" | 274×121 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 10 | button "2Connections that cannot launchconnections · can_launch = fa" | 274×121 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 11 | button "2Campaigns carrying a last_errorlist · campaigns.last_error," | 274×121 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 12 | button "all7" | 50×24 | OK |  |  |
| 13 | button "breached1" | 80×24 | OK |  |  |
| 14 | button "ok6" | 43×24 | OK |  |  |
| 15 | button "Sync Meta now" | 127×35 | OK |  |  |
| 16 | button "all11" | 56×24 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager/clicks/16-NOOP-all11.png |
| 17 | button "draft2" | 62×24 | OK |  |  |
| 18 | button "awaiting_approval1" | 135×24 | OK |  |  |
| 19 | button "approved1" | 80×24 | OK |  |  |
| 20 | button "live3" | 56×24 | OK |  |  |
| 21 | button "paused3" | 68×24 | OK |  |  |
| 22 | button "archived1" | 80×24 | OK |  |  |
| 23 | button "all11" | 56×24 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager/clicks/23-NOOP-all11.png |
| 24 | button "refresh5" | 74×24 | OK |  |  |
| 25 | button "queue3" | 62×24 | OK |  |  |
| 26 | button "ok3" | 43×24 | OK |  |  |
| 27 | button "unconfigured0" | 105×24 | OK |  |  |
| 28 | button "all4" | 50×24 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager/clicks/28-NOOP-all4.png |
| 29 | button "pending1" | 74×24 | OK |  |  |
| 30 | button "active2" | 68×24 | OK |  |  |
| 31 | button "expired1" | 74×24 | OK |  |  |
| 32 | button "revoked0" | 74×24 | OK |  |  |
| 33 | button "needs_verification0" | 141×24 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager/clicks/33-NOOP-needs_verification0.png |
| 34 | button "all16" | 56×24 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager/clicks/34-NOOP-all16.png |
| 35 | button "agent10" | 68×24 | OK |  |  |
| 36 | button "human6" | 62×24 | OK |  |  |
| 37 | button "revertible9" | 92×24 | OK |  |  |
| 38 | button "failed4" | 68×24 | OK |  |  |
| 39 | button "Search⌘K" | 99×36 | OK |  |  |
| 40 | button "Chat" | 52×52 | OK |  |  |
| 41 | tr "▸Credit Cards — Google search testcreated Jul 29, 2026 · not" | 1838×59 | API-FAIL | GET /api/campaigns/detail 400 · console: Failed to load resource: the server responded with a status of 400 () | docs/workflows/ui-audit-evidence/campaign-manager/clicks/41-API-FAIL-_Credit_Cards_Google_search_te.png |
| 42 | tr "▸Credit Repair — Forester coldcreated Jul 28, 2026 · not app" | 1838×59 | API-FAIL | GET /api/campaigns/detail 400 · console: Failed to load resource: the server responded with a status of 400 () | docs/workflows/ui-audit-evidence/campaign-manager/clicks/42-API-FAIL-_Credit_Repair_Forester_coldcr.png |
| 43 | tr "▸Funding — Venus Fly Trap 2 lookalikecreated Jul 26, 2026 · " | 1838×59 | API-FAIL | GET /api/campaigns/detail 400 · console: Failed to load resource: the server responded with a status of 400 () | docs/workflows/ui-audit-evidence/campaign-manager/clicks/43-API-FAIL-_Funding_Venus_Fly_Trap_2_look.png |
| 44 | tr "▸Credit Cards — Tornado prospectingcreated Jul 24, 2026 · ap" | 1838×59 | API-FAIL | GET /api/campaigns/detail 400 · console: Failed to load resource: the server responded with a status of 400 () | docs/workflows/ui-audit-evidence/campaign-manager/clicks/44-API-FAIL-_Credit_Cards_Tornado_prospect.png |
| 45 | tr "▸Funding — Forester Q3 broad (acct 2)last_error · Error vali" | 1838×76 | API-FAIL | GET /api/campaigns/detail 400 · console: Failed to load resource: the server responded with a status of 400 () | docs/workflows/ui-audit-evidence/campaign-manager/clicks/45-API-FAIL-_Funding_Forester_Q3_broad_acc.png |
| 46 | tr "▸Credit Repair — Harvester warm listcreated Jul 11, 2026 · a" | 1838×59 | API-FAIL | GET /api/campaigns/detail 400 · console: Failed to load resource: the server responded with a status of 400 () | docs/workflows/ui-audit-evidence/campaign-manager/clicks/46-API-FAIL-_Credit_Repair_Harvester_warm_.png |
| 47 | tr "▸Funding — Tornado TikTok coldcreated Jul 08, 2026 · approve" | 1838×59 | API-FAIL | GET /api/campaigns/detail 400 · console: Failed to load resource: the server responded with a status of 400 () | docs/workflows/ui-audit-evidence/campaign-manager/clicks/47-API-FAIL-_Funding_Tornado_TikTok_coldcr.png |
| 48 | tr "▸Funding — Forester Q3 broadcreated Jul 05, 2026 · approved " | 1838×59 | API-FAIL | GET /api/campaigns/detail 400 · console: Failed to load resource: the server responded with a status of 400 () | docs/workflows/ui-audit-evidence/campaign-manager/clicks/48-API-FAIL-_Funding_Forester_Q3_broadcrea.png |
| 49 | tr "▸Credit Cards — Hammer Them TikToklast_error · Budget must b" | 1838×76 | API-FAIL | GET /api/campaigns/detail 400 · console: Failed to load resource: the server responded with a status of 400 () | docs/workflows/ui-audit-evidence/campaign-manager/clicks/49-API-FAIL-_Credit_Cards_Hammer_Them_TikT.png |
| 50 | tr "▸Credit Cards — Venus Fly Trap 1 retargetcreated Jun 27, 202" | 1838×59 | API-FAIL | GET /api/campaigns/detail 400 · console: Failed to load resource: the server responded with a status of 400 () | docs/workflows/ui-audit-evidence/campaign-manager/clicks/50-API-FAIL-_Credit_Cards_Venus_Fly_Trap_1.png |
| 51 | tr "▸Funding — Harvester Q2 evergreencreated Apr 09, 2026 · appr" | 1838×59 | API-FAIL | GET /api/campaigns/detail 400 · console: Failed to load resource: the server responded with a status of 400 () | docs/workflows/ui-audit-evidence/campaign-manager/clicks/51-API-FAIL-_Funding_Harvester_Q2_evergree.png |
| 52 | tr "▸Jul 30, 2026 14:22agentagent_id null · unattributedcampaign" | 1755×63 | OK |  |  |
| 53 | tr "▸Jul 30, 2026 09:15agentagent_id null · unattributedad_setFo" | 1755×63 | OK |  |  |
| 54 | tr "▸Jul 30, 2026 09:15agentagent_id null · unattributedad_setTo" | 1755×63 | OK |  |  |
| 55 | tr "▸Jul 30, 2026 09:15agentagent_id null · unattributedad_setVF" | 1755×63 | OK |  |  |
| 56 | tr "▸Jul 29, 2026 21:03humanStaffcampaignCredit Cards — Hammer T" | 1755×63 | OK |  |  |
| 57 | tr "▸Jul 29, 2026 20:58humanStaffcampaignCredit Cards — Hammer T" | 1755×63 | OK |  |  |
| 58 | tr "▸Jul 29, 2026 14:12agentagent_id null · unattributedad_setHa" | 1755×63 | OK |  |  |
| 59 | tr "▸Jul 29, 2026 09:14agentagent_id null · unattributedad_setFo" | 1755×63 | OK |  |  |
| 60 | tr "▸Jul 28, 2026 16:40agentagent_id null · unattributedad_setFo" | 1755×63 | OK |  |  |
| 61 | tr "▸Jul 28, 2026 11:22humanCurtis Elleryconnectionmeta · act_99" | 1755×63 | OK |  |  |
| 62 | tr "▸Jul 27, 2026 18:05humanStaffcampaignCredit Cards — Tornado " | 1755×63 | OK |  |  |
| 63 | tr "▸Jul 27, 2026 15:48humanStaffad_setVFT1 · site visitors 30d " | 1755×102 | OK |  |  |
| 64 | tr "▸Jul 27, 2026 09:16agentagent_id null · unattributedad_setVF" | 1755×63 | OK |  |  |
| 65 | tr "▸Jul 26, 2026 09:15agentagent_id null · unattributedad_setTo" | 1755×63 | OK |  |  |
| 66 | tr "▸Jul 24, 2026 09:15agentagent_id null · unattributedad_setHa" | 1755×63 | OK |  |  |
| 67 | tr "▸Jul 22, 2026 10:47humanStaffautopilottarget_id null—Turned " | 1755×63 | OK |  |  |
