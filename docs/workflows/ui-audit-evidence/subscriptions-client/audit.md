# UI audit evidence — subscriptions-client as owner@fundhub.ai

Ran 2026-08-17T06:26:21.297Z against https://fundhub.ai. Login ok (role owner). Screen /app/subscriptions.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521 → HTTP 200, final /app/subscriptions.html?client_id=8556bedc-46e1-4d85-b0cd-a24adfee1521, title "Fundhub — Subscriptions".

Shots: docs/workflows/ui-audit-evidence/subscriptions-client/1440-fold.png · docs/workflows/ui-audit-evidence/subscriptions-client/1440-full.png · docs/workflows/ui-audit-evidence/subscriptions-client/390-full.png

## Load
- API calls: 7; failing: none
- Console errors: none

## DOM read (1440×900)
- Page height 11034px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: div "Beta — under development. Data may be incomplete or inaccurate. Do not use for c"
- H1: Subscriptions / Subscriptions / Payment links · H2s: —
- Nav: 33 visible items · active: ◍SubscriptionsBETA · groups: Sales▾(6), Funding▾(4), Client ops▾(5), Watch▾(3), Automation▾(4), Marketing▾(4), Admin▾(5), Portals▾(2)
- Font sizes in use (7): 22px×2, 14.5px×1, 13px×11, 12px×7, 11px×6, 10.5px×1, 10px×3
- Primary-looking (filled) buttons: 4 — "Record this plan", "Put this card on file", "Create payment link", "Chat"
- Generic labels: none · targets under 40px: 4
- Off-8px-scale spacing values: none
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: Leave the price empty if nobody has decided it yet. It is recorded as unknown and shown as an em dash — not as zero, whi
- Tables: none
- Metric-ish elements: none

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 32 · api fails: 0

## Click sweep
- 8 clicked of 8 candidates (cap 80) · tally: OK=2, GONE=3, NOOP=3

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | button "Dismiss" | 64×19 | OK |  |  |
| 2 | a "← Command Center" | 63×42 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 3 | a "← Client hub" | 35×42 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 4 | button "Record this plan" | 71×56 | GONE | control not visible on re-locate (DOM changed after an earlier click) |  |
| 5 | button "Put this card on file" | 56×80 | NOOP |  | docs/workflows/ui-audit-evidence/subscriptions-client/clicks/05-NOOP-Put_this_card_on_file.png |
| 6 | button "Create payment link" | 81×56 | NOOP |  | docs/workflows/ui-audit-evidence/subscriptions-client/clicks/06-NOOP-Create_payment_link.png |
| 7 | button "Search⌘K" | 99×36 | OK |  |  |
| 8 | button "Chat" | 52×52 | NOOP |  | docs/workflows/ui-audit-evidence/subscriptions-client/clicks/08-NOOP-Chat.png |
