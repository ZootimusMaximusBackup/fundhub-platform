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
| W2 | Provider: email (mailgun) | unclaimed | `pending` |
| W3 | Provider: SMS (ghl_relay) | unclaimed | `pending` |
| W4 | The dispatcher loop itself | unclaimed | `pending` |

W2, W3 and W4 were blocked on W1's brief. **They are now unblocked.** The
contracts below are what they build against.

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
| `to` | `string` | Destination address or E.164 phone number. Already resolved — a provider does not look up the client. |
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
