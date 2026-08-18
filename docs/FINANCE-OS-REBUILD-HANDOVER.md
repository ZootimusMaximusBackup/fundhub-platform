# What Finance OS has to rebuild, now that the Subscriptions screen is gone

**COMPLIANCE REVIEW REQUIRED** — one item below moves real money
(payment links). CLAUDE.md §7. Flagged as a marker, per owner instruction.

**Date:** 2026-08-17
**Owner decision:** delete the Subscriptions screen. Tracking client payments
belongs inside Finance OS, which is being rebuilt separately.

## Read this first

Only a **screen** was deleted. Nothing behind it was touched.

Every API still works. Every database table still holds its rows. Every
security rule still applies. A builder picking up Finance OS does not have to
rewrite any of that — it is sitting there, tested, waiting for a new screen.

What was lost is the **buttons**. Three jobs no longer have anywhere to click.

## The three jobs Finance OS needs to pick up

### 1. A client's plan

Look at what a client is subscribed to, start a plan, change the tier, or
cancel it.

- Endpoint: `GET /api/finance/subscriptions?client_id=<uuid>`
- Endpoint: `POST /api/finance/subscriptions` with `action` of
  `start`, `change`, or `cancel`
- Code behind it: `api/finance/subscriptions.mjs`, `src/subscriptions/store.mjs`
- Who is allowed: owner and admin only (`ROLE_SETS.FINANCE`)

### 2. A client's card

Add a card, attach it to a plan, or remove it.

- Endpoint: `GET /api/finance/cards?client_id=<uuid>&include_removed=1`
- Endpoint: `POST /api/finance/cards` with `action` of `add`, `attach`, `remove`
- Code behind it: `api/finance/cards.mjs`
- Who is allowed: owner and admin only

Note: "attach" writes to the subscriptions table. The two are joined at the hip.

### 3. Payment links — the one that matters most

Ask a client for a specific amount of money for a specific reason. The system
hands back a checkout link. The client pays. A webhook marks it paid.

**Until Finance OS rebuilds this panel, nobody can create a new payment link.**
There is no other screen for it. This is a real capability gap starting today,
and it was accepted knowingly.

- Endpoint: `GET /api/payment-links?client_id=<uuid>`
- Endpoint: `POST /api/payment-links` with `action` of `create`, `send`, `expire`
- Code behind it: `api/payment-links.mjs`
- Full specification, still accurate apart from which screen hosts it:
  `docs/PAYMENT-LINKS-SPEC.md`

**Links already sent keep working.** The part that listens for "this got paid"
is `src/handlers/payment-links.mjs`. It is server-side and needs no screen, so
payments still land and still get recorded. The landing page
`public/app/payment-success.html` also still works.

## Things a rebuilder must not break

- `src/subscriptions/index.mjs` is shared. Payment links and the closer deck
  both use it for price formatting. Do not fold it into a new screen.
- `db/migrations/075`, `076`, `077` and `153` are applied. Never edit an applied
  migration — add a new one instead.
- The subscriptions table has a rule preventing two overlapping plans for one
  client. Keep going through `src/subscriptions/store.mjs` rather than writing
  raw SQL, or that rule can be bypassed.
- `soft_pull_requests.subscription_id` has no foreign key on purpose. Deleting
  subscription rows will silently orphan it and the database will not warn you.

## What was deleted, exactly

- `public/app/subscriptions.html` — the screen
- `src/http/subscriptions-screen.test.mjs` — the test that read that file
- The Subscriptions row in the sidebar, and its four entries in
  `public/app/shell.js`

Nothing else.
