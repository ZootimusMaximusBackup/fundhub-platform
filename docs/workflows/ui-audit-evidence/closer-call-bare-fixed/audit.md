# UI audit evidence — closer-call-bare-fixed as closer@fundhub.ai

Ran 2026-08-17T17:44:34.083Z against https://fundhub.ai. Login ok (role closer). Screen /app/closer-call.html → HTTP 200, final /app/closer-call.html, title "Closer · Call cockpit".

Shots: docs/workflows/ui-audit-evidence/closer-call-bare-fixed/1440-fold.png · docs/workflows/ui-audit-evidence/closer-call-bare-fixed/1440-full.png · docs/workflows/ui-audit-evidence/closer-call-bare-fixed/390-full.png

## Load
- API calls: 3; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 1264px (fold 900) · content width 1440px (div) · sidebar 228px
- Top-left element: div "Open this cockpit from the pipeline with a client selected — ?client_id= is requ"
- H1: Loading… · H2s: —
- Nav: 5 visible items · active: ☎Call cockpit · groups: Sales▾(5), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (12): 24px×3, 22px×7, 14px×6, 13px×24, 12.5px×21, 12px×8, 11.5px×5, 11px×9, 10.5px×2, 10px×2, 9.5px×23, 9px×6
- Primary-looking (filled) buttons: 4 — "Join call", "Present", "Save · next call", "Chat"
- Generic labels: none · targets under 40px: 15
- Off-8px-scale spacing values: 1px×3, 14px×6, 15px×2, 22px×3
- Uneven card rows: top 104: [1212,201,201,201,201,201,201]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Live numbers only — no sample funding story. | No sample story. Live survey + pull only.
- Loading wording after settle: Loading…
- Error wording: none
- Empty-state wording: none
- Tables: [] rows=5; numeric cols align: n/a ‖ [] rows=5; numeric cols align: n/a
- Metric-ish elements: "Cash today — — Calls held — — "@14px, "Cash today — —"@14px, "Calls held — —"@14px, "Close rate — —"@14px, "Commission MTD — see My number"@14px, "Pace to target — —"@14px, "Unlogged — clear before next c"@14px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 34 · api fails: 0

## Click sweep
- 15 clicked of 15 candidates (cap 80) · tally: NOOP=13, OK=2

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Present" | 73×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call-bare-fixed/clicks/01-NOOP-Present.png |
| 2 | button "1Deposit" | 85×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call-bare-fixed/clicks/02-NOOP-1Deposit.png |
| 3 | button "2Downsell" | 94×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call-bare-fixed/clicks/03-NOOP-2Downsell.png |
| 4 | button "3Callback" | 91×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call-bare-fixed/clicks/04-NOOP-3Callback.png |
| 5 | button "4No show" | 92×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call-bare-fixed/clicks/05-NOOP-4No_show.png |
| 6 | button "5Not a fit" | 87×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call-bare-fixed/clicks/06-NOOP-5Not_a_fit.png |
| 7 | button "Price" | 58×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call-bare-fixed/clicks/07-NOOP-Price.png |
| 8 | button "Amount low" | 98×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call-bare-fixed/clicks/08-NOOP-Amount_low.png |
| 9 | button "Spouse" | 72×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call-bare-fixed/clicks/09-NOOP-Spouse.png |
| 10 | button "Timing" | 68×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call-bare-fixed/clicks/10-NOOP-Timing.png |
| 11 | button "Wants guarantee" | 128×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call-bare-fixed/clicks/11-NOOP-Wants_guarantee.png |
| 12 | button "None" | 60×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call-bare-fixed/clicks/12-NOOP-None.png |
| 13 | button "Save · next call" | 117×31 | NOOP |  | docs/workflows/ui-audit-evidence/closer-call-bare-fixed/clicks/13-NOOP-Save_next_call.png |
| 14 | button "Search⌘K" | 99×36 | OK |  |  |
| 15 | button "Chat" | 52×52 | OK |  |  |
