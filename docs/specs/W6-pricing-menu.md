# W6 — The pricing menu

> **COMPLIANCE REVIEW REQUIRED** — this document sets fee timing and a recurring
> payment schedule. Per CLAUDE.md §7 the label stays on it. It is a marker, not a
> recommendation, and nothing here asks anyone to revisit an owner decision.

**Status:** specification only. No code, no migrations, nothing built.
**Owner-set 2026-08-31.** Reads with `W0-decisions.md`, which it extends.

---

## In one minute

A partner pays **$10,000 once** to get in. That is the whole required price — there is
no monthly fee on the base program. Everything else is a **menu** they can add to,
month by month, and drop when they like.

Their **50% never changes.** Not when they stack add-ons, not when FundHub runs their
ads, not when their downline gets deep. Half is half. Everything else is a menu.

---

## The two laws

### Law 1 — the split is fixed

**50% of funding and repair, front end and back end, permanently.** No add-on, package,
or service moves it in either direction.

This is not a simplification, it is the product. A partner can repeat it from memory,
there is nothing to negotiate on a call, and the ledger never has to answer "what was
the split on the 4th of March" — `share_pct_applied` is frozen at accrual anyway
(`db/migrations/042_partners.sql`), so a fixed rate means that column tells one story
forever.

It also extends the rule already set for downlines: FundHub's half does not move when a
partner pays their own affiliates. Same principle, wider scope.

### Law 2 — the ad account connection is free, and required

**Every partner connects their ad account. No exceptions, no charge.**

This is a condition of using FundHub's fulfilment, not a product. It is what makes the
whole channel work:

- FundHub sees what all partners are running, so 100 partners can be kept out of each
  other's interest stacks and lookalikes.
- Layer 3 of the creative intelligence spine (`W2-creative-intelligence.md`) fills up
  from day one — the real spend, CTR and close-rate data that nobody can buy at any
  price. Thin Layer 3 was that spec's cold-start problem; mandatory connection solves it.

**What the connection gives FundHub is telemetry. What the Brain gives the partner is a
paid add-on.** Those are different things and separating them is the point: 100%
coverage of the data, while the intelligence stays sellable.

---

## The base — $10,000, once

| Included | |
|---|---|
| The white-label program | Their brand across the system |
| Training | Curriculum per the curriculum spec |
| Fulfilment | FundHub's team does the client work |
| Their portal | Brand Studio, CRM, partner screens |
| The split | 50%, funding and repair, front and back |
| Ad-account connection | Required. Free. Telemetry only |

No monthly. Financeable. Refund window short (`W0-decisions.md`).

---

## The menu — monthly, stack freely, cancel freely

Three add-ons at launch. Each is independent; none is a prerequisite for another.

### 1. Creative Intelligence

The Brain, pointed at them: hooks written for their offer, their segment assigned so
they are not bidding against other partners, the Winner's Board, and their own
performance data read back to them.

**Recommended: $497/month.** Evidence: Credit Repair Cloud charges $179–$599/month for
software alone; the 7 Figures partner program charges $97–$197/month; FundHub's own
public Winner's Board is $47/month. A partner gets the Board plus segment assignment
plus their own numbers, so it prices above the public tier and inside the market band.

### 2. Done-For-You Marketing

FundHub builds the creative, runs the campaigns, manages the account. The partner still
funds their own ad spend.

**Recommended: $2,497/month + their ad spend.** Evidence: this is agency work, and
agencies charge $2,000–$5,000/month for less than a full funnel plus fulfilment behind it.

This is the add-on that triggers the creative approval gate in `W4-live-trial.md` — when
FundHub runs the marketing, FundHub signs off on the creative.

### 3. Lead Flow

FundHub hands the partner booked calls.

**Recommended: $197 per booked call.** Evidence: FundHub's own measured cost is ~$33 per
booked call (thin sample, `docs/workflows/ads-waterfall-projections-2026-08-26.md`);
brokers in this market pay $80–$200 for an MCA live transfer. Priced per unit rather
than monthly because it is the easiest thing to sell to a partner who has just paid
$10,000 and wants motion this week.

> **Prices above are recommendations, not owner-set.** They are marked as such
> deliberately — see "Open" below.

---

## How this maps onto the schema

The machinery mostly exists and should be reused rather than rebuilt.

| Need | Existing | Notes |
|---|---|---|
| Recurring arrangement | `subscriptions` (`db/migrations/075_subscriptions.sql`) | Effective-dated. A price change **closes the live row and opens a new one** — `trg_subscriptions_terms_immutable` raises on an UPDATE to tier or price. `subscriptions_no_overlap` prevents two live versions |
| Access gating | `entitlement_catalog` + `src/entitlements/entitlements.mjs` | `forClient()` returns held **and** locked, because "the locked tile is the upsell surface". Exactly the menu's rendering model |
| One-off purchases | `products` (010/015), `src/config/offers.mjs` | The $10,000 entry belongs here |
| Idempotent granting | `grantFromTransaction()` | Replay-safe on a unique index; a repeat payment grants nothing new |
| Nothing hard-deletes | `revoke()` stamps `revoked_at` | A cancelled add-on stays answerable |

**Prices are rows, never code.** `db/migrations/013_commission_rules.sql` sets the rule
the schema is built on — every rate is a row. `subscriptions.price_cents` is nullable and
**NULL means "nobody has recorded what this costs"**, not zero. Do not default it.

### The blocker

**`subscriptions.client_id` is `NOT NULL REFERENCES clients(id)`. Entitlements are
client-scoped too** — `forClient(db, { orgId, clientId })`, reading `v_client_entitlements`.

**A partner is not a client, so a partner add-on cannot be recorded today.** This must be
resolved before any monthly add-on is sold. Three options, in preference order:

1. **Add a nullable `partner_id` to `subscriptions`** with a check that exactly one of
   `client_id` / `partner_id` is set. Smallest change; keeps one recurring table, one set
   of effective-dating guarantees, one place to look.
2. A parallel `partner_subscriptions` table. Duplicates the no-overlap and immutability
   triggers, which is exactly the kind of divergence that rots.
3. Represent partners as `clients` rows. Cheapest to write, worst to live with — it
   pollutes every client-scoped query and report in the system.

Recommend option 1. Either way, this is a **migration, not a workaround**, and editing an
applied migration is a silent no-op — supersede with a new file.

### The other blocker

**Recording a subscription and collecting money monthly are different things.** The
`subscriptions` table records the arrangement and carries `provider` and `card_id`, but
nothing verified in this repository actually charges a card on a cycle. Before any
monthly add-on launches, confirm the collection path end to end — otherwise a partner can
be marked `active` on a plan that never bills.

---

## Worked example

A partner who takes everything, one month:

```
ONE TIME
  Entry                                    $10,000

MONTHLY
  Creative Intelligence                       $497
  Done-For-You Marketing                    $2,497
  Lead Flow, 20 booked calls @ $197         $3,940
  ─────────────────────────────────────────────────
  Monthly to FundHub                        $6,934
  (their own ad spend is theirs, never on FundHub's books)

AND ON EVERY CLIENT THEY CLOSE
  Split                                    50 / 50
  ...which did not move by a single point.
```

---

## Open

| Item | Note |
|---|---|
| **The three prices** | $497 / $2,497 / $197 are recommendations from market comparables. Owner has not set them |
| **Bundling** | Whether Intelligence + Done-For-You sell as a discounted package, or strictly à la carte |
| **Partner subscription scoping** | Option 1 above is recommended but not chosen |
| **Recurring collection** | Must be verified working before anything monthly is sold |
| **More add-ons** | "Licensing" was named by the owner but not defined. Absent — recorded, not invented |
| **Does an add-on lapse affect the partnership?** | A partner who cancels Creative Intelligence still owes the 10-clients-a-month floor. Nothing says whether a lapsed add-on has any other consequence |
