# Portal sign-in by emailed link

**What this is:** how a funding client gets into their portal. They type their
email address, we email them a link, they click it, they are in. No password.

**Status:** built and working end to end. Nothing here sends an email yet — see
[What is still not true](#what-is-still-not-true) at the bottom, which is the
most important section in this file.

---

## The problem this fixes

The client portal has existed for a while. So has the machinery to give a client
a session (`db/migrations/044_accounts.sql`, `src/auth/account-session.mjs`).
What did not exist was any way for a client to **start** one.

Sign-in for a non-employee needed a password, and nothing in this system has
ever set a password on a client's account. There is no screen that does it, no
script that does it, and no email that offers to. So the portal was reachable in
principle and unreachable in practice.

An emailed link is the fix because the client already has the one thing we can
check: an email address on their file.

---

## Correcting the brief

The task this was built from said the `accounts` and `account_sessions` tables
have no migrations and the session code cannot run.

**That is not the case, and it was checked before anything was written.**
`db/migrations/044_accounts.sql` creates both tables, plus
`account_signup_policy` and the invite-only trigger, and it is listed in
`db/expected-migrations.mjs`. It applies cleanly. `src/auth/account-session.mjs`
runs against it today — `api/auth/login.mjs` has been calling `loginAccount()`
through it, and `api/auth/session.mjs` resolves the sessions it mints.

So no new tables for accounts or sessions were written. Writing a second pair
would have been the worst possible outcome: two tables with the same name in two
migrations, or a silent no-op, depending on which ran first.

**The real gap was the one this work closes** — there was no way to obtain a
session without a password, and no client has a password.

---

## How it works, in order

1. The client opens `/portal-login.html` and types their email address.
2. The browser posts it to `POST /api/auth/magic-link`.
3. The server writes one row to `account_magic_links` and — if that address
   belongs to somebody — mints a token, stores only its SHA-256 hash, and queues
   an email containing the link.
4. The reply is the same for every address. Always.
5. The client clicks the link, which lands back on `/portal-login.html?t=…`.
6. That page posts the token to `POST /api/auth/magic-link-verify`.
7. The server spends the link, creates the account if it did not exist, mints an
   account session, and hands the browser a token and a cookie.
8. The browser goes to `/app/client-portal.html`, signed in.

---

## The decisions, and why

Everything below was decided in this session under the full authority the task
granted. Each one is written down because the reason matters more than the
choice.

### The link expires in 15 minutes and works exactly once

A link sitting in an inbox is a credential lying around. Fifteen minutes is long
enough to move to a phone and open the mail, short enough that an archived
message is not a way in a month later.

Single use is enforced by the database, not by the code being careful: spending
a link is one `UPDATE … WHERE consumed_at IS NULL AND expires_at > now() …
RETURNING` statement. Two requests carrying the same token cannot both win —
the second one matches no row. A read followed by a write would let a mail
scanner and the actual human both end up signed in.

### Only the hash of the token is stored

Same as every other credential in this system. `account_magic_links.token_hash`
holds SHA-256 of the token; the token itself exists in the email and nowhere
else. A stolen database backup yields no working links.

### The answer never says whether an address is a client

`POST /api/auth/magic-link` returns the identical 200 and the identical sentence
for an address we know, an address we do not, a suspended account, and an
affiliate. Not a different status code, not an extra field, not different
wording.

If it did not, the form would answer "is this person a Fundhub customer?" for
any address anybody cared to type. For a consumer-finance product that list has
a market.

The service layer does know which case it was — it returns an `outcome` for the
log — and `api/auth/magic-link.mjs` deliberately reads none of it. There is a
test that fails if any of those words ever appear in the response body.

### Rate limiting counts requests, not failures

Three requests per email address and fifteen per source address, in a rolling
fifteen minutes.

It counts rows in `account_magic_links`, and **an address that matches nothing
still writes a row**. That is the point. If unknown addresses wrote nothing,
only real customers could ever be throttled — and "did this address get
throttled?" would be the account oracle the uniform reply exists to close.

The existing password rate limiter (`checkRateLimit` in `src/auth/login.mjs`)
was deliberately *not* reused. It counts failed logins, and asking for a link is
not a failed anything. Feeding link requests into it would spend a real
customer's password-login budget and lock them out of the other door.

### Asking for a link creates nothing; clicking one does

If requesting a link could create an account, anybody spraying addresses could
fill the `accounts` table with half-real customers.

So the account is created at **verification**, once the link has proved the
address reaches whoever asked for it. If the address matched a `clients` record
and no account, the link is bound to that client and the account is created on
first click — carrying the client's name and marked active.

### The account gets a password hash nobody holds

044 has a constraint, `accounts_active_needs_hash`: an active account must carry
a `password_hash`. It means "an active row can authenticate", and that sentence
is worth keeping.

The obvious move was to drop it. That was rejected — `src/auth/account-session
.pg.test.mjs` asserts the rejection, and a migration whose purpose is to make a
test stop failing is a migration that removed a guarantee to buy quiet.

Instead, a provisioned account gets 32 random bytes hashed with the same scrypt
every staff password uses, and the cleartext is discarded inside the function
that made it. The row holds a real credential; it is simply one that nobody —
including this system — has a copy of. Password sign-in against it is a
2⁻²⁵⁶ event rather than a rule someone has to remember. The column's claim is
true.

It is not a lock-out either: a client who wants a password can get one the
ordinary way.

### The emailed link points at a page, not at the API

This one is easy to get wrong and expensive when you do.

A magic link works once, so whatever opens it first spends it. Mailbox
providers and corporate mail gateways routinely fetch every URL in a message to
scan it. A link pointing straight at the verification endpoint gets burned
before the human ever clicks, and the client — who did nothing wrong — is told
their sign-in failed.

So the email points at `/portal-login.html?t=…`, which is a static HTML file. A
scanner fetching it consumes nothing. Only a real browser runs the script, and
only that script posts the token to the verification endpoint. The endpoint
**refuses GET entirely**, so this is enforced rather than merely conventional.

The page strips the token out of the address bar before it makes the network
call, so the credential is not left in a screenshot, a bookmark, or the next
page's referrer.

### Client principals only

Affiliate and partner accounts are refused — silently, with the same uniform
reply. Both are commercial relationships that arrive by invitation; 044 makes
`partner` invite-only at the table level for exactly that reason. Opening a
partner's book of clients through an emailed link is a bigger decision than this
unit, and nothing here removes their existing password sign-in.

### Both the token and the cookie, matching the password login

The verification endpoint returns the session token in the body **and** sets the
`fundhub_session` cookie, with `HttpOnly`, `Secure`, `SameSite=Lax`. That is
exactly what `api/auth/login.mjs` already does: the app reads the body into
local storage for its own calls, and a cold page reload has only the cookie.
Matching it was preferred over inventing a third arrangement.

---

## What was built

### Database

| File | What it does |
|---|---|
| `db/migrations/117_account_magic_links.sql` | The `account_magic_links` table, its indexes, and the grant to the unprivileged `fundhub_app` role. |
| `db/seed/007_portal_magic_link_template.sql` | The `EMAIL-PORTAL-MAGIC-LINK` template row — the actual words of the email. |

`account_magic_links` is a **request log first and a token store second**. Every
request writes one row. A row with `token_hash` set is a real link; a row with
`token_hash` NULL is a receipt for a request that matched nobody, and carries no
secret because none was minted.

`outcome` records which of the three cases it was: `issued`, `no_account`, or
`not_eligible`. It is for support and for the limiter. It never reaches a
caller.

The grant matters. `db/migrations/104_app_role.sql` runs the application as
`fundhub_app`, which holds no privilege it was not given. A new table on the
sign-in path without a grant is a permission error on the first client who tries
to sign in — in production, not here. 117 grants it and then verifies the grant
took, raising rather than reporting success if it did not.

### Code

| File | What it does |
|---|---|
| `src/auth/magic-link.mjs` | All of it: issuing, the limiter, provisioning, verification. |
| `api/auth/magic-link.mjs` | `POST` — ask for a link. Answers everybody the same. |
| `api/auth/magic-link-verify.mjs` | `POST` — spend a link for a session. Refuses `GET`. |
| `public/portal-login.html` | The sign-in page, and the landing spot for the emailed link. |
| `netlify/functions/api.mjs` | Both paths added to `ROUTES`. |
| `src/messaging/merge-tags-registry.mjs` | Teaches the template editor about `{{magic_link.*}}`. |

The routing entry is not a detail. `CLAUDE.md` §12 records that a finished
feature has twice been left unreachable by a missing line in that map. For a
magic link that failure mode is the worst available: the client gets the email,
clicks, and lands on a 404.

Nothing in this path transmits. `sendTemplated()` writes a `messages` row with
`status='queued'` and stops, which is exactly what it does everywhere else, and
no provider module is imported here.

### The email

Seeded rather than written as a string in code, because `sendTemplated()` is a
**silent no-op** against a template key with no row — it returns
`{ sent: false, reason: "template_pending" }`, throws nothing, and warns
nowhere anybody reads. A sign-in email referencing a key with no row would mean
the client asks for a link, gets a cheerful 200, and nothing is ever queued.

The copy is transactional: somebody asked to sign in, here is the link, it dies
in fifteen minutes, ignore this if it was not you. It makes no claim about
credit, scores, disputes, funding, or outcomes — nothing on `CLAUDE.md` §7's
list is in scope for a sign-in email.

`compliance_passed` is set true so it will actually send. Per
`116_template_approval.sql`, `approved_by` and `approved_at` stay NULL, which
records honestly that no person has signed this copy off — the same standing
every bulk-seeded template row already has. An owner or admin who opens the
template editor and approves it puts a real name and a body hash against it.

### Tests

| File | Covers |
|---|---|
| `src/auth/magic-link.test.mjs` | The refusals that must not cost a database query, and the shape of the emailed URL. |
| `src/auth/magic-link.pg.test.mjs` | Issuing, expiry, single use (including a race), enumeration behaviour, rate limiting, provisioning (including a race), invited-account activation. |
| `src/http/magic-link-endpoints.pg.test.mjs` | The handlers: that the reply never leaks the outcome, that `GET` on verify is refused, that both paths are routed, and the whole flow end to end. |

The endpoint tests live under `src/http/` and not next to the handlers because
`npm test`'s glob is `src/**` and `scripts/**` only — a test placed under `api/`
never runs and reports nothing while looking green (`CLAUDE.md` §12).

Both database test files wipe their rows on the way **out** as well as in. The
dispatcher's acceptance suite claims queued messages by organisation rather than
by client, so a single stray queued row from these tests makes an unrelated
file's send count wrong. This was found by running the suite, not by reasoning.

---

## What is still not true

**No email is actually delivered by any of this.** The link is minted and the
message row is written and it sits there.

That is not an oversight in this work — it is the state of the whole messaging
path and it is deliberate. `src/messaging/dispatch.mjs` is the thing that hands
a queued row to a provider, and nothing schedules it. `CLAUDE.md` §11 names
`INNGEST_EVENT_KEY` as one of the three switches that must be asked about first,
because turning it on makes 47 workflow functions go live at once. Nothing in
this session touched it.

**So the flow works, and the last step is a switch only the owner throws.**
Until then a link can be relayed by hand: it is in `messages.rendered_body`.

Two smaller ones:

- `PORTAL_BASE_URL` is not set on the deploy. It decides which host the emailed
  link points at. Unset, the code falls back to Netlify's own `URL` /
  `DEPLOY_PRIME_URL`, and then to `https://fundhub.ai` — so it is correct on a
  normal production deploy without being set at all. It could not be set from
  this session: `api.netlify.com` is blocked by the network policy in the hosted
  agent environment (`CLAUDE.md` §11), which is an organisation policy denial,
  not a retryable failure.
- There is no `docs/journeys/client-intended.md`. In fact there are no
  `-intended.md` files at all — only the generated `-actual.md` ones. §4 says to
  read the intended journey before touching a flow, and there was none to read,
  so nothing could be checked against it. That absence is reported here rather
  than filled in: authoring one would be inventing a specification and calling
  it the source of truth. `client-actual.md` was regenerated and now shows both
  new routes.

---

## Checking it yourself

With a database and the dev server running:

```
DATABASE_URL=... node db/migrate.mjs
DATABASE_URL=... PORTAL_BASE_URL=http://127.0.0.1:8899 node scripts/dev-server.mjs
```

Open `http://127.0.0.1:8899/portal-login.html`, type the email address of any
client on file, and submit. Then read the link out of the queued message:

```sql
SELECT rendered_body FROM messages
 WHERE template_key = 'EMAIL-PORTAL-MAGIC-LINK'
 ORDER BY created_at DESC LIMIT 1;
```

Paste that link into the browser. It should land on the portal signed in, and
pasting it a second time should be refused.
