# Live re-verify — sales desk (closer + sales manager) — 2026-08-17 20:12–20:17Z

Live `https://fundhub.ai`. Harness `--no-clicks`. All 10 loads HTTP 200, 0 retries, 0 API fails.

Screens: closer-dashboard · closer-dashboard-client · closer-call · closer-call-client · my-numbers · contracts · sales-floor · calendar · present-client · pipeline.

| Line | Screen | Expected | Live | Verdict |
|---|---|---|---|---|
| 275 | closer-dashboard.html (bare) | Rail ★ Closer Dashboard leads with today's calls; tiles show numbers or do not render | CD-01 Today's Pipeline is first (Rick 10:00 AM, Selwyn 1:00 PM). No empty KPI tiles. | **HOLDS** |
| 276 | closer-dashboard.html (bare) | Without a client, calculators hidden; only the gate shows | CD-02 reads "Open from a client." No calculator inputs. | **HOLDS** |
| 277 | closer-dashboard.html (bare) | Tile values dominate; nothing under 11px; the number that matters top-left | 11 sizes including 7.5 / 9.5 / 10 / 10.5px. Top-left is the header + "TEST — Closer Role", not a number. | **DOES-NOT-HOLD** |
| 278 | closer-dashboard.html?client_id=TEST | Inputs change an answer or do not render | Deal Math / Funding inputs are on screen (deposit, fee, draw). `--no-clicks` — no type-to-change proof this run. | **UNVERIFIED** |
| 279 | closer-dashboard.html?client_id=TEST | With a client, the screen says who it is calculating for | Calculators headed "TEST Client Role". | **HOLDS** |
| 281 | closer-call.html?client_id=TEST | Join call opens a link or is hidden; disabled is not the filled primary | Join call `disabled:true`, `filled:false`, grey `rgb(252,252,252)`, 77×31. Filled primaries are Save + Chat. | **HOLDS** |
| 282 | closer-call.html?client_id=TEST | One filled button; primary not covered | Two filled: "Save · next call" and "Chat". | **DOES-NOT-HOLD** |
| 283 | closer-call.html?client_id=TEST | Next call is first; buttons ≥40px | First row is Cash today / Calls held / Close rate. 15 targets under 40px (Join/Present/Save all 31px). Up Next says no booked calls. | **DOES-NOT-HOLD** |
| 285 | closer-call.html (bare) | Shift chip is real; never tells a signed-in user they are not signed in | Chip "NO OPEN SHIFT". No "not signed in" copy. | **HOLDS** |
| 287 | closer-call.html (bare) | Loading gone after settle; `needs ?client_id=` notice readable | No Loading. Bare URL auto-opened Rick Rockwell (`/api/read/closer-call?client_id=ca2bc6c4-…`). No `needs ?client_id=` notice. | **DOES-NOT-HOLD** |
| 288 | my-numbers.html | Owed-by-you rows open the call; list says how many | 10 owed rows link to `closer-call.html?client_id=…`. Full shot: "10 of 14". | **HOLDS** |
| 289 | my-numbers.html | Overdue work says how overdue, in words | "5d overdue" / "Held window ended Aug 12, 5:30 PM". No GMT object. | **HOLDS** |
| 290 | my-numbers.html | If the screen promises a comparison, the tiles carry one | Header "THIS MONTH vs last month". Only Deposits closed has "was 0". Close rate / show rate / downsells / funded have none. | **DOES-NOT-HOLD** |
| 291 | my-numbers.html | Human dates | Held-window lines are "Aug 12, 5:30 PM" style. | **HOLDS** |
| 292 | my-numbers.html | The 'vs your 90-day average' section shows one | No "90-day average" copy on this run. | **HOLDS** |
| 293 | my-numbers.html | Empty panels tell the closer what will appear; text not repeated | Empties speak in build notes (`staff_targets`, `funding_rounds.funded_amount`, `/api/read/my-numbers`, "not stored yet"). | **DOES-NOT-HOLD** |
| 295 | contracts.html | Closer never sees a button whose API call the closer is refused | Visible controls: filter, rows, Search, Sign out, Chat. No owner mail-blast / send-waiting button. | **HOLDS** |
| 296 | contracts.html | A button that emails clients confirms first, naming who | Closer still has no email-clients button, so nothing fires without confirm. | **HOLDS** |
| 297 | contracts.html | First tile + help card are closer work (send from the call, watch signatures) | First tile Waiting 4 "sent, not signed yet". Help: "Send from the call." | **HOLDS** |
| 299 | sales-floor.html | Top-left is today's held/booked/closed vs a target | Hero: Booked 0 · Held 0 · "No daily sales_manager target in staff_targets" (named, not invented). | **HOLDS** |
| 300 | sales-floor.html | A verdict line describes the numbers | "No deposits this month. The funnel above is the month so far." | **HOLDS** |
| 301 | sales-floor.html | Flag-to-marketing names what it flags; hidden when nothing to flag; route admits the role | HTTP 200 as sales_manager. No Flag button. Copy only: "Flag a belief x source pattern to marketing." | **HOLDS** |
| 302 | sales-floor.html | Each empty panel explains itself once | "No daily sales_manager target in staff_targets" is on the hero twice. | **DOES-NOT-HOLD** |
| 304 | calendar.html | Then = after Up Next; past work not shown as upcoming; >24h has a date | Then: "Nothing else dated after Up Next." Up Next is Rick, labeled "197 minutes overdue" (not as future). Times are today. | **HOLDS** |
| 305 | calendar.html | Who's on today = real clocked-in staff; screens agree | "Nobody clocked in right now." Sales-floor: "0 closers on shift". No DEMO staff. | **HOLDS** |
| 306 | calendar.html | Sales manager sees the live schedule only | Footer control "Demonstration states: double-booking alert · empty day · open hour". | **DOES-NOT-HOLD** |
| 307 | calendar.html | Toolbar ≥40px; Join Call only when a link exists | Day/Week/Today 24px. Join Call shown, `disabled:true`, `href:null`, 32px tall. | **DOES-NOT-HOLD** |
| 309 | closer-call.html (both) | Before-you-close checklist records the confirm, or does not render | Checklist is on both 1440-fold shots. `--no-clicks` — no Save POST proof. | **UNVERIFIED** |
| 310 | calendar.html vs closer-dashboard.html | Both clocks agree; an appointment time names its zone | Both headers EDT (4:12 vs 4:16). Pipeline rows are "10:00 AM" / "1:00 PM" with no zone. | **DOES-NOT-HOLD** |
| 311 | present.html?client_id | Client on screen-share never reads an internal name or build note | Client pane: "Your numbers are not on this file yet". No `crs_results` / file:line. | **HOLDS** |
| 312 | pipeline.html | Archive only after a contact is selected; not next to filters | Toolbar is Search + Filter + "16 cards". No Archive control in the DOM. | **HOLDS** |
| 313 | pipeline.html | ≤4 text sizes | 5 sizes: 14 / 13 / 12 / 11 / 10px. | **DOES-NOT-HOLD** |
| 317 | present.html?client_id=TEST | ≥40px hit areas; one filled button | 9 targets under 40px (slide chips 24px; Next screen 32px). Two filled: "01" and "Next screen". | **DOES-NOT-HOLD** |

## Evidence

| Slug | Ran | Fold |
|---|---|---|
| `_reverify-live/closer-dashboard` | 20:12:15Z | `docs/workflows/ui-audit-evidence/_reverify-live/closer-dashboard/1440-fold.png` |
| `_reverify-live/closer-dashboard-client` | 20:12:58Z | `docs/workflows/ui-audit-evidence/_reverify-live/closer-dashboard-client/1440-fold.png` |
| `_reverify-live/closer-call` | 20:13:14Z | `docs/workflows/ui-audit-evidence/_reverify-live/closer-call/1440-fold.png` |
| `_reverify-live/closer-call-client` | 20:13:47Z | `docs/workflows/ui-audit-evidence/_reverify-live/closer-call-client/1440-fold.png` |
| `_reverify-live/my-numbers` | 20:14:33Z | `docs/workflows/ui-audit-evidence/_reverify-live/my-numbers/1440-fold.png` |
| `_reverify-live/contracts` | 20:15:20Z | `docs/workflows/ui-audit-evidence/_reverify-live/contracts/1440-fold.png` |
| `_reverify-live/sales-floor` | 20:15:56Z | `docs/workflows/ui-audit-evidence/_reverify-live/sales-floor/1440-fold.png` |
| `_reverify-live/calendar` | 20:16:31Z | `docs/workflows/ui-audit-evidence/_reverify-live/calendar/1440-fold.png` |
| `_reverify-live/present-client` | 20:17:15Z | `docs/workflows/ui-audit-evidence/_reverify-live/present-client/1440-fold.png` |
| `_reverify-live/pipeline` | 20:17:52Z | `docs/workflows/ui-audit-evidence/_reverify-live/pipeline/1440-fold.png` |

This file: `docs/workflows/ui-audit-evidence/_reverify-live/sales-desk/verify.md`

Tally: **19 HOLDS · 12 DOES-NOT-HOLD · 2 UNVERIFIED**. No app edits.
