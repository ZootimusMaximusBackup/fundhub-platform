# finish-the-build

Shared board for the finish-the-build batch. Each workflow claims its task here,
writes its manifest here when done, and reads this file before starting.

This file did not exist when W2 ran; W2 created it and wrote the first entry.
Other workflows in this batch should append their own `## W<n>` heading below
rather than editing anyone else's.

## Task list

| Workflow | Owns | Status |
|---|---|---|
| W2 | Client Finance OS v1, foundation slice — migrations 075/076 + the store module | `done` |
| W3 | Soft-pull triggering | not claimed by W2 — named only as a scope fence in W2's brief |
| W4 | Alerts | not claimed by W2 — named only as a scope fence in W2's brief |

W2 was told which two neighbours exist (W3 owns soft-pull triggering, W4 owns
alerts) and nothing about any others. The rest of this table is deliberately
blank rather than guessed.

---

## W2

**Task:** Client Finance OS v1, foundation slice — `subscriptions` (075),
`client_cards` (076), and the store module over them. `status: done`

### The split, stated for the record (CLAUDE.md §0)

The owner had already split this batch and handed W2 its slice with an explicit
scope fence, so W2 did not re-propose one. W2's slice has no dependency on W3 or
W4 and shares no file with them. Model: Opus — schema plus a hard compliance
rule, where being wrong is expensive and not visible to a non-coder afterwards.

### What changed in plain language

The system can now record what a client pays us every month, and which card pays
for it — two things it had nowhere to put before.

Two rules are built into the database itself, so they hold no matter who writes
to it later:

1. **We never store a card number.** Only the payment company's token — a
   meaningless code that stands in for the card — plus the brand, the last four
   digits and the expiry date. The database physically rejects anything that
   looks like a real card number, and there is no column anywhere that could
   hold a security code.
2. **A price can never be edited after the fact.** Changing someone's plan
   writes a new row and closes the old one. If somebody tries to edit a live
   price, the database refuses and tells them to open a new row instead. That
   means what a client paid last March still reads as what they paid last March,
   forever.

Nothing here charges anybody. There is no billing run, no scheduled job, and no
web address that could take a payment. This is the filing cabinet, not the till.

### Files touched

| File | Change |
|---|---|
| `db/migrations/075_subscriptions.sql` | new — `subscriptions`: effective-dated plan rows, a no-overlap exclusion constraint, an immutability trigger on the terms, per-org scoped processor key. |
| `db/migrations/076_client_cards.sql` | new — `client_cards`: token reference only, two CHECKs that make "no card number" physical, plus the composite foreign key 075 could not declare yet. |
| `src/subscriptions/index.mjs` | new — pure logic: card-data refusals, null-preserving money, effective-date window maths, plan-change validation. No I/O. |
| `src/subscriptions/index.test.mjs` | new — 26 unit tests, no database. |
| `src/subscriptions/store.mjs` | new — the write paths: `putClientCard`, `listClientCards`, `removeClientCard`, `startSubscription`, `getSubscriptionAt`, `listSubscriptions`, `changeTier`, `cancelSubscription`, `attachCard`. |
| `src/subscriptions/store.pg.test.mjs` | new — 21 real-Postgres tests; skips cleanly with `DATABASE_URL` unset. |
| `docs/workflows/finish-the-build.md` | new — this board. |

No existing file was modified. Nothing under `src/shifts/**`,
`src/commissions/**`, `src/mail/**`, `db/migrations/077-079` or `public/app/**`
was touched, read-for-edit or renamed.

### Exports added

`src/subscriptions/index.mjs` — `looksLikeCardNumber`, `assertNoCardData`,
`normalizeCardMeta`, `priceToCents`, `formatPrice`, `assertPriceCents`,
`isLiveAt`, `planChange`.

`src/subscriptions/store.mjs` — `putClientCard`, `listClientCards`,
`removeClientCard`, `startSubscription`, `getSubscriptionAt`,
`listSubscriptions`, `changeTier`, `cancelSubscription`, `attachCard`.

No existing export changed. No route, handler or `ROUTES` entry was added, so
`src/http/routes.test.mjs` is unaffected — deliberately: the scope fence forbids
an HTTP endpoint that charges a card, and W2 built no endpoint at all.

### Verification

```
migrations apply to an empty database   52 applied, 0 errors
re-run on the same database              0 applied  (clean no-op)
npm test, DATABASE_URL unset             1934 tests · 0 fail · 216 skipped · exit 0
npm test against Postgres, virgin DB     2389 tests · 24 fail · 8 skipped
  baseline (same procedure, no changes)  2342 tests · 24 fail · 8 skipped
  failing NAMES, diffed both directions  identical — 0 new, 0 disappeared
subscriptions unit tests                 26 pass
subscriptions pg tests                   21 pass
16 code mutations                        16 caught
9 constraint/trigger drops               9 caught
npm run diagrams:check                   up to date (12 files)
```

The 24 pre-existing failures are the documented baseline (all in the creative /
ad-platform partner-isolation suites). They were captured by running the suite
twice on a clean database at the merge-base commit BEFORE any of this work, and
diffed by NAME rather than by count, per the trap note.

**Mutation checking.** Every behaviour was broken on purpose and the named test
was confirmed to fail: the null-preserving price, the last4 refusal, the PAN
shape test, each `planChange` refusal, the half-open window, the cross-client
token guard, the metadata COALESCE, the no-reinstate rule, both idempotent-date
COALESCEs, the removed-card guard on `attachCard`, and the carry-forward of the
card and processor reference through a plan change. Separately, each of the nine
database constraints was dropped on a cloned database and the test that claims
to prove it was confirmed to fail: `client_cards_token_not_pan`,
`client_cards_last4_shape`, `client_cards_expiry`, `subscriptions_no_overlap`,
`subscriptions_cancel_coherent`, `subscriptions_period`, `subscriptions_card_fk`,
`subscriptions_provider_ref_uq`, `trg_subscriptions_terms_immutable`.

### Assumptions recorded, per the owner's instruction to keep going

Every one of these is a call W2 made rather than a question W2 asked. Each is
reversible with one additive migration.

1. **"Card token reference" on `subscriptions` means a pointer to a
   `client_cards` row, not a copy of the token.** A token in two tables is a
   token that gets rotated in one of them. `subscriptions.card_id` is that
   pointer; there is no token column on `subscriptions`.
2. **The foreign key from `subscriptions` to `client_cards` is declared in 076,
   not 075.** `db/migrate.mjs` applies files in filename order, so 075 runs
   before `client_cards` exists. The alternative was swapping the numbers, which
   the owner fixed as 075 = subscriptions, 076 = cards.
3. **One subscription per client at a time.** `subscriptions_no_overlap` says
   two versions of one client's subscription can never cover the same instant.
   That is the plain reading of a single `tier` column plus "changing a plan
   opens a new row". If a client ever needs two concurrent subscriptions the
   constraint gains a key column; it does not get dropped.
4. **`tier` is free text with no CHECK list.** The tier names live in the
   rebuild plan's addendum, which is not in this repository. An invented list is
   a guess wearing a constraint (the call 065 made about outcome tiers).
5. **`price_cents` lives on the subscription and may be NULL.** See finding 1
   below — there is no tier price row anywhere to point at. NULL means "nobody
   recorded this", never 0.
6. **`cancelled_at` and `effective_to` are separate dates.** A cancellation
   requested today commonly runs to the end of the paid period. Collapsing them
   would lose the date a dispute turns on.
7. **A card refresh does not un-remove a card.** Storing the same token again
   updates the display fields and leaves `removed_at` alone. There is therefore
   no reinstate path, and W2 did not invent one — un-removing an instrument is a
   deliberate act that needs its own consent record.
8. **A two-digit expiry year is refused, not expanded.** `29` → `2029` is the
   same rule that reads `99` as `2099`.
9. **A long `last4` throws instead of being truncated.** Truncating means
   accepting a full card number, holding it in memory and reporting success.
10. **No billing interval column, no proration, no `supersedes_id`, no
    `is_default` card flag.** Each is stated with its reason in the migration
    headers under "WHAT WAS DELIBERATELY NOT DONE".

### Findings — read these

1. **THERE IS NO TIER PRICE ANYWHERE IN THIS REPOSITORY, AND W2 DID NOT INVENT
   ONE.** 013_commission_rules.sql:1 is the rule: "every rate is a row, there
   are no rates in code". Searched: `products` (010/015) models one-off
   purchases with a `default_price` PREFILL and has no recurring concept;
   `config_defaults` (052) has no price rows for tiers; nothing else in
   `db/` carries one. The rebuild plan's addendum — which names the tiers — is
   not in this repository either (`grep -ri "finance os"` and `grep -ri
   addendum` return one comment inside 054_tradelines.sql and nothing else).
   **Consequence:** every subscription written today has `price_cents = NULL`
   until somebody supplies the prices as rows. That is the honest state, and the
   NULL is preserved end to end rather than defaulted. **Somebody has to decide
   where tier prices live** — a `subscription_tiers` table, or rows in
   `products` with a recurring flag — before this can bill anything.
2. **`npm run lint` does not exist in this repository.** CLAUDE.md §6 lists it
   as a gate. `package.json` has `migrate`, `artifact`, `diagrams`,
   `diagrams:check` and `test`. There is no ESLint config file either. W2 could
   not run gate 1 because it is not there.
3. **`npx tsc --noEmit` does nothing here.** There is no `tsconfig.json`, so
   tsc has no inputs and prints its help text with exit code 0 — a green result
   that checked zero files. Gate 2 of §6 is currently vacuous for everyone, not
   just W2. (One `.ts` file exists: `src/lib/rbac.ts`.)
4. **The `docs/journeys/` directory in CLAUDE.md §4 does not exist.** `docs/`
   contains `diagrams/` and `workflows/` only. There are no `-intended.md` or
   `-actual.md` files and no `docs/journeys/CHANGELOG.md` to append to. W2 built
   no user-facing flow, so nothing was owed either way — but the next workflow
   that does build one should know the journey scaffolding is absent, not
   missing a file.
5. **`docs/compliance/` (CLAUDE.md §7) does not exist either.** W2 flagged this
   change for compliance review on the strength of the rule text alone; there
   were no domain rules on disk to read first.
6. **The repo has three copies of `withTransaction`** (`src/documents/register.mjs`,
   `src/inquiries/work.mjs`, `src/pii/index.mjs`). W2 did not add a fourth:
   `changeTier` is a single data-modifying CTE and needs no transaction. Noted
   because the next writer who needs one will otherwise make it four.
7. **The `conversations` pg suite is order-dependent too, like the `inquiries`
   suites the trap note names.** Running the full suite against a database that
   had already had pg tests run on it failed 7 `conversations` tests on the
   first pass and 0 on the second. On a virgin database the same code passes
   both passes. Nothing in W2 touches `conversations`; recorded so the next
   person who sees those 7 names does not go looking for a cause in their own
   diff.
8. **`src/tradelines/index.mjs` defines its own `toCents`/`fromCents`** rather
   than using `src/commissions/money.mjs`, and they behave differently
   (tradelines returns a number from `fromCents`; money returns a string). W2
   used `money.mjs` as instructed. Not touched — out of scope — but two money
   modules with the same function names is the kind of thing that surfaces
   months later.

### Blockers

None. W2 finished inside its fence.

### What W2 did NOT build, restated for whoever picks this up

No bank linking or Plaid. No alerts. No soft-pull triggering. No HTTP endpoint
of any kind — including no endpoint that charges a card. No billing run, no
scheduler, no `next_charge_at`. No browser extension and no credential
scraping, ever: both are issuer-banned and breach-shaped, and there is nowhere
in this schema to put what they would collect.
