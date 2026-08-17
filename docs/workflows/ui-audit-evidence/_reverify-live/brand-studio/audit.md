# UI audit evidence — _reverify-live/brand-studio as partner@fundhub.ai

Ran 2026-08-17T20:12:34.304Z against https://fundhub.ai. Login ok (role partner). Screen /app/brand-studio.html → HTTP 200, final /app/brand-studio.html, title "Fundhub — Brand Studio".

Shots: docs/workflows/ui-audit-evidence/_reverify-live/brand-studio/1440-fold.png · docs/workflows/ui-audit-evidence/_reverify-live/brand-studio/1440-full.png · docs/workflows/ui-audit-evidence/_reverify-live/brand-studio/390-full.png

## Load
- API calls: 5; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 2550px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Brand Studio · H2s: —
- Nav: 1 visible items · active: ◆Brand StudioBETA · groups: Admin▾(1)
- Font sizes in use (4): 28px×6, 18px×2, 14px×27, 11px×82
- Primary-looking (filled) buttons: 2 — "Create pages from selected funnels", "Save & apply"
- Generic labels: none · targets under 40px: 8
- Off-8px-scale spacing values: 14px×9, 13px×7, 6px×3, 10px×1, 9px×4
- Uneven card rows: top 120: [1164,282,282,282,282]; top 232: [1164,728,420]; top 632: [348,170,170]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | Coming soon
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "BS-00 / BRANDText markwordmark"@14px, "BS-00 / BRANDText markwordmark"@14px, "BS-00 / DOMAIN—not connected"@14px, "BS-00 / FUNNELS LIVE0of 6 avai"@14px, "BS-00 / COMPLIANCELockedmaster"@14px, "8 values, everything renders f"@11px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: input#bLogo · text under 11px: 3 · api fails: 0

## Click sweep
- skipped: --no-clicks
