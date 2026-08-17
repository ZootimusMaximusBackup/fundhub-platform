# UI audit evidence — campaign-manager-fixed as owner@fundhub.ai

Ran 2026-08-17T17:46:42.872Z against https://fundhub.ai. Login ok (role owner). Screen /app/campaign-manager.html → HTTP 200, final /app/campaign-manager.html, title "Fundhub — Campaigns".

Shots: docs/workflows/ui-audit-evidence/campaign-manager-fixed/1440-fold.png · docs/workflows/ui-audit-evidence/campaign-manager-fixed/1440-full.png · docs/workflows/ui-audit-evidence/campaign-manager-fixed/390-full.png

## Load
- API calls: 9; failing: GET /api/campaigns/list?state=all&limit=200 → 400; GET /api/campaigns/spend?state=all → 400; GET /api/campaigns/action-log?state=all&limit=200 → 400; GET /api/campaigns/fatigue?state=all&days=7 → 400; GET /api/campaigns/connections?state=all → 400
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: Failed to load resource: the server responded with a status of 400 () | Failed to load resource: the server responded with a status of 400 () | Failed to load resource: the server responded with a status of 400 () | Failed to load resource: the server responded with a status of 400 () | Failed to load resource: the server responded with a status of 400 ()

## DOM read (1440×900)
- Page height 3422px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Campaigns · H2s: —
- Nav: 4 visible items · active: ◇CampaignsBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(4), Admin▾(0), Portals▾(0)
- Font sizes in use (7): 28px×4, 18px×7, 14px×59, 13px×1, 12px×1, 11px×154, 10px×1
- Primary-looking (filled) buttons: 2 — "Sync Meta now", "Chat"
- Generic labels: ok, ok · targets under 40px: 15
- Off-8px-scale spacing values: 14px×12, 13px×7, 18px×3, 11px×3
- Uneven card rows: top 120: [1232,237,237,237,237,237]; top 1528: [1232,1230]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: loading…
- Error wording: Campaigns with an error on them | failed
- Empty-state wording: none
- Tables: [Panel | Status | Rows] rows=6; numeric cols align: n/a ‖ [Scope | Campaign | Platform | Daily limit | Spend today | Headroom | % of ceiling | Max daily increase | Flags] rows=1; numeric cols align: n/a ‖ [Campaign | Platform | Offer | Approval state | Strategy | Budget / day | Spend yesterday | ROAS 7d | Ad sets | Ads | Disclosure | Status] rows=1; numeric cols align: n/a ‖ [Ad | Campaign | Platform | Spend | Impressions | Frequency | CTR | ROAS | Last date | Rotated | Next rotation | Recommendation] rows=1; numeric cols align: n/a ‖ [Platform | Ad account | Connection state | Verification | Token | Campaigns | Can launch | Credit offer | Blockers] rows=1; numeric cols align: n/a ‖ [When | Actor | Target | Rule | Reason | Change | Outcome | Revert] rows=1; numeric cols align: n/a
- Metric-ish elements: "CM-00 / SPEND TODAY—Nothing ca"@14px, "CM-00 / SPEND TODAY—Nothing ca"@14px, "CM-00 / HEADROOM TODAY—Nothing"@14px, "CM-00 / SPEND YESTERDAY—Nothin"@14px, "CM-00 / LIVE CAMPAIGNS—Nothing"@14px, "CM-00 / ROAS 7D—Nothing can be"@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table.grid, thead, tr, th, th, tbody#srcRows · text under 11px: 4 · api fails: 5

## Click sweep
- 34 clicked of 34 candidates (cap 80) · tally: OK=3, API-FAIL=1, NOOP=27, GONE=3

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "Reload" | 75×35 | API-FAIL | GET /api/campaigns/action-log 400; GET /api/campaigns/fatigue 400; GET /api/campaigns/connections 400; GET /api/campaigns/list 400; GET /api/campaigns/spend 400 · console: Failed to load resource: the server responded with a status of 400 () / Failed to load resource: the server responded with a status of 400 () / Failed to load resource: the server responded with a status of 400 () / Failed to load resource: the server responded with a status of 400 () | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/02-API-FAIL-Reload.png |
| 3 | button "—Daily limits already hitNothing can be shown until a partne" | 291×135 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/03-NOOP-_Daily_limits_already_hitNothi.png |
| 4 | button "—Changes that did not go throughNothing can be shown until a" | 291×135 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 5 | button "—Connections that cannot go liveNothing can be shown until a" | 291×135 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 6 | button "—Campaigns with an error on themNothing can be shown until a" | 291×135 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 7 | button "all" | 42×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/07-NOOP-all.png |
| 8 | button "breached" | 80×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/08-NOOP-breached.png |
| 9 | button "ok" | 35×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/09-NOOP-ok.png |
| 10 | button "all" | 42×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/10-NOOP-all.png |
| 11 | button "draft" | 57×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/11-NOOP-draft.png |
| 12 | button "awaiting_approval" | 147×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/12-NOOP-awaiting_approval.png |
| 13 | button "approved" | 80×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/13-NOOP-approved.png |
| 14 | button "live" | 50×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/14-NOOP-live.png |
| 15 | button "paused" | 65×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/15-NOOP-paused.png |
| 16 | button "archived" | 80×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/16-NOOP-archived.png |
| 17 | button "all" | 42×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/17-NOOP-all.png |
| 18 | button "refresh" | 72×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/18-NOOP-refresh.png |
| 19 | button "queue" | 57×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/19-NOOP-queue.png |
| 20 | button "ok" | 35×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/20-NOOP-ok.png |
| 21 | button "unconfigured" | 110×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/21-NOOP-unconfigured.png |
| 22 | button "all" | 42×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/22-NOOP-all.png |
| 23 | button "pending" | 72×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/23-NOOP-pending.png |
| 24 | button "active" | 65×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/24-NOOP-active.png |
| 25 | button "expired" | 72×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/25-NOOP-expired.png |
| 26 | button "revoked" | 72×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/26-NOOP-revoked.png |
| 27 | button "needs_verification" | 155×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/27-NOOP-needs_verification.png |
| 28 | button "all" | 42×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/28-NOOP-all.png |
| 29 | button "agent" | 57×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/29-NOOP-agent.png |
| 30 | button "human" | 57×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/30-NOOP-human.png |
| 31 | button "revertible" | 95×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/31-NOOP-revertible.png |
| 32 | button "failed" | 65×27 | NOOP |  | docs/workflows/ui-audit-evidence/campaign-manager-fixed/clicks/32-NOOP-failed.png |
| 33 | button "Search⌘K" | 99×36 | OK |  |  |
| 34 | button "Chat" | 52×52 | OK |  |  |
