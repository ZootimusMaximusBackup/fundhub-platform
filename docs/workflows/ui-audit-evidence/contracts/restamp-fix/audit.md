# UI audit evidence — contracts-livefix as owner@fundhub.ai

Ran 2026-08-17T19:32:38.502Z against https://fundhub.ai. Login ok (role owner). Screen /app/contracts.html → HTTP 200, final /app/contracts.html, title "Fundhub — Contracts".

Shots: docs/workflows/ui-audit-evidence/contracts-livefix/1440-fold.png · docs/workflows/ui-audit-evidence/contracts-livefix/1440-full.png · docs/workflows/ui-audit-evidence/contracts-livefix/390-full.png

## Load
- API calls: 7; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 1227px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "WorkContracts — live"
- H1: Contracts · H2s: Contracts / Contract wording
- Nav: 4 visible items · active: ✒Contracts · groups: Sales▾(0), Funding▾(4), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (7): 28px×4, 18px×3, 14px×24, 13px×1, 12px×1, 11px×54, 10px×1
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 14px×6, 13px×3
- Uneven card rows: top 80: [1164,282,282,282,282]; top 336: [1164,1162]; top 728: [1164,1162]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Client | Contract | State | When] rows=6; numeric cols align: n/a ‖ [Short name | Name | State] rows=5; numeric cols align: n/a
- Metric-ish elements: "CT-00 / WAITING4sent, not sign"@14px, "CT-00 / WAITING4sent, not sign"@14px, "CT-00 / WORDINGS5wordings in u"@14px, "CT-00 / SIGNED0signed and on f"@14px, "CT-00 / DRAFTS2started, not se"@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table, thead, tr, th, tbody#listBody, tr.rowlink · text under 11px: 1 · api fails: 0

## Click sweep
- 8 clicked of 16 candidates (cap 8) · tally: DIALOG=1, OK=6, NOOP=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Send reminders" | 128×40 | DIALOG | dialog: confirm "Email everyone who has not signed yet (4 people) and put them on the follow-up list?" |  |
| 2 | tr "Chris ProveFundingFunding Agreement — prove send 2026-08-16o" | 1162×46 | OK | GET /api/read/contracts 200 |  |
| 3 | tr "Chris ProveFundingSoft Pull Authorization — prove send 2026-" | 1162×46 | OK | GET /api/read/contracts 200 |  |
| 4 | tr "Chris ProveFundingFunding Agreement — prove send 2026-08-16s" | 1162×46 | OK | GET /api/read/contracts 200 |  |
| 5 | tr "Chris ProveFundingSoft Pull Authorization — prove send 2026-" | 1162×46 | OK | GET /api/read/contracts 200 |  |
| 6 | tr "Chris ProveFundingFunding Agreement — prove send 2026-08-16d" | 1162×46 | OK | GET /api/read/contracts 200 |  |
| 7 | tr "Chris ProveFundingSoft Pull Authorization — prove send 2026-" | 1162×45 | OK | GET /api/read/contracts 200 |  |
| 8 | button "Upload a PDF" | 113×40 | NOOP |  | docs/workflows/ui-audit-evidence/contracts-livefix/clicks/08-NOOP-Upload_a_PDF.png |
