# Fundhub — Backlog Build Spec (5B.1 and 5B.2)
**For Cursor. Owner-approved 2026-08-23.**

Resolves the two items parked in section 5B of `build-spec-2026-08-22.md`.
Every open decision has now been answered by the owner and is recorded below.

---

## 0. Rules

1. **Additive only.** Nothing here may change behavior that shipped on
   2026-08-22. The booking lane is live and being tested — do not destabilize it.
2. **Preserve-first.** Grep before building. `src/crs/snapshot-negatives.mjs`
   already exists (the AX-07 detector). `invoices.funding_round_id` already
   exists and is indexed. Finish what is there rather than writing parallel
   implementations. Report what you found.
3. **The decisions below are owner-set and final.** Implement the mechanism,
   not the policy. If a decision is technically impossible as written, stop and
   report — do not substitute your own.
4. **Money.** Integer cents via `src/commissions/money.mjs`. NULL means unknown
   and must survive — never default it to 0.
5. Run `node --test "src/workflows/*.test.mjs"` after each section. Update
   assertions when counts change; do not delete tests.
6. Journey changelog line in the same commit as the code, per CLAUDE.md §4.

---

## 1. 5B.2 — Multi-invoice payment allocation

### The problem

Per-round invoicing (shipped 2026-08-22) means a client can have several
invoices open at once. Nothing decides which invoice a payment applies to, so
the AR chase cannot tell which one to stop chasing.

### Owner decision

> "It's based on what was approved for that round."

**A payment applies to the invoice for its own round.** Not oldest-first. Each
success-fee invoice is tied to one funding round and is settled by the payment
raised against that round.

### What already exists

- `invoices.funding_round_id uuid REFERENCES funding_rounds(id)`, indexed as
  `idx_invoices_round` (`db/migrations/017_invoices.sql`)
- `invoices.invoice_type` includes `'success_fee'`
- `invoices.status` includes `'paid'`, and `paid_at` exists
- `invoices.provider_ref` holds the Commas invoice id
- `src/commissions/calculate.mjs` already computes the per-round success fee

So the schema supports this. What is missing is the allocation itself.

### The gap

`payment.received` (emitted by `src/adapters/commas.mjs`) carries `product` and
`purpose`. It carries **no invoice reference and no round reference**. So when
a payment lands there is nothing linking it to the invoice it settles.

### Build

**1.1 — Carry the invoice reference out and back.**

When AR sends an invoice, the payment link generated for it must carry that
invoice's identity, so the payment webhook returns it. Use `provider_ref` /
the Commas invoice id — whichever survives the round trip. Verify against the
Commas adapter what actually comes back on `payment.received`; do not assume.

**1.2 — Allocate on `payment.received`.**

Resolve the invoice in this order:

1. The invoice whose provider reference matches the one on the payment. This
   is the normal path and should cover essentially every payment.
2. If no reference survives: the client's oldest unpaid `success_fee` invoice
   whose `funding_round_id` matches the round named on the payment.
3. If still unresolved: **do not guess.** Leave the payment unallocated, create
   a staff task, and leave every invoice untouched. An unallocated payment is a
   visible problem. A wrongly allocated one is an invisible one.

Report how often path 2 and path 3 fire once this is live.

**1.3 — Partial payments.**

A payment smaller than the invoice total leaves the invoice **open** with the
balance reduced. It does not become `paid`, and the AR chase continues against
the remaining balance. `{{balance_due}}` must reflect the remainder, not the
original amount.

A payment larger than the invoice settles it and leaves the surplus
unallocated with a staff task. Do not auto-apply an overpayment to another
invoice.

**1.4 — Stop the right chase.**

`invoice.paid` must stop the AR chase for that invoice only. Other open
invoices on the same client keep their own chases running independently. Each
chase is scoped to one invoice, never to the client.

**1.5 — Idempotency.**

A replayed payment webhook must not double-settle. Key on the provider payment
id.

---

## 2. 5B.1 — Funding pause recovery chain

### Where this picks up

AX-07 (shipped 2026-08-22) detects a new negative on a CRS snapshot, closes the
funding gate, creates a sales task, and sends the paused email + SMS. It stops
there. This section builds everything after the task.

`src/crs/snapshot-negatives.mjs` is the existing detector. Build on it.

### Owner decisions

**The pause is a hard stop with a human release.**

> "Yes — when one bureau is clear they technically are eligible to fund if they
> want."

The gate closes automatically and blocks the funding advisor from proceeding.
It is not advisory. But when at least one bureau is clean, funding on the clean
bureaus remains **available as a choice** — a rep or advisor can release the
gate for that path. The reasoning the owner gave: one new negative usually
means more are coming, so the default is to stop rather than let an advisor
burn a round. The clean-bureau route stays open for the client who wants it.

**The discounted repair offer reuses everything.**

> "The contract is the same, payment link is api and commission base is
> percentage."

- Same contract template as standard repair — no new contract wording
- Payment link generated through the existing API path, at a discounted amount
- Commission base stays percentage — do not introduce a flat-fee path

This is a **price**, not a new product. Do not add an entry to
`src/config/offers.mjs` unless the existing repair offer genuinely cannot carry
a variable amount. If it can, use it.

**A clean CRS snapshot reopens the gate.**

> "CRS clean snapshot."

The same snapshot pipeline that detects a new negative also clears the gate
when a later snapshot comes back clean. One mechanism, both directions — do not
build a second detector for the reopen.

**The next funding round is a fresh reassessment, not a resumption.**

> "Credit repair can take up to 6 months, although it happens quicker. So we
> basically reassess. Since accounts have aged, balances have changed, new
> accounts etc."

After repair completes, the client is re-underwritten from scratch: new pull,
new analysis, new round numbering. Do not resume the paused round. Prior
rounds' invoices stay attached to those prior rounds and are unaffected.

### Build

**2.1 — The sales task carries what the rep needs.**

The task AX-07 creates today must name the situation: which bureau or bureaus
took the new negative, which remain clean, and that the client is eligible to
fund on the clean ones if they choose. A rep should not have to go digging to
know what to offer.

**2.2 — Two routes off the task, both explicit.**

- **Route A — sell discounted repair.** Existing repair contract, API payment
  link at the discounted amount, percentage commission. Gate stays closed.
- **Route B — fund the clean bureaus.** A named staff release of the funding
  gate, scoped to that client, recorded with who released it and when. Only
  offerable when at least one bureau is clean — the detector already knows
  which.

Both routes may be taken. Selling repair does not remove the option to fund
clean bureaus.

**2.3 — Release must be auditable.**

Every gate release records actor, timestamp, and route. A funding gate that can
be opened without a trail is not a gate.

**2.4 — Reopen on a clean snapshot.**

When a later CRS snapshot for a paused client comes back with no new negatives,
clear the gate automatically and notify the rep. Reuse the existing snapshot
comparison. No new template needed — report if you believe one is required
rather than writing copy.

**2.5 — Fresh reassessment after repair.**

On repair program completion for a paused client: create a task to re-pull CRS
and re-underwrite. The new funding round is a new round with its own number and
its own invoice. Do not reopen or renumber the paused round.

---

## 3. Out of scope

| Item | Why |
|---|---|
| New copy | Reuse existing templates. If a gap is real, report it — do not write copy. |
| Changing the commission rate | One sixth, owner-set, migration 256. Settled. |
| Restating the 21 rows at 16.67% | $0.81 total, owner accepted. |
| Auto-applying overpayments across invoices | Explicitly refused above. Staff task instead. |
| Anything touching the booking lane | Live and under test. Do not touch. |

---

## 4. Verification

1. `node --test "src/workflows/*.test.mjs"` green.
2. Allocation tested against: exact payment, partial payment, overpayment,
   two invoices open at once, replayed webhook. Each must land on the right
   invoice and stop only that invoice's chase.
3. Gate tested against: new negative on one bureau with two clean, new negative
   on all three, clean snapshot after a pause, staff release. The release must
   appear in the audit trail.
4. **Do not run `verify:e2e` against production.** The scratch guard added on
   2026-08-22 (`src/verification/scratch-guard.mjs`) should refuse — confirm it
   still does.
5. Report anything you found already built and restored rather than rebuilt.
