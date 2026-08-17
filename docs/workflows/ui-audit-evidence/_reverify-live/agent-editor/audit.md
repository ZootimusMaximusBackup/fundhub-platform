# UI audit evidence — _reverify-live/agent-editor as owner@fundhub.ai

Ran 2026-08-17T20:15:54.546Z against https://fundhub.ai. Login ok (role owner). Screen /app/agent-editor.html → HTTP 200, final /app/agent-editor.html, title "Fundhub — Agent Editor".

Shots: docs/workflows/ui-audit-evidence/_reverify-live/agent-editor/1440-fold.png · docs/workflows/ui-audit-evidence/_reverify-live/agent-editor/1440-full.png · docs/workflows/ui-audit-evidence/_reverify-live/agent-editor/390-full.png

## Load
- API calls: 7; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 1932px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Agent Editor · H2s: —
- Nav: 4 visible items · active: ◈Agent EditorBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(4), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (7): 28px×4, 18px×2, 14px×44, 13px×1, 12px×1, 11px×153, 10px×1
- Primary-looking (filled) buttons: 3 — "+ New agent", "Save agent", "Chat"
- Generic labels: none · targets under 40px: 15
- Off-8px-scale spacing values: 14px×10, 13px×7, 6px×1, 7px×3
- Uneven card rows: top 120: [956,230,230,230,230]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: none
- Error wording: payment.failed
- Empty-state wording: Guardrail block is not empty | no source yet · not blocking
- Tables: none
- Metric-ish elements: "AE-00 / AGENTS2217 client-faci"@14px, "AE-00 / AGENTS2217 client-faci"@14px, "AE-00 / LIVE2acting on real cl"@14px, "AE-00 / SHADOW0logging, not se"@14px, "AE-00 / BREACHES 7D0guardrail "@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 4 · api fails: 0

## Click sweep
- skipped: --no-clicks
