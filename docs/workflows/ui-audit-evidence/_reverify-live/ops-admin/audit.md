# UI audit evidence — _reverify-live/ops-admin as owner@fundhub.ai

Ran 2026-08-17T20:10:09.746Z against https://fundhub.ai. Login ok (role owner). Screen /app/ops-admin.html → HTTP 200, final /app/ops-admin.html, title "Fundhub — Ops & Admin".

Shots: docs/workflows/ui-audit-evidence/_reverify-live/ops-admin/1440-fold.png · docs/workflows/ui-audit-evidence/_reverify-live/ops-admin/1440-full.png · docs/workflows/ui-audit-evidence/_reverify-live/ops-admin/390-full.png

## Load
- API calls: 11; failing: POST /api/messages-outbound → 599
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: Failed to load resource: the server responded with a status of 599 (Unknown)

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: — · H2s: —
- Nav: 3 visible items · active: ⚙Ops & AdminBETA · groups: Sales▾(0), Funding▾(0), Client ops▾(0), Watch▾(3), Automation▾(0), Marketing▾(0), Admin▾(0), Portals▾(0)
- Font sizes in use (7): 28px×6, 16px×1, 14px×13, 13px×1, 12px×1, 11px×44, 10px×1
- Primary-looking (filled) buttons: 4 — "Last 7 Days — Aug 11–17▾", "Turn ON", "MoneyKPIs · AR · compliance", "Chat"
- Generic labels: none · targets under 40px: 9
- Off-8px-scale spacing values: 14px×3, 9px×6, 11px×7, 2px×1, 13px×1
- Uneven card rows: top 288: [1164,226,226,226,226,226]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | DEMO MODE | OFF — demo rows are hidden. Turn on to seed fictional clients for demos and training. | Open Demo Mode screen →
- Loading wording after settle: none
- Error wording: failed events awaiting retry
- Empty-state wording: none
- Tables: [Client | Invoice | Days Overdue | Status] rows=2; numeric cols align: n/a ‖ [Client | Channel | Reason | When] rows=2; numeric cols align: n/a
- Metric-ish elements: "Cash Collected$0.01 Funded0 Cl"@16px, "Cash Collected$0.01"@16px, "$0.01"@28px/tnum, "Funded0"@16px, "0"@28px/tnum, "Close Rate— — show rate"@16px, "—"@28px/tnum, "— show rate"@11px/tnum, "Cost / Funded—"@16px, "—"@28px/tnum

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: div.kpi-tile, div.kpi-label, div.kpi-value, div, div.section, div.section-title · text under 11px: 4 · api fails: 1

## Click sweep
- skipped: --no-clicks
