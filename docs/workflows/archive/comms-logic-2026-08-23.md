# Comms logic map — 2026-08-23

Verification map. Code wins over the build spec. Did not book a call. Did not change app code.

Assembled from four slices, then checked against **current git** (`a646cf74` at write time). The booking slice was written before three booking patches. This file uses **current code**.

Book page: `https://apply.fundhub.ai/funding-book-call` (ClickFunnels, not Cal.com).

Live proof that a phone or inbox actually rang: **UNVERIFIED**. This map is what gets **queued**. A pump every 5 minutes tries to send queued rows.

---

## How to read this

A **template key** is the name of one text or email (example: `SMS-S04-01-CONFIRM`).

**Queued** means the row is waiting. It is not the same as “they got it.”

**WIRED-BUT-OFF** means the file still exists, but nothing starts it (empty trigger, or send turned off).

**Owner-hold** means Chris already chose to leave it for later. Not tonight’s ship.

---

## Shared send gates (every queued text/email)

Sends only if:

- a client row is found
- a template row exists for that key
- the row is marked sendable
- the body is not draft / lorem copy
- for SMS: they have not opted out of texts

Then the row waits. It leaves only if:

- that company’s send switch is on (no row = ON)
- the dry-run fence is an explicit off value (`0` / `false` / `no` / `off`). Unset = **blocked**
- SMS is outside quiet hours (**11pm–11am Eastern**). Held SMS moves to the next 11:00 Eastern. Email is not held.
- a phone (SMS) or email (email) exists
- the daily cap is not already full (default 500 / day)

Missing or unapproved template → silent skip. Nothing is invented.

Two pumps drain the same table every 5 minutes. One row cannot go out twice.

---

## Named defects — still live vs already patched

| Named defect | Still in **current code**? | Note |
|---|---|---|
| Confirm text asks CONFIRM; router only heard YES (`f604e0c6`) | **No — patched.** `f604e0c6` | CONFIRM now counts like YES while the call is still booked. |
| Cancel did not stop leftover S-04B / BS-01 / Josh wait / 15-min text / DPC-05 (`fe041d47`) | **No — patched.** `fe041d47` | Those jobs now stop on `booking.cancelled` (same booking id, or same email). Josh already rang at book time cannot be un-rang. |
| Blank Where on confirm email (`19e8ac94`) | **No — patched.** `19e8ac94` | Empty Where row is omitted. ClickFunnels still has no join URL. |
| Josh not on quiet hours (`fe041d47`) | **No — patched.** `fe041d47` | Josh waits until 11am Eastern, same window as SMS. |
| Cal.com dead; only Cal.com emitted `booking.noshow`; S-05A has no live trigger | **Yes.** | ClickFunnels has no no-show ping. DPC-02 tags no-show after the appointment, but **does not** write `booking.noshow` yet. A sibling is wiring that. Not landed at write time. |
| ClickFunnels many `entry.captured` pings per one submit | **Yes.** | Live: often ~20 capture pings, ~15–17 survey pings, not “ten.” Webhook dedupe is **not** in code. Board: blocked until this map. |
| Held 5 and 6 (three emails at book; 2h + 15min soon texts; 24h-before vs 24h-after-book) | **Yes — owner-hold.** | Do not ship a change tonight. Listed in the booking sequence below. |

These patches are in **this git tree**. They are not a live-site proof. Pre-flight 1 still has to match live code to HEAD before anyone books.

---

## EVENT: entry.captured

Fires when: a new lead’s email hits Fundhub. ClickFunnels webhook (`src/adapters/clickfunnels.mjs`) for almost every non-appointment ping. Homepage survey (`api/public/survey-submit.mjs`). Pipeline “New Client” (`api/pipeline-clients.mjs`).

**ClickFunnels defect (unfixed):** one form fill is many events. Live count 2026-08-23: often about **20** `entry.captured` in 1–3 minutes (13 people had exactly 20). Two people had 10. Some tests had 21–23. Appointments are the exception — those become booking events, not capture.

  EMAIL-S00-WELCOME  |  email  |  fires at right away
    Sends only if: client found; this client’s welcome lock (`s00_welcome_sent_at`) is still empty; shared email gates.
    Stops if: no client. Lock already set. Missing/unapproved template.
    Sends once, or repeats: **once per client** in code (lock). ClickFunnels can start this job many times; only the first lock-win should queue. Live still showed 12 welcome emails to one person on 2026-08-22 (day welcome shipped). **UNVERIFIED** if that was before the lock, duplicate clients, or a race.
    Which file: `src/workflows/s-00-welcome.mjs`
    Live template: yes, sendable.

  SMS-S00-WELCOME  |  sms  |  fires at right away (same job as the welcome email)
    Sends only if: client found; same welcome lock already won on this run; shared SMS gates.
    Stops if: no client. Lock already set. Opted out of SMS.
    Sends once, or repeats: meant once. Same-day burst can still show repeats in the message table.
    Which file: `src/workflows/s-00-welcome.mjs`
    Live template: yes, sendable.

  EMAIL-S02-FINISH-APPLICATION  |  email  |  fires at +20 minutes
    Sends only if: client found; after the wait, **no** survey-submitted event for that client (or that email); shared email gates.
    Stops if: no client. They finished the survey during the wait (then they get tag `survey:complete` and **no** email).
    Sends once, or repeats: **repeats with every capture ping.** No once-lock. One ClickFunnels fill can start many 20-minute timers. If they never finish, many emails. Live: 46 queued rows; at least one person has 11.
    Which file: `src/workflows/s-02-incomplete-survey-nudge.mjs`
    Live template: yes, sendable.

  EMAIL-N01-COLD-NURTURE  |  email  |  **WIRED-BUT-OFF**
    Sends only if: would need a live trigger. Trigger list is empty as of 2026-08-22 (owner: cold copy was landing on brand-new leads).
    Stops if: job never starts.
    Sends once, or repeats: does not fire.
    Which file: `src/workflows/n-01-cold-nurture.mjs`
    Live template: yes, sendable — sitting unused.

  SMS-N01-COLD-NURTURE  |  sms  |  **WIRED-BUT-OFF**
    Same as the N-01 email. Same empty trigger.
    Which file: `src/workflows/n-01-cold-nurture.mjs`

  (no-message effects)
    Client row + GHL contact try: `src/handlers/client-lifecycle.mjs`.
    Tag `lead:new`, field `lifecycle_status=New Lead`, sales card on `new_lead`: **twice** — that handler **and** `src/workflows/s-01-new-lead-intake.mjs`. Same facts, two writers.
    First-touch date (only if empty): `src/workflows/at-01-first-touch-capture.mjs`.
    Affiliate owners (only if those params exist and not already locked): `src/workflows/af-02-referral-ownership-capture.mjs`.

Same-moment doubles: welcome email + welcome text (meant as a pair). **s-02 is not the same moment** (waits 20 minutes) but it **is** a double if ClickFunnels wrote many captures.

---

## EVENT: survey.submitted

Fires when: survey answers land. Same ClickFunnels ping as capture when answers are present (`src/adapters/clickfunnels.mjs`). Homepage survey writes it in the same submit as capture. Live ClickFunnels: often **15–17** survey events for one fill.

  SMS-NOBOOK-01  |  sms  |  fires at +2 hours
  EMAIL-NOBOOK-01  |  email  |  fires at +2 hours (right after the text)
  SMS-NOBOOK-02  |  sms  |  fires at +26 hours
  EMAIL-NOBOOK-02  |  email  |  fires at +26 hours
  SMS-NOBOOK-03  |  sms  |  fires at +98 hours
  EMAIL-NOBOOK-03  |  email  |  fires at +98 hours
    Sends only if: client found; they still have **no** `booking.created` on that client id; shared gates.
    Stops if: no client. A booking row for that client id exists when a step wakes. **Caveat:** most ClickFunnels booking rows also have **no** `client_id` on the event (42 of 49 live). The stop check looks at `client_id`. It can miss a real book. **UNVERIFIED** how often.
    Sends once, or repeats: **one full chase per survey ping.** No once-lock. One ClickFunnels fill can start many chases. Live table only showed 1× each NOBOOK SMS. **UNVERIFIED** why live did not fan out.
    Which file: `src/workflows/s-nobook-chase.mjs`
    Live templates: all six sendable.
    Spec wanted +2h / +24h / +72h **from survey**. Code waits one after another, so 2nd/3rd land later (+26h / +98h). Emails exist (spec asked for that).

  EMAIL-N02-WARM-NURTURE  |  email  |  **WIRED-BUT-OFF**
  SMS-N02-WARM-NURTURE  |  sms  |  **WIRED-BUT-OFF**
    Trigger removed 2026-08-22 so this chase owns the lane. File still registered. Template rows exist.
    Which file: `src/workflows/n-02-warm-nurture.mjs`

  (no-message effects)
    Answers saved on the client. If the last question is present, card moves to survey complete: `src/handlers/client-lifecycle.mjs`.

---

## EVENT: booking.created

Fires when: they pick a call time. ClickFunnels appointment created, **or** a form ping that already has a start time (`src/adapters/clickfunnels.mjs`). Cal.com can also fire it — **not** the live public book page.

If the form ping and the later appointment ping are the **same email + same start time**, the second book notice is skipped. If those times do not match, **both fire**. That would double every send below, including Josh.

ClickFunnels sets the meeting link to empty. Confirm email “Where” is omitted when empty (`19e8ac94`). Times print in America/Phoenix unless the client record has a zone.

### Right away

  SMS-S04-01-CONFIRM  |  sms  |  fires at right away
    Sends only if: client found; shared SMS gates.
    Stops if: no client. Opted out. Missing/unapproved template.
    Sends once, or repeats: once per booking notice. A later reschedule is a new run.
    Which file: `src/workflows/s-04b-booking-reminders.mjs`
    Copy asks them to reply CONFIRM. Book link in the text.

  EMAIL-S04-01-CONFIRM  |  email  |  fires at right away (right after the confirm text)
    Sends only if: client found; shared email gates.
    Stops if: no client. Missing/unapproved template.
    Sends once, or repeats: once per booking notice. Reschedule queues this again.
    Which file: `src/workflows/s-04b-booking-reminders.mjs`
    Empty Where row is omitted. There is **no** 24-hour reminder **email**.

  EMAIL-PORTAL-MAGIC-LINK  |  email  |  fires at right away
    Sends only if: client found; an email exists; portal-invite lock still empty; magic-link helper can issue a link.
    Stops if: no client. No email. Lock already set (second book does not send). Rate limit (3 asks / 15 min).
    Sends once, or repeats: **once per client**, until that lock is cleared. Not per booking. Not on reschedule. The same key is also used when a person **asks** for a login link (that path is not this lock).
    Which file: `src/workflows/s-portal-invite.mjs`
    Link dies in 15 minutes and works once.

  (Josh robot call)  |  voice  |  fires at right away, **or** at 11am Eastern if they booked during 11pm–11am Eastern
    Sends only if: client found; a usable phone; Bland key set; dry-run fence off. Uses Agent Editor row `AG-04` if live; else vendor Josh script.
    Stops if: no client. No phone. Phone system not connected. Fence up. **Cancel before the quiet-hours wait** kills the wait (`fe041d47`). Cancel after Josh already rang does not un-ring.
    Sends once, or repeats: once per `booking.created`. Does **not** run on reschedule. Does **not** check SMS opt-out.
    Which file: `src/workflows/ai-set-01-josh-setter.mjs`
    No message-template row. This is a phone call, not a queued SMS.

  BS-FUND-D1-E1-*  |  email  |  fires at right away
    Sends only if: client found; funding path already set (`FUNDING_PLUS_REPAIR` / `FULL_FUNDING` / `PREMIUM_STACK`); an approved template matches `BS-FUND-D1-E1-%`.
    Stops if: no client. No funding path (**most new books skip this**). No approved row. Does **not** check whether a call already happened.
    Sends once, or repeats: once per booking event id.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`
    Repair path uses `BS-REPAIR-D1-E1-*` with the same wait. Spec said keep repair cells OFF until copy is reviewed. Live extra lookup saw repair rows with lorem — dispatcher would block those. **UNVERIFIED** as a live send.
    **Owner-hold (item 5/6):** if a path **is** set, this is a **third email at book** (with confirm + portal). Do not change tonight.

  EMAIL-N03 / SMS-N03  |  —  |  **WIRED-BUT-OFF**
    Hot nurture: `enabled: false` and no triggers.
    Which file: `src/workflows/n-03-hot-nurture.mjs`

### Later — appointment clock (from the call time)

  SMS-S04-02-REMIND-24H  |  sms  |  fires at 24 hours **before the call**
    Sends only if: booking had a start time; client found; shared SMS gates; call not already held (`call.completed` for this client).
    Stops if: no start time (confirm still sent). Call already held. Opted out. They reschedule (old wait killed; new run starts). **Cancel now kills this wait** (`fe041d47`).
    Sends once, or repeats: once per run. If they booked less than 24 hours out, this can go out **right after confirm**.
    Which file: `src/workflows/s-04b-booking-reminders.mjs`

  SMS-S04-03-REMIND-2H  |  sms  |  fires at 2 hours **before the call**
    Same gates and stop rules as the 24-hour reminder (including cancel-kills-wait).
    Which file: `src/workflows/s-04b-booking-reminders.mjs`

  SMS-AISET04-HANDOFF  |  sms  |  fires at 15 minutes **before the call**
    Sends only if: start time present; client found; shared SMS gates.
    Stops if: no start time. **Cancel now kills this wait** (`fe041d47`). Does **not** restart on reschedule. Old 15-minute text can still fire at the **old** time unless cancel/reschedule kill rules match. Does **not** check “call already held.”
    Sends once, or repeats: once per `booking.created` only.
    Which file: `src/workflows/ai-set-04-3way-handoff.mjs`
    Copy mentions a meet link. This send passes **no** appointment context, so that link tag is blank unless it lives on the client record.
    **Owner-hold:** this is a second “your call is soon” text next to the 2-hour reminder. Do not change tonight.
    Closer task “3-way handoff” at the same moment (assignee is closer, not funding advisor).

### Later — book clock (from when they booked, not the call)

  SMS-BS01-02-PRECALL  |  sms  |  fires at 24 hours **after booking** (not 24 hours before the call)
    Sends only if: client found; shared SMS gates; call not already held at wake.
    Stops if: call held during the wait. Opted out. Reschedule kills the old run and starts a new one. **Cancel now kills this wait.**
    Sends once, or repeats: once per run. Runs even when there is **no** funding/repair email path.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`
    **Owner-hold:** this can land the same day as `SMS-S04-02-REMIND-24H` if the call is about 48 hours after book. Do not change tonight.

  BS-FUND-D1-E2-* through D3-E6-*  |  email  |  +12h through +71h after book (only if funding path)
    Clock from book, not wall-clock morning/lunch/night. Names in code (kickoff/morning/…) do not match the last word of the key.

    | Cell | Fires at |
    |---|---|
    | D1-E1 | book (listed above) |
    | D1-E2 | +12h |
    | D1-E3 | +13h |
    | D1-E4 | +16h |
    | D1-E5 | +19h |
    | D1-E6 | +23h |
    | D2-E1 | +35h |
    | D2-E2 | +36h |
    | D2-E3 | +39h |
    | D2-E4 | +42h |
    | D2-E5 | +46h |
    | D2-E6 | +47h |
    | D3-E1 | +59h |
    | D3-E2 | +60h |
    | D3-E3 | +63h |
    | D3-E4 | +66h |
    | D3-E5 | +70h |
    | D3-E6 | +71h |

    Sends only if: funding path; approved `BS-FUND-Dn-En-%` row; `call.completed` still missing (every cell **except** D1-E1).
    Stops if: call completed at that wake. No approved row (skip, keep going). Cancel/reschedule: reschedule restarts; **cancel now kills the run.** No-show does **not** stop leftover emails (S-05A is a different job).
    Sends once, or repeats: once per booking event id. A second booking is a new grid.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`
    `db/seed` has **no** `BS-FUND-*` / `BS-REPAIR-*` inserts. Keys come from the docs seeder, not `db/seed`. Code looks up by prefix. Docs missing header: `BS-FUND-D2-E3-lunch` (live extra lookup still saw a row). Repair docs missing several D2 cells — those skip.

  EMAIL-DPC05-NO-PROGRESS-72H  |  email  |  fires at +72 hours after booking
  SMS-DPC05-NO-PROGRESS-72H  |  sms  |  fires at +72 hours after booking
    Sends only if: tagged as a client (`client:funding` / `client:repair-referral` / `client:diy-letters`); not already escalated; not hard-stopped; last progress older than 72 hours (or never stamped).
    Stops if: not a client yet (**a lead who only booked is skipped**). Already escalated. Hard stop. Progress made. **Cancel now kills this wait.**
    Sends once, or repeats: once per booking notice that still looks stalled at +72h.
    Which file: `src/workflows/dpc-05-no-progress-escalation.mjs`

### Retired keys (seeded, nothing sends them on book)

- `SMS-BS01-01-BOOKED` — used to double the confirm text. Code stopped 2026-08-22.
- `SMS-BS01-03-DAYOF` — used to double the 2-hour reminder. Code stopped 2026-08-22.

### No send (same event)

- Tags `call:booked`, outcome booked, sales card to booked: `src/workflows/s-04-call-booked.mjs` **and** `src/handlers/comms.mjs` (so Pipeline does not wait on the job runner).
- Closer task + booking row: `src/handlers/comms.mjs` `onBookingCreated`. Skips interview/post-fund Meet bookings.
- DPC-02 waits until 5 minutes after the appointment **end**, then marks showed vs no-show. If it is a no-show, it emits `booking.noshow` so S-05A can start. **No client send from DPC-02 itself.**

---

## EVENT: booking.rescheduled

Fires when: ClickFunnels appointment rescheduled. File: `src/adapters/clickfunnels.mjs`. Cal.com was removed 2026-08-23.

  SMS-S04-01-CONFIRM  |  sms  |  fires at right away (new run)
  EMAIL-S04-01-CONFIRM  |  email  |  fires at right away (new run)
  SMS-S04-02-REMIND-24H  |  sms  |  fires at 24 hours before the **new** start
  SMS-S04-03-REMIND-2H  |  sms  |  fires at 2 hours before the **new** start
    Sends only if: same as book (S-04B listens to both).
    Stops if: old S-04B run is cancelled when the new ping has the same email **or** the same booking id. If both of those are missing/mismatched, old reminders keep going **and** a new run starts (**DOUBLE**).
    Sends once, or repeats: a reschedule is meant to send confirm again with the new time.
    Which file: `src/workflows/s-04b-booking-reminders.mjs`

  SMS-BS01-02-PRECALL + BS-FUND/BS-REPAIR grid  |  sms / email  |  new grid from the **new** book moment
    Same cancel/restart as S-04B. If cancel of the old run fails, **two grids** can run.
    Which file: `src/workflows/bs-01-precall-launcher.mjs`

Does **not** fire here:

- Josh call (only first book)
- portal magic link (lock already set)
- 15-minute Josh handoff text (only first book; old wait is **not** restarted — cancel-on reschedule is **not** listed on that job)

No send: closer task and booking row updated; outcome `rescheduled` (`src/handlers/comms.mjs`).

---

## EVENT: booking.cancelled

Fires when: ClickFunnels appointment canceled.

  (no client “sorry you cancelled” text or email)
    Which file: `src/handlers/comms.mjs` `onBookingCancelled` — closes the closer task, marks the booking cancelled, tags `call:cancelled`, sets outcome `cancelled`.

**Current code (`fe041d47`):** leftover S-04B reminders, BS-01 grid/SMS, 15-minute handoff, DPC-05, and a Josh quiet-hours **wait** stop on this event (same booking id or same email).

**Still true:** Josh who already called at book time is not pulled back. No cancel template is wired (spec out of scope).

---

## EVENT: booking.noshow

Fires when: DPC-02 marks a no-show 5 minutes after the appointment ends, then emits `booking.noshow`. File: `src/workflows/dpc-02-call-outcome-enforcement.mjs`. Cal.com used to be the only emitter. It was removed 2026-08-23.

  EMAIL-S05A-NOSHOW-RECOVERY  |  email  |  fires at once
  SMS-S05A-NOSHOW-RECOVERY  |  sms  |  fires at once
  EMAIL-S05A-NOSHOW-02 / SMS-S05A-NOSHOW-02  |  email + sms  |  fires at +24 hours
  EMAIL-S05A-NOSHOW-03 / SMS-S05A-NOSHOW-03  |  email + sms  |  fires at +72 hours
  EMAIL-S05A-NOSHOW-04 / SMS-S05A-NOSHOW-04  |  email + sms  |  fires at +168 hours (7 days)
    Sends only if: `booking.noshow` actually fires; client found; templates exist; they have not rebooked (checked before later touches).
    Stops if: a new `booking.created` for the same email, or a later book count goes up.
    Sends once, or repeats: four pairs unless they rebook.
    Which file: `src/workflows/s-05a-no-show-recovery.mjs`
    If the event never fires, **this whole job never runs.** Leftover BS-FUND emails can keep going after a tagged no-show, because they do not listen here.

  (no-message effects if the Cal.com event does fire)
    Task done, tag `call:no_show`: `src/handlers/comms.mjs` `onBookingNoshow`.

---

## EVENT: message.inbound

Fires when: they reply to a text or inbound email. Twilio / Mailgun adapters, then `src/workflows/dpc-03-inbound-reply-router.mjs`.

  (no send on YES or CONFIRM)  |  —  |  —
    Sends only if: n/a.
    Stops if: n/a.
    Current code (`f604e0c6`): **CONFIRM counts like YES.** While outcome is still `booked`, that marks the call confirmed. After the call, YES/CONFIRM means “send contract + collect payment” (task + closed-won). Hard-stopped: no send.
    Which file: `src/workflows/dpc-03-inbound-reply-router.mjs`

  SMS-DPC04-RESCHEDULE-REBOOKING  |  sms  |  fires at once if the body has the word reschedule
    Sends only if: client found (or phone match); not hard-stopped; shared SMS gates.
    Stops if: no keyword. Hard-stopped.
    Sends once, or repeats: once per inbound event id.
    Which file: `src/workflows/dpc-03-inbound-reply-router.mjs`
    Also: task + tag `setter:reschedule`. Link falls back to `https://apply.fundhub.ai/funding-book-call`.

  CLOSE  |  —  |  —
    Move to downsell, strip nurture tags. **No send.**

---

## EVENT: call.completed

Fires when: a closer saves the call (`src/sales/call-outcomes.mjs` now emits this — spec 2.1 is in code), **or** a Bland/Josh call ends (`src/adapters/bland.mjs`).

  EMAIL-OFFER-SOFT-PULL  |  email  |  fires at right away  (offerKey SOFT_PULL)
  EMAIL-OFFER-FUNDING-DFY  |  email  |  fires at right away  (offerKey FUNDING_DFY)
  EMAIL-OFFER-REPAIR-DFY  |  email  |  fires at right away  (offerKey REPAIR_DFY)
  EMAIL-OFFER-REPAIR-TRIAL  |  email  |  fires at right away  (offerKey REPAIR_TRIAL)
  EMAIL-OFFER-UWIQ-DELIVERABLES  |  email  |  fires at right away  (offerKey UWIQ_DELIVERABLES)
  EMAIL-OFFER-FUNDING-MASTERY  |  email  |  fires at right away  (offerKey FUNDING_MASTERY)
  EMAIL-OFFER-NONE  |  email  |  fires at right away  (offerKey `none`, or no key and outcome `not_a_fit`)
    Sends only if: payload `disposition` is **closer**; a matching offer key (or the none/not-a-fit fallback); client found; offer-bucket lock still empty; shared email gates.
    Stops if: not a closer save (Josh/Bland calls do nothing here). No matching template. No client. Lock already set (second closer save does not send, even if the offer changed).
    Sends once, or repeats: **once per client**, first closer save that has an offer template. Email only (spec: no SMS).
    Which file: `src/workflows/s-offer-bucket.mjs`
    Live templates: all seven sendable. Live `call.completed` rows: 4. No offer-bucket rows seen in `messages` in the capture pass.

  SMS-AISET03-MSG1  |  sms  |  fires at once if the call was no-answer / voicemail
  SMS-AISET03-MSG2  |  sms  |  fires at +30 minutes
  SMS-AISET03-MSG3  |  sms  |  fires at +2 hours 30 minutes
    Sends only if: disposition is no-answer / voicemail; client found; shared SMS gates. A closer save will not match, so this stays AI-only.
    Stops if: not that disposition. After MSG1, it “checks rebook” by asking “does this client have **any** `booking.created`.” Josh’s people **already** have that, so MSG2 and MSG3 should almost never send after a Josh miss. **UNVERIFIED** live. File comment still says a 24h wait; **code has no 24h wait.**
    Sends once, or repeats: MSG1 yes; MSG2/MSG3 likely skipped for booked leads. **Any** unanswered Bland call can start MSG1, not only Josh.
    Which file: `src/workflows/ai-set-03-no-answer-cadence.mjs`

  EMAIL-DS01-REPAIR-REFERRAL  |  email  |  fires at once
  SMS-DS01-REPAIR-REFERRAL  |  sms  |  fires at once
    Sends only if: sales outcome “Repair Referral Sent”, **or** declined + `repairReferral` true; not a hard decline; email **and** phone; **not** a funding-path client.
    Stops if: any of those fail.
    Sends once, or repeats: once per call event id.
    Which file: `src/workflows/ds-01-repair-referral.mjs`
    Tags `client:repair-referral`. Sets product path “Referred.”

  (no-message effects)
    S-08 funding-declined: tags/task, **no client send**.

---

## EVENT: deposit.paid

Fires when: the deposit clears.

  EMAIL-DOC-01-REQUEST  |  email  |  fires at right away
  SMS-DOC-01-REQUEST  |  sms  |  fires at right away
    Sends only if: client found; doc-request lock still empty; shared gates.
    Stops if: no client. Lock already set.
    Sends once, or repeats: **once per client**.
    Which file: `src/workflows/s-doc-collection.mjs`
    Live `deposit.paid` rows: 26. **No** DOC-01 rows in `messages` in that pass. **UNVERIFIED** if those 26 ran this job (many may predate it).

  (no-message effects)
    Funding hold, next action “Collect Documents”, tag `docs:missing`: same file.
    Funding-path tags/task (no mail): `src/workflows/s-06-post-call-funding-purchased.mjs`.
    Inquiry-removal flag/tag (no mail): `src/workflows/c-02b-inquiry-removal-requested.mjs`.

---

## EVENT: docs.received

Fires when: a file shows up for the doc checker (`src/workflows/ghl-doc-document-check.mjs` → `src/handlers/ghl-doc.mjs`). Also clears a missing-docs hold if F-06 set it (**no send** on that path).

  EMAIL-DOC-03-APPROVED  |  email  |  fires at right away if the checker says accept
  SMS-DOC-03-APPROVED  |  sms  |  fires at right away if accept
  SMS-DOC-02-REQUEST-MORE  |  sms  |  fires at right away if the checker says request_more
    Sends only if: this file is a client upload / known doc type (not an inquiry letter); checker returns accept or request_more; shared gates.
    Stops if: wrong doc kind. Checker says hold (makes a task, **no** extra mail).
    Sends once, or repeats: once per `docs.received` that routes to accept or request_more.
    Which file: `src/handlers/ghl-doc.mjs`
    Live templates: all three sendable. Live `docs.received` rows: 3. **UNVERIFIED** if those three queued mail.

  (no-message effects)
    Accept: drop `docs:missing`, clear the funding hold, next action “Optimize Profile.”
    Hold: task for the closer, gate stays closed.

---

## EVENT: inquiry.docs.needed

Fires when: inquiry work needs more files (`src/handlers/inquiry-docs.mjs`).

  EMAIL-F06-MISSING-DOCS  |  email  |  fires at once
  SMS-F06-MISSING-DOCS  |  sms  |  fires at once
    **Same two keys** as F-06 on mail.response. Tags `docs:missing` + `inquiry:docs_needed`.
    **DOUBLE:** if both this event and F-06 `mail.response` fire, two email+SMS pairs.

---

## EVENT: mail.response

  EMAIL-F06-MISSING-DOCS  |  email  |  fires at once (missing-docs mail only)
  SMS-F06-MISSING-DOCS  |  sms  |  fires at once
    Sends only if: classification `MISSING_DOCS` **and** condition text present.
    Stops if: other mail classes. No condition text. No client.
    Which file: `src/workflows/f-06-funding-conditions-missing-docs.mjs`

---

## EVENT: round.started

Fires when: Lendflow adapter or card-stacking “apply now.”

  SMS-ROUND-STARTED-NOTIFY  |  sms  |  fires at once
    Sends only if: client found; shared SMS gates.
    Which file: `src/workflows/round-started-client-notify.mjs`

  EMAIL-F02-ID-PORTAL-NEEDED  |  email  |  fires at +3 hours
  SMS-F02-ID-PORTAL-NEEDED  |  sms  |  fires at +3 hours
  EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP  |  email  |  fires at +3 hours + 2 days
    Sends only if: ID still not uploaded **or** portal onboarding not Complete.
    Stops if: docs already there at the check.
    Which file: `src/workflows/f-02-portal-id-missing.mjs`
    Follow-up is **email only**.

  (no send)
    F-01 tags/tasks only. F-10 still registered; **sends retired**. Keys `EMAIL-F10-INBOX-SETUP` / `SMS-F10-INBOX-SETUP` unused.

---

## EVENT: round.submitted

  EMAIL-F03-ROUND-SUBMITTED  |  email  |  fires at once
  SMS-F03-ROUND-SUBMITTED  |  sms  |  fires at once
    Sends only if: client found; round number present.
    Stops if: no round number.
    Which file: `src/workflows/f-03-round-submitted.mjs`
    Sets employee next action “Remove Inquiries.”

---

## EVENT: round.approved

  EMAIL-F04-ROUND-APPROVALS  |  email  |  fires at once
  SMS-F04-ROUND-APPROVALS  |  sms  |  fires at once
    Sends only if: approved amount greater than 0.
    Stops if: amount is 0 or missing.
    Which file: `src/workflows/f-04-round-approvals.mjs`

---

## EVENT: round.funded

  EMAIL-F07-FUNDING-LOCKED  |  email  |  fires at once (only if amount **and** fee % both present)
  SMS-F07-FUNDING-LOCKED  |  sms  |  fires at once
    Stops if: amount or percent missing (ops tag + task, **no client send**).
    Which file: `src/workflows/f-07-funding-locked.mjs`
    Then a success-fee invoice can start AR chase **the same day** (see `invoice.sent`). **DOUBLE:** F-07 now + AR-01 now. Different keys.

  EMAIL-N06-RENEWAL  |  email  |  fires at +180 days
  SMS-N06-RENEWAL  |  sms  |  fires at +180 days
    Sends only if: a funding round still has funded amount > 0.
    Which file: `src/workflows/n-06-renewal-second-wave.mjs`

---

## EVENT: invoice.sent

  EMAIL-AR-01-FIRST-NOTICE  |  email  |  fires at once
  SMS-AR-01-FIRST-NOTICE  |  sms  |  fires at once
  EMAIL-AR-02-REMINDER  |  email  |  fires at +7 days
  SMS-AR-02-REMINDER  |  sms  |  fires at +7 days
  EMAIL-AR-03-FINAL-NOTICE  |  email  |  fires at +14 days
  SMS-AR-03-FINAL-NOTICE  |  sms  |  fires at +14 days
    Sends only if: success-fee invoice (or `source = funding_success_fee`); still open; shared gates.
    Stops if: not success fee. Invoice no longer open. Paid (`invoice.paid` cancel-on that invoice id).
    Sends once, or repeats: once per invoice-sent event. After AR-03: escalate + tag. **No 4th client message.**
    Which file: `src/workflows/ar-collections.mjs`
    Staff/API invoice email is a **different** key (`INVOICE-SENT-EMAIL`). Not these AR keys.

---

## EVENT: payment.received

  (AR settle)  |  —  |  —
    Settles the matching open success-fee invoice. **No client message.** 5B.2 allocation is a separate money commit (`a646cf74`) — not this map.

  EMAIL-DS02-DIY-LETTERS-READY  |  email  |  fires at once
    Sends only if: product name contains “consulting services package” or “diy”; client is **repair-only** path.
    Stops if: funding path. Not DIY name.
    Which file: `src/workflows/ds-02-diy-letters.mjs`
    **DOUBLE:** closer deck can queue the **same key**. Different event ids, so both can send if staff deck + payment workflow both run.

---

## EVENT: round.closeout

Fires when: money-chain emits it per funded round (`src/handlers/money-chain.mjs`), **or** staff marks the engagement closed (`src/funding/card-stacking-rounds.mjs` stage `closed`). Spec 4.8 said nothing emitted this; **code now does.**

  EMAIL-N04-POST-FUNDING  |  email  |  fires at once **only** if `stage = closed` **or** `engagementComplete = true`
  SMS-N04-POST-FUNDING  |  sms  |  fires at once (same gate)
    Stops if: money-chain closeout **without** those fields (F-07 owns the funded instant).
    Which file: `src/workflows/n-04-post-funding-nurture.mjs`

---

## EVENT: analysis.completed

  EMAIL-AX07-FUNDING-PAUSED  |  email  |  fires at once (new negatives only, not first snapshot)
  SMS-AX07-FUNDING-PAUSED  |  sms  |  fires at once
    Sends only if: payload source is CRS; not first snapshot; new negative keys.
    Stops if: first snapshot. No new keys. Not CRS.
    Which file: `src/crs/snapshot-negatives.mjs` (from `src/workflows/u-03-crs-snapshot-sync.mjs`)
    5B.1 (what happens after the pause task) is **not** in this map. Do not implement.

  U-02 delivery emails  |  —  |  **sends retired**
    Tags only. Keys unused.

  C-06 decline email/SMS  |  —  |  **off** (owner: never tell someone they are declined)

---

## EVENT: clock (daily 10:00 UTC) — unsigned contract

Also API `/api/contracts` `run_reminders`.

  CONTRACT-SEND-EMAIL  |  email  |  fires when staff send the contract (not the daily cron)
    Which file: `src/contracts/notify.mjs`

  CONTRACT-REMIND-EMAIL  |  email  |  fires at +3 days, then every +3 days, max 4
    Sends only if: contract still sent/viewed, unsigned; under max chases.
    Stops if: signed. Max chases hit. Send switch off.
    Which file: `src/contracts/notify.mjs` + `src/workflows/contract-chaser.mjs`

---

## Not an Inngest event — staff / payment / portal / repair

These still **queue** client-facing rows. The pump still has to drain them.

  (staff compose)  |  sms or email  |  when staff hit send
    No template key. Quiet-hours hold on SMS.

  payment_link_notice  |  sms  |  when staff hits send
    **Switched off in seed:** unapproved. Queues nothing useful until a human flips that flag.
    Which file: `api/payment-links.mjs`

  EMAIL-PORTAL-MAGIC-LINK  |  email  |  when a person asks for a login link
    Same key as the book-time invite. Rate limit 3 / 15 min.

  INVOICE-SENT-EMAIL  |  email  |  when staff/API emails an invoice
    Not the AR-01/02/03 keys.

  EMAIL-REPAIR-WELCOME  |  email  |  `repair.enrolled`
  EMAIL-REPAIR-LETTERS-SENT  |  email  |  `repair.letters.sent`
  EMAIL-REPAIR-RESPONSE-RESULTS  |  email  |  `repair.response.parsed`
  EMAIL-REPAIR-ROUND-ADVANCED  |  email  |  `repair.round.escalated`
  EMAIL-REPAIR-RETAKE-PHOTO  |  email  |  `repair.response.retake`
  EMAIL-REPAIR-TRIAL-COMPLETE-UPSELL  |  email  |  `repair.program.complete`
    Which file: `src/repair/notify.mjs`
    **Not in `db/seed/`.** Rows live in `db/migrations/253_repair_email_templates.sql`. Whether that migration ran live: **UNVERIFIED**.

Inquiry-call sweeper: bureau calls. **Not** client SMS/email.

---

## Keys called with no `db/seed` row (or unused)

| Key | Status |
|---|---|
| `BS-FUND-*` / `BS-REPAIR-*` | Not in `db/seed`. Docs seeder. Live extra lookup saw funding rows; repair matched lorem. |
| Repair `EMAIL-REPAIR-*` | Migration 253 only, not `db/seed`. |
| `payment_link_notice` | Seeded **unapproved**. |
| `SMS-BS01-01-BOOKED`, `SMS-BS01-03-DAYOF` | Seeded, **no sender**. |
| `BS-EMAIL-FUNDING-72HR`, `BS-EMAIL-REPAIR-72HR` | Docs/live lookup; **no sender**. |
| `SMS-BS01-01-CONFIRMATION-HUB`, `SMS-BS01-02-PRECALL-NUDGE` | Live lookup only; **no sender** in `src/`. |
| `EMAIL-F10-INBOX-SETUP`, `SMS-F10-INBOX-SETUP` | Send retired. |
| `EMAIL-U02-ANALYZER-*` | Send retired. |
| `EMAIL-C06-DECLINE`, `SMS-C06-DECLINE` | Decline send off. |
| N-01 / N-02 / N-03 keys | Templates exist; jobs will not start. |

---

## 1. Code vs spec diffs

Spec: `docs/workflows/build-spec-2026-08-22.md` plus copy in `docs/workflows/missing-copy-2026-08-22.md`. **Code wins.**

Code does what the spec asked (already built):

- Welcome + welcome text on capture; portal invite on book; offer-bucket emails on closer save; doc request on deposit; GHL-DOC on `docs.received`; N-01/02/03 off; U-02 / F-10 / C-06 decline sends off; N-04 on closeout not funded; no-show four touches **if the event fires**; closer `call.completed` emit; 3-way task assignee is closer; AX-07 pause email/SMS on new CRS negatives.

Code disagrees with the spec:

- No-book delays are **+2h / +26h / +98h**, not spec +2 / +24 / +72 from survey. Emails exist.
- AI-SET-03 has **no 24h third wait** (comment is stale). Clock is now / +30 min / +2h30.
- `booking.noshow` still has **no live ClickFunnels trigger**. Spec 4.4 sequence is wired to an event that the public book page does not emit. DPC-02 tags no-show but does not emit the event (sibling not landed).
- ClickFunnels one-submit → one `entry.captured` is **not** true. Spec did not name the 10×/20× ping. Live is often ~20.
- No-book stop looks at `client_id` on booking events; ClickFunnels bookings often have none.
- Spec 4.8 said nothing emits `round.closeout`. Money-chain **does** emit it per funded round. N-04 skips those payloads unless staff closeout fields are set.
- Spec 2.3 GHL-RECON watchdog: still orphaned. No client send.
- Dispatch file header still says the workflow queue is not drained. **Code disagrees.** The Inngest sweeper drains all queued outbound rows.
- `MESSAGING_DRY_RUN` unset still means **blocked**. Live value **UNVERIFIED**.
- BS-REPAIR: spec said stay OFF. Code will send if repair path + approved non-lorem row. Live extra lookup saw lorem (dispatcher would block).
- 5B.1 pause-recovery chain: spec backlog. **Not built.** Do not implement tonight.
- 5B.2 invoice allocation: money commit `a646cf74`, not a comms send.

Owner-hold (spec 5 / tonight’s “5 and 6”) — code still does these; **do not change tonight:**

- Three emails at book **if** a product path is already set (confirm + portal + BS-FUND kickoff).
- 2-hour reminder **and** 15-minute handoff (two “soon” texts).
- 24-hour-**before-call** text **and** 24-hour-**after-book** text.

---

## 2. Possible doubles

| When | What piles on |
|---|---|
| One ClickFunnels fill | Many `entry.captured` (often ~20) + many `survey.submitted` (often ~15–17) |
| Each capture if survey never finishes | Many `EMAIL-S02-FINISH-APPLICATION` 20 minutes later (no lock) |
| Each survey ping if they never book | Many no-book chases in code (no lock). Live mostly did not show that fan-out. |
| Each capture | Welcome email + welcome text (pair). Intake tags **and** lifecycle handler do the same New Lead work. |
| `booking.created` | Confirm text + confirm email + portal email + Josh. **Plus** BS-FUND kickoff email if a path is set (**owner-hold**). |
| Form ping + appointment ping with mismatched start times | Two `booking.created` → two confirms, two Josh dials |
| ~24h after a book that is ~48h before the call | S-04B 24h-before-call **and** BS-01 24h-after-book (**owner-hold**) |
| 2h before the call | S-04B 2h text **and** AI-SET-04 15-min text (**owner-hold**) |
| Reschedule that does not match email or booking id | Old reminders plus new confirms |
| After tagged no-show | Leftover BS-FUND emails can keep going **and** S-05A would start **if** `booking.noshow` ever fires |
| `round.started` | Notify SMS now + F-02 SMS at +3h if portal/ID still missing |
| `round.funded` with fee lock | F-07 now + AR-01 now |
| Missing docs two events | F-06 and `inquiry.docs.needed` share F-06 keys |
| DIY letters | DS-02 and closer deck share `EMAIL-DS02-DIY-LETTERS-READY` |
| Two sweepers | Same **row** is not sent twice |

N-02 vs no-book chase: **not** a double. N-02 trigger is empty.

---

## 3. Expected sequence — one new booking on the live book page

This is **pre-flight item 5**. Compare the next test against this list, not memory.

Page: `https://apply.fundhub.ai/funding-book-call`.

Assume:

- they are already a lead (survey already in)
- this is their **first** portal invite
- **no** funding/repair path yet (typical new book)
- the call is **more than 24 hours** out
- they book **outside** 11pm–11am Eastern
- ClickFunnels writes **one** `booking.created` (form time matches appointment time)
- send switch on, dry-run fence explicitly off, templates sendable

Then they should get, in time order:

| # | Template key | Channel | When |
|---|---|---|---|
| 1 | `SMS-S04-01-CONFIRM` | sms | right away |
| 2 | `EMAIL-S04-01-CONFIRM` | email | right away |
| 3 | `EMAIL-PORTAL-MAGIC-LINK` | email | right away (first book only) |
| 4 | Josh robot call | voice | right away (no template key) |
| 5 | `SMS-BS01-02-PRECALL` | sms | +24 hours **after book** |
| 6 | `SMS-S04-02-REMIND-24H` | sms | 24 hours **before the call** |
| 7 | `SMS-S04-03-REMIND-2H` | sms | 2 hours **before the call** |
| 8 | `SMS-AISET04-HANDOFF` | sms | 15 minutes **before the call** |

They should **not** get on this typical book:

- `BS-FUND-*` emails (no path yet)
- DPC-05 email/text (not tagged as a paying client yet)
- no-show recovery (event likely never fires on this page)
- welcome / finish-app / no-book chase (those are capture/survey, already past if they only book now)

If they booked **during** 11pm–11am Eastern: row 4 waits until **11am Eastern**. Confirm SMS may also wait until 11am; confirm email still goes.

If they booked **inside 24 hours**: row 6 can fire **right after** confirm.

If they **already have a funding path**: add `BS-FUND-D1-E1-*` email at book, then the rest of the 3-day grid until the call is held. That is the **third email at book**. **Owner-hold. Not tonight’s ship.**

If ClickFunnels sends two book notices with different start times: **everything in 1–4 can happen twice**, including Josh.

If they also just filled the apply form: that is a **separate** storm (many capture + survey pings). Welcome should be once (lock). Finish-app and no-book chase can still multiply until webhook dedupe ships.

Rows 5 + 6 can land the same calendar day when the call is about two days out. Rows 7 + 8 are two “soon” texts. **Owner-hold. Not tonight’s ship.**

---

## 4. Safe to book?

**No.**

Do not book until **all** of these are true:

1. Pre-flight 1 — live site matches git HEAD (this tree is `a646cf74` at write; live hash not proven here).
2. Pre-flight 2 — six-copy precall explained (not this file).
3. Pre-flight 3 — no leftover Inngest jobs from prior tests (not this file).
4. Pre-flight 4 — Inngest function list synced (not this file).
5. Pre-flight 5 — this sequence, written above.
6. Pre-flight 6 — baseline max `messages.id` + row count (not this file).
7. ClickFunnels 10×/20× `entry.captured` ping is **still unfixed** in code. A book-page-only test may skip capture, but a fill+book test will see many pings again.

Also still true at write time: S-05A has **no live ClickFunnels no-show trigger**. DPC-02 does not emit `booking.noshow` yet.

Held 5 and 6 stay held.

---

## UNVERIFIED (not a pass)

- Whether a live phone or inbox got any of this (only queued rows were counted in the slices).
- Live `MESSAGING_DRY_RUN` and company send switch.
- Whether Inngest `cancelOn` sees `event.data.payload.email` / `bookingUid` the way the bus sends them.
- Whether form start time and appointment start time always match.
- Whether a wait whose clock time is already past fires at once on the live runner.
- Whether the sibling `booking.noshow` wire landed after this file (check `src/workflows/dpc-02-call-outcome-enforcement.mjs` — at write, it did not emit).
- Exact ClickFunnels subscription list (contact created vs updated vs each survey step).

---

## Sources

Slices (code-derived, 2026-08-23):

- `docs/workflows/comms-logic-2026-08-23-slice-capture.md`
- `docs/workflows/comms-logic-2026-08-23-slice-booking.md`
- `docs/workflows/comms-logic-2026-08-23-slice-precall.md`
- `docs/workflows/comms-logic-2026-08-23-slice-chase.md`

Spec compared: `docs/workflows/build-spec-2026-08-22.md`, `docs/workflows/missing-copy-2026-08-22.md`.

Current-tree check (after slices): `dpc-03` CONFIRM=`f604e0c6`; cancel-on + Josh quiet hours=`fe041d47`; blank Where=`19e8ac94`; DPC-02 still no `booking.noshow` emit; ClickFunnels still maps non-appointment pings to `entry.captured`.
