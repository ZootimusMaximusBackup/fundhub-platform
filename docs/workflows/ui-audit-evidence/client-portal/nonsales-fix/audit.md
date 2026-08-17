# UI audit evidence — client-portal/nonsales-fix as client@fundhub.ai

Ran 2026-08-17T19:37:42.681Z against https://fundhub.ai. Login ok (role client). Screen /app/client-portal.html → HTTP 200, final /app/client-portal.html, title "Fundhub — Client Portal".

Shots: docs/workflows/ui-audit-evidence/client-portal/nonsales-fix/1440-fold.png · docs/workflows/ui-audit-evidence/client-portal/nonsales-fix/1440-full.png · docs/workflows/ui-audit-evidence/client-portal/nonsales-fix/390-full.png

## Load
- API calls: 10; failing: GET /api/read/documents?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521&limit=200 → 403; GET /api/dashboard/client?id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → 403
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: Failed to load resource: the server responded with a status of 403 () | Failed to load resource: the server responded with a status of 403 ()

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.shell) · sidebar 0px
- Top-left element: header "Client Portal State Before call In progress Just funded T— TEST — Client Role"
- H1: — · H2s: Metro 2 Dispute Letter Pack — Rounds 2 & 3 / Your call
- Nav: 0 visible items · active: none marked · groups: 
- Font sizes in use (7): 28px×1, 18px×2, 14px×108, 13px×2, 12.5px×1, 12px×2, 11px×9
- Primary-looking (filled) buttons: 4 — "I sign to authorize Fundhub to prepare my dispute letters", "Chat", "Message staff", "Send"
- Generic labels: none · targets under 40px: 3
- Off-8px-scale spacing values: 20px×4, 22px×3, 14px×5, 18px×1, 15px×9, 17px×2, 10px×2
- Uneven card rows: top 1200: [732,730]; top 1680: [686,221,221,221]
- ALL-CAPS runs: 0 · centered paragraphs: 1
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: Draw your signature. An empty box does not count. | No payments yet | your files are not listed here — your advisor sends them · live entitlements · 0 unlocked · 6 locked · live pre-qual · n
- Tables: none
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible false (0px) · burger false · elements past right edge: div.step, div.lbl, div.step, span.line, div.lbl, div.step · text under 11px: 0 · api fails: 2

## Click sweep
- skipped: --no-clicks
