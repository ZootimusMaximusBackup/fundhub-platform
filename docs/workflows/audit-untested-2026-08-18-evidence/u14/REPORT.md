# U14 — Background jobs actually ran

Date: 2026-08-18  
Did not set `INNGEST_EVENT_KEY`. Did not send a test event. Did not put the serve path in demo mode.

## Ground truth

No `docs/journeys/*-intended.md` step names “background jobs ran.”

**MISSING** journey step. Scored against Chris’s claim on the board.

Env names checked: `INNGEST_EVENT_KEY` present, `INNGEST_SIGNING_KEY` present. Values not printed.

## Chris’s claim

The background job service is on and jobs have actually run.

## Score

**UNVERIFIED — never ran (no Inngest run row).**

The switch looks on. Our own `events` table has trigger rows. The Automations screen says it does **not** track whether a workflow ran. There is no Inngest run table here. I did not send a test event.

## Prove

1. Jobs defined vs listed
   - **53** `inngest.createFunction` in `src/workflows/`
   - **51** on the serve list (`src/workflows/index.mjs`)
   - **2** left off: `s-02-incomplete-survey-nudge`, `inquiry-call-sweeper`

2. Live doors
   - `GET /api/inngest` → **401** `Unauthorized` (door exists, locked)
   - `HEAD /api/inngest` → **401**
   - Did not PUT the serve path
   - `GET /api/read/workflows` → **200**, count **51**, `engine_active` **true** for all
   - Status: **44 live / 7 never_triggered**
   - “live” here means: key is set + an `events` row exists. Not an Inngest run.

3. Named event counts (our `events` table)

   | Event | n |
   |---|---|
   | deposit.paid | 1 |
   | inquiry.removed | 0 |
   | message.inbound | 0 |
   | mail.response | 0 |
   | docs.received | 0 |
   | diagnostic.paid | 5 |
   | payment.received | 11 |
   | contract.signed | 3 |

4. Run log
   - Tables that look like runs: `events`, `failed_events` only. No `inngest` / `workflow_run` / `function_run` table.
   - `failed_events`: 2 rows named `survey.submitted` (bus fail log, not an Inngest run).
   - Never-triggered ids: `c-03-inquiry-removed-resume-or-hold`, `contract-chaser`, `dpc-03-inbound-reply-router`, `f-06-funding-conditions-missing-docs`, `f-09-funding-declined-no-path`, `f-11-bank-email-event-router`, `message-dispatch-sweeper`.
   - Screen: “ENGINE ON. 44 of 51… This screen does not track whether a workflow ran.”

No job has a live Inngest run row (success or error).

## Evidence

- `inventory.json`
- `env-presence.json`
- `db-events.json`
- `live-doors.json`
- `01-automations.png`
- `automations-ui.json`

## FAIL — jobs actually ran

- Journey: background jobs ran (Chris’s claim; **MISSING** in intended)
- Step: a real Inngest run row
- Expected: success or error run for at least one job
- Observed: engine_active true; 401 on `/api/inngest`; events exist; no run table; screen says it does not track runs
- Evidence: `01-automations.png`, `live-doors.json`, `db-events.json`
