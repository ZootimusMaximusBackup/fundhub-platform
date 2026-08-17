# UI audit evidence — contracts-mlfix as closer@fundhub.ai

Ran 2026-08-17T19:36:47.199Z against https://fundhub.ai. Login ok (role closer). Screen /app/contracts.html → HTTP 200, final /app/contracts.html, title "Fundhub — Contracts".

Shots: docs/workflows/ui-audit-evidence/contracts-mlfix/1440-fold.png · docs/workflows/ui-audit-evidence/contracts-mlfix/1440-full.png · docs/workflows/ui-audit-evidence/contracts-mlfix/390-full.png

## Load
- API calls: 6; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "WorkContracts — live"
- H1: Contracts · H2s: Contracts
- Nav: 3 visible items · active: ✒Contracts · groups: Sales▾(0), Funding▾(3), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (10): 22px×4, 14.5px×1, 13.5px×1, 13px×1, 12.5px×12, 12px×5, 11px×24, 10.5px×3, 10px×8, 9.5px×4
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 2
- Off-8px-scale spacing values: 14px×5, 13px×2
- Uneven card rows: top 80: [1164,282,282,282,282]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Client | Contract | State | When] rows=6; numeric cols align: n/a
- Metric-ish elements: "CT-00 / WAITING4sent, not sign"@13px, "CT-00 / WAITING4sent, not sign"@13px, "CT-00 / WORDINGS5wordings in u"@13px, "CT-00 / SIGNED0signed and on f"@13px, "CT-00 / DRAFTS2started, not se"@13px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 18 · api fails: 0

## Click sweep
- skipped: --no-clicks
