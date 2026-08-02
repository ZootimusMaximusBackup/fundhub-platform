# The staff reply inbox — what was built

> **COMPLIANCE REVIEW REQUIRED.** This change lets an employee type free-form
> text and send it to a consumer. It touches consent (opt-out), fee-and-outcome
> messaging (the restricted-wording rules), and the record of who said what to
> whom. CLAUDE.md §7 requires the label on changes affecting consent capture and
> credit-repair messaging; both apply. The label is a marker, not a
> recommendation — see the unnumbered "Owner decisions are final" section.

Built 2026-08-02, branch `claude/staff-reply-inbox-5gob90`.

---

## In one paragraph

A client texts or emails. The message lands in a thread. A staff member opens
the inbox, reads the thread, types a reply, and presses Send. The reply goes
through the same compliance gate and the same dispatcher every automatic
message goes through, and the message records who wrote it. That is the whole
feature.

---

## What already existed and was reused, not rebuilt

Nothing in this list was modified except where noted.

| Piece | Where | Used for |
|---|---|---|
| `messages`, `conversations` | `db/schema/001_init.sql` | the rows. One conversation per (client, channel), per migration 057 |
| the compliance gate | `src/messaging/gate.mjs` | **unchanged.** Opt-out, quiet hours, restricted wording |
| the dispatcher | `src/messaging/dispatch.mjs` | routing, provider resolution, retries, quiet-hours deferral. One function added — see below |
| the thread writer | `src/conversations/store.mjs` | **unchanged.** `upsertConversation` / `linkMessage` |
| the inbound handler | `src/handlers/comms.mjs` | `onMessageInbound` already wrote and threaded an inbound SMS. Widened to email |
| providers | `src/messaging/providers/*` | the only place anything transmits (CLAUDE.md §12) |
| the webhook door | `api/webhooks/[provider].mjs`, `src/http/router.mjs` | **unchanged** |
| per-client threads | `GET /api/read/conversations` | **unchanged.** Now also feeds the inbox's client panel |
| staff telemetry | `src/shifts/telemetry.mjs` | the `text_sent` seam, supplied for the first time |
| the shift gate | `src/http/middleware/requireActiveShift.mjs` | **unchanged.** Applied to the new write |

---

## What was added

### Migration `117_messages_sender.sql`

* `messages.sender_staff_id` — nullable, `REFERENCES staff(id) ON DELETE SET NULL`.
  NULL means **no person sent this** (a workflow, a webhook, or it is inbound).
  It does not mean "unknown staff member". No backfill: there is no staff member
  any historic row belonged to.
* `idx_messages_thread` — `(conversation_id, created_at DESC)`, partial on
  `conversation_id IS NOT NULL`. The thread read and the inbox's newest-message
  lateral both ride it.
* `idx_messages_org_created` — `(org_id, created_at DESC)`.

Deleting a staff row never deletes the messages they sent to clients. The
message is the record of what a consumer was told and it outlives the
employment.

### `GET /api/read/messages?conversation_id=<uuid>`

One thread, both directions, newest first. Staff roles only
(`ROLE_SETS.STAFF`), org bound from the session.

* `conversation_id` is **required**. A missing or malformed one is a 400 and
  reaches no query. Same rule and same reason as `read/conversations`.
* Newest-first because a thread read wants the END of the history. The screen
  reverses it for display.
* `sender_name` is LEFT JOINed from `staff`.
* **`to_address` is deliberately not returned.** A thread view is what was said,
  not a column of phone numbers on a shared monitor.
* An unknown or another company's conversation is `200 { items: [] }`, not 404 —
  confirming whether a uuid is a real thread is not a service owed to a guesser.

### `GET /api/read/inbox`

Every thread in the company, newest activity first, with the client's name and
the last message on each row. Staff roles only.

**Why this is not `read/conversations` with the `client_id` made optional.**
That endpoint's header argues at length that "forgot the parameter" must never
degrade into "return the whole table", and that reasoning is correct for what
it is — a per-client pre-call panel. An inbox is cross-client by definition;
there is no id to pass. So it is a second endpoint whose no-id case is its
normal case. `read/conversations` is untouched and still serves the client
panel.

**"Unread" is derived, and the screen says so.** There is no read receipt in
this schema, no `last_read_at`, and no per-staff read state. So the flag is:

> `needs_reply` = the most recent message on the thread came from the client.

Reading a thread does not clear it; replying does. The screen labels it
**"Needs reply"**, not "Unread", because that is what it measures. Real
per-staff read state would need a table, a write endpoint, and a decision about
whether "read" is per-person or per-company. None of that was invented.

`needs_reply` is `null` on a thread with no messages. Null is not false and is
counted as neither.

`sentiment` is passed through as `null`, as everywhere else in this codebase.
Nothing computes Hot/Warm/Cold and the screen does not render it.

### `POST /api/messages`

```
POST { conversation_id, body }                  reply in an open thread
POST { client_id, channel, body, subject? }     start one
POST { ..., idempotency_key }                   safe to retry
→ 200 { ok, message, conversation_id, outcome, detail, deduped }
```

Staff principals only. **Gated on an open shift** — the owner's rule names
"sending client messages" among the four writes to gate, and
`ACTIVE-SHIFT-ROLLOUT.md` records that client messaging had no endpoint in this
repository at the time the rule was made. This is that endpoint. The reads are
not gated; the same rule ends "do not gate read-only screens".

The work is in `src/messaging/compose.mjs`; the route file is only the door.

### `src/messaging/compose.mjs`

`composeAndSend()` — resolve the thread (or create it via the same upsert the
inbound handler uses), insert the message, link it, dispatch it, record the
telemetry, read the row back.

### `dispatchMessage(db, messageId, options)` in `dispatch.mjs`

Claims one named message atomically (`UPDATE ... RETURNING`, same shape as
`claimDue`) and hands it to `dispatchOne`. It adds no capability: every check
is `dispatchOne`'s, unchanged, and there is no option it accepts that
`dispatchOne` does not. `dispatchOne` cannot tell its rows from `claimDue`'s.

Still nothing is scheduled. There is no cron, no timer, and no Inngest
registration. `dispatchMessage` runs when a request calls it.

### Inbound email threading

`src/adapters/mailgun.mjs` now emits `message.inbound` with `channel: "email"`
**in addition to** `mail.response`, and only when the From address matches a
client record (`resolveClientFromSender`).

This is the distinction that makes it safe: Mailgun's inbound route carries
bank statements forwarded to `monitor+<clientId>@fundhub.ai`, where the client
is the **recipient** and the sender is a bank. A client replying to us is the
opposite shape — they are the **sender**. Threading a bank statement as though
the client had written it would put a bank's words in a consumer's mouth. The
existing `bank_inbox` path is untouched.

`onMessageInbound` handles both channels: it already read `channel` off the
payload, and now looks the client up by email rather than by phone when the
channel is email, and stores the subject. The TCPA STOP/START branch stays
guarded on SMS — "STOP" in an email subject is not an opt-out keyword.

### The screen

`public/app/messaging.html` was 1,035 lines of sample markup with one wired
read. It is now a real inbox: conversation list, thread view, compose box,
client context panel. The whole cast of the old transcript — Priya Nair, Jordan
Blake, the $12,400 prequal estimate — is gone, and `messaging-screen.test.mjs`
fails if any of it returns.

The view model between `FH-INBOX-BEGIN` / `FH-INBOX-END` is pure and is driven
directly by the test. The DOM wiring under it is kept thin.

---

## Rules that hold, and how

| Rule | Where it is enforced | Test |
|---|---|---|
| A staff reply is checked before it leaves | `dispatchOne` → `gateAndRecord`. compose does **not** call the gate itself | `compose.test.mjs`, `compose.pg.test.mjs` |
| Opt-out applies to a human's reply too | the gate, read fresh at send time | `compose.pg.test.mjs` |
| Quiet hours apply to a human's text too | `dispatchOne`, deferred to 11:00 Eastern | `compose.pg.test.mjs` |
| Restricted wording applies to a human's reply too | the gate, same `compliance_rules` rows as the ad screen | `compose.pg.test.mjs` |
| Template approval does **not** apply | there is no template row. See below | — |
| One verdict, taken at send time | compose never calls the gate; source-level assertion | `compose.test.mjs` |
| No path to a provider except dispatch | source-level assertion on compose and the route | `compose.test.mjs`, `messages-write.test.mjs` |
| The company comes from the session | every query; body/query org fields refused | all four HTTP test files |
| The sender is the session's staff member | never read from the body | `messages-write.test.mjs` |

**Why template approval does not apply, and why that is not a bypass.**
Approval (`116_template_approval.sql`) is a check on stored, reusable copy: has
a human reviewed this before we send it ten thousand times. Here a human *is*
the author, reviewing as they type, and there is no template row to carry a
flag. Nothing skips the gate, nothing passes it an option, and nothing takes a
different path through it — a phrase an employee may not put in a text is not
made sayable by typing it by hand.

---

## Decisions taken, with the reasoning

1. **`read/inbox` is a new endpoint, not a relaxed `read/conversations`.** See
   above. The existing requirement had a written rationale; relaxing it would
   have made a missing parameter silently change what the endpoint is for.
2. **Unread = "they spoke last".** The honest thing derivable from rows that
   exist. Alternatives all require inventing per-staff read state.
3. **Idempotency is opt-in.** With a key, a repeat returns the first message.
   Without one, two identical replies are two real messages — collapsing them
   would lose a message a client is waiting on. Nothing derives a key from the
   body text.
4. **`voice` cannot be composed on.** A person cannot type a phone call. Voice
   threads exist (the Bland handler writes them) and are read-only here.
5. **A missing phone number is not refused at compose time.** The dispatcher
   already has that branch (`no_address`) and records the reason on the row,
   where an operator can see it. Refusing earlier would make the message vanish
   with a toast and no record that anybody tried.
6. **Body cap 4,000 characters, rejected not truncated.** Not a carrier limit —
   a bound on one request's write. Sending half of what somebody wrote is worse
   than telling them it was too long.
7. **The compose box has no Templates button.** The old one had no handler.
   Template copy has its own screen (`template-editor.html`) and this is the
   free-form path; two template pickers would be two things to keep in step.

---

## Known gaps — stated, not filled

* **An emailed reply files no `staff_events` row.**
  `src/shifts/telemetry.mjs` freezes five kinds and `text_sent` is not one an
  email may borrow; there is no kind for an email. Per that file's own
  instruction, the gap is reported rather than the vocabulary extended by a call
  site that needed a word. **Consequence:** per-staff work counts include texts
  sent from the inbox and not emails. Adding a kind is a decision for whoever
  owns the telemetry vocabulary. Asserted as-is in `compose.pg.test.mjs`.
* **No per-staff read state.** See "unread" above.
* **No `-intended.md` journey to check this against.** CLAUDE.md §4 says to read
  the intended journey before building any flow. `docs/journeys/` contains only
  the eight generated `-actual.md` files; **no `-intended.md` file exists in this
  repository at all.** So there was nothing to read and nothing to diverge from.
  Recording the absence rather than writing one, because an intended journey is
  hand-authored and agents do not write those.
* **Nothing schedules the dispatcher.** A staff reply is dispatched by its own
  request. A message deferred for quiet hours, or queued for a retry, still
  needs `dispatchDue()` to be called by something, and nothing calls it —
  `src/workflows/message-dispatch-sweeper.mjs` remains defined and deliberately
  unregistered. **A text typed at midnight will not go out at 11am until that
  sweeper runs.** The screen tells the sender the message is held; it does not
  tell them nothing is scheduled to release it. That is the largest remaining
  hole in this feature and it is one line of registration away from being
  closed — but registering it is a live-sending decision, not a build one.
* **Inbound email only threads for a client whose address we hold.** A reply
  from an address not on the client record resolves to nobody and is not
  threaded, exactly as an SMS from an unrecognised number is not. That is the
  same honest state, not a bug.

---

## Where things are

```
db/migrations/117_messages_sender.sql       the column and the two indexes
src/messaging/compose.mjs                   the staff send path
src/messaging/dispatch.mjs                  + dispatchMessage / claimOne
src/adapters/mailgun.mjs                    + resolveClientFromSender, message.inbound
src/handlers/comms.mjs                      onMessageInbound widened to email
api/messages.mjs                            POST — staff, on shift
api/read/inbox.mjs                          GET  — the thread list
api/read/messages.mjs                       GET  — one thread
netlify/functions/api.mjs                   all three routed
public/app/data.js                          inbox / thread / conversations / sendMessage
public/app/messaging.html                   the screen

src/messaging/compose.test.mjs                    no database
src/messaging/compose.pg.test.mjs                 the gate, end to end
src/messaging/reply-inbox-acceptance.pg.test.mjs  the ticket's own four steps
src/handlers/inbound-threading.pg.test.mjs        new + existing thread, sms + email
src/http/messages-read.pg.test.mjs                thread read auth and data
src/http/inbox-read.pg.test.mjs                   inbox auth and data
src/http/messages-write.test.mjs                  the POST's gates
src/http/messaging-screen.test.mjs                the screen
```

## One thing fixed outside the feature, and why

`src/http/campaign-endpoints.pg.test.mjs` and `src/http/conversations-read.pg.test.mjs`
both picked their test staff member with `LIMIT 1` and **no `ORDER BY`**. The
suite runs test files concurrently, and `src/auth/seed-staff.pg.test.mjs`
inserts `+seedtest@fundhub.ai` staff rows into the same company and deletes them
again — so an unordered pick can land on a row that is gone by the time the
session built from it is verified. `verifySession` joins `staff`, finds nothing,
and answers **401**, which reads like an authentication bug and is not one.

This fired once during the runs for this change (`campaign-endpoints`, two
subtests, 401 where 200 and 400 were expected) and did not reproduce on the four
runs either side of it. It is pre-existing, not caused by this work — but adding
four more concurrent files that hold a session for that same company widens the
window, so leaving it would have meant shipping a flake that now fires more
often. The fix is `ORDER BY created_at` on the pick, which pins it to the seeded
DEMO roster that outlives every test file. Four words of SQL and a comment; no
behaviour changed.

## Measured

* Without a database: **3,919 passing, 0 failing**, 518 skipped.
* Against a local Postgres 16 in the build container: **34 pre-existing
  failures before this change and the same 34 after it**, an identical set —
  none in messaging. Per CLAUDE.md §12, the count moves with the environment;
  34 is this container's number, measured on this branch at `fca108c`, not a
  figure to quote elsewhere.
