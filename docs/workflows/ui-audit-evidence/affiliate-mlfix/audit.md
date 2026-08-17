# UI audit evidence — affiliate-mlfix as affiliate@fundhub.ai

Ran 2026-08-17T19:39:45.559Z against https://fundhub.ai. Login ok (role affiliate). Screen /app/affiliate.html → HTTP 200, final /app/affiliate.html, title "Fundhub — Affiliate".

Shots: docs/workflows/ui-audit-evidence/affiliate-mlfix/1440-fold.png · docs/workflows/ui-audit-evidence/affiliate-mlfix/1440-full.png · docs/workflows/ui-audit-evidence/affiliate-mlfix/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 1277px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Affiliate · H2s: —
- Nav: 1 visible items · active: ⇗AffiliateBETA · groups: Portals▾(1)
- Font sizes in use (4): 28px×4, 18px×1, 14px×17, 11px×47
- Primary-looking (filled) buttons: 1 — "Ask"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 14px×9, 13px×3
- Uneven card rows: top 320: [1164,282,282,282,282]; top 520: [1164,1162]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Referred | Business | Status | First paid product | Basis | Commission | Payout] rows=1; numeric cols align: n/a
- Metric-ish elements: "AF-02 / REFERRED—lifetime lead"@14px, "AF-02 / REFERRED—lifetime lead"@14px, "AF-02 / CONVERTED—comes from y"@14px, "AF-02 / OWED$0accrued, not yet"@14px, "AF-02 / PAID—lifetime · comes "@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 0 · api fails: 0

## Click sweep
- skipped: --no-clicks
