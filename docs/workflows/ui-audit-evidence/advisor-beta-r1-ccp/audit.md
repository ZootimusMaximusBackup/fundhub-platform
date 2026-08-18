# UI audit evidence — advisor-beta-r1-ccp as advisor@fundhub.ai

Ran 2026-08-18T03:33:06.022Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/client-control-panel.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → HTTP 200, final /app/client-control-panel.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521, title "Fundhub — Client Control Panel".

Shots: docs/workflows/ui-audit-evidence/advisor-beta-r1-ccp/1440-fold.png · docs/workflows/ui-audit-evidence/advisor-beta-r1-ccp/1440-full.png · docs/workflows/ui-audit-evidence/advisor-beta-r1-ccp/390-full.png

## Load
- API calls: 4; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: pageerror: FHData is not defined | pageerror: FHData is not defined

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "/ Client Control Panel"
- H1: — · H2s: —
- Nav: 4 visible items · active: ◎Client Control Panel · groups: Sales▾(0), Funding▾(0), Client ops▾(4), Automation▾(0)
- Font sizes in use (3): 14px×57, 13px×1, 11px×6
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 1
- Off-8px-scale spacing values: 5px×7, 11px×7, 3px×1, 10px×2, 13px×1, 14px×2, 9px×1, 7px×3, 6px×3
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: Loading…
- Error wording: none
- Empty-state wording: Lender list is empty — import CSV on Lenders.
- Tables: none
- Metric-ish elements: "—"@14px, "—"@14px/tnum, "—"@14px/tnum, "—"@14px/tnum, "—"@14px/tnum, "—"@14px/tnum, "—"@14px/tnum, "Credit —"@14px, "Credit —"@14px, "FUNDHUB-CCP · live ORG: — — no"@11px

## Mobile (390×844)
- Horizontal overflow: YES (scrollWidth 1056) · sidebar visible true (228px) · burger true · elements past right edge: div.topbar-right, div#fh-shell-chip, span, span#fh-shell-src, button#fh-shell-out, div.record-id · text under 11px: 0 · api fails: 0

## Click sweep
- skipped: --no-clicks
