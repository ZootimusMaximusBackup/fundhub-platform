# Precall slice — BS-01 + BS-FUND grid

Read-only map. No app code changed. No booking made.

This job is `bs-01-precall-launcher` in `src/workflows/bs-01-precall-launcher.mjs`.
It is registered in `src/workflows/index.mjs`.

**What it is:** when someone books a call, this job can send a 3-day email grid
(funding or repair) plus one later text. The clock starts at **book time**, not
at morning / lunch / night on the wall, and not at the appointment time.

**Names that look like clock times are not clock times.**
The code slot names (kickoff / morning / midday / afternoon / evening / spare)
do not match the template endings (morning / midmorning / lunch / afternoon /
evening / night). The template ending is just the last word of the key. The
job finds a row with `LIKE 'BS-FUND-D1-E1-%'` (and the same for each cell).

---

## Clock vs booking

Every email wait is `step.sleep` from the **last cell**, starting at book.

| Cell | Code name | Usual key ending (docs) | Wait before this cell | Time after book |
|---|---|---|---|---|
| D1-E1 | kickoff | morning | none | **right away** |
| D1-E2 | morning | midmorning | 12h | +12h |
| D1-E3 | midday | lunch | 1h | +13h |
| D1-E4 | afternoon | afternoon | 3h | +16h |
| D1-E5 | evening | evening | 4h | +19h |
| D1-E6 | spare | night | 1h | +23h |
| D2-E1 | kickoff | morning | 12h | +35h |
| D2-E2 | morning | midmorning | 1h | +36h |
| D2-E3 | midday | lunch | 3h | +39h |
| D2-E4 | afternoon | afternoon | 3h | +42h |
| D2-E5 | evening | evening | 4h | +46h |
| D2-E6 | spare | night | 1h | +47h |
| D3-E1 | kickoff | morning | 12h | +59h |
| D3-E2 | morning | midmorning | 1h | +60h |
| D3-E3 | midday | lunch | 3h | +63h |
| D3-E4 | afternoon | afternoon | 3h | +66h |
| D3-E5 | evening | evening | 4h | +70h |
| D3-E6 | spare | night | 1h | +71h |

The SMS wait is **+24h from book**, not from the appointment.

S-04B reminders (other job) use **appointment time minus 24h / 2h**. That is a
different clock.

---

## Who gets which emails

The job reads `clients.outcome_tier` (`src/config/product-path.mjs`).

- Funding path (`FUNDING_PLUS_REPAIR`, `FULL_FUNDING`, `PREMIUM_STACK`) → `BS-FUND-*` emails.
- Repair-only (`REPAIR_ONLY`) → `BS-REPAIR-*` emails (same waits, same job).
- Anything else (null, unknown, hold) → **no email grid**. The +24h SMS still runs.

---

## Stop / cancel (what the code actually does)

**Does stop leftover emails/SMS**

- At every cell except D1-E1, the job asks `callHappened()` in
  `src/workflows/dpc-02-call-outcome-enforcement.mjs`. That looks for an event
  named `call.completed` on this client (any call, not this booking). If yes,
  the rest of the grid **and** the SMS path stop.
- D1-E1 has **no** that check. Kickoff can still send even if a call already
  happened.
- On `booking.rescheduled`, Inngest `cancelOn` tries to kill the old run, then
  this same job **starts again** (it also listens to `booking.rescheduled`).
  Match is: same `payload.email`, **or** same `payload.bookingUid`.
  Cal.com also writes `payload.bookingUid` and `payload.email`. Email match
  and uid match can both work **if** Inngest sees `event.data.payload.*`.
  **UNVERIFIED in live Inngest.**

**Does not stop this job**

- Finish the call is only `call.completed`. No other “they showed” flag.
- **No-show:** `booking.noshow` does **not** cancel this job. DPC-02 can tag
  no-show and move the card. S-05A can start a **different** recovery. Leftover
  BS-FUND emails can keep going.
- **Cancel:** `booking.cancelled` does **not** cancel this job.
  `src/handlers/comms.mjs` tags `call:cancelled` and closes the booking row.
  The sleeps still wake.

**Empty cell:** no approved template for that prefix → skip, log a gap, keep going.
Does not invent copy.

---

## EVENT: booking.created

Fires when: Cal.com / ClickFunnels (or anyone) emits `booking.created`.
This job also listens to `booking.rescheduled` (same handle, new run).

### Email grid (funding path) — channel email — waits from book, not the wall clock

  `BS-FUND-D1-E1-*`  |  email  |  fires at book (no wait)
    Sends only if: client found; funding path; an approved template matches `BS-FUND-D1-E1-%`.
    Stops if: no client; not funding path; no approved row (gap). **Does not** check `call.completed`.
    Sends once, or repeats: once per booking event id (`eventId:D1:E1`). A **second booking** is a new event id, so the whole grid can send again.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

  `BS-FUND-D1-E2-*`  |  email  |  fires at book + 12h
    Sends only if: funding path; approved `BS-FUND-D1-E2-%`; `call.completed` is still missing.
    Stops if: `call.completed` at this wake; no approved row (skip, continue).
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

  `BS-FUND-D1-E3-*`  |  email  |  fires at book + 13h
    Sends only if: funding path; approved `BS-FUND-D1-E3-%`; call not completed.
    Stops if: `call.completed`; missing approved row.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

  `BS-FUND-D1-E4-*`  |  email  |  fires at book + 16h
    Sends only if: funding path; approved `BS-FUND-D1-E4-%`; call not completed.
    Stops if: `call.completed`; missing approved row.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

  `BS-FUND-D1-E5-*`  |  email  |  fires at book + 19h
    Sends only if: funding path; approved `BS-FUND-D1-E5-%`; call not completed.
    Stops if: `call.completed`; missing approved row.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

  `BS-FUND-D1-E6-*`  |  email  |  fires at book + 23h
    Sends only if: funding path; approved `BS-FUND-D1-E6-%`; call not completed.
    Stops if: `call.completed`; missing approved row.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

  `BS-FUND-D2-E1-*`  |  email  |  fires at book + 35h
    Sends only if: funding path; approved `BS-FUND-D2-E1-%`; call not completed.
    Stops if: `call.completed`; missing approved row.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

  `BS-FUND-D2-E2-*`  |  email  |  fires at book + 36h
    Sends only if: funding path; approved `BS-FUND-D2-E2-%`; call not completed.
    Stops if: `call.completed`; missing approved row.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

  `BS-FUND-D2-E3-*`  |  email  |  fires at book + 39h
    Sends only if: funding path; approved `BS-FUND-D2-E3-%`; call not completed.
    Stops if: `call.completed`; missing approved row.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`
    Note: **no header** in `fundhub-docs/sources/EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md`. Live DB still had a row (extra lookup, not a send proof).

  `BS-FUND-D2-E4-*`  |  email  |  fires at book + 42h
    Sends only if: funding path; approved `BS-FUND-D2-E4-%`; call not completed.
    Stops if: `call.completed`; missing approved row.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

  `BS-FUND-D2-E5-*`  |  email  |  fires at book + 46h
    Sends only if: funding path; approved `BS-FUND-D2-E5-%`; call not completed.
    Stops if: `call.completed`; missing approved row.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

  `BS-FUND-D2-E6-*`  |  email  |  fires at book + 47h
    Sends only if: funding path; approved `BS-FUND-D2-E6-%`; call not completed.
    Stops if: `call.completed`; missing approved row.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

  `BS-FUND-D3-E1-*`  |  email  |  fires at book + 59h
    Sends only if: funding path; approved `BS-FUND-D3-E1-%`; call not completed.
    Stops if: `call.completed`; missing approved row.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

  `BS-FUND-D3-E2-*`  |  email  |  fires at book + 60h
    Sends only if: funding path; approved `BS-FUND-D3-E2-%`; call not completed.
    Stops if: `call.completed`; missing approved row.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

  `BS-FUND-D3-E3-*`  |  email  |  fires at book + 63h
    Sends only if: funding path; approved `BS-FUND-D3-E3-%`; call not completed.
    Stops if: `call.completed`; missing approved row.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

  `BS-FUND-D3-E4-*`  |  email  |  fires at book + 66h
    Sends only if: funding path; approved `BS-FUND-D3-E4-%`; call not completed.
    Stops if: `call.completed`; missing approved row.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

  `BS-FUND-D3-E5-*`  |  email  |  fires at book + 70h
    Sends only if: funding path; approved `BS-FUND-D3-E5-%`; call not completed.
    Stops if: `call.completed`; missing approved row.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

  `BS-FUND-D3-E6-*`  |  email  |  fires at book + 71h
    Sends only if: funding path; approved `BS-FUND-D3-E6-%`; call not completed.
    Stops if: `call.completed`; missing approved row.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

Repair path uses the same waits and the same stop rule, with prefix `BS-REPAIR`.
Docs are missing: D1-E6, D2-E1, D2-E2, D2-E3, D2-E4, D2-E5. Those cells skip.

### SMS this job actually sends

  `SMS-BS01-02-PRECALL`  |  sms  |  fires at book + 24h
    Sends only if: client found; `call.completed` still missing at the +24h wake;
    approved SMS template; not opted out of SMS (`sendTemplated`).
    Stops if: `call.completed` before this wake. Does **not** stop on cancel or no-show.
    Sends once, or repeats: once per booking event id (`eventId:sms:precall`). Runs even when there is **no** funding/repair email path.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`
    Seed row: `db/seed/010_bs_sms_precall.sql` (also listed in `src/workflows/templates-seed.mjs`).

### SMS this job does **not** send (keys still in code + seed)

  `SMS-BS01-01-BOOKED`  |  sms  |  does not fire
    Sends only if: nothing. Exported, seeded, no send site. Owner 2026-08-22: S-04B owns the booked text (`SMS-S04-01-CONFIRM`).
    Stops if: n/a
    Sends once, or repeats: never from this job
    Which file: `src/workflows/bs-01-precall-launcher.mjs` (constant only)
    Seed row: `db/seed/010_bs_sms_precall.sql`

  `SMS-BS01-03-DAYOF`  |  sms  |  does not fire
    Sends only if: nothing. Exported, seeded, no send site. Owner 2026-08-22: S-04B owns T-2h (`SMS-S04-03-REMIND-2H`).
    Stops if: n/a
    Sends once, or repeats: never from this job
    Which file: `src/workflows/bs-01-precall-launcher.mjs` (constant only)
    Seed row: `db/seed/010_bs_sms_precall.sql`

---

## EVENT: booking.rescheduled

Fires when: the booking is moved.

  Same templates as `booking.created`.
    Sends only if: the new run still has a client and a matching path.
    Stops if: `cancelOn` killed the **old** run (email match, or uid match if the field names line up). Then this job starts a **new** grid from the new book moment.
    Sends once, or repeats: new event id → new grid. If cancel of the old run fails, **two grids** can run.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

---

## Possible doubles

**Same key, two jobs**

- No other workflow in `src/workflows/` calls `sendTemplated` with `BS-FUND-*`.
  Same-key doubles only happen if **two BS-01 runs** exist: two `booking.created`
  events, or a reschedule that did not kill the old run.
- Replay of the **same** event id should not double (provider ref includes event id + cell).

**Two jobs, different keys, same person, same window**

- At book: S-04B `EMAIL-S04-01-CONFIRM` + BS-01 `BS-FUND-D1-E1-*` (two emails) if funding path.
- At book: S-04B `SMS-S04-01-CONFIRM` (BS-01 no longer sends `SMS-BS01-01-BOOKED`).
- ~24h: S-04B `SMS-S04-02-REMIND-24H` is **appointment minus 24h**. BS-01 `SMS-BS01-02-PRECALL` is **book plus 24h**. If the call is about 48h after book, both texts can land together.
- T-15m: AI-SET-04 `SMS-AISET04-HANDOFF` (other job).
- After no-show: leftover BS-FUND emails can keep going **and** S-05A recovery can start. Different keys.

---

## Keys in code with no `db/seed` row

`db/seed` has **no** `BS-FUND-*` or `BS-REPAIR-*` inserts.
Those keys are meant to come from the docs seeder
(`src/messaging/seed/seed.mjs` → `fundhub-docs/sources/EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md`),
which is **not** `db/seed`.
`db/seed/006_message_templates_source_doc.sql` only adds a column. It does not insert these rows.

Code never hard-codes the full `BS-FUND-D1-E1-morning` string except in tests.
It only hard-codes prefixes `BS-FUND` / `BS-REPAIR` and looks up `prefix-Dn-En-%`.

Docs headers present for BS-FUND (17 of 18): all D1, D2 except E3, all D3.
Docs missing: `BS-FUND-D2-E3-lunch`.

Docs still show lorem ipsum on BS-FUND-D1-E1. Dispatcher (`src/messaging/dispatch.mjs`)
blocks lorem. A re-seed from docs would matter. Extra live lookup saw current
BS-FUND rows as not matching `%lorem ipsum%` and `compliance_passed=true`.
That is **not** proof a send happened.

---

## Seed / live rows with no caller in this job

| Key | Where seen | Caller |
|---|---|---|
| `SMS-BS01-01-BOOKED` | `db/seed/010_bs_sms_precall.sql`, `templates-seed.mjs` | none (retired) |
| `SMS-BS01-03-DAYOF` | same | none (retired) |
| `BS-EMAIL-FUNDING-72HR` | docs + live extra lookup | none (comment says merged into BS-01; key never sent) |
| `BS-EMAIL-REPAIR-72HR` | docs + live extra lookup | none |
| `SMS-BS01-01-CONFIRMATION-HUB` | live extra lookup only | none in `src/` |
| `SMS-BS01-02-PRECALL-NUDGE` | live extra lookup only | none in `src/` |

Live extra lookup also saw all 18 `BS-FUND-*` keys including D2-E3, and the
12 `BS-REPAIR-*` keys that exist in docs. Live `BS-REPAIR-*` matched lorem.
Dispatcher would block those even if queued. **UNVERIFIED** as a live send.

---

## Related jobs (not this slice’s senders)

- `src/workflows/s-04b-booking-reminders.mjs` — confirm SMS+email now; T-24h and T-2h SMS from **appointment** time. Same `booking.created` / `booking.rescheduled`. Same `call.completed` stop on reminders.
- `src/workflows/s-04-call-booked.mjs` — tags / moves card. No template send.
- `src/workflows/dpc-02-call-outcome-enforcement.mjs` — showed vs no-show after end+5m. Does not cancel BS-01.
- `src/workflows/s-05a-no-show-recovery.mjs` — starts on `booking.noshow`. Does not cancel BS-01.
- `src/handlers/comms.mjs` — cancel / no-show tags. Does not cancel BS-01.
- `src/workflows/ai-set-04-3way-handoff.mjs` — SMS at T-15m.
- `src/workflows/s-portal-invite.mjs` — portal email on book.

---

## Files read

- `.cursor/skills/fundhub-auditor/SKILL.md`
- `src/workflows/bs-01-precall-launcher.mjs`
- `src/workflows/bs-01-precall-launcher.test.mjs`
- `src/workflows/index.mjs`
- `src/workflows/dpc-02-call-outcome-enforcement.mjs`
- `src/workflows/s-04b-booking-reminders.mjs`
- `src/workflows/s-04-call-booked.mjs`
- `src/workflows/s-05a-no-show-recovery.mjs`
- `src/workflows/ai-set-01-josh-setter.mjs`
- `src/workflows/ai-set-04-3way-handoff.mjs`
- `src/workflows/s-portal-invite.mjs`
- `src/workflows/messaging.mjs`
- `src/workflows/templates-seed.mjs`
- `src/config/product-path.mjs`
- `src/handlers/comms.mjs`
- `src/messaging/dispatch.mjs`
- `src/messaging/seed/seed.mjs`
- `src/messaging/seed/collect.mjs`
- `src/messaging/seed/parse-email.mjs`
- `src/events/bus.mjs`
- `src/events/canonical.mjs`
- `src/adapters/calcom.mjs`
- `src/adapters/clickfunnels.mjs`
- `db/seed/010_bs_sms_precall.sql`
- `db/seed/006_message_templates_source_doc.sql`
- `fundhub-docs/sources/EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md` (headers + D1-E1 body sample)
- `docs/workflows/cf-dedupe-comms-map-2026-08-23.md`

Not used as truth: old audit dumps, UI “morningoff” labels (look like key + Off badge).

---

## UNVERIFIED

- No test booking was made. No inbox / phone was watched. **No PASS on a live send.**
- Whether Inngest `cancelOn` sees `event.data.payload.email` / `bookingUid` the way the bus sends them.
- Whether ClickFunnels payloads always have `email` / `bookingUid`.
- Whether every `call.completed` is written when a call actually ends.
- Whether two bookings for one person happen, and whether both grids send.
- Whether live BS-FUND copy stays non-lorem if someone re-runs the docs seeder
  (`compliance_passed` on that seeder is false; docs D1-E1 is still lorem).
- Whether dispatcher placeholder block still catches rewritten copy that is not
  the words “lorem ipsum”.
- Live SQL extra lookup (template rows exist). That is not proof they went out.
