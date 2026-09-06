# The accountability layer — spec

Owner-set 2026-09-05. This is the half that turns the progress page from a screen into a service:
the client is chased when they stall, and can ask a question and get a real answer.

**Copy is placeholder on purpose.** Chris is auditing every email and text in the company in a
separate thread. Build the machinery with placeholder bodies and a stable template key per
message; he swaps the words later without touching code. **Do not write final client copy here.**

---

## What already exists

| Piece | Where | State |
|---|---|---|
| `client_waypoints` with `owner`, `due_at`, `state`, `completed_at` | migration 330 | built |
| `overdue` computed from `due_at`, never stored | the progress contract | specified |
| Template send that writes a queued row | `sendTemplated`, `src/workflows/messaging.mjs` | working |
| The dispatcher that hands queued rows to a provider | `src/messaging/dispatch.mjs`, swept every 5 min by `src/workflows/message-dispatch-sweeper.mjs` | working |
| Idempotency backbone | unique index on `events(org_id, idempotency_key)` | working |
| Client-reachable chat | `api/chat/*` | reachable by a client principal today |
| Agent runtime, seeded prompts, voice + text | `src/agents/`, `db/migrations/114_*` | working |
| Consent wording | the block in `homepage-survey.js` | **shipped legal copy — reuse verbatim, never reword** |

**Nothing sends a nudge when a waypoint goes overdue. That is the gap.**

---

## Read this before writing a single line of the nudge loop

On 2026-09-03 a chase loop sent **51 identical texts to one phone in two hours**, to clients who
had already booked. Two causes stacked: funnel events carried no client id so the "have they done
it yet?" check could never match, and the provider fired ~16 duplicate webhooks per survey, each
starting its own run.

So the exit conditions are not a detail of this feature. **They are the feature.** Design them
first, test them first, and treat every one of them as a blocker.

---

## The model

A waypoint is the unit. Each one already knows whose job it is, when it is due, and whether it is
done. The nudge layer adds one thing: **what we do when it goes overdue and stays overdue.**

### Only nudge what the client owns

`owner = 'client'`. A waypoint FundHub owes is never chased — chasing a client about our own work
is the fastest way to lose trust. Those appear on the page as *us*, and if they slip, that is a
staff alert, not a client message.

### The ladder

Per overdue waypoint, not per client. Placeholder copy, stable keys:

| Step | When | Channel | Template key |
|---|---|---|---|
| 1 | on `due_at` | SMS | `SMS-WAYPOINT-DUE` |
| 2 | +2 days overdue | email | `EMAIL-WAYPOINT-NUDGE-1` |
| 3 | +5 days overdue | SMS | `SMS-WAYPOINT-NUDGE-2` |
| 4 | +9 days overdue | staff task, **no client message** | — |

Step 4 hands it to a human rather than escalating tone at the client. The existing document-chase
voice agent already covers the phone leg for identity documents and should be reused rather than
duplicated.

**Cadence is owner-decidable.** The days above are a starting point, not a rule. What is not
negotiable is that the ladder terminates.

### Every exit condition. All of them are blockers.

The loop stops, permanently, on **any** of these:

1. The waypoint reaches a completed state. Check this **at send time**, not only at schedule time.
2. The waypoint is deleted or its owner changes to `us`.
3. The client bought the paid alternative for that waypoint — never chase someone to do a thing
   they have just paid us to do.
4. Step 4 is reached. Four messages per waypoint, ever. A hard cap, enforced by a stored count and
   not by the scheduler's memory.
5. The client replies to any message on that thread. A human takes it from there.
6. STOP, opt-out, a complaint, or any mention of a lawyer. Honour the existing suppression path,
   do not write a second one.
7. The client's program is complete, cancelled, or on hold.
8. There is no verified contact method for that channel.

### Idempotency

One row per `(waypoint, step)`, keyed on `events.idempotency_key`. A replay, a duplicate webhook,
two schedulers, or a retry must all collapse to one send. Write the test that fires the same step
sixteen times and asserts one message row — that is the exact shape that produced the 51 texts.

### Quiet hours and volume

No client-facing message outside daytime in the client's own timezone. **At most one client-facing
message per client per day across every waypoint**, so someone with three overdue items gets one
text and not three. That cap is global, not per waypoint, and it is the thing that stops the
ecosystem becoming spam.

---

## AI support

`api/chat/*` already reaches a client principal. Two jobs:

**Answer from the truth.** Feed it the same facts the progress page renders — the contract in
`docs/workflows/portal-progress-contract.md`. "Where is my file" should be answered from
`stage`, `movement` and `timeline`, not generically. It must never invent a date, a score, an
amount, or an outcome, and must never say a CFPB or state AG complaint was filed, because nothing
in the system records that (`src/metro2/letters/catalog.mjs:57-65`).

**Notice and reach out.** When a waypoint goes overdue the same context drives the nudge, so the
message can name the actual thing rather than a generic reminder.

Reuse the existing agent runtime and the seeded-prompt pattern. Do not add a second one.

---

## Compliance

Credit-repair messaging is on the CLAUDE.md section 7 list, so flag
`COMPLIANCE REVIEW REQUIRED` at the top of the summary for this work. Marker only.

Outbound transmission is permitted in `src/messaging/providers/` and nowhere else. `sendTemplated`
writes a queued row; the dispatcher sends it. Do not add a send path.

Consent wording is shipped legal copy — reuse the existing block verbatim.

No client-facing copy says "credit repair"; use funding-optimisation and capital-readiness
language.

---

## Where this lands in the build

**Wave 4, after wave 3's front end.** It depends on waypoints being real and visible first, and it
is the piece most likely to cause harm if rushed, since it is the one that talks to people.

Build order inside it: the exit conditions and the idempotency test **first**, with a loop that
sends nothing. Then the schedule. Then the placeholder templates. Then AI support last.

## Proof required before it ships

Every one of these watched happen, not reasoned about:

* A waypoint completed between scheduling and sending: **nothing sends.**
* Sixteen duplicate triggers for one step: **one message row.**
* Three overdue waypoints on one client on one day: **one message, not three.**
* The paid alternative bought: **the chase stops.**
* STOP received: **the chase stops and stays stopped.**
* Step 4 reached: **a staff task, and no fifth client message ever.**
* A client with no phone: **the SMS step is skipped, not retried forever.**
