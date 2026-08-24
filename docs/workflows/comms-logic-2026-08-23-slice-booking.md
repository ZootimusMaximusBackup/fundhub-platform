# Booking confirm / Josh / reminders — comms slice

Read-only map. 2026-08-23. Did not book a call. Did not change app code.

Book page in code: `https://apply.fundhub.ai/funding-book-call`.

Live proof of a real text, email, or Josh ring: **UNVERIFIED**.

---

## How a booking notice is born

Live book page is ClickFunnels, not Cal.com (`src/adapters/calcom.mjs` header, checked 2026-08-18).

ClickFunnels (`src/adapters/clickfunnels.mjs`) turns calendar pings into:

- `appointments/scheduled_event.created` → `booking.created`
- a form post that already has a start time → `booking.created` (thank-you can paint before the appointment ping)
- `appointments/scheduled_event.rescheduled` → `booking.rescheduled`
- `appointments/scheduled_event.canceled` → `booking.cancelled`

If the form post and the later appointment ping are the **same email + same start time**, the second `booking.created` is skipped (slot match). If those times do not match exactly, both can fire. That would double every send below.

Cal.com can still emit the same four names plus `booking.noshow`. Public book page does not use Cal.com. Live ClickFunnels path has **no** no-show ping in this adapter.

The notice is written to the event log, then CRM handlers run, then the automation runner is told (only if `INNGEST_EVENT_KEY` is set).

Texts and emails are **queued** first. A pump every 5 minutes tries to send them (`src/workflows/message-dispatch-sweeper.mjs`). Josh’s call does **not** wait in that queue. It dials through the phone vendor right away.

### Shared send gates (every queued text/email)

Sends only if:

- a client row is found
- a template row exists for that key
- the row is marked sendable (`compliance_passed`)
- the body is not draft copy
- for SMS: they have not opted out of texts

Then a waiting row is written. It leaves only if:

- that company’s send switch is on
- the dry-run fence is an explicit off value (`0` / `false` / `no` / `off`)
- SMS is outside quiet hours (11pm–11am Eastern). Email is not held for quiet hours.
- a phone (SMS) or email (email) address exists

Missing template or unapproved row → silent skip (`template_pending`). Nothing is invented.

Reschedule link in copy falls back to `https://apply.fundhub.ai/funding-book-call`.

ClickFunnels always sets `meetingUrl` to **null**. Confirm email “Where” and any meet-link tag from this event will be blank unless some other field fills it. **UNVERIFIED** if a live ClickFunnels body has a meet link this adapter never copies.

ClickFunnels reads a timezone on the way in, then **does not put it on the event**. Times print in America/Phoenix unless the client record has a zone.

---

EVENT: booking.created
Fires when: someone books on the ClickFunnels calendar (form with a start time, or appointment created). File: `src/adapters/clickfunnels.mjs`. Cal.com `BOOKING_CREATED` can also fire it (`src/adapters/calcom.mjs`) — not the live public book page.

  SMS-S04-01-CONFIRM  |  sms  |  fires at once
    Sends only if: client found; shared SMS gates.
    Stops if: no client. Opted out of SMS. Missing/unapproved template.
    Sends once, or repeats: once per booking notice (same notice replay does not queue a second). A later reschedule is a new run (see `booking.rescheduled`).
    Which file: `src/workflows/s-04b-booking-reminders.mjs`
    Seeded: `db/seed/011_followup_sms_pack.sql` (sendable). Asks them to reply CONFIRM. Book link in the text.

  EMAIL-S04-01-CONFIRM  |  email  |  fires at once (right after the confirm text)
    Sends only if: client found; shared email gates.
    Stops if: no client. Missing/unapproved template.
    Sends once, or repeats: once per booking notice. Reschedule starts a new run and queues this email again.
    Which file: `src/workflows/s-04b-booking-reminders.mjs`
    Seeded: `db/seed/012_s04_booking_confirm_email.sql` (sendable). Says they’re booked. “Where” uses the meeting link from the event — blank on the ClickFunnels path as written.

  EMAIL-PORTAL-MAGIC-LINK  |  email  |  fires at once
    Sends only if: client found; an email exists on the event or the client; this client has never been locked (`portal_invite_sent_at` empty); magic-link helper can issue a link (address matches a client).
    Stops if: no client. No email. Lock already set (second book does not send). Rate limit (3 asks / 15 min per address). Not a client-kind account.
    Sends once, or repeats: **once per client, forever**, until that lock field is cleared. Not per booking. Not on reschedule.
    Which file: `src/workflows/s-portal-invite.mjs` → `src/auth/magic-link.mjs`
    Seeded: `db/seed/007_portal_magic_link_template.sql` (sendable; `ON CONFLICT DO NOTHING` so an old row is not overwritten). Link dies in 15 minutes and works once.

  (Josh robot call)  |  voice  |  fires at once
    Sends only if: client found; a usable phone on the client or the booking; Bland key set; dry-run fence off. Uses Agent Editor row `AG-04` if that row is live with a script. If not, it **falls back** to the vendor Josh script and treats it as live.
    Stops if: no client. No phone. Phone system not connected. Fence up.
    Sends once, or repeats: once per `booking.created`. **Does not** run on reschedule. **Does not** stop if they later cancel. Does **not** check SMS opt-out. Does **not** wait for quiet hours (can ring at night).
    Which file: `src/workflows/ai-set-01-josh-setter.mjs` → `src/messaging/providers/bland-voice.mjs`
    No message-template row. This is a phone call, not a queued SMS.

  SMS-S04-02-REMIND-24H  |  sms  |  fires at 24 hours before the call
    Sends only if: the booking had a start time; client found; shared SMS gates; the call has not already been held (`call.completed` for this client).
    Stops if: no start time (confirm still sent; this reminder skipped). Call already held. Opted out. They reschedule (old wait is killed; a new run starts). **Cancel does not kill this wait.**
    Sends once, or repeats: once per run. If they booked less than 24 hours out, the wait time is already past, so this can go out **right after confirm**. Live runner behavior **UNVERIFIED**.
    Which file: `src/workflows/s-04b-booking-reminders.mjs`
    Seeded: `db/seed/011_followup_sms_pack.sql`. There is **no** 24-hour reminder email in this workflow.

  SMS-S04-03-REMIND-2H  |  sms  |  fires at 2 hours before the call
    Sends only if: start time present; client found; shared SMS gates; call not already held.
    Stops if: no start time. Call already held. Opted out. Reschedule kills the old wait. **Cancel does not kill this wait.**
    Sends once, or repeats: once per run. Same “already past” burst if they booked inside 2 hours.
    Which file: `src/workflows/s-04b-booking-reminders.mjs`
    Seeded: `db/seed/011_followup_sms_pack.sql`.

  SMS-AISET04-HANDOFF  |  sms  |  fires at 15 minutes before the call
    Sends only if: start time present; client found; shared SMS gates.
    Stops if: no start time (whole workflow exits). No cancel-on-reschedule. No cancel-on-cancel. No “call already held” check.
    Sends once, or repeats: once per `booking.created` only. **Does not** restart on reschedule. Old 15-minute text can still fire at the **old** time.
    Which file: `src/workflows/ai-set-04-3way-handoff.mjs`
    Seeded: `db/seed/011_followup_sms_pack.sql`. Copy mentions a meet link. This send passes **no** appointment context, so that link tag is blank unless it lives on the client record.

  SMS-BS01-02-PRECALL  |  sms  |  fires at 24 hours after booking (not 24 hours before the call)
    Sends only if: client found; shared SMS gates; call not already held at wake.
    Stops if: call held during the 24-hour wait. Opted out. Reschedule kills the old run and starts a new one.
    Sends once, or repeats: once per run.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`
    Seeded: `db/seed/010_bs_sms_precall.sql`.
    **Not** the S-04B confirm. Kept here because it is a second “before your call” text on the same booking notice. Full pre-call email grid is another slice.

  (BS-01 emails, funding or repair grid)  |  email  |  first cell fires at once; later cells over ~71 hours
    Sends only if: client has a funding or repair-only path at book time. Many books have no path yet → **no email grid**.
    Stops if: no matching path. Call held (after the first cell). Reschedule restarts.
    Sends once, or repeats: one cell per slot that has a seeded row.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`
    **DOUBLE risk:** if a path is set, kickoff email lands at the same moment as `EMAIL-S04-01-CONFIRM` and the portal login email (up to three emails at book).

  EMAIL-DPC05-NO-PROGRESS-72H  |  email  |  fires at 72 hours after booking
  SMS-DPC05-NO-PROGRESS-72H  |  sms  |  fires at 72 hours after booking
    Sends only if: they are tagged as a client (`client:funding` / `client:repair-referral` / `client:diy-letters`); not already escalated; not hard-stopped; last progress older than 72 hours (or never stamped).
    Stops if: not a client yet (a lead who only booked is skipped). Already escalated. Hard stop. Progress made.
    Sends once, or repeats: once per booking notice that still looks stalled at +72h. **Cancel does not stop the wait.**
    Which file: `src/workflows/dpc-05-no-progress-escalation.mjs`
    Pointer only — not confirm/Josh/reminders.

### Retired keys (seeded, nothing sends them on book)

- `SMS-BS01-01-BOOKED` — used to double the confirm text. Code stopped sending it 2026-08-22. Seed remains (`db/seed/010_bs_sms_precall.sql`).
- `SMS-BS01-03-DAYOF` — used to double the 2-hour reminder. Code stopped sending it 2026-08-22.

### Switched off on this event

- N-03 hot nurture: registered but **enabled: false** and **no triggers**. File: `src/workflows/n-03-hot-nurture.mjs`.

### No send (same event)

- `src/workflows/s-04-call-booked.mjs` — tags `call:booked`, sets outcome booked, moves the sales card. No text/email.
- `src/handlers/comms.mjs` `onBookingCreated` — closer task, booking row, same tags/card move (so Pipeline does not wait on the automation runner). Skips interview/post-fund Meet bookings.
- `src/workflows/dpc-02-call-outcome-enforcement.mjs` — waits until 5 minutes after the appointment end, then marks showed vs no-show. No client send. Does not cancel if they cancel/reschedule.

---

EVENT: booking.rescheduled
Fires when: ClickFunnels `appointments/scheduled_event.rescheduled`, or Cal.com `BOOKING_RESCHEDULED`. Files: `src/adapters/clickfunnels.mjs`, `src/adapters/calcom.mjs`.

  SMS-S04-01-CONFIRM  |  sms  |  fires at once (new run)
  EMAIL-S04-01-CONFIRM  |  email  |  fires at once (new run)
  SMS-S04-02-REMIND-24H  |  sms  |  fires at 24 hours before the **new** start
  SMS-S04-03-REMIND-2H  |  sms  |  fires at 2 hours before the **new** start
    Sends only if: same as `booking.created` (S-04B listens to both).
    Stops if: old S-04B run is cancelled when the new ping has the same email **or** the same booking id. If both of those are missing/mismatched, the old reminders keep going **and** a new run starts (**DOUBLE**).
    Sends once, or repeats: a reschedule is meant to send confirm again with the new time.
    Which file: `src/workflows/s-04b-booking-reminders.mjs`

  SMS-BS01-02-PRECALL  |  sms  |  fires at 24 hours after the reschedule notice
    Same cancel/restart pattern as S-04B. File: `src/workflows/bs-01-precall-launcher.mjs`.

Does **not** fire here:

- Josh call (only `booking.created`)
- portal magic link (only `booking.created`, and lock already set)
- 15-minute Josh handoff text (only `booking.created`; old wait is **not** cancelled)

No send: `src/handlers/comms.mjs` `onBookingRescheduled` updates the closer task and booking row; sets outcome `rescheduled`.

---

EVENT: booking.cancelled
Fires when: ClickFunnels `appointments/scheduled_event.canceled`, or Cal.com `BOOKING_CANCELLED`. Files: `src/adapters/clickfunnels.mjs`, `src/adapters/calcom.mjs`.

  (no client text or email in this slice)
    Sends only if: n/a — no workflow in `src/workflows/` listens to `booking.cancelled` to send.
    Stops if: n/a.
    Sends once, or repeats: n/a.
    Which file: `src/handlers/comms.mjs` `onBookingCancelled` only — closes the closer task, marks the booking cancelled, tags `call:cancelled`, sets outcome `cancelled`.

**Hole:** S-04B, BS-01, AI-SET-04, Josh, and DPC-05 do **not** cancel-on `booking.cancelled`. A cancel 30 hours before the call can still get the 24-hour reminder, the 2-hour reminder, and the 15-minute handoff. Josh already called at book time and is not pulled back.

No “sorry you cancelled” template is wired.

---

EVENT: booking.noshow
Fires when: Cal.com no-show triggers only (`src/adapters/calcom.mjs`). ClickFunnels adapter does **not** emit this. Live public book path: this event likely never fires. **UNVERIFIED** live.

  EMAIL-S05A-NOSHOW-RECOVERY / SMS-S05A-NOSHOW-RECOVERY (and 02/03/04 pairs)  |  email + sms  |  four touches after no-show
    Sends only if: `booking.noshow` actually fires; client found; templates exist.
    Stops if: a new `booking.created` for the same email (cancel-on) or a later book count goes up.
    Sends once, or repeats: four pairs unless they rebook.
    Which file: `src/workflows/s-05a-no-show-recovery.mjs`

No-show CRM: `src/handlers/comms.mjs` `onBookingNoshow` — task done, tag `call:no_show`.

---

EVENT: call.completed
Fires when: Josh’s Bland call (or any Bland call) ends. File: `src/adapters/bland.mjs` (not fully re-read this pass).

  SMS-AISET03-MSG1  |  sms  |  fires at once if the call was no-answer / voicemail
  SMS-AISET03-MSG2  |  sms  |  fires at 30 minutes later
  SMS-AISET03-MSG3  |  sms  |  fires at 2 hours after MSG2
    Sends only if: disposition is no-answer / voicemail; client found; shared SMS gates.
    Stops if: not a no-answer. After MSG1, it “checks rebook” by asking “does this client have **any** `booking.created`.” Josh’s people **already** have that, so MSG2 and MSG3 should almost never send after a Josh miss. **UNVERIFIED** live.
    Sends once, or repeats: MSG1 yes; MSG2/MSG3 likely skipped for booked leads.
    Which file: `src/workflows/ai-set-03-no-answer-cadence.mjs`
    Related to Josh only. Not gated to Josh’s agent code — **any** unanswered Bland call can start MSG1.

---

EVENT: message.inbound
Fires when: they reply to a text. File: `src/handlers/comms.mjs` plus `src/workflows/dpc-03-inbound-reply-router.mjs`.

  (no send on CONFIRM)  |  —  |  —
    Sends only if: n/a.
    Stops if: the router only treats the word **YES** as “I confirm the call” (and only while outcome is still `booked`). The confirm text asks them to reply **CONFIRM**. **CONFIRM is not read.** That reply is ignored as a decision.
    Sends once, or repeats: n/a.
    Which file: `src/workflows/dpc-03-inbound-reply-router.mjs`

  SMS-DPC04-RESCHEDULE-REBOOKING  |  sms  |  fires at once if they reply with the word reschedule
    Sends only if: body has `reschedule`; client found; not hard-stopped; shared SMS gates.
    Stops if: no keyword. Hard-stopped.
    Sends once, or repeats: once per inbound event id.
    Which file: `src/workflows/dpc-03-inbound-reply-router.mjs`
    Seeded: `db/seed/015_live_template_backfill.sql` (sendable). Link falls back to `https://apply.fundhub.ai/funding-book-call`.

---

## Doubles / missing / switched off (this slice)

**Doubles**

- Confirm text vs old booked text: **fixed in code** (BS-01 no longer sends `SMS-BS01-01-BOOKED`).
- 2-hour reminder vs old day-of text: **fixed in code** (BS-01 no longer sends `SMS-BS01-03-DAYOF`).
- Still live: S-04B 24-hour-before-call text **and** BS-01 24-hour-after-book text. Same day if they booked about 2 days out.
- Still live: S-04B 2-hour text **and** AI-SET-04 15-minute text (two “your call is soon” texts).
- Still live: confirm email + portal login email at the same moment. Plus BS-01 kickoff email if a product path is already set.
- Form ping + appointment ping with **mismatched** start times → two `booking.created` → two confirms, two Josh dials.
- Reschedule that does not match email or booking id → old reminders plus new confirms.

**Missing template / unwired copy**

- No 24-hour **email** reminder in S-04B. Confirm email only.
- No cancel email/text.
- GHL-era keys `S-04` and `S-04B Reminder Email` are not what the live workflow sends. Wired keys are `EMAIL-S04-01-CONFIRM` and the three `SMS-S04-*` keys.
- `src/workflows/templates-seed.mjs` has different confirm-text wording (“Josh from Fundhub”) and is **not auto-run**. Migrate uses `db/seed/011_followup_sms_pack.sql` (“it’s Fundhub”). Live body **UNVERIFIED**.

**Switched off / will not leave**

- Dry-run fence defaults to **hold**. Unset/empty/`true` → no real SMS, email, or Josh ring.
- Company send switch off → queued rows sit.
- N-03 on book: off.
- Josh with no phone: skipped.
- Portal with no email or lock already set: skipped.
- Reminders with no start time: skipped (confirms still queue).
- Quiet hours hold **SMS** 11pm–11am Eastern. Josh can still ring.

**Reply mismatch**

- Texts say reply **CONFIRM**. Router only honors **YES** (while still booked).

---

## Files read

- `.cursor/skills/fundhub-auditor/SKILL.md`
- `docs/workflows/cf-dedupe-comms-map-2026-08-23.md`
- `src/workflows/s-04-call-booked.mjs`
- `src/workflows/s-04b-booking-reminders.mjs`
- `src/workflows/s-04b-booking-reminders.test.mjs`
- `src/workflows/s-portal-invite.mjs`
- `src/workflows/s-portal-invite.test.mjs`
- `src/workflows/ai-set-01-josh-setter.mjs`
- `src/workflows/ai-set-01-josh-setter.test.mjs`
- `src/workflows/ai-set-03-no-answer-cadence.mjs`
- `src/workflows/ai-set-04-3way-handoff.mjs`
- `src/workflows/bs-01-precall-launcher.mjs`
- `src/workflows/dpc-02-call-outcome-enforcement.mjs`
- `src/workflows/dpc-03-inbound-reply-router.mjs`
- `src/workflows/dpc-05-no-progress-escalation.mjs`
- `src/workflows/n-02-warm-nurture.mjs`
- `src/workflows/n-03-hot-nurture.mjs`
- `src/workflows/s-nobook-chase.mjs`
- `src/workflows/s-05a-no-show-recovery.mjs`
- `src/workflows/index.mjs`
- `src/workflows/messaging.mjs`
- `src/workflows/custom-fields.mjs`
- `src/workflows/templates-seed.mjs`
- `src/workflows/message-dispatch-sweeper.mjs`
- `src/handlers/comms.mjs`
- `src/adapters/clickfunnels.mjs`
- `src/adapters/clickfunnels.test.mjs` (slot-dedupe + cancel tests)
- `src/adapters/calcom.mjs`
- `src/auth/magic-link.mjs`
- `src/events/bus.mjs`
- `src/events/canonical.mjs`
- `src/messaging/providers/bland-voice.mjs`
- `src/messaging/dispatch.mjs` (header + quiet-hours use)
- `src/messaging/outbox.mjs`
- `src/messaging/gate.mjs` (quiet hours)
- `src/lib/dry-run.mjs`
- `src/insights/meet.mjs`
- `db/seed/007_portal_magic_link_template.sql`
- `db/seed/010_bs_sms_precall.sql`
- `db/seed/011_followup_sms_pack.sql`
- `db/seed/012_s04_booking_confirm_email.sql`
- `db/seed/015_live_template_backfill.sql` (reschedule-reply SMS)
- `db/expected-migrations.mjs` (seed order)

## UNVERIFIED

- Whether a live book on `https://apply.fundhub.ai/funding-book-call` actually queued/sent these rows today.
- Whether `MESSAGING_DRY_RUN` is an explicit off value on production.
- Whether that company’s send switch is on.
- Whether Agent Editor `AG-04` is live, or Josh is using the vendor fallback.
- Whether a live ClickFunnels body has a Google Meet URL this adapter drops.
- Whether form start time and appointment start time always match (double `booking.created` if not).
- Whether a wait whose clock time is already past fires at once on the live runner.
- Whether cancel-after-book has ever still received the 24h / 2h / 15-min texts.
- Whether anyone who texts CONFIRM (not YES) gets marked confirmed.
- Whether Josh no-answer ever sends MSG2/MSG3 after a booked Josh miss.
- Live template body for `SMS-S04-01-CONFIRM` (011 vs unused templates-seed wording).
- Cal.com no-show path on a live book (public page is ClickFunnels).
