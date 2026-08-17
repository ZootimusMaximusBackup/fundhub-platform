# UI audit evidence — consent-capture as client@fundhub.ai

Ran 2026-08-17T06:19:48.089Z against https://fundhub.ai. Login ok (role client). Screen /app/consent-capture.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → HTTP 200, final /app/client-portal.html **BOUNCED**, title "Fundhub — Client Portal".

Shots: docs/workflows/ui-audit-evidence/consent-capture/1440-fold.png · docs/workflows/ui-audit-evidence/consent-capture/1440-full.png · docs/workflows/ui-audit-evidence/consent-capture/390-full.png

## Load
- API calls: 10; failing: GET /api/consent/capture?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521&kind=dispute_authorization → 401; GET /api/read/documents?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521&limit=200 → 401; GET /api/dashboard/client?id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → 401
- Console errors: Failed to load resource: the server responded with a status of 401 () | Failed to load resource: the server responded with a status of 401 () | Failed to load resource: the server responded with a status of 401 ()

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.shell) · sidebar 0px
- Top-left element: header "Client Portal State Before call In progress Just funded T— TEST — Client Role"
- H1: — · H2s: Metro 2 Dispute Letter Pack — Rounds 2 & 3 / Book a call
- Nav: 0 visible items · active: none marked · groups: 
- Font sizes in use (18): 22px×1, 21px×1, 20px×1, 17px×2, 16px×1, 15px×7, 14.5px×1, 14px×3, 13.5px×11, 13px×9, 12.5px×14, 12px×28, 11.5px×15, 11px×6, 10.5px×10, 10px×4, 9.5px×1, 9px×13
- Primary-looking (filled) buttons: 13 — "Unlock", "Unlock", "Unlock", "Unlock", "Unlock", "Unlock", "Payments", "Book a call", "Unlock — pay now", "Pick a time", "Chat", "Message staff", "Send"
- Generic labels: none · targets under 40px: 15
- Off-8px-scale spacing values: 14px×4, 18px×1, 15px×9, 20px×3, 22px×2, 17px×2, 10px×2
- Uneven card rows: top 832: [732,730]; top 1296: [686,221,221,221]
- ALL-CAPS runs: 0 · centered paragraphs: 1
- Sample/demo/beta wording: sample documents — not signed in for real data · live pre-qual · none yet · live entitlements · 0 unlocked · 6 locked · 
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: No payments yet | sample documents — not signed in for real data · live pre-qual · none yet · live entitlements · 0 unlocked · 6 locked · 
- Tables: none
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible false (0px) · burger false · elements past right edge: none · text under 11px: 25 · api fails: 3

## Click sweep
- skipped: screen bounced
