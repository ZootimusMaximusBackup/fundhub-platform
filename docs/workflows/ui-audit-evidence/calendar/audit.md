# UI audit evidence — calendar as sales@fundhub.ai

Ran 2026-08-17T15:52:22.130Z against https://fundhub.ai. Login ok (role sales_manager). Screen /app/calendar.html → HTTP 200, final /app/calendar.html, title "Fundhub — Calendar".

Shots: docs/workflows/ui-audit-evidence/calendar/1440-fold.png · docs/workflows/ui-audit-evidence/calendar/1440-full.png · docs/workflows/ui-audit-evidence/calendar/390-full.png

## Load
- API calls: 6; failing: none
- Load retries because of 503/bounce (dev-server flakiness, not a screen finding): 0 at first open · 0 across the whole run
- Console errors: none

## DOM read (1440×900)
- Page height 900px (fold 900) · content width 1440px (div.app) · sidebar 228px
- Top-left element: header "Fundhub / Calendar Org: Fundhub Mon, Aug 17, 8:53:22 AM LIVE"
- H1: — · H2s: —
- Nav: 4 visible items · active: ▦Calendar · groups: Sales▾(4), Funding▾(0), Client ops▾(0), Watch▾(0), Automation▾(0), Marketing▾(0), Admin▾(0)
- Font sizes in use (14): 22px×1, 16px×1, 15px×1, 14px×2, 13px×8, 12.5px×2, 12px×17, 11.5px×11, 11px×14, 10.5px×19, 10px×17, 9.5px×14, 9px×10, 8.5px×6
- Primary-looking (filled) buttons: 2 — "Client file", "Chat"
- Generic labels: none · targets under 40px: 10
- Off-8px-scale spacing values: 7px×3, 11px×5, 6px×3, 14px×1
- Uneven card rows: none detected
- ALL-CAPS runs: 0 · centered paragraphs: 0
- Sample/demo/beta wording: DEMO Admin | DEMO Closer | DEMO Funding Advisor | DEMO Inquiry Specialist | DEMO Owner | DEMO Sales Manager | DEMO Setter
- Loading wording after settle: none
- Error wording: none
- Empty-state wording: double-booking alert · empty day · open hour
- Tables: none
- Metric-ish elements: "Booked2 Done0 No-show— Show ra"@16px, "Booked2"@16px, "Done0"@16px, "No-show—"@16px, "Show rate—"@16px, "Left today2"@16px, "16"@11.5px, "17"@11.5px, "18"@11.5px, "19"@11.5px

## Mobile (390×844)
- Horizontal overflow: no · sidebar visible true (228px) · burger true · elements past right edge: div.stat-tiles, div.stat, div.l, div#statNoshow.v, div.stat, div.l · text under 11px: 65 · api fails: 0

## Click sweep
- 24 clicked of 24 candidates (cap 80) · tally: OK=21, NOOP=3

| # | Control | Size | Result | What happened | Shot |
|---|---|---|---|---|---|
| 1 | div "Sun163 booked10:30Karl Elliott12:00Adam Denoto+1 more" | 115×44 | OK |  |  |
| 2 | div "Mon172 booked · 2 left10:00Rick Rockwell1:00Selwyn Mcintosh" | 115×44 | OK |  |  |
| 3 | div "Tue18—Nothing booked." | 115×44 | OK |  |  |
| 4 | div "Wed19—Nothing booked." | 115×44 | OK |  |  |
| 5 | div "Thu20—Nothing booked." | 115×44 | OK |  |  |
| 6 | div "Fri21—Nothing booked." | 115×44 | OK |  |  |
| 7 | div "Sat22—Nothing booked." | 115×44 | OK |  |  |
| 8 | button "Client file" | 76×32 | NOOP |  | docs/workflows/ui-audit-evidence/calendar/clicks/08-NOOP-Client_file.png |
| 9 | div "10:30Sarah BlanksteinStrategy session booked" | 308×43 | OK |  |  |
| 10 | div "11:00Vinesh LochanStrategy session booked" | 308×43 | OK |  |  |
| 11 | div "11:00William BoldenStrategy session booked" | 308×43 | OK |  |  |
| 12 | div "3:30Samone KendrickStrategy session booked" | 308×43 | OK |  |  |
| 13 | div "5:00Cory CarlsonStrategy session booked" | 308×43 | OK |  |  |
| 14 | div "6:00Juan GarciaStrategy session booked" | 308×43 | OK |  |  |
| 15 | div "9:30Anthony KiveshStrategy session booked" | 308×43 | OK |  |  |
| 16 | div "11:00Kalaya SirimitrStrategy session booked" | 308×42 | OK |  |  |
| 17 | button "Demonstration states double-booking alert · empty day · open" | 1212×25 | OK |  |  |
| 18 | button "Search⌘K" | 99×36 | OK |  |  |
| 19 | button "Chat" | 52×52 | OK |  |  |
| 20 | span "Day" | 50×24 | NOOP |  | docs/workflows/ui-audit-evidence/calendar/clicks/20-NOOP-Day.png |
| 21 | span "Week" | 60×24 | OK |  |  |
| 22 | div "‹" | 24×24 | OK |  |  |
| 23 | div "›" | 24×24 | OK |  |  |
| 24 | div "Today" | 55×24 | NOOP |  | docs/workflows/ui-audit-evidence/calendar/clicks/24-NOOP-Today.png |
