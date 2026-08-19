# UI audit evidence — T1-repro-portal-owner as owner@fundhub.ai

Ran 2026-08-19T06:50:22.331Z against https://fundhub.ai. Login ok (role owner). Screen /app/client-portal.html?id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → HTTP 200, final /app/client-portal.html?id=8556bedc-46e1-4d85-b0cd-a24adfee1521, title "Fundhub — Client Portal".

Shots: docs/workflows/ui-audit-evidence/T1-repro-portal-owner/1440-fold.png · docs/workflows/ui-audit-evidence/T1-repro-portal-owner/1440-full.png · docs/workflows/ui-audit-evidence/T1-repro-portal-owner/390-full.png

## Load
- API calls: 9; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.shell) · sidebar 0px
- Top-left element: div "Client Portal"
- H1: — · H2s: Metro 2 Dispute Letter Pack — Rounds 2 & 3 / Your call
- Nav: 0 visible items · active: none marked · groups: 
- Font sizes in use (5): 32px×1, 20px×2, 16px×142, 13px×5, 11px×1
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 2
- Off-8px-scale spacing values: 3px×1, 10px×3, 7px×3, 20px×5, 22px×4, 14px×6, 18px×1, 15px×9, 17px×2
- Uneven card rows: top 1184: [732,730]; top 1712: [686,221,221,221]
- ALL-CAPS runs: 0 · centered paragraphs: 1
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: live pre-qual · none yet · live agreements · 2 on file · live entitlements · 0 unlocked · 6 locked · live documents · 4 
- Tables: none
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible false (0px) · burger false · elements past right edge: div.step, div.lbl, div.step, span.line, div.lbl, div.step · text under 11px: 0 · api fails: 0

## Click sweep
- 0 clicked of 21 candidates (cap 0) · tally: 

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
