# Where `logStaffEvent()` should be called from

**APPLIED (W1). All four call sites below are now wired.** This document was a
proposal; it is now the record of what was done and what deliberately was not.

What changed, and what did not:

| kind | call site | state |
|---|---|---|
| `call_made` | `src/inquiries/work.mjs` `logAttempt()`, `kind: "call"` | **writes a row today** |
| `letter_issued` | same function, `kind: "letter"` | **writes a row today** |
| `text_sent` | `src/workflows/messaging.mjs` `sendTemplated()` | wired, **silent** — emits only when a caller passes `staffId`, and no caller does |
| `pull_run` | `src/handlers/client-lifecycle.mjs` `onAnalysisCompleted()` | wired, **silent** — emits only when the event names an actor, and no emitter does |

The two silent ones are silent because **there is no actor to name**, not because
the wiring is incomplete. The analysis in the rest of this document is why. A row
appearing in either place today would mean somebody invented an employee.

Decisions taken while applying it:

1. **The `shift_id` question (see below) was answered with option 2** —
   `currentShift()` is resolved at the `logAttempt` call site, one extra `SELECT`
   per attempt. Rationale: §14 telemetry exists to answer "on whose clock", a
   null `shift_id` cannot be repaired later without guessing, and someone who is
   not clocked in still honestly gets null.
2. **`portal` and `note` write nothing.** `portal` is a real staff action with no
   word in `EVENT_KINDS`; filing it under `letter_issued` would make the letter
   count wrong. Still a reportable gap (item 2 under "What is missing").
3. **`sendTemplated()` gained optional `staffId` / `shiftId` arguments.** All 39
   existing call sites pass neither and are unaffected. The guard is
   `if (staffId && channel === "sms")` rather than relying on `logStaffEvent()`
   refusing a null id, so an automated send does not print a swallowed-failure
   line on every message.
4. **`pull_run` reads `actorStaffId` off the event payload** and emits only when
   present. It sits after the replay-dedupe guard, so a replayed
   `analysis.completed` cannot log a second pull.

Tests: `src/shifts/telemetry-callsites.test.mjs`.

`src/shifts/telemetry.mjs` is the writer for `staff_events`. This file is the
other half of the job: for each of the five kinds in `EVENT_KINDS`, *where the
action actually completes today* and *the exact call that should be added there*.

It is a proposal, not a patch, for one reason: those call sites are spread across
files other build threads are writing in right now, and the plan's own rule is
"prefer emitting from existing call sites over inventing new ones" — which means
the emit belongs in files this thread does not own. Whoever integrates should
apply these one at a time, each with the file's owner.

---

## The finding that matters most, before the table

**Three of the five kinds have no staff-attributed call site anywhere in this
repository.** Not a call site that is hard to reach — one that does not exist.

`staff_events.staff_id` is `uuid NOT NULL REFERENCES staff(id)`. A telemetry row
*is* an attribution: "this person did this". But the pull, the letter and the
text are all issued today by **Inngest workflows and event handlers reacting to
system events**, and a workflow has no staff member. It has an `orgId`, a
`clientId` and an event id. There is nobody to attribute the work to, and there
is no column, payload field, or table anywhere that says which employee caused a
workflow to run.

So the honest answer for `pull_run`, `letter_issued` and `text_sent` is **not**
"call `logStaffEvent()` here with some staff id" — inventing an actor is exactly
the failure mode the repo's headline rule exists to prevent. It is: *these
actions are not performed by staff in this system as it stands.* If §14 telemetry
is meant to count them per person, that is a **product gap**, and the fix is
upstream of this module (see "What is missing" at the end).

Two kinds — `call_made` and `letter_issued` — **do** have a real staff-attributed
call site, and it is the same function: `logAttempt()` in `src/inquiries/work.mjs`.
That one is ready to wire today.

---

## `call_made` — READY. One real call site.

**Where the action completes:** `src/inquiries/work.mjs:36` — `logAttempt()`,
with `kind: "call"`. The row is inserted at `src/inquiries/work.mjs:47-51`
(`INSERT INTO inquiry_attempts`) and the transaction returns at
`src/inquiries/work.mjs:71`. This is an inquiry specialist phoning a furnisher or
a bureau, with `staffId` already required and already validated
(`src/inquiries/work.mjs:38` — `401` if absent).

Reached from `api/inquiries.mjs:40-45`, `POST { action: "attempt", kind: "call" }`,
where `staffId` comes off the session principal (`api/inquiries.mjs:23`) and never
off the body.

**The call to add.** `logAttempt()` currently *returns* the transaction
(`src/inquiries/work.mjs:41`, `return withTransaction(db, async (tx) => {`). The
emit must happen **after the commit**, so line 41 becomes a binding and the
existing `return updated;` at line 71 stays inside the callback:

```js
// at the top of src/inquiries/work.mjs
import { logStaffEvent } from "../shifts/telemetry.mjs";

// src/inquiries/work.mjs:41 — `return withTransaction(` becomes `const updated = await withTransaction(`
const updated = await withTransaction(db, async (tx) => {
  /* ...unchanged, still ending in `return updated;` at line 71... */
});

// AFTER the commit, never inside it: telemetry must not be able to roll back
// the attempt it is describing, and a row that says "called" must not exist for
// a call whose transaction was rolled back.
if (kind === "call" || kind === "letter") {
  await logStaffEvent(db, {
    orgId:   updated.org_id,          // inquiry_log.org_id, off the row just written
    staffId,                          // already required by logAttempt
    shiftId: null,                    // SEE "the shift_id problem" below
    kind:    kind === "call" ? "call_made" : "letter_issued",
    detail:  {
      inquiry_id: updated.id,
      client_id:  updated.client_id,
      outcome:    outcome ?? null,    // NULL survives — the desk may not know yet
      attempt_no: updated.call_attempts
    }
  });
}

return updated;
```

`kind: "portal"` and `kind: "note"` get **no** telemetry row. `note` is
explicitly not an attempt (`src/inquiries/work.mjs:14-16` — "a desk that inflates
its attempt count is lying to a bureau, slowly"), and `portal` is neither a call
nor a letter — there is no kind in `EVENT_KINDS` for filing through a bureau
portal. **That is a reportable gap, not a reason to file it under one of the
other four.**

No `try`/`catch` is needed around the call: `logStaffEvent()` never throws.

## `letter_issued` — READY at the same call site; the automated ones have no actor.

**Staff-attributed (wire this):** `src/inquiries/work.mjs:36` with
`kind: "letter"` — an inquiry specialist mailing a correction request. Covered by
the snippet above.

**Not staff-attributed (do NOT wire these):**

| where | what it is | why there is no call |
|---|---|---|
| `src/workflows/ds-02-diy-letters.mjs:111` — `step.run("deliver-letters", …)` | DIY dispute-letter pack, delivered by POSTing UnderwriteIQ-lite | An Inngest workflow on `payment.received` (`ds-02-diy-letters.mjs:123`). No staff member is involved at any point. |
| `src/workflows/c-06-crs-results-router.mjs:145-146` — `step.run("deliver-funding-letters", …)` | the funding letter set, same webhook, `letterSet: "funding"` | Same: a workflow reacting to `analysis.completed` (`c-06-crs-results-router.mjs:158`). |

Both are automation. Attributing them to a staff member would mean inventing one.

Note also: `letter.generated` is already a canonical event
(`src/events/canonical.mjs:24`) and **nothing in the repository emits it.** If the
letter workflows ever do, a handler on that event is a cleaner home for automated
letter telemetry than these two call sites — but `staff_events` is still the wrong
table for it, because there is no staff member.

## `text_sent` — NO staff-attributed call site exists.

**Where the action completes:** `src/workflows/messaging.mjs:74-78` — the
`INSERT INTO messages … status='queued'` inside `sendTemplated()`, returning
`{ sent: true }` at `src/workflows/messaging.mjs:79`. That is the **only**
outbound-message writer in the repository.

**All 39 of its call sites, across 22 files, are Inngest workflows**, and not one
of them has a staff id. In full, by file:
`ai-set-03-no-answer-cadence.mjs` (3), `ai-set-04-3way-handoff.mjs` (1),
`bs-01-precall-launcher.mjs` (1), `c-06-crs-results-router.mjs` (2),
`dpc-03-inbound-reply-router.mjs` (1), `dpc-05-no-progress-escalation.mjs` (2),
`ds-01-repair-referral.mjs` (2), `ds-02-diy-letters.mjs` (1),
`f-02-portal-id-missing.mjs` (3), `f-03-round-submitted.mjs` (2),
`f-04-round-approvals.mjs` (2), `f-06-funding-conditions-missing-docs.mjs` (2),
`f-07-funding-locked.mjs` (2), `f-10-client-funding-inbox-provisioner.mjs` (2),
`n-01-cold-nurture.mjs` (2), `n-02-warm-nurture.mjs` (2), `n-03-hot-nurture.mjs` (2),
`n-04-post-funding-nurture.mjs` (2), `n-06-renewal-second-wave.mjs` (2),
`round-started-client-notify.mjs` (1), `s-02-incomplete-survey-nudge.mjs` (1),
`u-02-analyzer-complete-delivery.mjs` (1).

There is **no endpoint under `api/` that lets a staff member send a message** —
no `api/messages.mjs`, no send action on any existing endpoint. So "texts sent by
this person" is not a number this system can produce, and no call is proposed.

If a staff-facing send is ever built, the emit goes immediately after the
`INSERT` succeeds (i.e. before `return { sent: true }`), with the staff id
threaded down as a new argument to `sendTemplated()` — and **only when one is
present**:

```js
// PROPOSED, for a future staff-initiated send only. sendTemplated() would need
// a `staffId` argument; a workflow would keep passing nothing and no row would
// be written, which is the correct outcome rather than an unattributed row.
if (staffId && channel === "sms") {
  await logStaffEvent(db, {
    orgId, staffId, shiftId: null, kind: "text_sent",
    detail: { client_id: clientId, template_key: templateKey, channel }
  });
}
```

Also worth knowing before anyone counts these: `sendTemplated` writes
`status='queued'` and **nothing transmits** — there is no outbound fetch in
`src/adapters/` or `src/lib/`. A `text_sent` row would record "a message was
queued", not "a message reached a phone".

## `pull_run` — NO staff-attributed call site exists.

A credit pull is requested and returned entirely through events. Three places
touch it, none with a staff member:

| where | what it is | why there is no call |
|---|---|---|
| `src/workflows/c-00-crs-soft-pull-request.mjs:26` — `step.run("set-crs-request-fields", …)` | marks CRS Status = Requested | Inngest workflow on `diagnostic.paid` (the $32 payment). The *client* pays; no employee runs anything. |
| `src/adapters/crs.mjs:158` — `emitCrsResult({ db, engineResult, clientId })` | the platform calls this after the CRS engine finishes | An adapter. Its whole documented contract is normalize + emit, "and NOTHING else" (`src/adapters/crs.mjs:7-9`). It has no staff context and should not grow one. |
| `src/handlers/client-lifecycle.mjs:124-138` — `onAnalysisCompleted`, `INSERT INTO crs_results` at line 135 | where the pull's result is actually stored | An event handler on `analysis.completed`. Handlers receive `(event, db)`; `event` carries `orgId`/`clientId` and no staff id. |

`src/handlers/client-lifecycle.mjs:135` is the line where "a pull ran" becomes
true, and is the right place **if** an actor ever exists. As of today it does not,
so no call is proposed.

## `file_touched` — candidates exist, but the kind is undefined.

Not in the four this thread was asked to document, and listed only so the next
person does not have to re-derive it. Three places where a staff member
demonstrably touches a client's file:

- `src/pii/index.mjs:167` — `revealSsn()`, which already writes its own
  attributed audit row (`INSERT INTO pii_access_log`, line 179) with
  `accessedBy` = the session's staff id (`api/pii.mjs:57`).
- `src/inquiries/work.mjs:83` `confirmRemoval()` and `src/inquiries/work.mjs:105`
  `setStatus()` — both set `worked_by = staffId`.
- `api/tasks.mjs` — `PATCH { id, claim: true }`, staff id off the principal.

**No call is proposed for any of them**, because "file_touched" is not defined
anywhere: the schema comment gives the token and nothing else. Whether opening a
record counts, or only changing one; whether a PII reveal is a *file* touch or
its own thing given it already has a dedicated log; whether every task claim
should produce a row — those are telemetry-spec questions. Answering them by
picking call sites would be inventing the definition.

---

## The `shift_id` problem — read this before wiring anything

Every proposed call above passes `shiftId: null`.

`staff_events.shift_id` is a nullable FK, and null is an honest value ("this work
is not linked to a shift"). But telemetry whose entire purpose is §14 — who was
on the file, when, on whose clock — is much less useful unlinked, and a null
shift_id cannot be repaired later without guessing which shift a timestamp fell
inside.

The link is one query: `currentShift(db, { staffId })` from
`src/shifts/store.mjs`. `logStaffEvent()` deliberately does **not** call it
itself — resolving the open shift inside the writer would attach work to a shift
the caller never named, and would add a second round trip to every business
action whether or not it wanted one.

So this is a decision for whoever wires the first call site, and it should be made
once for all of them:

1. **`shiftId: null`** — cheapest, honest, and the telemetry cannot answer "on
   which shift".
2. **`shiftId: (await currentShift(db, { staffId }))?.id ?? null`** — one extra
   `SELECT` per action, correct answer, and still null for someone who is not
   clocked in.
3. **Resolve it in the HTTP layer once per request** and thread it down —
   cheapest correct option, but it needs a place to live that does not exist yet.

There is no basis in the repo for choosing; it is a cost/fidelity call, not a
fact. **Pick one deliberately.**

---

## What is missing, stated plainly

1. **Three of the five kinds have no actor.** `pull_run`, `letter_issued` (the
   automated ones) and `text_sent` are performed by workflows. `staff_events`
   requires a staff member. Either those actions gain a staff-initiated path, or
   the automation belongs in a different table — `events` already records what
   the system did — and `staff_events` stays what its name says.
2. **`portal` has no kind.** `inquiry_attempts.kind` includes `portal` (filing
   through a bureau portal, `db/migrations/055_inquiry_work.sql:52`). `EVENT_KINDS`
   has no equivalent. A real, counted, staff-performed action that this telemetry
   cannot express.
3. **`shift_auto_closed` is written by `src/shifts/store.mjs` and is not in
   `EVENT_KINDS`.** Two writers, two vocabularies, one column. See the note on
   `EVENT_KINDS` in `telemetry.mjs`.
4. **`file_touched` is undefined.** A token in a schema comment is not a
   specification.
5. **`letter.generated` is canonical and unemitted.** If letter automation should
   be observable, that event is the natural spine for it.
