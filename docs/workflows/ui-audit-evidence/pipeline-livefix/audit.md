# UI audit evidence — pipeline-livefix as closer@fundhub.ai

Ran 2026-08-17T19:33:48.227Z against https://fundhub.ai. Login ok (role closer). Screen /app/pipeline.html → HTTP 200, final /app/pipeline.html, title "Fundhub — Pipeline".

Shots: docs/workflows/ui-audit-evidence/pipeline-livefix/1440-fold.png · docs/workflows/ui-audit-evidence/pipeline-livefix/1440-full.png · docs/workflows/ui-audit-evidence/pipeline-livefix/390-full.png

## Load
- API calls: 11; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "Fundhub / Pipeline Org: Fundhub Mon, Aug 17, 3:33:54 PM EDT LIVE"
- H1: — · H2s: —
- Nav: 5 visible items · active: ▤Pipeline · groups: Sales▾(5), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (5): 14px×72, 13px×1, 12px×1, 11px×15, 10px×1
- Primary-looking (filled) buttons: 1 — "Chat"
- Generic labels: none · targets under 40px: 0
- Off-8px-scale spacing values: 7px×4, 9px×4, 14px×1
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "fundhub-pipeline · v1 org: fun"@11px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: div.rail-tab, div.rail-tab, span.rt-code, div.rail-tab, span.rt-code, div.rail-tab · text under 11px: 1 · api fails: 0

## Click sweep
- skipped: --no-clicks
