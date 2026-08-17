# UI audit evidence — messaging-mlfix as advisor@fundhub.ai

Ran 2026-08-17T19:35:51.538Z against https://fundhub.ai. Login ok (role funding_advisor). Screen /app/messaging.html → HTTP 200, final /app/messaging.html, title "Fundhub — Messaging".

Shots: docs/workflows/ui-audit-evidence/messaging-mlfix/1440-fold.png · docs/workflows/ui-audit-evidence/messaging-mlfix/1440-full.png · docs/workflows/ui-audit-evidence/messaging-mlfix/390-full.png

## Load
- API calls: 4; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "Fundhub / Messaging Org: Fundhub Mon, Aug 17, 3:35:58 PM EDT LIVE"
- H1: — · H2s: —
- Nav: 5 visible items · active: ✉Messaging · groups: Sales▾(0), Funding▾(0), Client ops▾(5), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (5): 14px×24, 13px×1, 12px×1, 11px×11, 10px×1
- Primary-looking (filled) buttons: 3 — "Needs reply 0", "Send", "Chat"
- Generic labels: none · targets under 40px: 2
- Off-8px-scale spacing values: 11px×1, 13px×1, 10px×1, 14px×1
- Uneven card rows: top 48: [288,622,300]
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: none
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: none
- Tables: none
- Metric-ish elements: "fundhub-messaging · v1 org: fu"@11px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: none · text under 11px: 1 · api fails: 0

## Click sweep
- skipped: --no-clicks
