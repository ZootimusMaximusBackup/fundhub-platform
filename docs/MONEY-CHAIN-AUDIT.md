# Money chain audit — 2026-08-02

Written for a human who was not in the merge session and cannot see the CRM.
Plain English. Measured against `main` after the go-live batch (`87a7355`).

This is diagnostic only. Nothing was fixed here.

---

## What “the money chain” means

When a client pays, a deal closes, or a funding round lands, the system is
supposed to leave durable rows in Postgres so later screens and payouts can
trust the numbers. The pieces are:

1. **Sales** — “this client bought this product for this price.”
2. **Funding rounds** — “this client was funded for $X in round N.”
3. **Commission ledger** — “this closer (or affiliate) earned $Y on that event.”
4. **Entitlement grants** — “this client unlocked product Z (letters pack, funding path, etc.).”
5. **Invoices** — “we billed them $A.”
6. **Payment links** — “we sent a checkout link; it was paid or expired.”

Below: for each piece, what should write the row, whether a live writer exists,
and what a person sees when the writer is missing.

---

## 1. Sales

**What should cause a row?**  
A deal closing — typically a Commas payment mapped to a product (diagnostic,
deposit, DIY letters, full funding purchase). The event name in this codebase
is often `sale.closed` (DIY) or related payment events (`diagnostic.paid`,
`deposit.paid`, `payment.received`).

**Does a live handler write the `sales` table?**  
**No.** A repo-wide search for `INSERT INTO sales` outside tests finds nothing.
The live handler for `sale.closed` (`src/handlers/client-lifecycle.mjs`) only
flips a custom-field flag (`sale_closed: true`) on the client record. It does
not insert a sale.

Commission SQL (`SQL_SALE_CONTEXT`, attributions, etc.) **assumes** a sale row
already exists. Nothing in production creates it.

**What that means in practice**  
- Screens that list or total sales stay empty or wrong.  
- Commission calculation can be demoed in unit tests with hand-built sale rows,
  but a real close will not create the sale the ledger expects.  
- The CRM can still show “sale closed” as a flag on the person while the money
  tables stay blank.

**Concrete walkthrough**  
1. Client pays for DIY letters through Commas.  
2. Webhook normalizer emits `payment.received` and `sale.closed`.  
3. `onSaleClosed` sets `sale_closed` on the client.  
4. **Chain breaks:** no `sales` insert.  
5. Later, anything that joins `sales` for commissions or reporting finds nothing.

---

## 2. Funding rounds

**What should cause a row?**  
A funding round being opened or marked funded (lender approval / funds wired).

**Does a live handler write `funding_rounds`?**  
**No insert.** Workflows **read** rounds and sometimes **update** them (for
example F-09 sets `hold_reason` when all applications are denied). Tests insert
rounds by hand. There is no production `INSERT INTO funding_rounds` in handlers
or workflows.

**What that means**  
- “Funded today” / round history screens that read this table stay empty unless
  someone loaded data manually.  
- Workflows that gate on “has this client ever been funded?” (`funded_amount > 0`)
  never see a real yes from live traffic.  
- Numbers calculated for display from other sources will not match a round ledger
  that was never written.

**Concrete walkthrough**  
1. Advisor marks a deal funded in the real world.  
2. Expectation: a `funding_rounds` row with amount and status.  
3. **Chain breaks:** nothing in the app writes that row on the event.  
4. Renewal / second-wave workflows that check for a funded round quietly treat
   the client as never funded.

---

## 3. Commission ledger

**What should cause a row?**  
Earning an amount when a sale closes, a payment posts, or a round funds —
depending on the rule (front-end on sale price, back-end on funded amount, etc.).

**Does a live handler write `commission_ledger`?**  
**No.** The library is built and tested:

- Pure calculators in `src/commissions/calculate.mjs`
- SQL insert text in `src/commissions/sql.mjs` (`SQL_INSERT_LEDGER`)
- Read API `GET /api/read/commissions`

Nothing outside tests runs the insert. Proposed event wiring lives in
`src/commissions/PROPOSED-EVENTS.md` as design, not as live handlers.

**What that means**  
- The Products & Commissions screen can show **rules** (products API).  
- Payout / ledger views that read `commission_ledger` stay empty.  
- You can compute a commission in a test; a live close will not post one.

**Concrete walkthrough**  
1. Closer closes a funded deal.  
2. Expectation: select rules → compute → `INSERT` ledger line.  
3. **Chain breaks:** no handler calls `SQL_INSERT_LEDGER` after `sale.closed`
   or funding.  
4. Owner opens commissions: rules exist, earned rows do not.

---

## 4. Entitlement grants

**What should cause a row?**  
Paying for a product that unlocks access (letter pack, funding path, portal
features). Function `grant()` in `src/entitlements/entitlements.mjs` knows how
to insert.

**Does a live handler call `grant()`?**  
**No.** Callers found: the module itself and **tests** only. Payment /
`sale.closed` handlers do not grant entitlements.

**What that means**  
- `GET /api/read/entitlements` can return demo or seed rows, but live purchases
  do not unlock new codes.  
- Upsell surfaces that depend on “what they hold” stay stale.  
- Seed migration `096_demo_client_entitlements.sql` can make demos look fine
  while real clients never get grants.

**Concrete walkthrough**  
1. Client pays for Metro2 letter pack.  
2. Expectation: `grant(db, { code: … })` after payment.  
3. **Chain breaks:** payment handlers stamp flags / transactions only.  
4. Client portal still shows the pack locked (or only shows seed data).

---

## 5. Invoices

**What should cause a row?**  
Billing events — success fee when funding locks, DIY deposit, etc.

**Does a live writer exist?**  
**Yes, in workflows:**

- F-07 (`funding-locked`) → `createInvoice` (success fee)  
- DS-02 (`diy-letters`) → `createInvoice` (deposit) plus later letter steps  

Those run only when the workflow engine is actually executing (Inngest with
`INNGEST_EVENT_KEY`, or a manual journey/test harness). The invoice email path
exists behind outbound settings; transmitting still needs provider credentials
and the company `outbound_enabled` switch.

**What that means**  
- Against a dead workflow engine, invoices are **not** created for live clients.  
- When workflows run, invoice **rows** can appear; email may still sit in
  `messages` as `queued` until dispatch + credentials work.

---

## 6. Payment links

**What should cause a row?**  
Staff creates a link in Subscriptions / payment-links UI; client pays via Commas.

**Does a live writer exist?**  
**Yes.**

- Create/send/expire in `src/payment-links/index.mjs`  
- CRM panel on subscriptions  
- Webhook path settles paid links via `src/handlers/payment-links.mjs`  

**What that means**  
This is the healthiest money write path in the CRM today. Vendor URL shape still
depends on a real Commas sandbox (called out in the payment-links spec).

---

## Cross-cutting truth

| Event | What actually persists today |
|-------|------------------------------|
| Commas payment | Transaction / flags / sometimes `sale.closed` flag — **not** sale row, ledger, or entitlement |
| “Deal funded” in ops | **No** funding_rounds insert from app code |
| Workflow success-fee / DIY | Invoice row **if** workflows run |
| Staff payment link | payment_links row + settle on webhook |

**Bottom line:** the platform can **calculate** and **display** money concepts,
and it can **invoice** and **payment-link** when those paths are on. The core
**sale → commission → entitlement → funding round** write chain is not hooked
to live events. Screens that look like a ledger are reading tables that live
traffic does not fill.

---

## Related docs

- `docs/FULL-SYSTEM-AUDIT-2026-08-02.md` — severity rollup  
- `src/commissions/PROPOSED-EVENTS.md` — intended commission event map (not implemented as writers)  
- `docs/MERGE-LOG.md` — go-live merge that preceded this audit  
