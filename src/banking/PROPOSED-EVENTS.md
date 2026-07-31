# Proposed canonical events — bank linking (W5)

**Proposal only. `src/events/canonical.mjs` has not been edited.**

`canonical.mjs` is the spec §4 event spine and adding to it is the owner's call,
not a workflow's. Nothing in migrations `080`–`082`, `src/adapters/plaid.mjs`,
`src/banking/index.mjs` or `api/banking/plaid.mjs` depends on any of these
existing. Bank linking works today without them; what it does not have is a way
to *tell anyone* that something happened.

---

## What already exists and is enough

Nothing. There is no event in the current spine about a bank connection, a
balance, or a consent window. `docs.received` is the nearest neighbour and it is
about documents, not accounts — reusing it would make "the client uploaded a
statement" and "the client linked their bank" indistinguishable to every handler
downstream.

---

## Proposed: the link lifecycle

### `bank.linked`

Emitted when `linkItem()` succeeds — the moment a standing credential to a
client's bank comes into existence.

```jsonc
{
  "name": "bank.linked",
  "version": 1,
  "idempotency_key": "<org_id>:<plaid item_id>",
  "client_id": "<uuid>",
  "payload": {
    "plaid_item_id": "<uuid — our row id, not Plaid's token>",
    "item_id": "<Plaid's item_id>",
    "institution_id": "ins_3",
    "institution_name": "Chase",
    "account_count": 4,
    "linked_by": "<staff uuid>",
    "linked_at": "2026-07-31T12:00:00Z"
  }
}
```

The payload carries **no access token and no balance**. An event body is copied
into logs, dead-letter rows and replay tooling, and a credential that reaches any
of those is a credential that has to be rotated.

### `bank.link_broken`

Emitted when a sync sets an item's status to anything other than `active`. This
is the one that has a customer consequence: `login_required` means only the
client can fix it, and nobody finds out unless something says so.

```jsonc
{
  "name": "bank.link_broken",
  "version": 1,
  "idempotency_key": "<plaid item row id>:<error_code>:<date>",
  "client_id": "<uuid>",
  "payload": {
    "plaid_item_id": "<uuid>",
    "status": "login_required",     // login_required | pending_expiration | revoked | error
    "error_code": "ITEM_LOGIN_REQUIRED",
    "institution_name": "Chase",
    "detected_at": "2026-07-31T12:00:00Z"
  }
}
```

The idempotency key includes the date deliberately: a link that stays broken for
a week should produce one notification a day at most, not one per sync.

### `bank.consent_expiring`

Consent windows lapse. `plaid_items.consent_expires_at` holds the date when Plaid
gives us one, and NULL means Plaid did not say — **not** "never expires". A
handler for this event has to treat those two cases differently, which is the
main reason it is worth being an event rather than a query somebody remembers to
run.

```jsonc
{
  "name": "bank.consent_expiring",
  "version": 1,
  "idempotency_key": "<plaid item row id>:<consent_expires_at>",
  "client_id": "<uuid>",
  "payload": {
    "plaid_item_id": "<uuid>",
    "consent_expires_at": "2026-10-01T00:00:00Z",
    "days_remaining": 14,
    "institution_name": "Chase"
  }
}
```

### `bank.accounts_synced`

Emitted after a successful balance refresh. Low value on its own; proposed
because W8's projections need a trigger that is not a timer, and because it is
the natural place for a "balances are stale" check to hang off.

```jsonc
{
  "name": "bank.accounts_synced",
  "version": 1,
  "idempotency_key": "<plaid_sync_audit row id>",
  "client_id": "<uuid>",
  "payload": {
    "plaid_item_id": "<uuid>",
    "account_count": 4,
    "unclassified_count": 2,
    "synced_by": "<staff uuid | 'system'>",
    "synced_at": "2026-07-31T12:00:00Z"
  }
}
```

`unclassified_count` is the number of accounts still at `entity_kind = 'unknown'`.
That is a work queue, not a defect — see below.

---

## Deliberately NOT proposed

**`bank.account_classified`.** A staff member setting an account to
personal/business is already written to `bank_accounts.entity_kind_set_by` and
`entity_kind_set_at`, with the constraint in `082` making an unattributed
classification unrepresentable. An event would be a second, weaker copy of a
record that already exists in the row.

**Anything carrying a balance.** No event body should contain a client's account
balance. Events are replayed, logged and dead-lettered; a balance in one is a
copy of somebody's finances in a place nobody is auditing.

**Anything that fires on `entity_kind = 'unknown'`.** Unknown is a real value and
a normal state, not an error to alarm on. A handler that treats every unclassified
account as a problem trains people to ignore the alert, and then the alert is
worth nothing on the day it matters.

---

## Compliance note

`bank.linked` and `bank.consent_expiring` touch consent capture and are worth a
compliance read before any handler is written for them. Nothing here transmits:
consistent with the rest of the platform, `sendTemplated` would write a
`messages` row with `status='queued'` and nothing would send it.
