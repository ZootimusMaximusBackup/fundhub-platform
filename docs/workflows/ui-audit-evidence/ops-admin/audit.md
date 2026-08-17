# UI audit evidence — ops-admin as owner@fundhub.ai

Ran 2026-08-17T06:15:11.562Z against https://fundhub.ai. Login ok (role owner). Screen /app/ops-admin.html → HTTP 200, final /app/ops-admin.html, title "Fundhub — Ops & Admin".

Shots: docs/workflows/ui-audit-evidence/ops-admin/1440-fold.png · docs/workflows/ui-audit-evidence/ops-admin/1440-full.png · docs/workflows/ui-audit-evidence/ops-admin/390-full.png

## Load
- API calls: 10; failing: POST /api/messages-outbound → 599
- Console errors: Failed to load resource: the server responded with a status of 599 (Unknown)

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: — · H2s: —
- Nav: 33 visible items · active: ⚙Ops & AdminBETA · groups: Sales▾(6), Funding▾(4), Client ops▾(5), Watch▾(3), Automation▾(4), Marketing▾(4), Admin▾(5), Portals▾(2)
- Font sizes in use (12): 18px×6, 16px×1, 13.3333px×5, 13px×3, 12.5px×3, 12px×9, 11px×9, 10.5px×12, 10px×7, 9.5px×14, 8px×1, 7.5px×1
- Primary-looking (filled) buttons: 7 — "Last 7 Days — Jul 20–26▾", "Turn ON", "MoneyKPIs · AR · compliance", "Send what is waiting", "Pause sending", "Email unsent invoices", "Chat"
- Generic labels: none · targets under 40px: 13
- Off-8px-scale spacing values: 14px×3, 9px×6, 11px×7, 2px×1, 13px×1
- Uneven card rows: top 280: [1164,226,226,226,226,226]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions. | DEMO MODE | OFF — demo rows are hidden. Turn on to seed fictional clients for demos and training. | Open Demo Mode screen →
- Loading wording after settle: none
- Error wording: failed events awaiting retry
- Empty-state wording: none
- Tables: [Client | Invoice | Days Overdue | Status] rows=2; numeric cols align: n/a ‖ [Client | Channel | Reason | When] rows=2; numeric cols align: n/a
- Metric-ish elements: "Cash Collected— Funded— Close "@16px, "Cash Collected—"@16px, "—"@18px, "Funded—"@16px, "—"@18px, "Close Rate— — show rate"@16px, "—"@18px, "— show rate"@10px, "Cost / Funded—"@16px, "—"@18px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: div.kpi-tile, div, div.section, div.section-title, span, table#compliance-blocked-table.admin · text under 11px: 59 · api fails: 1

## Click sweep
- 14 clicked of 14 candidates (cap 80) · tally: NOOP=3, OK=3, WRITE-INTERCEPTED=2, NAV=1, GONE=5

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | NOOP |  | docs/workflows/ui-audit-evidence/ops-admin/clicks/01-NOOP-Dismiss.png |
| 2 | button "Last 7 Days — Jul 20–26▾" | 152×34 | OK |  |  |
| 3 | button "Turn ON" | 80×35 | WRITE-INTERCEPTED | POST /api/demo/mode 599 · WRITE POST /api/demo/mode {enabled} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/ops-admin/clicks/03-WRITE-INTERCEPTED-Turn_ON.png |
| 4 | button "Turn OFF" | 89×37 | WRITE-INTERCEPTED | POST /api/demo/mode 599 · WRITE POST /api/demo/mode {enabled} · console: Failed to load resource: the server responded with a status of 599 (Unknown) | docs/workflows/ui-audit-evidence/ops-admin/clicks/04-WRITE-INTERCEPTED-Turn_OFF.png |
| 5 | a "Open Demo Mode screen →" | 168×15 | NAV | → /app/sample-data.html · GET /api/auth/session 200; GET /api/demo/mode 200; GET /api/health 200; GET /api/org-brand 200; GET /api/demo/mode 200 |  |
| 6 | button "MoneyKPIs · AR · compliance" | 188×29 | NOOP |  | docs/workflows/ui-audit-evidence/ops-admin/clicks/06-NOOP-MoneyKPIs_AR_compliance.png |
| 7 | button "Peoplestaff, comp & consent" | 185×29 | OK |  |  |
| 8 | button "Send what is waiting" | 138×21 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 9 | button "Pause sending" | 104×21 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 10 | button "Email unsent invoices" | 145×21 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 11 | summary "› Affiliates + Hiring — referrals · — paid out · — applicant" | 1162×40 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 12 | a "Open Affiliates ↗" | 111×22 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 13 | button "Search⌘K" | 99×36 | NOOP |  | docs/workflows/ui-audit-evidence/ops-admin/clicks/13-NOOP-Search_K.png |
| 14 | button "Chat" | 52×52 | OK |  |  |
