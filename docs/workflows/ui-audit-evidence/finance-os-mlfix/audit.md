# UI audit evidence — finance-os-mlfix as advisor@fundhub.ai

Ran 2026-08-17T19:36:16.356Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/finance-os.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → HTTP 200, final /app/finance-os.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521, title "Fundhub — Finance OS".

Shots: docs/workflows/ui-audit-evidence/finance-os-mlfix/1440-fold.png · docs/workflows/ui-audit-evidence/finance-os-mlfix/1440-full.png · docs/workflows/ui-audit-evidence/finance-os-mlfix/390-full.png

## Load
- API calls: 12; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 5201px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Finance OS · H2s: Credit — from the latest pull / Bank & investment accounts / Cards & credit lines / Recent transactions / Where it goes / Recurring bills / What the engine says / Text me when / Deal calculator / Ask it
- Nav: 3 visible items · active: ▩Finance OSBETA · groups: Sales▾(0), Funding▾(3), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (7): 28px×4, 18px×11, 14px×63, 13px×1, 12px×1, 11px×15, 10px×1
- Primary-looking (filled) buttons: 4 — "30d", "Run", "Ask", "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 14px×3
- Uneven card rows: top 688: [1164,690]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | No transactions on file for this window. Bank transactions only exist once an account has real (or sample) history behin
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "—"@28px/tnum, "0"@28px/tnum, "—"@28px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: div.fld, label, input#dealFeePct, div.fld, label, input#dealDebts · text under 11px: 1 · api fails: 0

## Click sweep
- skipped: --no-clicks
