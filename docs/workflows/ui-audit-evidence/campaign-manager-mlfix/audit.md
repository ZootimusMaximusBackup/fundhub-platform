# UI audit evidence — campaign-manager-mlfix as owner@fundhub.ai

Ran 2026-08-17T19:39:09.351Z against https://fundhub.ai. Login ok (role owner). Screen /app/campaign-manager.html → HTTP 200, final /app/campaign-manager.html, title "Fundhub — Campaigns".

Shots: docs/workflows/ui-audit-evidence/campaign-manager-mlfix/1440-fold.png · docs/workflows/ui-audit-evidence/campaign-manager-mlfix/1440-full.png · docs/workflows/ui-audit-evidence/campaign-manager-mlfix/390-full.png

## Load
- API calls: 10; failing: GET /api/campaigns/spend?state=all → 400; GET /api/campaigns/connections?state=all → 400; GET /api/campaigns/fatigue?state=all&days=7 → 400; GET /api/campaigns/action-log?state=all&limit=200 → 400; GET /api/campaigns/list?state=all&limit=200 → 400
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: Failed to load resource: the server responded with a status of 400 () | Failed to load resource: the server responded with a status of 400 () | Failed to load resource: the server responded with a status of 400 () | Failed to load resource: the server responded with a status of 400 () | Failed to load resource: the server responded with a status of 400 ()

## DOM read (1440×900)
- Page height 3694px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Campaigns · H2s: —
- Nav: 4 visible items · active: ◇CampaignsBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(4), Admin▾(0), Portals▾(0)
- Font sizes in use (7): 28px×5, 18px×1, 14px×103, 13px×1, 12px×1, 11px×113, 10px×1
- Primary-looking (filled) buttons: 2 — "Sync Meta now", "Chat"
- Generic labels: ok, ok · targets under 40px: 0
- Off-8px-scale spacing values: 14px×12, 13px×7, 18px×3, 11px×3
- Uneven card rows: top 144: [1232,299,299,299,299]; top 1272: [1232,1230]; top 1712: [1232,1230]; top 2640: [1232,1230]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: loading…
- Error wording: Campaigns with an error on them | failed
- Empty-state wording: none
- Tables: [Panel | Status | Rows] rows=6; numeric cols align: n/a ‖ [Scope | Campaign | Platform | Daily limit | Spend today | Headroom | % of ceiling | Max daily increase | Flags] rows=1; numeric cols align: n/a ‖ [Campaign | Platform | Offer | Approval state | Strategy | Budget / day | Spend yesterday | ROAS 7d | Ad sets | Ads | Disclosure | Status] rows=1; numeric cols align: n/a ‖ [Ad | Campaign | Platform | Spend | Impressions | Frequency | CTR | ROAS | Last date | Rotated | Next rotation | Recommendation] rows=1; numeric cols align: n/a ‖ [Platform | Ad account | Connection state | Verification | Token | Campaigns | Can launch | Credit offer | Blockers] rows=1; numeric cols align: n/a ‖ [When | Actor | Target | Rule | Reason | Change | Outcome | Revert] rows=1; numeric cols align: n/a
- Metric-ish elements: "CM-00 / SPEND TODAY—Nothing ca"@14px, "CM-00 / SPEND TODAY—Nothing ca"@14px, "CM-00 / HEADROOM TODAY—Nothing"@14px, "CM-00 / SPEND YESTERDAY—Nothin"@14px, "CM-00 / LIVE CAMPAIGNS—Nothing"@14px, "CM-00 / ROAS 7D—Nothing can be"@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table.grid, thead, tr, th, th, tbody#srcRows · text under 11px: 1 · api fails: 5

## Click sweep
- skipped: --no-clicks
