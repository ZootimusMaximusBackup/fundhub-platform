# Chase / no-show / dispatcher / everything else that sends — comms slice

Read-only map. 2026-08-23. Did not book a call. Did not change app code.

This slice owns: never-booked chase, no-show recovery, the 5-minute send pump, and **every remaining send** not owned by capture/welcome/portal/offer/docs, booking/Josh/reminders, or BS-FUND precall.

Live proof that a real text or email left the building: **UNVERIFIED**.

---

## How a queued notice is born, then leaves

Workflows and staff actions **do not send**. They call `sendTemplated` in `src/workflows/messaging.mjs`. That writes a waiting row (`messages`, `direction='outbound'`, `status='queued'`). Same notice replay uses `provider_ref = workflow:{templateKey}:{eventId}` so it does not queue twice.

A pump every **5 minutes** tries to send due rows.

### Two pumps (same table)

1. **Inngest sweeper** `message-dispatch-sweeper` — cron `*/5 * * * *` — file `src/workflows/message-dispatch-sweeper.mjs`. Calls `drainAll` → `drain` → `dispatchDue` **without** `senderStaffOnly`. So it **does drain the full workflow queue**, not staff-only.
2. **Netlify cron** `staff-message-sweeper` — same `*/5 * * * *` in `netlify.toml` — file `netlify/functions/staff-message-sweeper.mjs`. Calls `dispatchDue({ senderStaffOnly: true })`. Staff-typed rows only.

Same row cannot go out twice: claim uses `FOR UPDATE SKIP LOCKED`. Staff rows can be claimed by **either** pump. That is not a double send of one row.

**Stale comment:** `src/messaging/dispatch.mjs` header still says the workflow backlog is not drained / staff-only is the live path. **Code disagrees.** The Inngest sweeper drains all queued outbound rows.

### Shared send gates (every queued text/email)

Sends only if:

- a client row is found
- a template row exists for that key
- the row is marked sendable (`compliance_passed`)
- the body is not draft copy
- for SMS: they have not opted out of texts

Then a waiting row is written. It leaves only if:

- that company’s send switch is on (`messaging_settings.outbound_enabled`; **no row = ON**)
- the dry-run fence is an explicit off value (`0` / `false` / `no` / `off`). Unset = **blocked**
- SMS is outside quiet hours (**11pm–11am Eastern**). Held SMS is moved to the next **11:00** Eastern, not dropped. Email is not held for quiet hours.
- a phone (SMS) or email (email) address exists
- the daily cap is not already full (default **500** / day if a cap is set)

Missing template or unapproved row → silent skip (`template_pending`). Nothing is invented.

Queue ≠ send. The sweeper transmits.

---

## EVENT: survey.submitted

Fires when: a ClickFunnels form post already has answers (`src/adapters/clickfunnels.mjs` `mapToCanonical`). Also the homepage survey (`api/public/survey-submit.mjs`). CRM handler: `src/handlers/client-lifecycle.mjs`.

**Double risk:** each ping is its own event id. Ten ClickFunnels pings → ten chase runs. Same-id replay does not queue twice (`provider_ref`). Live ping count: **UNVERIFIED**. Sibling CF-dedupe is not shipped.

N-02 used to chase this event. **Off now** (`triggers: []`). No double with N-02.

### s-nobook-chase (`src/workflows/s-nobook-chase.mjs`) — registered, live trigger

Waits are **one after another**, not from survey time on a wall clock.

1. Wait **2 hours**. If still no `booking.created` for this client → SMS + email **right then** (**+2 hours**).
2. Wait **24 hours more**. If still no book → SMS + email (**+26 hours**).
3. Wait **72 hours more**. If still no book → SMS + email (**+98 hours**).

Stops if: no client. A `booking.created` row exists (checked before the first wait and before each send). Opted out of SMS (SMS arm only). Missing/unapproved template.

Sends once, or repeats: once per survey event id. Arms use suffixes `:1` / `:1e` / `:2` / `:2e` / `:3` / `:3e`. A later survey ping is a new run.

Spec vs code: spec asked +2h / +24h / +72h **from survey**. Code has emails. Times are sequential, so 2nd/3rd land later than those spec labels.

  SMS-NOBOOK-01  |  sms  |  fires at +2 hours
    Sends only if: client found; no booking yet; shared SMS gates.
    Stops if: they booked. No client. Opted out. Missing/unapproved template.
    Sends once, or repeats: once per survey ping (suffix `:1`).
    Which file: `src/workflows/s-nobook-chase.mjs`
    Seeded: `db/seed/011_followup_sms_pack.sql` (sendable).

  EMAIL-NOBOOK-01  |  email  |  fires at +2 hours (right after the text in the same step)
    Sends only if: client found; no booking yet; shared email gates.
    Stops if: they booked. No client. Missing/unapproved template.
    Sends once, or repeats: once per survey ping (suffix `:1e`).
    Which file: `src/workflows/s-nobook-chase.mjs`
    Seeded: `db/seed/013_section4_message_templates.sql` (sendable).

  SMS-NOBOOK-02  |  sms  |  fires at +26 hours
    Same gates as 01. Suffix `:2`. Seeded `011`.

  EMAIL-NOBOOK-02  |  email  |  fires at +26 hours
    Same gates as 01. Suffix `:2e`. Seeded `013`.

  SMS-NOBOOK-03  |  sms  |  fires at +98 hours
    Same gates as 01. Suffix `:3`. Seeded `011`.

  EMAIL-NOBOOK-03  |  email  |  fires at +98 hours
    Same gates as 01. Suffix `:3e`. Seeded `013`.

---

## EVENT: booking.noshow

Fires when: Cal.com webhook `BOOKING_NO_SHOW` / `MEETING_NO_SHOW` / `BOOKING_NO_SHOW_CREATED` (`src/adapters/calcom.mjs`).

Live public book page is ClickFunnels/Cronofy, **not** Cal.com. Adapter header: `CALCOM_WEBHOOK_SECRET` unset → fail-closed 401. ClickFunnels adapter has **no** no-show ping.

**UNVERIFIED** whether live no-shows ever emit this event. If they never do, this whole job never runs.

### s-05a-no-show-recovery (`src/workflows/s-05a-no-show-recovery.mjs`)

Also: tag `call:no_show`. Task “No-show recovery — rebook” for closer.

Stop: `booking.created` count **greater than** the count at start (they rebooked). Inngest `cancelOn` `booking.created` if emails match.

Waits are sequential: now, then 24h, then 48h more, then 96h more → clock **+0 / +24h / +72h / +168h (7 days)** if they never rebook. Spec table matches those clock times.

Old audits that said “one email + one text only” are **wrong**. Code has four touches.

  EMAIL-S05A-NOSHOW-RECOVERY  |  email  |  fires at once
    Sends only if: client found; shared email gates.
    Stops if: no client. Missing/unapproved template.
    Sends once, or repeats: once per no-show event (suffix `:1:email`).
    Which file: `src/workflows/s-05a-no-show-recovery.mjs`
    Seeded: `db/seed/015_live_template_backfill.sql` (sendable).

  SMS-S05A-NOSHOW-RECOVERY  |  sms  |  fires at once
    Same, SMS gates. Suffix `:1:sms`. Seeded `015`.

  EMAIL-S05A-NOSHOW-02  |  email  |  fires at +24 hours
    Sends only if: they have not rebooked; shared email gates.
    Seeded: `db/seed/013_section4_message_templates.sql`.

  SMS-S05A-NOSHOW-02  |  sms  |  fires at +24 hours
    Same. Seeded `013`.

  EMAIL-S05A-NOSHOW-03  |  email  |  fires at +72 hours
    After the extra 48h wait. Seeded `013`.

  SMS-S05A-NOSHOW-03  |  sms  |  fires at +72 hours
    Seeded `013`.

  EMAIL-S05A-NOSHOW-04  |  email  |  fires at +168 hours (7 days)
    After the extra 96h wait. Seeded `013`.

  SMS-S05A-NOSHOW-04  |  sms  |  fires at +168 hours (7 days)
    Seeded `013`.

---

## EVENT: entry.captured

Fires when: first lead capture (ClickFunnels form without a start time, homepage survey, and other capture paths). Capture slice owns welcome/portal/offer/docs. This nudge is listed so the assembler cannot drop it.

### s-02-incomplete-survey-nudge (`src/workflows/s-02-incomplete-survey-nudge.mjs`)

Wait **20 minutes**. If no `survey.submitted` for this client id **or** this email → one email. If the survey did land → tag `survey:complete`, **no send**.

  EMAIL-S02-FINISH-APPLICATION  |  email  |  fires at +20 minutes
    Sends only if: client found; survey still not in the event log (client id or email); shared email gates.
    Stops if: they finished the survey. No client. Missing/unapproved template.
    Sends once, or repeats: once per capture event id.
    Which file: `src/workflows/s-02-incomplete-survey-nudge.mjs`
    Seeded: `db/seed/015_live_template_backfill.sql` (sendable).

---

## EVENT: call.completed

Fires when: a sales call outcome is saved (`src/sales/call-outcomes.mjs`). Offer-bucket on this event is capture’s slice. S-08 tags/task only — **no client send**.

### ai-set-03-no-answer-cadence (`src/workflows/ai-set-03-no-answer-cadence.mjs`)

Runs only if disposition is `no_answer` / `no-answer` / `voicemail`.

Comment says 30 min / 2 hr / 24 hr. **Code has no 24h wait.** Clock: **now / +30 min / +2 hours 30 min**.

Stops on `booking.created`.

  SMS-AISET03-MSG1  |  sms  |  fires at once
    Sends only if: no-answer (or voicemail) disposition; client found; shared SMS gates.
    Stops if: not that disposition. No client. Opted out. Missing/unapproved template.
    Sends once, or repeats: once per call event (`:1`).
    Which file: `src/workflows/ai-set-03-no-answer-cadence.mjs`
    Seeded: `db/seed/015_live_template_backfill.sql` (sendable).

  SMS-AISET03-MSG2  |  sms  |  fires at +30 minutes
    Same, plus they still have not booked. Suffix `:2`. Seeded `015`.

  SMS-AISET03-MSG3  |  sms  |  fires at +2 hours 30 minutes
    After 2 more hours. Suffix `:3`. Seeded `015`. **No fourth wait.**

### ds-01-repair-referral (`src/workflows/ds-01-repair-referral.mjs`)

Runs only if `isRepairReferral`: sales outcome “Repair Referral Sent”, **or** declined + `repairReferral` true, and **not** a hard decline (ofac / fraud / hard_decline / disqualified). Needs email **and** phone. **Not** a funding-path client.

Tags `client:repair-referral`. Sets product path “Referred”.

  EMAIL-DS01-REPAIR-REFERRAL  |  email  |  fires at once
    Sends only if: repair-referral gate; identity present; not funding path; shared email gates.
    Stops if: any of those fail. Missing/unapproved template.
    Sends once, or repeats: once per call event id.
    Which file: `src/workflows/ds-01-repair-referral.mjs`
    Seeded: `db/seed/015_live_template_backfill.sql` (sendable).

  SMS-DS01-REPAIR-REFERRAL  |  sms  |  fires at once
    Same, SMS gates. Seeded `015`.

---

## EVENT: booking.created

Booking slice owns confirm / Josh / reminders / cancel / reschedule. These two also listen here.

### ai-set-04-3way-handoff (`src/workflows/ai-set-04-3way-handoff.mjs`)

Sleeps until **15 minutes before** `payload.startTime`. Needs a start time. Then SMS + closer task “3-way handoff”.

  SMS-AISET04-HANDOFF  |  sms  |  fires at appointment time minus 15 minutes
    Sends only if: client found; start time present; shared SMS gates.
    Stops if: no start time. No client. Opted out. Missing/unapproved template.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/ai-set-04-3way-handoff.mjs`
    Seeded: `db/seed/011_followup_sms_pack.sql` as `SMS-AISET04-HANDOFF` (sendable).

### dpc-05-no-progress-escalation (`src/workflows/dpc-05-no-progress-escalation.mjs`)

Wait **72 hours**. Then send only if: tags include `client:funding` **or** `client:repair-referral` **or** `client:diy-letters`; not already `dpc:no-progress-escalated`; not hard-stopped; `last_progress_timestamp` is missing or older than 72 hours. Then tag + advisor task.

  EMAIL-DPC05-NO-PROGRESS-72H  |  email  |  fires at +72 hours
    Sends only if: those client tags; not already escalated; not hard-stopped; stalled; shared email gates.
    Stops if: not a client of those kinds. Already escalated. Hard stop. They progressed. Missing/unapproved template.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/dpc-05-no-progress-escalation.mjs`
    Seeded: `db/seed/015_live_template_backfill.sql` (sendable).

  SMS-DPC05-NO-PROGRESS-72H  |  sms  |  fires at +72 hours
    Same, SMS gates. Seeded `015`.

---

## EVENT: message.inbound

Fires when: Twilio SMS or Mailgun inbound (`src/adapters/twilio.mjs`, `src/adapters/mailgun.mjs`).

### dpc-03-inbound-reply-router (`src/workflows/dpc-03-inbound-reply-router.mjs`)

Parses YES / CONFIRM / RESCHEDULE / CLOSE. Hard-stopped: no send.

- YES while call outcome is still `booked` → mark call confirmed. **No send.**
- YES otherwise → task “send contract + collect payment”, move card to closed-won. **No send.**
- RESCHEDULE → SMS below + task + tag `setter:reschedule`.
- CLOSE → move to downsell, strip nurture tags. **No send.**

  SMS-DPC04-RESCHEDULE-REBOOKING  |  sms  |  fires at once (reschedule branch only)
    Sends only if: body has “reschedule”; client found (or phone match); not hard-stopped; shared SMS gates.
    Stops if: other keywords. No client. Hard stop. Missing/unapproved template.
    Sends once, or repeats: once per inbound event id.
    Which file: `src/workflows/dpc-03-inbound-reply-router.mjs`
    Seeded: `db/seed/015_live_template_backfill.sql` (sendable).

---

## EVENT: round.started

Fires when: Lendflow adapter or card-stacking `apply_now` (`src/funding/card-stacking-rounds.mjs`). F-01 tags/tasks only — **no send**. F-10 still registered; **sends retired** (sets `monitor+{clientId}@fundhub.ai` + staff task). Keys `EMAIL-F10-INBOX-SETUP` / `SMS-F10-INBOX-SETUP` unused.

**Possible two texts:** notify SMS **now**, then F-02 SMS at **+3 hours** if ID/portal still missing. Different times. Different keys.

### round-started-client-notify (`src/workflows/round-started-client-notify.mjs`)

  SMS-ROUND-STARTED-NOTIFY  |  sms  |  fires at once
    Sends only if: client found; shared SMS gates.
    Stops if: no client. Opted out. Missing/unapproved template.
    Sends once, or repeats: once per round-started event id.
    Which file: `src/workflows/round-started-client-notify.mjs`
    Seeded: `db/seed/015_live_template_backfill.sql` (sendable).

### f-02-portal-id-missing (`src/workflows/f-02-portal-id-missing.mjs`)

Wait **3 hours**. If ID not uploaded **or** portal onboarding not `Complete` → email + SMS, tag `docs:missing`. Wait **2 days more**. If still missing → follow-up **email only**.

  EMAIL-F02-ID-PORTAL-NEEDED  |  email  |  fires at +3 hours
    Sends only if: still missing ID or portal complete; shared email gates.
    Stops if: docs already there at the 3-hour check. No client. Missing/unapproved template.
    Sends once, or repeats: once per round-started event (`:1`).
    Which file: `src/workflows/f-02-portal-id-missing.mjs`
    Seeded: `db/seed/015_live_template_backfill.sql` (sendable).

  SMS-F02-ID-PORTAL-NEEDED  |  sms  |  fires at +3 hours
    Same. Seeded `015`.

  EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP  |  email  |  fires at +3 hours + 2 days
    Sends only if: still missing after the second wait. Email only. Suffix `:2`. Seeded `015`.

---

## EVENT: round.submitted

### f-03-round-submitted (`src/workflows/f-03-round-submitted.mjs`)

Needs `roundNumber` (or `round_number`) set. Sets employee next action “Remove Inquiries”.

  EMAIL-F03-ROUND-SUBMITTED  |  email  |  fires at once
    Sends only if: client found; round number present; shared email gates.
    Stops if: no round number. No client. Missing/unapproved template.
    Sends once, or repeats: once per submitted event id.
    Which file: `src/workflows/f-03-round-submitted.mjs`
    Seeded: `db/seed/015_live_template_backfill.sql` (sendable).

  SMS-F03-ROUND-SUBMITTED  |  sms  |  fires at once
    Same. Seeded `015`.

---

## EVENT: round.approved

### f-04-round-approvals (`src/workflows/f-04-round-approvals.mjs`)

Needs `approvedAmount > 0`.

  EMAIL-F04-ROUND-APPROVALS  |  email  |  fires at once
    Sends only if: approved amount greater than 0; shared email gates.
    Stops if: amount is 0 or missing. No client. Missing/unapproved template.
    Which file: `src/workflows/f-04-round-approvals.mjs`
    Seeded: `015`.

  SMS-F04-ROUND-APPROVALS  |  sms  |  fires at once
    Same. Seeded `015`.

---

## EVENT: round.funded

### f-07-funding-locked (`src/workflows/f-07-funding-locked.mjs`)

Needs both `approvedAmount` and `feePercent`. If either missing → ops tag + task, **no client send**.

If both present: client email + SMS, then a success-fee invoice, then `announceInvoice(..., "invoice.sent")` which **starts AR chase** (same day as F-07). That is a **second pair** of client notices if the invoice is a success fee.

  EMAIL-F07-FUNDING-LOCKED  |  email  |  fires at once (only if amount and fee % both present)
    Sends only if: fee lock is ready; shared email gates.
    Stops if: amount or percent missing (ops path). No client. Missing/unapproved template.
    Which file: `src/workflows/f-07-funding-locked.mjs`
    Seeded: `015`.

  SMS-F07-FUNDING-LOCKED  |  sms  |  fires at once
    Same. Seeded `015`.

**Double:** F-07 now + AR-01 now (see `invoice.sent`). Different keys. Same day.

### n-06-renewal-second-wave (`src/workflows/n-06-renewal-second-wave.mjs`)

Wait **180 days**. Send only if a funding round still has `funded_amount > 0`. Advisor task too.

  EMAIL-N06-RENEWAL  |  email  |  fires at +180 days
    Sends only if: still a funded round; shared email gates.
    Stops if: no funded round left. No client. Missing/unapproved template.
    Which file: `src/workflows/n-06-renewal-second-wave.mjs`
    Seeded: `015`.

  SMS-N06-RENEWAL  |  sms  |  fires at +180 days
    Same. Seeded `015`.

---

## EVENT: round.closeout

### n-04-post-funding-nurture (`src/workflows/n-04-post-funding-nurture.mjs`)

Sends **only if** `payload.stage === "closed"` **or** `engagementComplete === true`. Money-chain closeout without those fields is skipped (F-07 owns the funded instant).

  EMAIL-N04-POST-FUNDING  |  email  |  fires at once (staff closeout only)
    Sends only if: that closeout shape; client found; shared email gates.
    Stops if: not staff closeout. No client. Missing/unapproved template.
    Which file: `src/workflows/n-04-post-funding-nurture.mjs`
    Seeded: `015`.

  SMS-N04-POST-FUNDING  |  sms  |  fires at once
    Same. Seeded `015`.

---

## EVENT: invoice.sent  (and payment.received)

### ar-collections (`src/workflows/ar-collections.mjs`)

Client chase **only** if `source === "funding_success_fee"` **or** `invoice_type === "success_fee"`. Other invoices: no AR templates.

Stops if the invoice is no longer open (`draft` / `sent` / `reminded` / `escalated` / `partially_paid`). `cancelOn` `invoice.paid` same `invoiceId`.

After AR-03: escalate + tag `ar:collections-handoff`. **No 4th client message.**

`payment.received` branch: settle the one open success-fee invoice. **No client message.**

Clock: **now / +7 days / +14 days**.

  EMAIL-AR-01-FIRST-NOTICE  |  email  |  fires at once
    Sends only if: success-fee invoice; still open; shared email gates.
    Stops if: not success fee. Invoice not open. No invoice id. No client.
    Sends once, or repeats: once per invoice-sent event (`:01` + key).
    Which file: `src/workflows/ar-collections.mjs`
    Seeded: `db/seed/013_section4_message_templates.sql` as `EMAIL-AR-01-FIRST-NOTICE` / `SMS-AR-01-FIRST-NOTICE` (sendable).

  SMS-AR-01-FIRST-NOTICE  |  sms  |  fires at once
    Same.

  EMAIL-AR-02-REMINDER  |  email  |  fires at +7 days
    Same open-invoice gate. Seeded `013`.

  SMS-AR-02-REMINDER  |  sms  |  fires at +7 days
    Seeded `013`.

  EMAIL-AR-03-FINAL-NOTICE  |  email  |  fires at +14 days
    Seeded `013`.

  SMS-AR-03-FINAL-NOTICE  |  sms  |  fires at +14 days
    Seeded `013`.

Staff/API invoice email is a **different** key (`INVOICE-SENT-EMAIL`) — see non-Inngest below. Not the AR templates.

---

## EVENT: payment.received

AR settle path: no client send (above).

### ds-02-diy-letters (`src/workflows/ds-02-diy-letters.mjs`)

Product name must contain “consulting services package” or “diy”. Client must be **repair-only** path. Does **not** auto-mail bureaus. Builds in-repo letter pack + invoice stub.

  EMAIL-DS02-DIY-LETTERS-READY  |  email  |  fires at once
    Sends only if: DIY product name; repair-only path; shared email gates.
    Stops if: funding path. Not DIY name. No client. Missing/unapproved template.
    Sends once, or repeats: once per payment event id.
    Which file: `src/workflows/ds-02-diy-letters.mjs`
    Seeded: `015`.

**Double:** closer deck can queue the **same key** (`src/sales/closer-deck.mjs` imports `EMAIL-DS02-DIY-LETTERS-READY`). Different event ids, so both can send if staff deck + payment workflow both run.

---

## EVENT: mail.response  /  docs.received  /  inquiry.docs.needed

### f-06-funding-conditions-missing-docs (`src/workflows/f-06-funding-conditions-missing-docs.mjs`)

`mail.response`: send only if classification `MISSING_DOCS` **and** `conditionDescription` present. Tags `docs:missing`. Sets hold “Missing Documents”.

`docs.received`: clear that tag/hold if **this** workflow set it. **No send.**

  EMAIL-F06-MISSING-DOCS  |  email  |  fires at once (missing-docs mail only)
    Sends only if: MISSING_DOCS + condition text; shared email gates.
    Stops if: other mail classes. No condition text. No client.
    Which file: `src/workflows/f-06-funding-conditions-missing-docs.mjs`
    Seeded: `015`.

  SMS-F06-MISSING-DOCS  |  sms  |  fires at once
    Same. Seeded `015`.

### inquiry.docs.needed (`src/handlers/inquiry-docs.mjs`)

**Same two F-06 keys**, now. Tags `docs:missing` + `inquiry:docs_needed`.

**Double:** if both `inquiry.docs.needed` and F-06 `mail.response` fire, two email+SMS pairs (different event ids).

### ghl-doc-document-check (`src/workflows/ghl-doc-document-check.mjs` → `src/handlers/ghl-doc.mjs`)

On `docs.received` for client-upload / listed doc types (not inquiry_doc, not bureau_response). Agent outcome:

- accept → email + SMS approved
- request_more → SMS only
- hold → staff task only, **no client send**

  EMAIL-DOC-03-APPROVED  |  email  |  fires at once (accept)
    Seeded: `db/seed/013_section4_message_templates.sql` as `EMAIL-DOC-03-APPROVED`.

  SMS-DOC-03-APPROVED  |  sms  |  fires at once (accept)
    Seeded `013` as `SMS-DOC-03-APPROVED`.

  SMS-DOC-02-REQUEST-MORE  |  sms  |  fires at once (request_more)
    Seeded `013` as `SMS-DOC-02-REQUEST-MORE`.

---

## EVENT: analysis.completed

### u-02-analyzer-complete-delivery — **sends retired**

Tags only. Keys `EMAIL-U02-ANALYZER-FUNDING-DELIVERY` / `EMAIL-U02-ANALYZER-REPAIR-DELIVERY` unused. Repair pack is supposed to ship from DS-02 after pay.

### u-03-crs-snapshot-sync → `src/crs/snapshot-negatives.mjs`

Only if `payload.source === "crs"`. **First snapshot:** store keys, **no send**. Later snapshot with **new** negative keys → pause funding + closer task + email/SMS.

  EMAIL-AX07-FUNDING-PAUSED  |  email  |  fires at once (new negatives only, not first snapshot)
    Sends only if: not first snapshot; new negative keys; shared email gates.
    Stops if: first snapshot. No new keys. Not CRS source. No client.
    Which file: `src/crs/snapshot-negatives.mjs` (called from `src/workflows/u-03-crs-snapshot-sync.mjs`)
    Seeded: `db/seed/015_live_template_backfill.sql`; turned sendable in `db/seed/014_ax07_funding_paused_on.sql`.

  SMS-AX07-FUNDING-PAUSED  |  sms  |  fires at once
    Same.

### c-06-crs-results-router — **decline send off**

`HARD_DECLINE_SIGNALS_DEFERRED = true` → decline detector always false. Keys `EMAIL-C06-DECLINE` / `SMS-C06-DECLINE` unused. Funding letters may be **stored**, not emailed from this file.

---

## Retired nurture (still registered, will not start)

- **n-01-cold-nurture** — trigger `[]`. Off 2026-08-22.
- **n-02-warm-nurture** — trigger `[]`. Off so S-NOBOOK owns chase.
- **n-03-hot-nurture** — `enabled: false` and trigger `[]`.

Handle functions still exist. Inngest will not start them.

---

## EVENT: clock (cron) — unsigned contract

### contract-chaser (`src/workflows/contract-chaser.mjs`)

Cron `0 10 * * *` (10:00 UTC daily). Also API `/api/contracts` `run_reminders`.

`src/contracts/notify.mjs`: first chase **3 days** after send, then every **3 days**, max **4**. Also `dispatchOne` by id (still respects outbound pause).

  CONTRACT-SEND-EMAIL  |  email  |  fires when staff send the contract (not the daily cron)
    Sends only if: template loadable; shared email gates / dispatch.
    Which file: `src/contracts/notify.mjs`
    Seeded: `db/seed/008_contract_messages.sql` as `CONTRACT-SEND-EMAIL` (sendable).

  CONTRACT-REMIND-EMAIL  |  email  |  fires at +3 days, then every +3 days, max 4
    Sends only if: contract still sent/viewed, unsigned; under max chases; shared gates.
    Stops if: signed. Max chases hit. Send switch off.
    Which file: `src/contracts/notify.mjs` + `src/workflows/contract-chaser.mjs`
    Seeded: `008` as `CONTRACT-REMIND-EMAIL` (sendable).

---

## Not an Inngest event — staff / payment / portal / repair

These still **queue** client-facing rows (or try to). Sweeper still has to drain them.

### Staff compose (`src/messaging/compose.mjs`)

No template key. Staff SMS/email. Quiet-hours hold. Staff sweeper **or** full sweeper can release.

### Payment link (`api/payment-links.mjs`)

  payment_link_notice  |  sms  |  fires when staff hits send
    Sends only if: shared SMS gates **and** template approved.
    **Switched off in seed:** `db/seed/007_payment_link_template.sql` sets `compliance_passed = false`. Queues nothing useful until a human flips that flag.
    Which file: `api/payment-links.mjs`

### Magic link (`src/auth/magic-link.mjs`)

  EMAIL-PORTAL-MAGIC-LINK  |  email  |  fires when a login link is issued
    Booking/portal slice also lists this. Seeded `db/seed/007_portal_magic_link_template.sql` (sendable). Rate limit 3 / 15 min.

### Invoice email from staff/API (`src/invoices/notify.mjs`)

  INVOICE-SENT-EMAIL  |  email  |  fires when staff/API emails an invoice
    Not the AR-01/02/03 keys. Seeded `008` (sendable).

### Repair emails (`src/repair/notify.mjs` via `onRepairEvent`)

Email only. Keys:

- `EMAIL-REPAIR-WELCOME` (`repair.enrolled`)
- `EMAIL-REPAIR-LETTERS-SENT` (`repair.letters.sent`)
- `EMAIL-REPAIR-RESPONSE-RESULTS` (`repair.response.parsed`)
- `EMAIL-REPAIR-ROUND-ADVANCED` (`repair.round.escalated`)
- `EMAIL-REPAIR-RETAKE-PHOTO` (`repair.response.retake`)
- `EMAIL-REPAIR-TRIAL-COMPLETE-UPSELL` (`repair.program.complete`)

**Not in `db/seed/`.** Rows live in `db/migrations/253_repair_email_templates.sql` (`compliance_passed=true` in that file). Live DB whether that migration ran: **UNVERIFIED**.

### inquiry-call-sweeper

Cron `*/15`. Bureau calls. **Not** client SMS/email.

### deposit.paid / s-06

Tags/task only. **No send** (doc collection is capture slice).

---

## Doubles (same person, two notices)

| When | What |
|---|---|
| Many `survey.submitted` ids | Many full no-book chases |
| `round.started` | SMS notify **now** + F-02 SMS at **+3h** if portal/ID still missing |
| `round.funded` with fee lock | F-07 email/SMS **now** + AR-01 email/SMS **now** (`invoice.sent`) |
| Missing docs two events | F-06 and `inquiry.docs.needed` share F-06 keys |
| DIY letters | DS-02 and closer deck share `EMAIL-DS02-DIY-LETTERS-READY` |
| Two sweepers | Same **row** is not sent twice (`SKIP LOCKED`) |

N-02 vs S-NOBOOK: **not** a double. N-02 trigger is empty.

---

## Switched off / missing / stale

- N-01 / N-02 / N-03 will not start.
- U-02 client send retired. F-10 client send retired. C-06 decline send off.
- `payment_link_notice` seeded **unapproved**.
- Repair keys not in `db/seed/` (migration 253 only).
- `booking.noshow` may never fire on the live ClickFunnels book page.
- Dispatch **header** is stale; Inngest sweeper **does** drain workflow queued rows.
- `MESSAGING_DRY_RUN` unset = nothing transmits. Live value: **UNVERIFIED**.
- Company send switch live value: **UNVERIFIED**.
- Live template rows vs seed: **UNVERIFIED**.

---

## Spec vs this code (short)

- No-book: emails exist; delays **+2h / +26h / +98h**, not spec +2 / +24 / +72 from survey.
- No-show: four touches in code; sequential waits land on spec +0 / +24h / +72h / +7d.
- AI-SET-03: no 24h third wait.
- N-01/02/03 retired (spec wanted N-02 off so S-NOBOOK owns chase).
- U-02 / F-10 / C-06 decline: no client send.
- Payment link template unapproved.
- Dispatch comment vs sweeper drain-all.

---

## Registered Inngest functions that send (assembler — do not drop)

From `src/workflows/index.mjs` `functions` array, this slice:

- `messageDispatchSweeper` (`message-dispatch-sweeper`) — drain, not compose
- `sNobookChase` (`s-nobook-chase`)
- `s05aNoShowRecovery` (`s-05a-no-show-recovery`)
- `s02IncompleteSurveyNudge` (`s-02-incomplete-survey-nudge`)
- `aiSet03NoAnswerCadence` (`ai-set-03-no-answer-cadence`)
- `aiSet043WayHandoff` (`ai-set-04-3way-handoff`)
- `dpc03InboundReplyRouter` (`dpc-03-inbound-reply-router`)
- `dpc05NoProgressEscalation` (`dpc-05-no-progress-escalation`)
- `ds01RepairReferral` (`ds-01-repair-referral`)
- `ds02DiyLetters` (`ds-02-diy-letters`)
- `f02PortalIdMissing` (`f-02-portal-id-missing`)
- `f03RoundSubmitted` (`f-03-round-submitted`)
- `f04RoundApprovals` (`f-04-round-approvals`)
- `f06FundingConditionsMissingDocs` (`f-06-funding-conditions-missing-docs`)
- `f07FundingLocked` (`f-07-funding-locked`)
- `n04PostFundingNurture` (`n-04-post-funding-nurture`)
- `n06RenewalSecondWave` (`n-06-renewal-second-wave`)
- `arCollections` (`ar-collections`)
- `contractChaser` (`contract-chaser`)
- `roundStartedClientNotify` (`round-started-client-notify`)
- `ghlDocDocumentCheck` (`ghl-doc-document-check`) — send is in the handler
- `u03CrsSnapshotSync` (`u-03-crs-snapshot-sync`) — send is in `snapshot-negatives.mjs`

Registered here but **no client send** (or send retired / trigger empty): `n01ColdNurture`, `n02WarmNurture`, `n03HotNurture`, `s01NewLeadIntake`, `s04CallBooked`, `s06PostCallFundingPurchased`, `s08PostCallFundingDeclined`, `f01FundingIntake`, `f05InquiryCleanupGate`, `f08PostFundingMonitoring`, `f09FundingDeclinedNoPath`, `f10ClientFundingInboxProvisioner` (sends retired), `f11BankEmailEventRouter`, `u02AnalyzerCompleteDelivery` (sends retired), `c00CrsSoftPullRequest`, `c02InquiryCreated`, `c02bInquiryRemovalRequested`, `c03InquiryRemovedResumeOrHold`, `c05PreFundingReview`, `c06CrsResultsRouter` (decline send off), `inquiryCallSweeper`, `dpc01AnalyzerLock`, `dpc02CallOutcomeEnforcement`, `af02ReferralOwnershipCapture`, `at01FirstTouchCapture`, `bc01CustomerResponsiveness`, `bc02CustomerFriction`, `sys01ClientValueCalculator`, `sys01LtvCalculator`, `u04PromoteCrsPrimary`, `u05DataHealthMonitor`, `repairBureauResponseReader`.

Other slices (registered, send elsewhere): `s00Welcome`, `sPortalInvite`, `sOfferBucket`, `sDocCollection`, `s04bBookingReminders`, `aiSet01JoshSetter`, `bs01PrecallLauncher`.

**Non-workflow senders the assembler must still list:** compose, payment-links, magic-link, invoices/notify, contracts/notify, closer-deck, repair/notify, inquiry-docs, crs snapshot-negatives, ghl-doc handler.

---

## Files read

- `.cursor/skills/fundhub-auditor/SKILL.md`
- `docs/workflows/cf-dedupe-comms-map-2026-08-23.md`
- `docs/workflows/comms-logic-2026-08-23-slice-booking.md` (format only)
- `docs/workflows/comms-logic-2026-08-23-slice-precall.md` (format only)
- `src/workflows/index.mjs`
- `src/workflows/messaging.mjs`
- `src/workflows/s-nobook-chase.mjs`
- `src/workflows/s-05a-no-show-recovery.mjs`
- `src/workflows/s-02-incomplete-survey-nudge.mjs`
- `src/workflows/ai-set-03-no-answer-cadence.mjs`
- `src/workflows/ai-set-04-3way-handoff.mjs`
- `src/workflows/dpc-03-inbound-reply-router.mjs`
- `src/workflows/dpc-05-no-progress-escalation.mjs`
- `src/workflows/ds-01-repair-referral.mjs`
- `src/workflows/ds-02-diy-letters.mjs`
- `src/workflows/n-01-cold-nurture.mjs`
- `src/workflows/n-02-warm-nurture.mjs`
- `src/workflows/n-03-hot-nurture.mjs`
- `src/workflows/n-04-post-funding-nurture.mjs`
- `src/workflows/n-06-renewal-second-wave.mjs`
- `src/workflows/f-02-portal-id-missing.mjs`
- `src/workflows/f-03-round-submitted.mjs`
- `src/workflows/f-04-round-approvals.mjs`
- `src/workflows/f-06-funding-conditions-missing-docs.mjs`
- `src/workflows/f-07-funding-locked.mjs`
- `src/workflows/f-10-client-funding-inbox-provisioner.mjs`
- `src/workflows/ar-collections.mjs`
- `src/workflows/round-started-client-notify.mjs`
- `src/workflows/contract-chaser.mjs`
- `src/workflows/ghl-doc-document-check.mjs`
- `src/workflows/u-02-analyzer-complete-delivery.mjs`
- `src/workflows/u-03-crs-snapshot-sync.mjs`
- `src/workflows/c-06-crs-results-router.mjs`
- `src/workflows/message-dispatch-sweeper.mjs`
- `src/messaging/dispatch.mjs`
- `src/messaging/outbox.mjs`
- `src/messaging/gate.mjs`
- `src/lib/dry-run.mjs`
- `netlify/functions/staff-message-sweeper.mjs`
- `netlify.toml` (staff sweeper schedule)
- `src/adapters/clickfunnels.mjs` (survey.submitted map)
- `src/adapters/calcom.mjs` (header + noshow)
- `api/public/survey-submit.mjs`
- `src/contracts/notify.mjs`
- `src/handlers/ghl-doc.mjs`
- `src/handlers/inquiry-docs.mjs`
- `src/crs/snapshot-negatives.mjs`
- `src/repair/notify.mjs`
- `src/sales/closer-deck.mjs` (DIY email key)
- `src/invoices/notify.mjs` (key via grep)
- `api/payment-links.mjs` (key via grep)
- `src/auth/magic-link.mjs` (partial)
- `db/seed/007_payment_link_template.sql`
- `db/seed/008_contract_messages.sql` (grep)
- `db/seed/011_followup_sms_pack.sql`
- `db/seed/013_section4_message_templates.sql`
- `db/seed/014_ax07_funding_paused_on.sql` (grep)
- `db/seed/015_live_template_backfill.sql` (grep)
- `db/migrations/253_repair_email_templates.sql` (grep)

---

## UNVERIFIED

- Live ClickFunnels ping count (can 10 `survey.submitted` still fire).
- Whether a live no-show ever emits `booking.noshow` (Cal.com path; public book page is not Cal.com).
- Live `MESSAGING_DRY_RUN` value (unset = blocked in code).
- Live `messaging_settings.outbound_enabled` per company.
- Live `message_templates` rows vs seed (especially repair keys / payment_link_notice flag).
- Whether Inngest `cancelOn` for no-show actually kills the run in production.
- Whether a wait whose clock time is already past fires at once on the live runner.
- Live proof a queued row was claimed and handed to Twilio/Mailgun.
