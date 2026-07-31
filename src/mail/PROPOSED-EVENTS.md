# Proposed canonical events — direct-mail response

**Proposal only. `src/events/canonical.mjs` has not been edited.**

The mail response path needs an event that does not exist in `CANONICAL_EVENTS`
today. Per the build rules it is proposed here rather than added unilaterally.

Nothing in `src/mail/` depends on it existing. `recordResponse()` in
`src/mail/responses.mjs` takes `db` as an argument and writes `mail_responses` /
`mail_universe` directly; it does not call `emit()`. The mail response surface is
fully functional without any of this.

---

## The name collision, which is the whole reason this file is long

**`mail.response` already exists in `canonical.mjs` and it is not this.** It was
the obvious name for "a mail piece got a response" and it is taken by something
completely different. Overloading it would be a live-fire regression against a
subsystem that is already wired, so here is exactly what is on the other end of
it.

### What `mail.response` actually is today

**Emitter — `src/adapters/mailgun.mjs`.** The file header: *"Receives
bank-forwarded emails from Mailgun, classifies them, and emits `mail.response`
onto the canonical event bus."* `mapToCanonical()` is unconditional:

```js
export function mapToCanonical(evt) {
  // An inbound bank email always maps to mail.response
  return [{ name: "mail.response" }];
}
```

The payload it builds is `{ classification, from, to, subject, clientId, source:
"mailgun" }`, where `classification` is one of seven bank-email outcomes
(`APPROVED` / `COUNTEROFFER` / `DENIED` / `MISSING_DOCS` / `ACTION_REQUIRED` /
`APP_RECEIVED` / `NOISE`) produced by a keyword classifier ported from
`inquiry-removal-ai/src/lib/email-classifier.js`. `clientId` is resolved from the
per-client forwarding address `monitor+<clientId>@fundhub.ai` that F-10
provisions.

**Handler — `onMailResponse()` in `src/handlers/comms.mjs`,** registered by that
file's `register()`. It writes a **`bank_inbox`** row:

```js
await db.query(
  `INSERT INTO bank_inbox (org_id, client_id, classification, subject, body_preview, raw)
   VALUES ($1,$2,$3,$4,$5,$6)`, ...);
```

The `comms.mjs` header states the mapping in one line: `mail.response (Mailgun)
-> bank_inbox row (classified bank email)`.

So `mail.response` means: **a bank sent an email about a client's credit
application, we classified it, and it is in the bank inbox.** It has nothing to
do with a mail piece, a mail campaign, `mail_universe`, or a QR code. The word
"mail" in it means e-mail.

### What happens if the mail-piece response is emitted under that name

`onMailResponse` runs on it, because it is registered on the name and
`getHandlers()` does not care where the event came from. A QR scan carries no
`subject`, no `classification` and no bank address, so the handler:

1. calls `findClient(db, orgId, { email: p.from })` — `p.from` is absent, so it
   returns `null`;
2. inserts a `bank_inbox` row with `client_id` NULL, `classification` NULL,
   `subject` NULL, `body_preview` NULL.

**One junk `bank_inbox` row per scan of a QR code**, in the table that F-06, F-09
and F-11 read to decide what a bank said about a funding application. At mail
volumes that is not noise, it is a flood, and every row of it is unclassified —
which is indistinguishable from a real bank email the classifier failed on.

That is the regression. It is not hypothetical and it needs no bug to happen; it
is what the existing, correct, already-registered handler does when handed an
event whose name it owns.

### Why discriminating inside the payload was rejected

The alternative was one name carrying two meanings, with `onMailResponse` gaining
an early return on something like `if (p.source === "mail_piece") return;`.
Rejected on four counts:

1. **It requires editing `src/handlers/comms.mjs`**, a file another subsystem
   owns, to add a guard whose only purpose is to protect it from this thread.
   The correctness of the bank inbox would then depend on a line written for the
   mail pipeline's benefit — and the next person to add a discriminator to the
   same event has to find that line.
2. **`replay()` becomes unsound.** `src/events/bus.mjs` exposes
   `replay(db, { name })`, which the §16 replay validator uses to re-drive a
   stream. `replay({ name: "mail.response" })` would re-drive a mixed stream of
   bank emails and QR scans through every handler registered on the name. A
   replay harness whose filter cannot separate two subsystems is not a harness.
3. **The events table stops being queryable by name.** `idx_events_name` is
   `(org_id, name, created_at)`. "How many bank responses last week" and "how
   many mail responses last week" would both need a payload predicate, and
   anyone who forgets one gets a wrong answer that looks right.
4. **The failure is silent and permanent.** A missing discriminator on one
   emitter writes junk that looks like data. There is no error, no dead letter,
   nothing that surfaces. Distinct names make the same mistake impossible to
   make.

### Why not `mail.responded`

It was considered and rejected outright: one character and one tense apart from
`mail.response`, for two different subsystems, in a flat string list that people
read at a glance and type from memory. That is a trap, not a name.

---

## Proposed: `mailer.responded`

One event. A person who was sent a mail piece has responded to it.

`mailer` is the subject because it is the printed piece, and it collides with
nothing: no table, column, event, handler or adapter in this repo uses the word.
The form matches the spine — every canonical name except `message.inbound` and
`mail.response` itself is `<subject>.<past-participle>` (`entry.captured`,
`deposit.paid`, `round.funded`, `file.finalized`).

```jsonc
{
  "name": "mailer.responded",
  "version": 1,
  "idempotency_key": "mailer|<record_slug>|<channel>",
  "client_id": null,
  "payload": {
    "slug": "7KQ2M9XBTDVF",
    "channel": "web",
    "respondedAt": "2026-07-30T14:02:11Z",
    "providerRef": null,
    "source": "clickfunnels"
  }
}
```

**The payload carries the slug and nothing about the person.** `mail_universe.
fields` is the vendor's per-record consumer data off a **prescreened** file, and
`events` is queried, exported and replayed — PII in a payload is PII in a backup.
The slug is an identifier for a row; the row stays in the row. Anything that
emits this must keep it that way.

**`client_id` is null and normally stays null.** 065 on
`mail_responses.client_id`: *"NULL is the normal state — a response is a stranger
until they are created as a client, and most never are."* If the landing page
also captures an email, that is `entry.captured` doing its existing job, and the
two events are linked by the client the funnel creates — not by inventing a
client here.

**The idempotency key mirrors the module's own dedupe rule** (first
identifier-less response per record and channel wins, see
`db/migrations/067_mail_response_idempotency.sql`), so a double-tapped QR code
collapses onto one `events` row via `idx_events_idem` before it ever reaches a
handler. When a `providerRef` is present it should be used instead —
`mailer|<provider_ref>` — because that is the thing that genuinely distinguishes
two responses.

### The handler, if approved

Not written, because `emit()` throws for a name that is not canonical and there
is no honest way to register a handler for an event that cannot be emitted:

```js
// src/handlers/mail.mjs — DOES NOT EXIST YET
import { on } from "../events/registry.mjs";
import { recordResponse, MailResponseError } from "../mail/responses.mjs";

export async function onMailerResponded(event, db) {
  const p = event.payload || {};
  try {
    await recordResponse(db, {
      slug: p.slug,
      channel: p.channel,
      respondedAt: p.respondedAt,
      providerRef: p.providerRef || null,
      payload: p
    });
  } catch (err) {
    if (err instanceof MailResponseError && err.code === "unknown_slug") return; // see below
    throw err;
  }
}

export function register() { on("mailer.responded", onMailerResponded); }
```

**The `unknown_slug` branch is the open question in that sketch, and it should be
decided rather than defaulted.** An unresolvable slug is a real signal — a typo, a
scraped URL, or somebody enumerating — and `recordResponse` deliberately refuses
to invent a record for it. But a handler that rethrows dead-letters the event
(`src/events/dead-letter.mjs`), which turns a stranger's typo into an operational
alert, and a handler that swallows it loses the signal entirely. Neither is
obviously right and neither should be picked by whoever writes the file first.

### Deliberately not proposed

- **`mailer.scanned` / `mailer.viewed`.** A page view is not a response, nothing
  in this repo records one, and an event per view would dwarf the event stream
  with rows no reader wants.
- **`mailer.dropped`.** There is no drop, and the gate says there will not be one
  until FCRA research, Deluxe compliance and legal sign-off are all in
  (`src/mail/README.md`). `mail_campaigns.status = 'dropped'` is a human writing
  down something that happened at a printing plant. An event name would imply a
  system that observes drops, and creating one is exactly the kind of "one line
  that looks harmless" 065 warns about.
- **`mailer.suppressed`.** Suppression is a decision recorded on the row, made in
  bulk over a whole universe. One event per suppressed record is a hundred
  thousand events per drop describing a batch operation.

---

## Summary for `canonical.mjs`, if approved

```js
// direct mail
"mailer.responded",
```

One name, under its own grouping. `mail.response` stays exactly as it is — it is
the Mailgun bank-inbox event, it has a working emitter and a working handler, and
nothing in this proposal touches it.

**The decision actually being asked for is not the spelling.** It is whether the
`mail.` prefix in the event spine belongs to e-mail (it does today, with one
member) while direct mail takes a different word. If the answer is that
`mail.response` was itself misnamed and should become something like
`bank.email_received`, that is a rename with two call sites
(`src/adapters/mailgun.mjs`, `src/handlers/comms.mjs`) plus any stored `events`
rows already carrying the old name — a migration, not a rename. Worth deciding
once, either way, before a third thing wants the prefix.
