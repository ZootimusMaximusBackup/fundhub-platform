# UI audit evidence — my-numbers-livefix as closer@fundhub.ai

Ran 2026-08-17T19:33:33.771Z against https://fundhub.ai. Login ok (role closer). Screen /app/my-numbers.html → HTTP 200, final /app/my-numbers.html, title "My numbers · Fundhub".

Shots: docs/workflows/ui-audit-evidence/my-numbers-livefix/1440-fold.png · docs/workflows/ui-audit-evidence/my-numbers-livefix/1440-full.png · docs/workflows/ui-audit-evidence/my-numbers-livefix/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 1898px (fold 900) · content width 1440px (div.app-shell) · sidebar 228px
- Top-left element: header "C-02 / My numbers Off shift TEST — Closer Role"
- H1: — · H2s: —
- Nav: 5 visible items · active: ＃My numbers · groups: Sales▾(5), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (8): 28px×14, 14px×67, 13px×1, 12px×1, 11.5px×1, 11px×7, 10px×1, 9px×2
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 1px×3, 17px×3, 18px×3
- Uneven card rows: none detected
- ALL-CAPS runs: 1 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "$0"@28px/tnum, "—/—"@28px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 1 · api fails: 0

## Click sweep
- skipped: --no-clicks
