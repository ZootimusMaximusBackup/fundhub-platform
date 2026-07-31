# Proposed canonical events — banking / recurring bills

**Proposal only. `src/events/canonical.mjs` has not been edited.**

Per the build rules, a new canonical event name is proposed here rather than
added unilaterally. This mirrors `src/mail/PROPOSED-EVENTS.md` and
`src/commissions/PROPOSED-EVENTS.md`.

**Nothing in `src/banking/` depends on any of this existing.**
`detectRecurringBills()` is a pure function that takes rows and returns an
answer. It does not call `emit()`, does not take a `db`, and is completely
usable today without the bus. When a name is approved, a handler calls the
detector — not the reverse.

---

## The name collision to avoid

`mail.response` is already in `CANONICAL_EVENTS` and it means **an inbound bank
email classified by the Mailgun adapter**, handled by `onMailResponse()` in
`src/handlers/comms.mjs`, which writes a `bank_inbox` row. The word "bank" in
`bank_inbox` refers to a lender emailing about a credit application. It has
nothing to do with a linked deposit account, a transaction ledger, or a bill.

So **no proposed name below uses `bank.` as a prefix** without a qualifier that
makes the distinction obvious. Overloading anything in that family would put
garbage `bank_inbox` rows on the board.

---

## Proposed names

### 1. `bank.transaction.recorded`

Emitted once per newly written `bank_transactions` row.

- **Payload:** `{ transactionId, bankAccountId, clientId, amountCents, postedOn, merchantName, isPending, provider }`
- **Idempotency key:** the provider transaction id, scoped to the account —
  the same key as `uq_bank_transactions_account_provider`.
- **Why it might be wanted:** it is the hook a "large unexpected debit" alert
  or a live balance tile would attach to.
- **Why it is only proposed:** a busy account produces hundreds of these a
  month. Nothing in this repo consumes them yet, and an event stream nobody
  reads is a cost with no benefit. It should be added when there is a consumer,
  not before.

### 2. `bills.detected`

Emitted once per detection RUN, not per bill.

- **Payload:** `{ bankAccountId, clientId, detectedAsOf, billCount, candidateCount, rejectedCount, excludedCount }`
- **Idempotency key:** `${bankAccountId}:${detectedAsOf}` — the same account
  evaluated as of the same instant is the same run, so a replay cannot
  double-report.
- **Why per run and not per bill:** a bill is not an event. It is a standing
  inference that gets revised every time detection runs, and re-emitting
  `bill.detected` for the same Netflix subscription every week would fill the
  bus with restatements of an unchanged fact. `recurring_bills` already holds
  the current answer, keyed so a re-run updates in place.

### 3. `bill.changed` — **proposed but NOT recommended yet**

Would fire when a re-detection materially changes a stored bill: the amount
moves, the cadence changes, or the confidence crosses a band boundary.

**It is listed here to be argued against, because it is the one that will look
attractive and is the one most likely to cause harm.** "Materially" is doing all
the work in that sentence and nothing in this repo defines it. A threshold
chosen by guess would either fire on every cent of variance in a utility bill,
or stay silent through a real doubling. Worse, the obvious consumer for it is a
customer-facing notification — *"your internet bill went up"* — which is a claim
about a client's finances made from an inference this module is explicit about
not being certain of.

Define the threshold from real data first, and route anything customer-facing
through compliance before it is emitted. See `docs/compliance/`.

---

## What is deliberately NOT proposed

- **No `bill.due` / `bill.upcoming` / `payment.reminder`.** Reminders and
  projections belong to the projections workflow, which owns the decision about
  when something is "due". Emitting a due event from the detector would make the
  detector a scheduler, and it is explicitly not one.
- **No event carrying `next_expected_on` as a bare date.** Any consumer of a
  predicted date must also receive `confidencePct`, `confidenceLabel` and, when
  the date is null, `nextExpectedUnknownReason`. A date travelling on its own
  loses exactly the information the whole module exists to preserve, and the
  receiving end has no way to tell a high-confidence prediction from a guess.
