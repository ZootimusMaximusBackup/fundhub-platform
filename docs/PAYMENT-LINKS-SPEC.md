# Payment links — what was built and what is assumed

**COMPLIANCE REVIEW REQUIRED** — this touches payment rails (CLAUDE.md §7).
Nothing here drafts a customer-facing claim about credit outcomes; flagging
because the feature moves money, not because of its wording.

## What this is

A CRM action: a member of staff opens a client, asks for a specific amount of
money for a specific reason (deposit, the diagnostic fee, a repair charge, or
anything else with a description), and the system hands back a Commas
checkout link. The client pays Commas directly. When Commas' webhook reports
the payment, the link is marked paid and `payment.received` fires on the
event bus, same as every other Commas payment in this system.

Screen: `public/app/subscriptions.html` — a new "Payment links" panel below
the existing plan/cards panel, same page because it is the other Finance OS
billing screen and already carries `?client_id=`.

## What was built

| Piece | File |
|---|---|
| Table | `db/migrations/119_payment_links.sql` |
| Template seed (see below) | `db/seed/007_payment_link_template.sql` |
| Store (create/send/expire/paid, reads) | `src/payment-links/index.mjs` |
| Outbound URL builder + inbound ref extraction | `src/adapters/commas.mjs` (`buildCommasCheckoutUrl`, `normalizeCommasEvent`'s `ref`) |
| Settles the link when Commas pays | `src/handlers/payment-links.mjs` (reacts to `payment.received`) |
| CRM endpoint | `api/payment-links.mjs`, routed in `netlify/functions/api.mjs` |
| Screen panel | `public/app/subscriptions.html` |
| Tests | `src/payment-links/index.test.mjs`, `src/handlers/payment-links.test.mjs`, `src/http/payment-links-endpoints.test.mjs`, additions to `src/adapters/commas.test.mjs`, additions to `src/http/subscriptions-screen.test.mjs` |

## The table: `payment_links`, not `invoices`

`invoices` (017/031) already exists and records money OWED on an AR ladder
(draft → sent → paid → overdue → void). It was deliberately **not** reused.
A payment link's lifecycle is its own thing (created → sent → paid, or →
expired/void) and is keyed to one specific checkout URL, not to an AR cycle.
Reusing `invoices` would have meant bolting a `link_ref`/`checkout_url`/
`commas_session_id` shape onto a table whose CHECK constraints and AR-ladder
semantics do not fit it, and reconciling the two ledgers is a real design
decision this task did not ask for. If the owner wants payment links to also
raise an invoice, that is a follow-up with its own migration — nothing here
reads or writes `invoices`.

It is also distinct from `transactions` (written by
`src/handlers/client-lifecycle.mjs`'s existing `onPaymentReceived`, which
already fires on every Commas `payment.received`). `payment_links` is the
**ask**; `transactions` is the **receipt**. A `payment_links` row reaching
`paid` implies a matching `transactions` row exists. The reverse is not true
— a client can pay Commas without ever having been sent a link from this
screen, and every one of those payments already lands in `transactions`
exactly as it did before this feature existed.

## The one real gap: how a checkout link for a variable amount is minted

This is the part that needed a judgement call, and it is recorded here rather
than guessed silently.

**What the task description said:** "Commas API ... creates checkout sessions
with variable amounts. Read [`src/adapters/commas.mjs`] first."

**What is actually in that file, and in this whole repository:** an inbound
webhook handler only. There is no outbound call to Commas anywhere in this
codebase — `src/adapters/commas.mjs`'s job (per its own header) is "verify,
normalize, emit" on inbound events, nothing else. No `COMMAS_API_KEY`, no
session-creation function, no `@fanbasis` SDK import. The file's own header
already carries a `⚠️ CONFIRM` banner saying its inbound field paths were
written from documentation, not an observed payload — the same is true, more
so, for anything about creating a session.

**The hard constraint this sits inside:** CLAUDE.md §12 states new outbound
`fetch` may be added **only** inside `src/messaging/providers/*`, with three
named, closed exceptions (`lendflow.mjs`, and two workflow files posting to a
letter-delivery URL). A server-side "create a Commas checkout session" API
call would be a fourth exception to a rule the file states explicitly has
none. Adding one was not this task's to authorize.

**The decision made, with full authority per the task's instructions:**
`buildCommasCheckoutUrl()` in `src/adapters/commas.mjs` builds a checkout URL
by pure string construction — no network call — against a
`COMMAS_CHECKOUT_BASE_URL` env var, with `amount`, `ref` (the link's own
opaque reference) and `description` on the query string. `ref` is the value
`normalizeCommasEvent` now also extracts from an inbound webhook (checking
`client_reference_id`, `metadata.link_ref`/`metadata.ref`, `reference`, `ref`,
in that order), on the assumption that a real Commas checkout page both
accepts a reference on the URL and echoes it back on the payment webhook —
the same class of assumption the file's existing CONFIRM banner already
covers for `bland`, `clickfunnels` and `lendflow`.

**This is unverified against a live Commas account.** Until someone checks it
against a real Commas sandbox:

- `COMMAS_CHECKOUT_BASE_URL` needs to be set to wherever Commas actually hosts
  a variable-amount checkout page (`netlify env:set` — blocked from this
  session by the network policy at CLAUDE.md §11; a human needs to run it, or
  clear the session network policy that's blocking `api.netlify.com`).
- If Commas does **not** echo a client reference back on its webhook, a link
  will sit at `sent` forever with no automatic path to `paid` — an honest
  stuck state (nothing marks it paid without seeing the money), not a silently
  wrong one. The fix, once the real webhook shape is known, is entirely inside
  `normalizeCommasEvent`'s `ref` extraction — nothing else needs to change.
- If Commas' checkout page does not read `amount` off the query string the
  way assumed here, `buildCommasCheckoutUrl` is the one function to change.

## Honest states, on purpose

- **No fake "paid".** Nothing in this feature can move a link to `paid`
  except `src/handlers/payment-links.mjs` reacting to a real
  `payment.received` event from the real webhook path. There is no "mark
  paid" button anywhere.
- **A different amount paid than asked is recorded, not hidden.**
  `paid_amount_cents` is separate from `amount_cents`. If a client pays a
  different amount than the link asked for, both figures survive.
- **"Send" is honest about not sending yet.** `sendTemplated` (the existing
  messaging path) refuses to render any template that has not passed
  `compliance_passed = true`. `db/seed/007_payment_link_template.sql` seeds
  the SMS copy with `compliance_passed = false` on purpose — sending a
  payment request to a client is exactly the kind of copy CLAUDE.md §7 wants
  reviewed before it goes out. Until a human flips that flag, pressing "Send"
  queues nothing and the response says so (`message_queued: false,
  message_reason: "template_pending"`) while still marking the link `sent`,
  because staff can — and the screen tells them to — copy the link and send
  it by hand in the meantime. This also means this is the **first
  staff-initiated send** in the codebase; `src/workflows/messaging.mjs`'s own
  header names that seam as empty until something uses it, and this is that
  something (the `staffId` telemetry path now fires for a real send).
- **No sample rows anywhere.** The screen renders "No payment links created
  for this client yet" against a real empty read, same pattern as every other
  panel on this page.

## Access

`ROLE_SETS.FINANCE` (`owner`, `admin`, `sales_manager`) on both `GET` and
`POST /api/payment-links` — the same gate as `finance/subscriptions` and
`finance/cards`, on the same reasoning: a payment link is a live request for
a client's money, the same class of action as starting a plan or filing a
card reference.

## What was not built

- No scheduler expires a stale link automatically. `expired` is a staff
  action (`action: "expire"`), because this repo has no cron/sweep mechanism
  for this and inventing one was out of scope.
- No reconciliation against `invoices` or `transactions` — see above.
- No Playwright run against a live browser: this environment has no browser
  session to drive interactively. `src/http/subscriptions-screen.test.mjs`
  (extended for this change) lifts the page's real wiring script out of the
  `.html` file and runs it against a stub DOM, which proves what the script
  puts on screen for a given API response without proving layout or
  legibility. A human should still open the screen once against a real
  session before calling this done end-to-end.

## Definition-of-done trace

- Staff creates a link for a test client → `POST /api/payment-links
  {action:"create", ...}` inserts a `created`-status row with a real
  `checkout_url` (once `COMMAS_CHECKOUT_BASE_URL` is set).
- The record persists with correct status → covered by
  `src/payment-links/index.test.mjs` and `src/http/payment-links-endpoints.test.mjs`.
- A simulated webhook marks it paid and the event fires → covered by
  `src/handlers/payment-links.test.mjs` (direct) and
  `src/adapters/commas.test.mjs` (the `ref` round-trips into the emitted
  `payment.received` payload the handler reads).
