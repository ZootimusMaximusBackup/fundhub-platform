# Proposed canonical events — commission + billing

**Proposal only. `src/events/canonical.mjs` has not been edited.**

The commission model needs events that do not exist in `CANONICAL_EVENTS` today.
Per the build rules they are proposed here rather than added unilaterally —
`canonical.mjs` is the spec §4 event spine and adding to it is Darwin's call.

Nothing in `db/migrations/010`–`015` or `src/commissions/` depends on these
existing. The calculator is pure and takes its inputs as arguments; the ledger is
written by whoever wires the handlers. These are what those handlers would
naturally emit.

---

## What already exists and is enough

These fire the calculator and need no change:

| Existing event | Drives |
|---|---|
| `deposit.paid` | front-end commission — closer earns on deposit collected |
| `sale.closed` | attribution written; front end if the rule pays on `sale_price` |
| `round.started` | freezes the round → sale link (`funding_round_sales`) |
| `round.funded` | back-end commission — advisor earns on that round's funded amount |
| `payment.received` | `sale_payments` row; may re-fire a front-end rule |

The commission model is fully drivable from the existing spine. Everything below
is about what happens *after* a commission exists.

---

## Proposed: commission lifecycle

### `commission.earned`

Emitted when a `commission_ledger` row is written. This is the notification
surface — a rep's dashboard, the ops feed, the telemetry counters in spec §14.

```jsonc
{
  "name": "commission.earned",
  "version": 1,
  "idempotency_key": "<the ledger row's idempotency_key>",
  "client_id": "<uuid>",
  "payload": {
    "ledger_id": "<uuid>",
    "staff_id": "<uuid>",
    "employee_code": "EMP-000001",
    "client_code": "FH-000042",
    "basis": "front_end",          // front_end | back_end
    "stacking": "base",            // base | bonus
    "role": "closer",
    "amount": "500.00",
    "base_amount": "3000.00",
    "sale_id": "<uuid>",
    "funding_round_id": null,
    "product_id": "<uuid>",
    "source_event": "deposit.paid",
    "earned_at": "2026-07-01T12:00:00Z"
  }
}
```

Note the idempotency key is **the ledger row's own key**, so a replayed
`deposit.paid` produces the same `commission.earned` key and the events table's
unique index absorbs it exactly as the ledger's does. Replay-safe end to end
(Rule 9).

A reversal emits `commission.earned` with a negative `amount` and a
`reverses_ledger_id` in the payload, rather than a separate event name — it is the
same fact, signed. Worth a decision either way.

### `commission.approved`

`earned → approved`. Payload: `ledger_id`, `staff_id`, `amount`, `approved_by`,
`approved_at`. This is the gate a payout run reads.

### `commission.paid`

`approved → paid`. Payload adds `paid_by`, `paid_at`, `payout_ref`. This is what a
rep's "you've been paid" notification hangs off.

---

## Proposed: billing — and the one that unblocks three workstreams

### `invoice.raised` ⚠️ **wanted by three separate workstreams**

Spec §12: *"on `round.funded`, fee calculated, invoice raised, deposit credited"*
— the AX20/AX21 closeout. There is no outbound invoice capability anywhere in the
platform today.

Three places need it:

1. **DS-02** — a separate session porting DS-02 stubbed the Commas
   invoice-creation call as a **staff task**, because there was nothing to call.
2. **AR-series** — spec §12's *unpaid invoice → AR pipeline → sequences → AR voice
   agent* has no invoice to start from. Blocked on the same gap.
3. **This model** — the 10% success fee on `round.funded`.

**Darwin: this should be built once, not three times.**

```jsonc
{
  "name": "invoice.raised",
  "version": 1,
  "idempotency_key": "invoice|<sale_id>|<funding_round_id>",
  "client_id": "<uuid>",
  "payload": {
    "invoice_id": "<uuid>",
    "sale_id": "<uuid>",
    "funding_round_id": "<uuid>",
    "kind": "success_fee",         // success_fee | balance | manual
    "amount": "5000.00",
    "currency": "USD",
    "due_at": "2026-10-29T00:00:00Z",
    "provider": "commas",
    "provider_ref": "<commas invoice id>"
  }
}
```

**What this model provides, and what it does not.** The success fee amount is
already derivable — `v_sale_balance.success_fee_due` computes it from the percent
frozen on the sale against the funded rounds linked to it. Balance due is there
too.

What is missing is an **`invoices` table**. `v_sale_balance` is a computed
balance, not an invoice record: no invoice number, no issue date, no dunning
state, no provider reference. Whoever builds the AR side should own that table.
It should reference `sales(id)` and `funding_rounds(id)`, both of which exist.

Deliberately **not** built here: an invoice is an AR artefact, and guessing at its
shape from the commission side would produce exactly the second source of truth
this model exists to avoid.

**This does not block commission.** Back-end commission is earned at
`round.funded` regardless of whether the fee is invoiced or collected (CHRIS
PROVISIONAL #3). It blocks AR.

### `invoice.paid`

Closes the loop: AR marks the invoice settled, `sale_payments` gets a
`kind = 'success_fee'` row, `v_sale_balance` drops to zero. Payload: `invoice_id`,
`amount`, `paid_at`, `provider_ref`.

### `sale.recorded`

`sale.closed` already exists and is about the *deal* being closed. A distinct
`sale.recorded` — a `sales` row written with its agreed price and attribution — may
or may not be worth separating. **Probably not**, and it is listed only so the
question is asked rather than assumed. If `sale.closed` handlers write the sale
row, one event is enough.

---

## Summary for `canonical.mjs`, if approved

```js
// commission
"commission.earned",
"commission.approved",
"commission.paid",
// billing
"invoice.raised",
"invoice.paid",
```

Five names. `sale.recorded` is deliberately excluded pending the question above.

They belong under a new `// commission + billing` grouping alongside the existing
`// side events` block — none of them is part of the journey spine.
