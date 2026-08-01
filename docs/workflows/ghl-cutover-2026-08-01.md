# ghl-cutover-2026-08-01

Shared board for the GHL cutover batch (Ticket 1 — outbound messaging
dispatcher). Each workflow claims its row here, writes its manifest here when
done, and reads this file before starting.

**This file did not exist when W1 ran.** W1 created it and wrote the first
entry. There was also no GHL cutover spec anywhere in `docs/` — see Findings.
Other workflows should append their own `## W<n>` heading below rather than
editing anyone else's.

## Task list

| # | Task | Owner | Status |
|---|---|---|---|
| W1 | Foundation — migration 110 + the compliance gate | W1 | `done` |
| W2 | Provider: email (mailgun) | W1 | `done` |
| W3 | Provider: SMS (ghl_relay) | W1 | `done` |
| W4 | The dispatcher loop itself | W1 | `done` |
| W4b | Dispatcher corrections + sweeper + queue-time address/subject | W4b | `done` |
| W5 | Turning sending on — scheduler, env vars, cutover | unclaimed | `blocked` |

The whole batch was run in one thread at the owner's instruction, so W1 owns
every row. **W5 is blocked and is deliberately not started** — see "What is NOT
switched on" at the end of this file.

**Contract amendment (W2/W3):** providers now also export `ADDRESS_FIELD`. The
original contract said `to` was "an address or E.164 phone number", which is
wrong for GHL — it addresses a *contact id*, not a number. Recorded here first,
per the batch rule, before either provider was written.

---

## Shared context brief

Four things about this repo that will otherwise cost each workflow the same
hour:

1. **`messages` already existed.** It is created in `db/schema/001_init.sql:256`
   and `src/workflows/messaging.mjs` has been writing rows into it since the
   workflow engine landed — `status='queued'`, `provider='internal'`. Migration
   110 **adds columns to that table**. Do not create a second one.

2. **Nothing transmits today.** There is no outbound `fetch` in `src/adapters/`
   or `src/lib/`. `sendTemplated` writes a queued row and stops. W2 and W3 are
   writing the first code in this repo that actually contacts an outside
   service.

3. **A handler file is not a route.** `netlify/functions/api.mjs` holds a
   hardcoded `ROUTES` map. A handler missing from it returns 404 both locally
   and deployed. This has shipped broken twice. `src/http/routes.test.mjs`
   fails if a handler is neither routed nor allow-listed.

4. **Tasks go through `createTask`.** `src/lib/create-task.mjs` is the only
   sanctioned writer to the `tasks` table — it forces an owning employee role,
   because a task with no owner reaches nobody.
   `src/workflows/task-routing.test.mjs` fails the build on a raw insert
   anywhere under `src/`. Note it greps the **file text**, so even a comment
   quoting that SQL trips it.

---

## W1 — Foundation

**Task:** migration 110 + the compliance gate. `status: done`

**What changed in plain language:** the messages table now has the extra
columns a sender needs — when a message is due, how many times we tried, what
went wrong, and why it was held back. A new table records which company sends
email and text through which provider. And there is now a single checkpoint
that every outgoing message has to pass before anything is sent: it stops
messages to people who asked us to stop, it holds texts overnight, and it
refuses messages whose wording breaks a compliance rule.

### CONTRACT 1 — the schema

This is verbatim. Everyone builds against these exact names.

#### `messages` — columns ADDED by `db/migrations/110_messages_outbound.sql`

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `scheduled_at` | `timestamptz` | yes | — | When it is due. **NULL means due immediately.** |
| `attempts` | `integer` | no | `0` | Delivery attempts made. |
| `last_attempt_at` | `timestamptz` | yes | — | When we last tried. |
| `last_error` | `text` | yes | — | Provider error text from the most recent failure. |
| `provider_message_id` | `text` | yes | — | The provider's own id, returned on acceptance. |
| `blocked_reason` | `text` | yes | — | Comma-joined gate reason codes. |
| `blocked_at` | `timestamptz` | yes | — | When the gate held it. |

Index added:

```sql
CREATE INDEX idx_messages_due
  ON messages (org_id, scheduled_at NULLS FIRST)
  WHERE direction = 'outbound' AND status = 'queued';
```

**`provider_ref` and `provider_message_id` are NOT the same field. Do not
collapse them.** `provider_ref` is ours — synthesised before the send as
`workflow:<templateKey>:<eventId>` — and it carries the unique index from
migration 004 that makes a replayed event a no-op. `provider_message_id` is
theirs, unknown until they accept it, and it is the only handle we have for a
later delivery receipt or bounce.

#### `messages` — columns that ALREADY EXISTED (not restated in 110)

`id`, `org_id`, `client_id`, `conversation_id`, `direction`, `channel`,
`template_key`, `rendered_body`, `provider`, `provider_ref`, `status`,
`compliance_check_passed`, `created_at`, `updated_at`.

#### `message_channel_routing` — new table

```sql
CREATE TABLE message_channel_routing (
  org_id     uuid        NOT NULL REFERENCES orgs(id),
  channel    text        NOT NULL,
  provider   text        NOT NULL,
  enabled    boolean     NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, channel)
);
```

Seeded one row per channel per org: `email` → `mailgun`, `sms` → `ghl_relay`.
`updated_at` is maintained by the standard `set_updated_at()` trigger.

**Rule for W4:** no row, or `enabled = false`, is a **hold** — not a licence to
fall back to a default provider. A dispatcher that guesses which provider to
use when routing is missing is the bug this table exists to prevent.

No row-level security on this table, deliberately, matching every other
non-partner table here. `db/migrations/109_no_bare_rls.sql` documents the
outage that came from enabling it without a policy attached.

### CONTRACT 2 — the gate

`src/messaging/gate.mjs`

```js
gate(db, message, options) -> Promise<{ state, reasons, task }>
```

**Input `message`:**

| Field | Required | Notes |
|---|---|---|
| `orgId` | yes | Missing → blocked. |
| `clientId` | yes | Missing → blocked (`recipient_unknown`). No client means no opt-out record to read, and "no record" must never mean "nobody objected". |
| `channel` | yes | `sms` \| `email` \| `voice`. Anything else → blocked. |
| `body` | — | The rendered text. Defaults to `""`. |
| `messageId` | — | The `messages.id` row, carried into the raised task. |

**Input `options`:** `{ now, timeZone }` **and nothing else.** Any other key
throws, which the gate turns into a **block**. `now` is a function returning a
`Date`; it defaults to the real clock and production passes nothing.

**Return:**

```js
{
  state: "allowed" | "blocked",
  reasons: [ { code, rule_set, message, citation?, severity?, retryable?, detail? } ],
  task: null | { orgId, clientId, title, sourceWorkflow, assigneeRole, body, detail }
}
```

There is no third state and no soft block. **Anything that is not exactly
`"allowed"` must not reach a provider.**

Reason codes you will see:

| `code` | `rule_set` | Clears on its own? |
|---|---|---|
| `opted_out` | `consent` | Yes — if they opt back in. |
| `recipient_unknown` | `consent` | No. |
| `quiet_hours` | `tcpa` | Yes — at 11:00 Eastern. Carries `retryable: true`. |
| *(rule key from `compliance_rules`)* | `croa` / `claims` / `disclosure` | No. Raises a task. |
| `gate_error` | `engine` | Fail-closed catch-all. |

Also exported: `gateAndRecord(db, message, options)` — same signature and
return, but it persists. **Every path that actually dispatches must use this
one.** It writes `blocked_reason`, `blocked_at` and `status='blocked'` on the
message row, and files the task through `createTask`. It writes nothing when
the result is allowed, and it never clears an existing block.

Supporting exports: `inQuietHours(date, tz)`, `easternHour(date, tz)`,
`CHANNELS`, `QUIET_START_HOUR` (23), `QUIET_END_HOUR` (11), `QUIET_HOURS_TZ`
(`America/New_York`), `QUIET_HOURS_CHANNELS` (`sms` only), `GATE_SOURCE`,
`GATE_TASK_ROLE`.

**There is no override.** No `force`, no `skipCompliance`, no `override`, no
`test_bypass` — not as an argument, not as an option, not as an environment
variable, and not for tests. `assertNoBypass()` rejects an unknown option, and
that rejection produces a **block**: an attempt to bypass the gate closes it
rather than opening it. A test scans the gate's own source for such an
identifier so a later edit cannot add one quietly. Do not add one to a
provider, to the dispatcher, or to an endpoint.

### CONTRACT 3 — the provider interface (proposed, for W2 and W3)

Every file in `src/messaging/providers/*.mjs` implements exactly this. It is
proposed by W1; if W2 or W3 needs it changed, change it **here first** and note
it, so the other provider does not diverge.

```js
// src/messaging/providers/<name>.mjs

/** Must equal the `provider` value in message_channel_routing. */
export const PROVIDER = "mailgun";

/** Channels this provider can carry. The dispatcher refuses a mismatch. */
export const CHANNELS = new Set(["email"]);

/** Which column of the client record addresses this provider.
    One of: 'email' | 'phone' | 'ghl_contact_id'. The dispatcher resolves it. */
export const ADDRESS_FIELD = "email";

/**
 * Hand one message to the outside service.
 * @param {OutboundMessage} message
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<SendResult>}
 */
export async function send(message, options) { /* ... */ }
```

**`OutboundMessage` — what the dispatcher passes in:**

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid` | The `messages.id`. |
| `orgId` | `uuid` | |
| `clientId` | `uuid \| null` | |
| `channel` | `"sms" \| "email"` | |
| `to` | `string` | The destination, already resolved — a provider never looks up the client. **Which value this is depends on the provider, not the channel:** an email address for Mailgun, a GHL contact id for the relay. Each provider declares which client column it needs via `ADDRESS_FIELD`. |
| `subject` | `string \| null` | Email only. |
| `body` | `string` | The rendered text. Send it **as given**. |
| `providerRef` | `string` | Our idempotency key. Pass it to the provider as their idempotency key if they support one. |

**`SendResult` — what every provider returns:**

```js
{
  status: "sent" | "failed" | "rejected",
  providerMessageId: string | null,
  error: string | null,
  retryable: boolean
}
```

| `status` | Meaning | `providerMessageId` | `retryable` |
|---|---|---|---|
| `sent` | The provider accepted it. | **required, non-null** | `false` |
| `failed` | Transient — timeout, 5xx, rate limit. Try again later. | `null` | `true` |
| `rejected` | Permanent — bad address, hard bounce, suppressed at the provider. Never retry. | `null` | `false` |

**Rules every provider must follow:**

1. **Never throw.** Catch everything and return `failed` with `retryable: true`.
   A thrown error is treated by the dispatcher as exactly that, but returning it
   yourself puts the reason in `error` where an operator can read it.
2. **Never touch the database.** No reads, no writes, no `db` argument. The
   dispatcher persists the result. A provider that writes its own status row is
   a provider that can disagree with the dispatcher about what happened.
3. **Never re-check compliance, and never skip it.** `gateAndRecord` has already
   run by the time `send` is called. A provider must not second-guess it and
   must not offer a way around it.
4. **Never mutate `message`.** Especially not `body` — no truncation, no
   appended footer, no template rendering. If the copy needs changing, that is a
   template change and it goes through the gate.
5. **Set a timeout.** Default 10 seconds unless the service documents otherwise.
   Honour `options.signal` if given.
6. **Take `fetch` as an option** (`options.fetchImpl`), defaulting to global
   `fetch`. That is how the tests drive you without network access, and it is
   why no test needs a bypass flag.
7. **Credentials come from `process.env` only** — never an argument, never a
   literal, never a fixture. Name the variable in your manifest below; do not
   print its value anywhere.
8. **`error` is operator-facing text**, truncated to 300 characters, and must
   never contain a credential or the message body.

**Registration.** Export `PROVIDER`, `CHANNELS` and `send` and nothing else that
the dispatcher depends on. W4 resolves `message_channel_routing.provider` to a
module by matching `PROVIDER`; an unknown provider string is a hold, not a
default.

### Files touched

| File | Change |
|---|---|
| `db/migrations/110_messages_outbound.sql` | New. Seven columns added to `messages`, one partial index, `message_channel_routing` created + seeded + granted. |
| `db/expected-migrations.mjs` | Regenerated (`npm run migrations:manifest`). 88 migrations. |
| `src/messaging/gate.mjs` | New. The gate, `gateAndRecord`, and the quiet-hours helpers. |
| `src/messaging/gate.test.mjs` | New. 59 tests. |
| `src/compliance/screen.mjs` | Two `export` keywords added (`appliesTo`, `toRegex`) plus comments saying why. **No behaviour change.** |
| `docs/workflows/ghl-cutover-2026-08-01.md` | New. This board. |

### Exports added

- `src/messaging/gate.mjs` — `gate` (also default), `gateAndRecord`,
  `inQuietHours`, `easternHour`, `CHANNELS`, `QUIET_START_HOUR`,
  `QUIET_END_HOUR`, `QUIET_HOURS_TZ`, `QUIET_HOURS_CHANNELS`, `GATE_SOURCE`,
  `GATE_TASK_ROLE`.
- `src/compliance/screen.mjs` — `appliesTo`, `toRegex` now exported. Nothing
  renamed, nothing removed.

**Routes affected:** none. **Journeys affected:** none —
`npm run journeys:check` reports up to date, and the generator reads routes and
role gates, neither of which this change adds.

### How it was verified

- Applied against a real Postgres 16.13 through `db/migrate.mjs` (88
  migrations, clean). Re-applying `110` directly is a no-op with no duplicate
  seed rows.
- `npm run lint` — 665 files parse clean.
- `npm test` with no database: **3802 pass, 0 fail, 443 skipped** (baseline
  before this change was 3743 / 0 / 443 — the 59 new tests are the difference).
- `npm test` against the local Postgres: 28 failures, and the failing-test list
  is **byte-identical** to the same list at the baseline commit `b822675` run
  against a separately-built database. This change adds zero failures.
- Three deliberate mutations were introduced and each was caught: a
  quiet-hours window written as a non-wrapping range (9 failures), an opt-out
  honoured only when it predates the message (2), and a working `force` flag
  (2).

---

## Findings — read these

1. **There is no GHL cutover spec in this repository.** W1 searched all of
   `docs/`. The only description of Ticket 1 was the workflow prompt itself.
   Every contract above is derived from that prompt plus the existing code —
   not from a spec document, because there isn't one.

2. **This board did not exist.** W1 was told to claim a row in it. It had to be
   created first.

3. **`docs/compliance/` does not exist.** `CLAUDE.md` §7 points at it for domain
   rules. The real compliance rules live in the `compliance_rules` table
   (`db/migrations/047_compliance_rules.sql`), which is what the gate uses.

4. **`npx tsc --noEmit` is a no-op here.** There is no `tsconfig.json` and no
   TypeScript in the repo — everything is `.mjs`. The command prints its help
   text and exits non-zero without checking anything. It is a §6 gate that
   cannot fail, and it proves nothing about any change.

5. **New §12 measurement.** Against a **local Postgres 16.13, connected as the
   `postgres` superuser**, the suite fails **28** tests at commit `b822675`.
   One of those failures is *because* of the superuser connection
   (`the app's database role holds no superuser-level privilege`), so this is
   not a measurement of the `fundhub_app` path that
   `db/migrations/104_app_role.sql` introduced. Recording it as a data point
   with its environment named, per §12's own instruction — not as *the* number.

6. **`scripts/marketing/lib/fetch.test.mjs` is flaky.** `RateLimiter: enforces
   a floor between requests` is a timing assertion; it failed once in five full
   runs and passes in isolation. Not caused by this change, and worth knowing
   before anyone chases it.

7. **Migration `106` is used twice** — `106_entities.sql` and
   `106_journeys.sql`. Both are already applied so neither can be renamed.
   Noted, not touched; out of scope for W1.

8. **The gate has no caller yet.** Nothing imports it. It changes no behaviour
   until W4's dispatcher calls `gateAndRecord`. Adding the gate did not turn
   anything on.

9. **`assigneeRole` for a held message is `admin`** — W1's choice, not a
   specified value. `createTask` requires an employee role and rejects anything
   else, and fixing restricted wording is operational work. If the owner wants
   a different role, it is the `GATE_TASK_ROLE` constant in
   `src/messaging/gate.mjs` and nothing else.

---

## W2 + W3 — the providers

**Task:** email via Mailgun, SMS via the GHL relay. `status: done`

**What changed in plain language:** these are the two pieces that actually hand
a message to an outside company. Before this, nothing in the system could send
anything anywhere. Now it can — but only for a message the gate has already
approved, and only once someone turns it on.

### Files

| File | What it is |
|---|---|
| `src/messaging/providers/http.mjs` | Shared plumbing: one POST with a hard timeout, credential stripping, and the retry/permanent classification both providers use. |
| `src/messaging/providers/mailgun.mjs` | Email. |
| `src/messaging/providers/ghl-relay.mjs` | SMS. |
| `src/messaging/providers/index.mjs` | The registry that turns a routing row's provider name into code. |
| `src/messaging/providers/providers.test.mjs` | 46 tests. No network is touched. |

### Environment variables — NOT SET, someone with access must set them

I could not set these myself: the Netlify CLI is not installed in this
environment and `api.netlify.com` is unreachable from it (connection fails
outright), which CLAUDE.md §11 records as an org network-policy denial. Names
only, no values:

| Variable | For |
|---|---|
| `MAILGUN_SEND_API_KEY` | Mailgun private API key. **Secret.** |
| `MAILGUN_SEND_DOMAIN` | Sending domain, e.g. `mg.example.com`. |
| `MAILGUN_SEND_FROM` | The From header. |
| `MAILGUN_SEND_BASE_URL` | Optional. Only for EU-hosted domains. |
| `GHL_RELAY_API_KEY` | GoHighLevel private API key. **Secret.** |
| `GHL_RELAY_BASE_URL` | Optional. Only if "relay" means an intermediary rather than GHL directly. |
| `GHL_RELAY_VERSION` | Optional. Defaults to `2021-07-28`. |

The `MAILGUN_SEND_*` prefix is deliberate: `src/adapters/mailgun.mjs` already
consumes a Mailgun signing key for **inbound** webhooks. One variable serving
both directions would mean rotating the webhook key silently breaks sending.

Until these are set, every queued message fails **retryably** with a readable
reason — nothing is lost, and the backlog goes out once the keys land.

### Decisions worth knowing

- **An auth failure retries.** A 401 means the credential is wrong, not the
  message. Marking it permanent would leave the whole backlog dead even after
  someone fixed the key.
- **A 2xx with no provider id is not treated as sent.** No id means no way to
  match a later bounce to the message, so recording it as delivered would be
  recording something we cannot prove.
- **Errors are stripped of anything credential-shaped** before they reach
  `messages.last_error`, which operators read and paste into support threads.

---

## W4 — the dispatcher

**Task:** claim due messages, gate them, send the survivors. `status: done`

### Files

| File | What it is |
|---|---|
| `src/messaging/dispatch.mjs` | `dispatchDue`, `dispatchOne`, `claimDue`. |
| `src/messaging/dispatch.test.mjs` | 30 tests. |
| `src/messaging/dispatch.pg.test.mjs` | 9 tests against a real Postgres. Skips without `DATABASE_URL`. |

### The order, which is the whole design

**gate → route → send.** Every block happens *before* the provider module is
resolved, so a bug in the routing code cannot produce a send — the provider has
not been loaded yet at the moment any block is decided. A test asserts the
routing table is not even read for a blocked message.

### Outcomes

`sent`, `blocked`, `no_route`, `unknown_provider`, `channel_mismatch`,
`no_address`, `rejected`, `retry`, `gave_up`.

A **hold** (`no_route`, `unknown_provider`, `channel_mismatch`) gives the
attempt back, because it is a configuration problem rather than a bad message —
otherwise a weekend of missing routing burns the retry budget and the backlog is
dead before anyone notices. A **permanent** outcome (`rejected`, `no_address`,
`gave_up`) stops. Retries cap at `MAX_ATTEMPTS` (5).

### Verified

- 76 new unit tests, plus 9 against a real Postgres 16.13.
- **Seven deliberate mutations, each caught:** gate result ignored (4 failures),
  unknown provider falling back to a default (1), disabled channel treated as
  enabled (1), `SKIP LOCKED` removed (1), plus W1's three.
- Full suite, no database: **3878 pass, 0 fail, 452 skipped.**
- Full suite against real Postgres: the failing-test list is **identical by name
  to baseline `b822675`**. The one extra line seen in a single run was
  `RateLimiter: enforces a floor between requests`, which passes 4/4 in
  isolation and on the unmodified tree — the pre-existing flake already noted in
  Findings.

---

## What is NOT switched on — read before assuming this sends anything

**Nothing sends today.** The dispatcher exports functions and nothing calls
them. There is no cron, no timer, no Inngest registration, and no route or
workflow imports `dispatch.mjs`. A test asserts the dispatcher registers no
scheduler of its own, so this stays true unless someone deliberately changes it.

Turning it on (W5) needs all of these, and none were done:

1. The environment variables above, set by someone with Netlify access.
2. Migration 110 applied to production. It has **not** been — `api.supabase.com`
   is blocked from this environment too.
3. A caller — a scheduled job that invokes `dispatchDue`. Note `INNGEST_EVENT_KEY`
   is one of the three things CLAUDE.md §11 says to ask the owner about first,
   because it makes 47 workflow functions go live at once.
4. A decision about which orgs go first. The routing table is per-org, so the
   cutover can be one org at a time, and `enabled = false` is the kill switch.

### One repo invariant changed — say so out loud

CLAUDE.md §12 records **"Nothing transmits — there is no outbound `fetch` in
`src/adapters/` or `src/lib/`."** That sentence is still literally true: both
existing adapters are inbound webhook receivers, and nothing in those two
directories changed.

But `src/messaging/providers/` now contains the **first outbound `fetch` in this
codebase**. The existing "nothing transmits" tests are scoped to specific
modules (`src/alerts/store.mjs`, `src/banking/plaid.mjs`,
`src/http/bank-accounts*.mjs`, `src/finance/soft-pulls.mjs`) and none of them
sweep this directory, so none of them broke — which is exactly why this is
written down rather than left for someone to discover. §12 should be updated
when W5 lands.

---

## W4b — dispatcher corrections, the sweeper, and queue-time addressing

**Task:** the follow-up row on W4. `status: done`

**What changed in plain language:** a text message held overnight used to be
killed rather than delayed — it was marked "blocked" forever and would never go
out in the morning. It now waits and goes out at 11am. Messages also now record
where they were being sent and what the subject line said at the moment they
were written, instead of looking that up later. And there is now a scheduled job
written for the thing that would drain the queue — written, and deliberately not
switched on.

### CORRECTION 1 — quiet hours are a deferral, not a block

**This is a change to W4's behaviour. Read it before building on the dispatcher.**

Two of W1's own rules pulled against each other:

* `gateAndRecord` persists **any** non-allowed verdict as `status='blocked'` plus
  a `blocked_reason`.
* `110_messages_outbound.sql` says — correctly — that a block is an audit record
  and nothing may clear it.
* But the gate marks `quiet_hours` as `retryable: true`, and its own message
  text says the text "is being held until the window opens".

Put together, a text queued at 11pm was blocked permanently and never went out
at 11am. W4's test asserted only that nothing was sent, which the broken
behaviour also satisfied.

**Now:** a text inside the window is not gated at all. It goes back on the queue
with `scheduled_at` moved to the next 11:00 Eastern, no verdict is recorded, and
it is gated fresh when it wakes. That last part is what the gate's own header
asks for — opt-out state must be read at the instant of sending, not eleven
hours earlier.

The deferral is strictly narrower than the block. It uses W1's exported
`inQuietHours` / `QUIET_HOURS_CHANNELS`, it cannot reach a provider, every other
gate reason still runs through `gateAndRecord` unchanged, and no flag shortens
it. New outcome code: `OUTCOME.DEFERRED`.

### CORRECTION 2 — `claimDue` and `dispatchOne` disagreed about `now`

`claimDue` took `now` as a bare timestamp; `dispatchOne` takes it as a clock
function and forwards it to the gate. `dispatchDue` hands the same options
object to both, so **`dispatchDue` could not be driven with a fixed clock at
all** — the function was passed into a `timestamptz` parameter and Postgres
rejected it. Neither existing test caught it because each function was only ever
driven on its own.

`claimDue` now accepts either shape. `now` as a clock function is the convention
across this feature.

### CONTRACT 4 — `to_address` and `subject` (migration 111)

Two columns added to `messages`, both nullable, no backfill:

| Column | Type | Meaning |
|---|---|---|
| `to_address` | `text` | The destination as it stood when the message was queued. |
| `subject` | `text` | The **rendered** subject line. Email only; NULL otherwise. |

W1's provider contract says the dispatcher hands a provider an already-resolved
`to`. W4 read it off `clients` at send time, so a message that waited in the
queue went wherever the record pointed at the moment of sending rather than
where it was written to go.

**`to_address` is recorded in the terms of the CHANNEL, not the provider** —
`email` → `clients.email`, `sms` → `clients.phone`. Routing can change between
queueing and sending, and the GHL relay addresses a contact id, which is not a
destination the queue could record in channel terms. So a provider whose
`ADDRESS_FIELD` is not the channel's natural column still resolves live, and so
do the rows queued before 111, which have no recorded address and get no
invented one.

**The subject is stored rendered.** It carries the same `{{contact.*}}` merge
tags the body does; the template's raw text in a subject line reads
`Hi {{contact.first_name}}` to the client before they open the message. The
dispatcher prefers the stored subject over the template lookup for that reason.

**Only the address is pinned. Consent is not.** Opt-out state is still read
fresh by the gate at the instant of sending.

### CONTRACT 5 — event names

`message.queued`, `message.sent`, `message.failed`, `message.blocked` added to
`src/events/canonical.mjs`.

Only `message.queued` has an emitter: `sendTemplated`, and **only when a row was
really written**. A replayed event conflicts into `DO NOTHING`, returns no row,
and emits nothing — so replaying the log does not grow the log. Keyed on
`provider_ref` so the event is idempotent in the bus too. Emission is non-fatal:
the message row is already committed, and an unavailable bus must not turn a
queued message into a failed send.

The other three are **reserved names with no emitter**. The dispatcher records
outcomes on the message row and makes no bus writes. Do not assume they fire.

`contract.*` events were in this workflow's brief and were **deliberately not
added** — nothing called a contract exists anywhere in this repo, and the owner
confirmed it is a later e-signature ticket. Inventing four names for it would
have been guessing.

### The sweeper

`src/workflows/message-dispatch-sweeper.mjs` — `sweep(db, options)` plus an
Inngest cron definition at `*/5 * * * *`.

**It is NOT in `src/workflows/index.mjs`**, which is what
`netlify/functions/inngest.mjs` serves, so it is registered with nothing and
invoked by nothing. A test asserts it stays absent and names W5 as the act that
changes that. Adding that export is what turns outbound sending on.

Why a sweeper and not a handler on `message.queued`: a message with a future due
time, a text deferred overnight, and a retryable provider failure all end up
queued with no event attached. One clock handles all three. A pass is one
bounded batch, not a drain to empty.

### Files touched

| File | Change |
|---|---|
| `src/messaging/dispatch.mjs` | Quiet-hours deferral, `nextQuietHoursEnd`, `claimDue` clock fix, prefers `to_address` / `subject`. |
| `src/messaging/dispatch.test.mjs` | Quiet-hours tests strengthened; window arithmetic asserted across every day of 2026 and both daylight-saving nights. |
| `src/messaging/cutover-acceptance.pg.test.mjs` | New. The ticket's acceptance bar, end to end against Postgres. |
| `src/workflows/message-dispatch-sweeper.mjs` + `.test.mjs` | New. |
| `src/workflows/messaging.mjs` | Persists `to_address` and rendered `subject`; emits `message.queued`. |
| `src/events/canonical.mjs` | Four `message.*` names. |
| `db/migrations/111_messages_address.sql` | New. Two columns. |
| `db/expected-migrations.mjs` | Regenerated. 89 migrations. |
| `CLAUDE.md` | §12 "nothing transmits" rewritten — see below. |

**Exports added:** `nextQuietHoursEnd`, `OUTCOME.DEFERRED` (dispatch.mjs);
`sweep`, `messageDispatchSweeper`, `SWEEP_CRON`, `SOURCE_WORKFLOW`
(message-dispatch-sweeper.mjs).

**Routes affected:** none. **Journeys affected:** none —
`npm run journeys:check` reports up to date (9 files).

### CLAUDE.md §12 — the rewrite does not say what it was asked to say

The instruction was to replace the "nothing transmits" line with wording
asserting that `src/adapters/`, `src/lib/`, `src/handlers/`, `src/workflows/`
and `src/mail/` "contain no outbound fetch, and none may be added."

**That is false, and it was false before this batch started.** Three call sites
already transmit:

* `src/adapters/lendflow.mjs` — submits an application.
* `src/workflows/ds-02-diy-letters.mjs` — POSTs to a letter-delivery URL.
* `src/workflows/c-06-crs-results-router.mjs` — POSTs to the same URL.

Writing the sentence as given would have put a false invariant into the file
agents are told to trust. The line as written keeps the intent — `providers/*`
is the only place new outbound `fetch` may be added — and names those three as
pre-existing exceptions rather than pretending they do not exist. `src/lib/`,
`src/handlers/` and `src/mail/` genuinely contain none, and the line says so.

**This needs the owner's eye.** If the intent was that those three should be
migrated behind provider modules, that is a real piece of work and nobody has
scheduled it.

### Verified

* Local Postgres 16.13 (this session's container, `initdb` at `/tmp/pg16data`,
  connected as the `postgres` superuser), all 89 migrations applied clean.
* `npm run lint` — 676 files parse clean.
* `npm run journeys:check` — up to date (9 files).
* `npm run diagrams:check` — in sync.
* `npx tsc --noEmit` — still a no-op in this repo, as W1 found. No
  `tsconfig.json`, no TypeScript. It prints its help text. Ticked, proves
  nothing.
* `npm test` with **no** database: **3894 pass, 0 fail, 460 skipped.**
* `npm test` against that Postgres: **4967 pass, 28 fail, 8 skipped.**
  The baseline at `fa0ee7d`, measured in the same container before any of this
  work, was **4942 pass, 29 fail**. **The failing set after this work is a strict
  subset of the baseline's** — nothing new fails. Two baseline failures
  (`hiring pipeline`, `scores cannot be deleted`) pass in the later run and are
  order-dependent, not fixed by anything here.

  **§12's warning holds and this is another data point for it: the number moved
  between two runs of the same commit in the same container.** Compare the
  failing set by name, never the count.
* Six deliberate mutations each fail the acceptance suite: the quiet-hours
  deferral removed, the gate verdict ignored, the claim no longer requiring
  `status='queued'`, the `claimDue` clock fix reverted, the subject stored
  unrendered, and `to_address` not recorded.

### Findings

1. **The n-06 acceptance test could have passed vacuously** and did, in its
   first draft: it looped over queued rows asserting each was blocked, and there
   were no rows because the templates it needed were not seeded. It now asserts
   at least one message was queued before asserting none of them went out. Worth
   copying — a "nothing was sent" test that queues nothing is a test that always
   passes.
2. **`sendTemplated`'s own opt-out guard only covers SMS.** Email relies
   entirely on the gate. That is fine now the dispatcher gates everything, but
   it means the pre-dispatcher code path could always have queued an email to an
   opted-out client. Nothing sent it, because nothing sent anything.
3. **`compliance_rules` has no phrase rules with an empty platform scope** in
   the seeded set — they are all `regex` or `required`. Worth knowing before
   writing a test that assumes a literal phrase match.
4. **Emitting a client-scoped event breaks any teardown that deletes clients
   without deleting events first.** `events.client_id` is a foreign key to
   `clients`, so adding `message.queued` took all four tests in
   `src/workflows/invoice-workflows.pg.test.mjs` down at once — the teardown
   failed, not the tests. Every other `.pg.test.mjs` that deletes clients was
   checked; that was the only one exposed. Worth knowing before adding the next
   event.
5. **`scripts/diagrams/generate.mjs` reads a group's section name from the
   comment line directly above it** in `src/events/canonical.mjs`. A multi-line
   comment puts its LAST line in the table as the section label — four times, in
   this case. Keep the line immediately above a group short.
