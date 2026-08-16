# CRM honest — 2026-08-16

Owner: Chris. Dashboards must be real. They/them copy. Chris Stanbridge is the closer.
Prove client: `9af65808-a619-4e65-ae91-239766a006b7` (Chris ProveFunding, `stanbridgejchris@gmail.com`, `+16616180865`).
Org: `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6`.
Do not invent scores. TransUnion stays off. Do not delete staff rows. Do not commit `.env`.

## Tasks

| ID | Owner | Status | Files |
|---|---|---|---|
| calendar-real | this session | done | `public/app/calendar.html`, `e2e/calendar.spec.mjs`, `e2e/controls-persist.spec.mjs` |
| closer-chris | closer-chris | done | `public/app/sales-floor.html`, `public/app/sales-floor.js`, `src/sales/metrics.mjs`, `src/sales/metrics.test.mjs`, `e2e/sales-dashboards.spec.mjs` |
| contracts-split | contracts-split | done | `public/app/contracts.html`, `public/app/contract-send.js`, closer-call / present send |
| ccp-live | this session | done | `public/app/client-control-panel.html`, `src/http/crm-html.test.mjs` |
| present-deck-prove | this session | done | live sends 200; soft-pull / e-book / pay-link email `sent` via Resend; letters delivered. SMS still queued. Ship of other CRM-honest HTML is next-stack unit 0. |

Claim by writing your id next to the task before you edit. Write a manifest when done.

## Shared brief

- Calendar top date / week strip / Booked 10 are July sample. Today’s list is real tasks. Who’s-on font is broken. His file → Client file. No UUID dump. Then rows must be clickable.
- Sales floor still lists demo closers. Show Chris Stanbridge only. Kill Devon coaching copy. Live numbers or dashes.
- Contracts page = make wordings. Send from Present / closer cockpit.
- Client control panel: no Derek / Marcus / voided check. Bind `/api/dashboard/client`.
- Present deck: fill apply-survey fields on the prove client, then prove every send (soft pull, e-book, pay link, letters). Emails to Chris’s Gmail.

## Manifest — calendar-real

Status: done. Did not invent bookings. Empty day stays empty.

Files:
- `public/app/calendar.html` — July sample week, day list, clock, and 10 / 3 / 75% tiles are gone. Date, Today, and the week strip use the real week. Chips and the day list come from dated rows on `GET /api/tasks` (open + done). Then rows load that appointment in Up Next. “His file” is “Client file” and opens `client-control-panel.html?client_id=` when a client is on the task. Join Call stays off until a real meeting URL exists. Before you dial shows the task title, never an id code. Who’s on today uses Inter (name on one line, role + since on the next).
- `e2e/calendar.spec.mjs` — today vs July sample, live counts, Then click, no id-code dump, Client file URL, Join Call still off without a meeting link.
- `e2e/controls-persist.spec.mjs` — Client file URL matches `?client_id=`.

Live vs dash:

| Tile / block | Source |
|---|---|
| Date, clock, Today, week days | Real calendar |
| Week chips + day list | Dated `/api/tasks` (or empty) |
| Booked / Done / Left today | Count of those dated tasks |
| No-show | Dash — a task row has no no-show flag |
| Show rate | Dash — needs no-show |
| Up Next / Then / briefing | Dated tasks; title only |
| Join Call | On only when `meeting_url` (or `join_url`) is set |
| Client file | On only when `client_id` is set |
| Who’s on today | `/api/shifts?roster=1` |

Journeys: no calendar journey files exist. Did not edit `-actual.md` or CHANGELOG.

Playwright: 16/16 on calendar + persist Client file + coverage roster + mobile smoke.

Did not edit sales-floor, contracts, or client-control-panel.

## Manifest — closer-chris

Status: done. Staff rows were filtered, not deleted.

Files:
- `public/app/sales-floor.html` — removed Marcus Webb / Elena Voss / Devon Marsh rows and the “Devon isn't lazy” note. Roster header stays; live JS fills the rows.
- `public/app/sales-floor.js` — empty state is “No closers on this board”; missing action is a dash.
- `src/sales/metrics.mjs` — `closerRoster` includes Chris Stanbridge even when `staff.role` is owner. Drops demo / sandbox / test names (`is_demo`, name/email patterns). Cash / close / funded come from `call_outcomes` or null (dash).
- `src/sales/metrics.test.mjs` — roster filter tests.
- `e2e/sales-dashboards.spec.mjs` — board shows Chris, not sample names.

What the live “Your closers” table will show (one row):

| Closer | Shift | Calls | Close | Funded | Cash | Do this |
|---|---|---|---|---|---|---|
| Chris Stanbridge | Off shift | 2 | 0% | — | $2 | — |

Those numbers are live: two downsells logged today, $1 each, no deposits. Close is 0% because 0 deposits / 2 calls. Funded and Do this are dashes because there is not enough live data.

Hidden (still in the staff table, not shown): Jordan Blake, Nina Castellano, CRS Sandbox Smoke, TEST — Closer Role, DEMO Closer.

Journeys: no new routes. Did not edit calendar.html, contracts.html, or client-control-panel.html.

## Manifest — ccp-live

Status: done.

Files:
- `public/app/client-control-panel.html` — no Derek / Marcus / voided check / Funding Round #2 / fake Equifax fail. Name, next action, blockers, income, rounds, scores, hold, and links bind from `GET /api/dashboard/client`. Missing field = dash. Fake pull/upload timers gone. Messaging opens `messaging.html?client_id=` so a known file does not fall back to the empty inbox.
- `src/http/crm-html.test.mjs` — fails if Dana Reyes, Derek Owusu, Marcus Webb, or "voided check" appear in `client-control-panel.html` or `closer-call.html`. Also fails if simulated `data-act` / Pull Equifax / Funding Round #2 come back.

Did not edit calendar.html, sales-floor.html, or contracts.html.

Hard-refresh of the prove client panel (`/app/client-control-panel.html?id=9af65808-a619-4e65-ae91-239766a006b7`) after this ships should show:

| Field | Live value |
|---|---|
| Name | Chris ProveFunding |
| Email / key | stanbridgejchris@gmail.com |
| Phone | +16616180865 |
| Main status | Diagnostic paid |
| Prequal / total approved | — |
| Open inquiries / inquiry removal / funding round | — |
| Scores | EX 464 · EQ 462 · TU — |
| Next action | — |
| On hold | Awaiting CRS |
| Blockers | On hold: Awaiting CRS, plus three open tasks titled “Fix UnderwriteIQ mapping — critical fields missing” |
| Income (Experian) | $97,000/yr |
| Income (Equifax) | $81,000/yr |
| Tier | MANUAL_REVIEW |
| Path | Funding |
| Credit status | Complete |
| Last credit pull | Aug 16, 2026, 2:37 AM EDT |
| Funded | No |
| Banner | live file · Chris ProveFunding · 1 payment · 3 messages |

TU is a dash (not invented). No sample person anywhere on the page.

## Manifest — contracts-split

**COMPLIANCE REVIEW REQUIRED** — contracts, send, payment-adjacent.

Status: done.

Send now lives on the **call cockpit** and **Present**. Not on the Contracts wording page.

How to send:
1. Open the client on `closer-call.html?client_id=…` and press **Send contract** (next to Present). Pick a wording, press Send, copy the sign link.
2. Or in Present, on the close screen (S-23), press **Send contract**. Same pick → send → copy.

That path reuses `POST /api/contracts` (`create_draft` then `send`). The existing notifier still emails if mail is on. No new mail provider.

Files:
- `public/app/contracts.html` — removed the “Send a contract” form and client picker. Kept wording list, upload PDF, new wording, in-use/archive, sent-queue view, void, download, reminders. Footer reports `live wordings · N` even when the queue is empty, so live wordings never show “showing sample markup”.
- `public/app/contract-send.js` — shared helper. Lists in-use wordings, drafts + sends, copies the link.
- `public/app/closer-call.html` / `public/app/closer-call.js` — Send contract for this client.
- `public/app/present.html` / `public/app/present.js` — Send contract on the close screen.
- `src/chat/platform-help.mjs` — help text now points at the call cockpit.
- Tests: `src/http/contracts-screen.test.mjs`, `src/http/contract-send.test.mjs`, `src/http/closer-deck-present.test.mjs`.

Did not edit calendar.html, sales-floor, or client-control-panel.

Journeys: no new routes. Lint clean. Unit tests for this split: 62 pass.


