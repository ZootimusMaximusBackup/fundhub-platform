# G5 report — background jobs, calendar, bank-app launcher

Date: 2026-08-18  
Live site: https://fundhub.ai  
Ground truth: **MISSING** for G5a, G5b, and G5c. Scored only against this board.  
No app code, config, env, tests, or journeys were changed. The background-job key was not turned on or off. No test job was sent. No real booking was made. No bank form was filed.

Evidence folder: `docs/workflows/audit-gaps-2026-08-18-evidence/g5/`

---

## G5a — Background jobs

**What you asked:** Are the jobs on? Have they ever run? Do not flip the key.

### Count

- **53** jobs are defined in `src/workflows/` (`inngest.createFunction`).
- **51** are on the serve list (`src/workflows/index.mjs` → `/api/inngest`).
- **2** are written but **not** on that list:
  - `s-02-incomplete-survey-nudge` (listens for `entry.captured` — that event has **400** live rows)
  - `inquiry-call-sweeper` (timer every 15 minutes)

The old “47 jobs” number is stale. The test in the repo pins **51**.

List: `inventory.json`

### The mail sweeper

`message-dispatch-sweeper` **is registered**. The old note that it was “defined and not registered” is no longer true.

It is a timer (`*/5 * * * *`), not an event name. The events table has no row for a timer, so the automations screen marks it **never_triggered**. That does **not** prove the timer never ran. I did not send a test job to find out.

### Is the switch on?

I did not set the key. I only checked the name.

- Local `.env`: name `INNGEST_EVENT_KEY` is present and not empty.
- Live Netlify production: that **name** is present.
- Live staff API `GET /api/read/workflows`: every listed job says `engine_active: true`.
- Live `GET` and `HEAD` `https://fundhub.ai/api/inngest` both return **401** `{"message":"Unauthorized"}`. That means the door is there and locked. It is not a 404.

So the owner switch looks **already on**.

The automations screen says **42 live** and **9 never_triggered**. “Live” here only means: the key is on, and a matching row exists in the `events` table. It is **not** proof the background-job service actually ran the job. I did not open that service’s run log, and I did not send a test event.

Evidence: `env-presence.json`, `live.json`, `follow.json`

### Events in the live database

The `events` table is our own log. A row is written even if the background-job service never wakes.

| Event name | Live rows | Jobs that listen and have never seen it |
|---|---|---|
| entry.captured | 400 | (s-02 listens but is not registered) |
| survey.submitted | 267 | — |
| booking.created | 30 | — |
| analysis.completed | 9 | — |
| round.started / submitted / approved | 5 / 5 / 5 | — |
| payment.received | 4 | — |
| diagnostic.paid | 3 | — |
| round.funded | 3 | — |
| call.completed | 1 | — |
| booking.noshow | 1 | — |
| deposit.paid | **0** | `c-02b-inquiry-removal-requested`, `s-06-post-call-funding-purchased` |
| inquiry.removed | **0** | `c-03-inquiry-removed-resume-or-hold` |
| message.inbound | **0** | `dpc-03-inbound-reply-router` |
| mail.response | **0** | `f-09-funding-declined-no-path`, `f-11-bank-email-event-router` |
| docs.received | **0** | (with mail.response) `f-06-funding-conditions-missing-docs` |

Seven registered jobs have **never** seen their event in this table.

Two registered timer jobs (`message-dispatch-sweeper`, `contract-chaser`) also show never_triggered, because timers do not write an `events` row.

Evidence: `db.json`

### G5a score

- Switch on: **observed** (live API + 401 on the serve door). Not a PASS that jobs ran.
- Jobs actually ran in the background-job service: **UNVERIFIED**. Proving that would need that service’s run history or a test event. Both were out of bounds.
- Seven jobs: event has **never** been written. They cannot have run from a live event.

---

## G5b — Calendar as a real booking

**What you asked:** Owner calendar. Real bookings or only demo text? Do not book a real person.

### There is no bookings table

Live tables that look booking-related: `events`, `tasks`, `call_outcomes`, `webhook_captures`. No `bookings` table. `v_partner_book` exists and has **0** rows.

The calendar page reads **tasks with a due date** from `GET /api/tasks`.

### What is in the database

- **30** `booking.created` rows.
  - **26** source `clickfunnels` (apply-funnel book).
  - **4** source `gauntlet` / `gauntlet-all` / `sim` (test probes). Idempotency prefix `inngest-probe`.
  - **0** source `calcom`.
- **0** webhook rows from Cal.com. **418** webhook rows from ClickFunnels.
- **15** tasks titled “Strategy session booked”, all tagged `calcom` in the task field. That tag is hard-coded even when the event came from ClickFunnels.
- Those 15 due dates: Aug 12–18, 2026. **1** is due today (Aug 18). **4** are due Aug 14. **0** are in the future.
- `call_outcomes` with a booking ref: **0**.

So: real book events **have** landed, from the **funnel book**, not from a Cal.com webhook.

### Live Cal.com door

- Named route is `POST /api/webhooks/calcom`, not `/api/webhooks/cal`.
- Forged body + fake signature: **401** `bad_signature`. Nothing written.
- `POST /api/webhooks/cal`: **404** unknown provider.
- Name `CALCOM_WEBHOOK_SECRET` is **missing** in local `.env` and on live Netlify.

A Cal.com webhook cannot verify today. I did not replay a real signature. I did not create a booking.

### What the owner sees

Signed in as `chris@fundhub.ai` on `/app/calendar.html`.

- Today (Aug 18): **“Nothing booked.”** All counts show a dash. Shot: `01-calendar-today.png`
- Aug 14 (four tasks in the database): still **“Nothing booked.”** Shot: `02-calendar-aug14.png`
- The same page, from the browser, can read the task API: **66** tasks, **15** with dates. The grid does not paint them. After 12+ seconds the counts are still dashes.
- A hidden “Demonstration states” drawer still has fake copy: “Move one booking” / “Two bookings sit in the same 4:30 slot.” DOM proof: `shots.json`. The drawer sits under the fold.

So the live calendar **looks empty**. The database is **not** empty. Demo Move labels are still in the page.

Evidence: `db.json`, `follow.json`, `live.json`, `shots.json`, the three PNGs.

---

## G5c — Bank-app launcher

**What you asked:** Owner on the test client. Hit launch only far enough to get the error. Do not file a bank app.

- Test client: `8556bedc-46e1-4d85-b0cd-a24adfee1521`
- Dummy lender id only: `00000000-0000-4000-8000-000000000001` (not a real bank file)
- `POST /api/proxy/launch` → **HTTP 503**
- Error code: **`oxylabs_credentials_missing`**
- Message names the missing settings: `OXYLABS_USERNAME`, `OXYLABS_PASSWORD`
- `proxy_sessions` rows: **0** before, **0** after. No session was created.
- Those two names are also missing in local `.env`.

Same break W6 already saw. Still broken.

Evidence: `live.json`, `db.json`, `shots.json` (`proxyAfter.n = 0`)

---

## Capped failures

### G5a — seven jobs have never seen their event

- Journey: background jobs (no intended file)
- Step: event must exist before the job can run
- Expected: each registered job has seen its listen-event at least once, or a proven run
- Observed: `deposit.paid` 0, `inquiry.removed` 0, `message.inbound` 0, `mail.response` 0, `docs.received` 0
- Jobs: `c-02b-inquiry-removal-requested`, `s-06-post-call-funding-purchased`, `c-03-inquiry-removed-resume-or-hold`, `dpc-03-inbound-reply-router`, `f-06-funding-conditions-missing-docs`, `f-09-funding-declined-no-path`, `f-11-bank-email-event-router`
- Evidence: `g5/db.json`

### G5a — two jobs are defined and not registered

- Journey: background jobs
- Step: defined job is on the serve list
- Expected: every `createFunction` is in `src/workflows/index.mjs`
- Observed: `s-02-incomplete-survey-nudge` and `inquiry-call-sweeper` are out. `entry.captured` has 400 rows and S-02 will never see them on the serve path.
- Evidence: `g5/inventory.json`

### G5a — “did the job service actually run?” is unproven

- Journey: background jobs
- Step: prove a live run
- Expected: a run record from the job service, or a safe probe
- Observed: key looks on; serve door answers 401; local `events` rows exist. No run log was read. No test event was sent.
- Verdict: **UNVERIFIED**
- Evidence: `g5/live.json`, `g5/follow.json`

### G5b — calendar does not show the bookings that exist

- Journey: calendar (no intended file)
- Step: owner opens Calendar and sees real books
- Expected: dated work from the task list shows on the day
- Observed: 15 dated “Strategy session booked” rows in the database (1 due today, 4 on Aug 14). Owner screen says “Nothing booked.” Counts stay dashes. The page can read the same list (66 / 15) and still does not paint.
- Evidence: `g5/01-calendar-today.png`, `g5/02-calendar-aug14.png`, `g5/shots.json`, `g5/db.json`

### G5b — Cal.com webhook is not the source, and the secret is missing

- Journey: calendar
- Step: an outside book writes a row
- Expected: Cal.com signed posts become `booking.created` with source `calcom`
- Observed: **0** Cal.com events. **26** ClickFunnels books. `CALCOM_WEBHOOK_SECRET` missing live and local. Forged `POST /api/webhooks/calcom` → 401. `POST /api/webhooks/cal` → 404.
- I did not book a real person. A new Cal.com book cannot be proven without that secret and a real slot.
- Evidence: `g5/db.json`, `g5/live.json`, `g5/env-presence.json`

### G5c — bank-app launcher stops on missing proxy login

- Journey: bank-app launcher (no intended file)
- Step: owner launch on the test client, stop at the error
- Expected: a proxy session starts, or a clear error
- Observed: **503** `oxylabs_credentials_missing`. `proxy_sessions` = 0.
- Evidence: `g5/live.json`

---

## What I did not do

- Did not set, clear, or change `INNGEST_EVENT_KEY`.
- Did not send a background-job test event.
- Did not create a calendar booking or email a real person.
- Did not submit a bank application.
- Did not open client `9af65808-a619-4e65-ae91-239766a006b7`.

---

## Files

| File | What it is |
|---|---|
| `inventory.json` | All 53 jobs, listen-events, who is registered |
| `env-presence.json` | Key **names** only, local + Netlify |
| `db.json` | Live event / task / proxy counts |
| `follow.json` | Booking sources, due days, live 51-job registry |
| `live.json` | Live HTTP: job door, Cal.com door, launcher error |
| `shots.json` | Calendar facts (no client names) |
| `01-calendar-today.png` | Owner calendar, Aug 18, empty |
| `02-calendar-aug14.png` | Owner calendar, Aug 14, empty |
| `03-calendar-demo-drawer.png` | Same empty frame after opening the demo drawer |
