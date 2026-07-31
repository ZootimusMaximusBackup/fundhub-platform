# Proposed canonical events — on-demand soft pulls

**Proposal only. `src/events/canonical.mjs` has not been edited.**

Same posture as `src/auth/PROPOSED-EVENTS.md` and `src/documents/PROPOSED-EVENTS.md`:
`canonical.mjs` is the spec §4 event spine, adding a name to it is the owner's
call, and a build that needs one writes it down here instead of adding it.

Nothing in `db/migrations/077_soft_pull_requests.sql`,
`src/finance/soft-pulls.mjs` or `api/finance/soft-pull.mjs` depends on any of
these existing. Not one of them calls `emit()`. The soft-pull ledger is fully
functional without a single new event name.

---

## Why the existing spine is not enough

`diagnostic.paid` already exists and already fires the engine flow —
`c-00-crs-soft-pull-request` listens for it and stamps
`crs_status: "Requested"`. That is the **paid gate**: the client bought the $32
Business Financial Assessment, and the payment is what authorises the pull.

The on-demand path is a different fact. Nobody paid $32. An existing client, or
the employee working their file, asked for the credit picture to be refreshed —
under a plan, under an included allowance, or at a per-pull cost that the ledger
records in `cost_cents`. Reusing `diagnostic.paid` for that would be a lie in
the events table: it would assert a payment that did not happen, and it would
re-drive C-00's whole invoice/consent/paid-gate branch for a request that never
went through it.

So the gap is real. It is also not urgent — see the last section.

---

## Proposed: `softpull.requested`

Emitted after a `soft_pull_requests` row is inserted, by whatever ends up
calling `requestSoftPull()`.

```jsonc
{
  "name": "softpull.requested",
  "version": 1,
  "idempotency_key": "softpull|<soft_pull_request_id>",
  "client_id": "<uuid>",
  "payload": {
    "request_id": "<uuid>",
    "requested_by_kind": "staff",          // "staff" | "client"
    "requested_by_staff_id": "<uuid>",     // exactly one of these two is set
    "requested_by_account_id": null,
    "reason": "closer refreshing the funding waterfall before the call",
    "cost_cents": 1200,                    // NULL means UNKNOWN, never free
    "subscription_id": null,
    "at": "2026-07-31T12:00:00Z"
  }
}
```

**The idempotency key is the request row's id**, so a replayed emit collapses
onto the same row via the existing `idx_events_idem` unique index. Replay-safe.

**The payload carries the attribution and nothing else about the person.** No
SSN, no date of birth, no bureau identifiers, no report contents. The events
table is queried, exported and replayed; consumer identity data in a payload is
consumer identity data in a backup. `pii_identity` is the encrypted, access-
logged home for that and it should stay the only one.

## Proposed: `softpull.completed`

Emitted by `fulfilSoftPull()`'s caller once a `crs_results` row has answered the
request and the tradelines have been ingested.

Payload: `request_id`, `crs_result_id`, `tradelines_ingested` (an integer),
`at`. Idempotency key `softpull|<request_id>|completed`.

This is the one with downstream value: it is the natural trigger for
"re-run the funding waterfall and tell the closer the number moved", which today
has nothing to hang off. Note that `U-03 — CRS Snapshot Sync` already exists and
covers the post-pull sync for the paid path; whoever approves this name should
check whether U-03 should listen to it rather than a second workflow being
written.

## Proposed: `softpull.failed`

Emitted by `closeSoftPull()`'s caller for `status: 'failed'`. Payload:
`request_id`, `state_reason`, `at`.

Worth having separately from `softpull.completed` because a pull that could not
be obtained is an operational fact somebody has to act on, and it currently has
no route to a screen at all.

**`softpull.cancelled` is deliberately NOT proposed.** A withdrawn request is
already fully recorded in `soft_pull_requests` with its reason and its
`resolved_at`, and nothing downstream would act on it. Emitting an event per
cancellation adds rows to an append-only table to record that nothing happened.

---

## The decision this actually asks for

Not the three names. The question is whether the on-demand path is a **first-
class journey step** or an **operational detail of the credit file**.

* If it is a journey step, these belong in the spine next to `diagnostic.paid`
  and the workflows that read the spine can react to them.
* If it is an operational detail, the ledger table is the whole answer and the
  spine should stay as it is. `soft_pull_requests` already records everything an
  audit needs, and every one of these events would be a second copy of a fact
  that has a better home.

**My reading is the second one, for now**, which is why nothing emits and why
this file exists instead of a diff to `canonical.mjs`. The moment there is a
provider that can actually complete a pull — see the PROVIDER SEAM in
`src/finance/soft-pulls.mjs` — `softpull.completed` becomes worth the widening,
because at that point something real needs to wake up when a client's credit
picture changes. Until then it would be an event nobody listens to, describing a
request nobody sent.

---

## Summary for `canonical.mjs`, if approved

```js
// on-demand soft pulls
"softpull.requested",
"softpull.completed",
"softpull.failed",
```

Three names. `softpull.cancelled` is excluded — see above. All three carry a
real `client_id`, so unlike the staff-auth proposal they do not widen what the
events table is for.
