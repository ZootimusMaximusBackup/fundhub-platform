# UI audit evidence — affiliate as affiliate@fundhub.ai

Ran 2026-08-17T06:13:39.623Z against https://fundhub.ai. Login ok (role affiliate). Screen /app/affiliate.html → HTTP 200, final /app/affiliate.html, title "Fundhub — Affiliate".

Shots: docs/workflows/ui-audit-evidence/affiliate/1440-fold.png · docs/workflows/ui-audit-evidence/affiliate/1440-full.png · docs/workflows/ui-audit-evidence/affiliate/390-full.png

## Load
- API calls: 5; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 1350px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Affiliate · H2s: —
- Nav: 1 visible items · active: ⇗AffiliateBETA · groups: Portals▾(1)
- Font sizes in use (12): 22px×4, 15px×5, 14.5px×1, 14px×5, 13px×2, 12.5px×6, 11.5px×30, 11px×13, 10.5px×4, 10px×7, 9.5px×7, 9px×7
- Primary-looking (filled) buttons: 2 — "Ask", "Sign license"
- Generic labels: none · targets under 40px: 3
- Off-8px-scale spacing values: 14px×9, 13px×3
- Uneven card rows: top 688: [1164,282,282,282,282]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: [Referred | Business | Status | First paid product | Basis | Commission | Payout] rows=1; numeric cols align: n/a
- Metric-ish elements: "AF-02 / REFERRED0lifetime lead"@13px, "AF-02 / REFERRED0lifetime lead"@13px, "AF-02 / CONVERTED0—"@13px, "AF-02 / OWED$0.00accrued, not "@13px, "AF-02 / PAID$0.00lifetime"@13px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: table.grid, thead, tr, th, th, th · text under 11px: 30 · api fails: 0

## Click sweep
- 8 clicked of 8 candidates (cap 80) · tally: OK=6, DIALOG=1, NOOP=1

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | button "Ask" | 53×42 | OK |  |  |
| 3 | button "Copy link" | 97×41 | OK |  |  |
| 4 | button "Copy code" | 97×41 | OK |  |  |
| 5 | button "Sign license" | 112×29 | DIALOG | dialog: confirm "Open the partner license for signature?

Accrued payouts release on the next Friday run once it is signed." |  |
| 6 | button "Referred leads" | 133×40 | NOOP |  | docs/workflows/ui-audit-evidence/affiliate/clicks/06-NOOP-Referred_leads.png |
| 7 | button "Payouts" | 80×40 | OK |  |  |
| 8 | button "Terms" | 64×40 | OK |  |  |
