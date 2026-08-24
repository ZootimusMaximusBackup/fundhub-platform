# Capture / welcome / portal / offer / docs — comms slice

Read-only map. 2026-08-23. Did not change app code. Did not book a call. Did not write the assembled file `docs/workflows/comms-logic-2026-08-23.md`.

This slice is first-lead capture, plus the four named jobs: welcome (`s-00-welcome`), portal invite (`s-portal-invite`), offer bucket (`s-offer-bucket`), doc request (`s-doc-collection`).

Live proof that a phone or inbox actually rang: **UNVERIFIED**. The live database has queued message rows. That is not the same as “they got it.”

---

## How a new lead is born

Three doors write `entry.captured`.

1. **ClickFunnels webhook** (`src/adapters/clickfunnels.mjs`, posted at `/api/webhooks/clickfunnels`).
2. **Homepage survey** (`api/public/survey-submit.mjs`).
3. **Pipeline “New Client”** (`api/pipeline-clients.mjs`).

After the event is saved, the job runner is told (only if `INNGEST_EVENT_KEY` is set). Then the jobs below run.

Texts and emails are **queued** first (`sendTemplated` in `src/workflows/messaging.mjs`). A pump tries to send them later. This map is about **what gets queued**.

### Shared send gates (every queued text/email)

Sends only if:

- a client row is found
- a template row exists for that key
- the row is marked sendable (`compliance_passed`)
- the body is not draft copy
- for SMS: they have not opted out of texts

Missing template → silent skip (`template_pending`). Nothing is invented.

Live check 2026-08-23: every template key in this slice **has** a sendable row. None missing.

---

## ClickFunnels: one form fill is many `entry.captured`

**Do not fix this. Map only.**

The webhook does **not** wait for “the form is done.” For almost every ClickFunnels ping that has an email and is **not** an appointment, the adapter writes **`entry.captured`**. If that ping also has survey answers, it also writes **`survey.submitted`**. Each ping uses ClickFunnels’ own event id as the dedupe key (`clickfunnels:<that id>:entry.captured`). A new ping with a new id is a new event.

Appointments are the exception: those become `booking.created` / reschedule / cancel, not `entry.captured`.

The apply survey has **10** answer fields (`cf_svy_*` in `src/survey/cf-question-map.mjs`). If ClickFunnels pings us on each step (and on contact create / contact update), one person filling the form can fire **many** `entry.captured` in a couple of minutes.

Live events table (counted 2026-08-23, no names printed):

- **536** `entry.captured` total. **510** say `source=clickfunnels`.
- **528** of those 536 have **no** `client_id` on the event row. The ClickFunnels adapter does not pass a client id into `emit()`. Jobs still try to find the person by email later.
- One ClickFunnels fill is often about **20** `entry.captured` in about **1–3 minutes** (13 people had exactly 20). Two people had exactly **10**. Some test fills had 21–23 in about two minutes.
- `survey.submitted` from ClickFunnels often lands **15–17 times** for the same email in that same window.

So: the prompt said “ten.” Live, **ten happens, twenty is more common.** Same bug either way: one fill, many events, many jobs.

What that does to mail:

- **Welcome** has a once-lock on the client (`s00_welcome_sent_at`). Code says only the first win sends. Live still shows **12 welcome emails on one person on 2026-08-22** (the day welcome shipped). **UNVERIFIED** if that was before the lock, duplicate client rows, or a race.
- **Finish-app nudge (`s-02`) has no once-lock.** Each `entry.captured` starts its own 20-minute timer. If they never finish the survey, that can be **many** “finish your application” emails. Live: **46** `EMAIL-S02-FINISH-APPLICATION` rows; at least one person has **11**.
- **No-book chase (`s-nobook-chase`) has no once-lock.** Each `survey.submitted` starts its own 2-hour chase. Live only shows **1** `SMS-NOBOOK-01`. Code would allow many. **UNVERIFIED** why live did not fan out (job runner not up yet, they booked, or sleeps still waiting).

Homepage survey is different: **one** submit writes **one** `entry.captured` and **one** `survey.submitted`. Dedupe key includes the time, so a double-click can still write two.

Pipeline New Client writes **one** `entry.captured` per email (`pipeline-client:<org>:<email>`).

---

EVENT: entry.captured
Fires when: a new lead’s email hits Fundhub. ClickFunnels webhook (`src/adapters/clickfunnels.mjs`), homepage survey (`api/public/survey-submit.mjs`), or Pipeline New Client (`api/pipeline-clients.mjs`).

  EMAIL-S00-WELCOME  |  email  |  fires at right away
    Sends only if: client found; this client’s `s00_welcome_sent_at` lock is still empty; shared email gates.
    Stops if: no client. Lock already set. Missing/unapproved template.
    Sends once, or repeats: **once per client** in code (lock). ClickFunnels can start this job **many times**; only the first lock-win should queue. Live still showed 12 emails to one person on 2026-08-22.
    Which file: `src/workflows/s-00-welcome.mjs`
    Live template: yes, sendable.

  SMS-S00-WELCOME  |  sms  |  fires at right away (same job as the welcome email)
    Sends only if: client found; same welcome lock already won on this run; shared SMS gates.
    Stops if: no client. Lock already set (second job exits before send). Opted out of SMS.
    Sends once, or repeats: same as the welcome email — meant once. Same-day burst can still show repeats in the message table.
    Which file: `src/workflows/s-00-welcome.mjs`
    Live template: yes, sendable.

  EMAIL-S02-FINISH-APPLICATION  |  email  |  fires at +20 minutes
    Sends only if: client found; after the wait, **no** `survey.submitted` for that client (or that email); shared email gates.
    Stops if: no client. They finished the survey during the wait (then they get tag `survey:complete` and **no** email).
    Sends once, or repeats: **repeats with every `entry.captured`.** No once-lock. One ClickFunnels fill can start many 20-minute timers. If they never finish, many emails.
    Which file: `src/workflows/s-02-incomplete-survey-nudge.mjs`
    Live template: yes, sendable. Live queued: 46 rows.

  EMAIL-N01-COLD-NURTURE  |  email  |  **WIRED-BUT-OFF**
    Sends only if: would need a cold lead and a live trigger. Trigger list is empty as of 2026-08-22.
    Stops if: job never starts.
    Sends once, or repeats: does not fire.
    Which file: `src/workflows/n-01-cold-nurture.mjs` (still registered in `src/workflows/index.mjs`, trigger `[]`)
    Live template: yes, sendable — sitting unused.

  SMS-N01-COLD-NURTURE  |  sms  |  **WIRED-BUT-OFF**
    Same as the N-01 email. Same empty trigger.
    Which file: `src/workflows/n-01-cold-nurture.mjs`
    Live template: yes, sendable — sitting unused.

  (no-message effects on `entry.captured`, same moment)
    Client row + GHL contact try: `src/handlers/client-lifecycle.mjs` (`onEntryCaptured` via `resolveClient`).
    Tag `lead:new`, field `lifecycle_status=New Lead`, sales card on `new_lead`: **twice** — the handler above **and** `src/workflows/s-01-new-lead-intake.mjs`. Same facts, two writers.
    First-touch date (only if empty): `src/workflows/at-01-first-touch-capture.mjs`.
    Affiliate a1/a2 owners (only if those params exist and not already locked): `src/workflows/af-02-referral-ownership-capture.mjs`.

Same-moment doubles on `entry.captured`: welcome email + welcome text (meant as a pair). Welcome + N-01 used to be a double; N-01 is off. **s-02 is not the same moment** (it waits 20 minutes) but it **is** a double if ClickFunnels wrote many `entry.captured`.

---

EVENT: survey.submitted
Fires when: the survey answers land. Same ClickFunnels ping as capture when answers are present (`src/adapters/clickfunnels.mjs`). Homepage survey writes it in the same submit as capture (`api/public/survey-submit.mjs`).

  SMS-NOBOOK-01  |  sms  |  fires at +2 hours
  EMAIL-NOBOOK-01  |  email  |  fires at +2 hours
  SMS-NOBOOK-02  |  sms  |  fires at +2 hours, then +24 hours more (+26 hours from survey)
  EMAIL-NOBOOK-02  |  email  |  same as SMS-02
  SMS-NOBOOK-03  |  sms  |  then +72 hours more (+98 hours from survey)
  EMAIL-NOBOOK-03  |  email  |  same as SMS-03
    Sends only if: client found; they still have **no** `booking.created` on that client id; shared gates.
    Stops if: no client. A `booking.created` row for that client id exists when a step wakes. **Caveat:** most ClickFunnels `booking.created` rows also have **no** `client_id` (42 of 49 live). The stop check looks at `client_id`. It can miss a real book. **UNVERIFIED** how often that happens.
    Sends once, or repeats: **one chase per `survey.submitted`.** No once-lock. One ClickFunnels fill can start many chases. Live table only shows 1× SMS-NOBOOK-01 / 02 / 03.
    Which file: `src/workflows/s-nobook-chase.mjs`
    Live templates: all six sendable.

  EMAIL-N02-WARM-NURTURE  |  email  |  **WIRED-BUT-OFF**
  SMS-N02-WARM-NURTURE  |  sms  |  **WIRED-BUT-OFF**
    Trigger removed 2026-08-22. File still registered. Template rows exist.
    Which file: `src/workflows/n-02-warm-nurture.mjs`

  (no-message effects)
    Answers saved on the client. If the last question `cf_svy_available_capital` is present, card moves to survey complete: `src/handlers/client-lifecycle.mjs` (`onSurveySubmitted`).

---

EVENT: booking.created
Fires when: they pick a call time. ClickFunnels appointment (or a form ping that already has a start time) in `src/adapters/clickfunnels.mjs`.

  EMAIL-PORTAL-MAGIC-LINK  |  email  |  fires at right away
    Sends only if: client found; an email exists; `portal_invite_sent_at` lock still empty; magic-link helper can issue a link; shared email gates.
    Stops if: no client. No email. Lock already set (second book does not send this invite).
    Sends once, or repeats: **once per client** for this workflow lock. The **same template** is also used when a person **asks** for a login link (`src/auth/magic-link.mjs`). That path is not this lock. Live: 24 rows; one person has many. Mix of invite + “send me a link” is **UNVERIFIED**.
    Which file: `src/workflows/s-portal-invite.mjs` → `src/auth/magic-link.mjs`
    Live template: yes, sendable. Link dies in 15 minutes and works once.

  (no-message effects on this event)
    Tag `call:booked`, field `call_outcome=booked`, card to booked: `src/workflows/s-04-call-booked.mjs`.

  **Same-moment doubles (this slice + booking slice):**
    Right away the person can also get **SMS-S04-01-CONFIRM** and **EMAIL-S04-01-CONFIRM** from `src/workflows/s-04b-booking-reminders.mjs` (mapped in the booking slice). That is a second email at the same moment as the portal login email.
    Josh may also get a dial from `src/workflows/ai-set-01-josh-setter.mjs` (call, not a template).

---

EVENT: call.completed
Fires when: a closer saves the call (`src/workflows/s-offer-bucket.mjs` listens here).

  EMAIL-OFFER-SOFT-PULL  |  email  |  fires at right away  (offerKey SOFT_PULL)
  EMAIL-OFFER-FUNDING-DFY  |  email  |  fires at right away  (offerKey FUNDING_DFY)
  EMAIL-OFFER-REPAIR-DFY  |  email  |  fires at right away  (offerKey REPAIR_DFY)
  EMAIL-OFFER-REPAIR-TRIAL  |  email  |  fires at right away  (offerKey REPAIR_TRIAL)
  EMAIL-OFFER-UWIQ-DELIVERABLES  |  email  |  fires at right away  (offerKey UWIQ_DELIVERABLES)
  EMAIL-OFFER-FUNDING-MASTERY  |  email  |  fires at right away  (offerKey FUNDING_MASTERY)
  EMAIL-OFFER-NONE  |  email  |  fires at right away  (offerKey `none`, or no key and outcome `not_a_fit`)
    Sends only if: payload `disposition` is **closer**; a matching offer key (or the none/not-a-fit fallback); client found; `offer_bucket_email_sent_at` still empty; shared email gates.
    Stops if: not a closer save (setter calls do nothing here). No matching template. No client. Lock already set (second closer save does not send, even if the offer changed).
    Sends once, or repeats: **once per client**, first closer save that has an offer template.
    Which file: `src/workflows/s-offer-bucket.mjs`
    Live templates: all seven sendable. Live `call.completed` rows: 4. No offer-bucket rows seen in `messages` in this pass.

  (no-message effects)
    Other jobs also listen to `call.completed` (no-answer cadence, repair referral, funding-declined). They are not this slice.

---

EVENT: deposit.paid
Fires when: the deposit clears. Doc request is the send in this slice.

  EMAIL-DOC-01-REQUEST  |  email  |  fires at right away
  SMS-DOC-01-REQUEST  |  sms  |  fires at right away
    Sends only if: client found; `doc_01_request_sent_at` still empty; shared gates.
    Stops if: no client. Lock already set.
    Sends once, or repeats: **once per client**.
    Which file: `src/workflows/s-doc-collection.mjs`
    Live templates: both sendable. Live `deposit.paid` rows: 26. **No** DOC-01 rows in `messages` this pass. Workflow is registered. **UNVERIFIED** if it has run on those 26 (many deposits may predate this job).

  (no-message effects)
    Funding hold reason set, next action “Collect Documents”, tag `docs:missing`: same file.
    Funding-path tags/task (no mail): `src/workflows/s-06-post-call-funding-purchased.mjs`.
    Inquiry-removal flag/tag (no mail): `src/workflows/c-02b-inquiry-removal-requested.mjs`.

---

EVENT: docs.received
Fires when: a file shows up for the doc checker (`src/workflows/ghl-doc-document-check.mjs` → `src/handlers/ghl-doc.mjs`).

  EMAIL-DOC-03-APPROVED  |  email  |  fires at right away if the checker says accept
  SMS-DOC-03-APPROVED  |  sms  |  fires at right away if accept
  SMS-DOC-02-REQUEST-MORE  |  sms  |  fires at right away if the checker says request_more
    Sends only if: this file is a client upload / known doc type (not an inquiry letter); checker returns accept or request_more; shared gates.
    Stops if: wrong doc kind. Checker says hold (makes a task, **no** extra mail). Missing fields.
    Sends once, or repeats: once per `docs.received` that routes to accept or request_more (event id is part of the queue key).
    Which file: `src/handlers/ghl-doc.mjs`
    Live templates: all three sendable. Live `docs.received` rows: 3. **UNVERIFIED** if those three queued mail.

  (no-message effects)
    Accept: drop `docs:missing`, clear the funding hold, next action “Optimize Profile”.
    Hold: task for the closer, gate stays closed.

---

## Same-moment doubles (short list)

| When | What piles on |
|---|---|
| One ClickFunnels fill | Many `entry.captured` (often ~20) + many `survey.submitted` (often ~15–17) |
| Each `entry.captured` | Welcome email + welcome text (pair). Intake tags **and** the lifecycle handler do the same New Lead work. |
| Each `entry.captured` if survey never finishes | Many `EMAIL-S02-FINISH-APPLICATION` 20 minutes later (no lock) |
| Each `survey.submitted` if they never book | Many no-book chases in code (no lock). Live mostly did not show that fan-out. |
| `booking.created` | Portal login email **and** booking confirm email/text (confirm is the booking slice) **and** Josh dial |
| `deposit.paid` | Doc request email+text (once) plus funding tags/task plus inquiry-removal flag. Not three mails. |

---

## Keys called

- Live database read (`execute_sql` / events + `message_templates` + `messages`). No Netlify env printed. No secrets printed.

## Files read

- `.cursor/skills/fundhub-auditor/SKILL.md`
- `src/adapters/clickfunnels.mjs` (+ tests)
- `api/public/survey-submit.mjs`
- `api/pipeline-clients.mjs`
- `src/events/bus.mjs`
- `src/events/canonical.mjs`
- `src/handlers/client-lifecycle.mjs`
- `src/workflows/s-00-welcome.mjs`
- `src/workflows/s-01-new-lead-intake.mjs`
- `src/workflows/s-02-incomplete-survey-nudge.mjs`
- `src/workflows/s-portal-invite.mjs`
- `src/workflows/s-offer-bucket.mjs`
- `src/workflows/s-doc-collection.mjs`
- `src/workflows/s-nobook-chase.mjs`
- `src/workflows/s-04-call-booked.mjs`
- `src/workflows/s-04b-booking-reminders.mjs`
- `src/workflows/s-06-post-call-funding-purchased.mjs`
- `src/workflows/n-01-cold-nurture.mjs`
- `src/workflows/n-02-warm-nurture.mjs`
- `src/workflows/at-01-first-touch-capture.mjs`
- `src/workflows/af-02-referral-ownership-capture.mjs`
- `src/workflows/ghl-doc-document-check.mjs`
- `src/handlers/ghl-doc.mjs`
- `src/workflows/c-02b-inquiry-removal-requested.mjs`
- `src/workflows/ai-set-01-josh-setter.mjs`
- `src/workflows/messaging.mjs`
- `src/workflows/custom-fields.mjs`
- `src/workflows/index.mjs`
- `src/auth/magic-link.mjs`
- `src/survey/cf-question-map.mjs`
- `db/seed/007_portal_magic_link_template.sql`
- `db/seed/011_followup_sms_pack.sql`
- `db/seed/013_section4_message_templates.sql`
- `db/seed/015_live_template_backfill.sql`
- `docs/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md`

## UNVERIFIED

- Whether a live phone or inbox got these (only queued rows were counted).
- Why one person has 12 welcome rows on 2026-08-22 if the once-lock is in code.
- Why no-book chase did not fan out in `messages` the way the code allows.
- Whether the 26 `deposit.paid` rows ran `s-doc-collection` (no DOC-01 message rows found).
- Whether the 3 `docs.received` rows queued DOC-02 / DOC-03.
- Whether `INNGEST_EVENT_KEY` is set in production right now (owner says the product is live; this pass did not print env).
- Exact ClickFunnels subscription list (contact created vs contact updated vs each survey step). Code treats almost every non-appointment ping as `entry.captured`. Live counts match “many pings per fill.”
