# UI audit evidence — template-editor/nonsales-fix as owner@fundhub.ai

Ran 2026-08-17T19:28:39.498Z against https://fundhub.ai. Login ok (role owner). Screen /app/template-editor.html → HTTP 200, final /app/template-editor.html, title "Fundhub — Message Copy".

Shots: docs/workflows/ui-audit-evidence/template-editor/nonsales-fix/1440-fold.png · docs/workflows/ui-audit-evidence/template-editor/nonsales-fix/1440-full.png · docs/workflows/ui-audit-evidence/template-editor/nonsales-fix/390-full.png

## Load
- API calls: 6; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 8753px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "AutomationMessage Copy — live"
- H1: Message Copy · H2s: —
- Nav: 4 visible items · active: ✎Message Copy · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(4), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (7): 28px×5, 18px×1, 14px×209, 13px×1, 12px×1, 11px×232, 10px×1
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 2
- Off-8px-scale spacing values: 14px×7, 13px×2
- Uneven card rows: top 80: [1164,282,282,282,282]
- ALL-CAPS runs: 8 · centered paragraphs: 0
- Sample/demo/beta wording: placeholder copy — blocked from send
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "TE-00 / MESSAGES200pieces of c"@14px, "TE-00 / MESSAGES200pieces of c"@14px, "TE-00 / TEXTS18sent as SMS"@14px, "TE-00 / EMAILS182sent as email"@14px, "TE-00 / SWITCHED OFF190waiting"@14px, "TE-00 / DRAFT HAZARD2placehold"@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 4 · api fails: 0

## Click sweep
- skipped: --no-clicks
