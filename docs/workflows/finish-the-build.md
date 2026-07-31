# finish-the-build

Shared board for the finish-the-build batch. Each workflow claims its task here,
writes its manifest here when done, and reads this file before starting.

This file did not exist when W4 ran; W4 created it and wrote the first entry.
Other workflows in this batch should append their own `## W<n>` heading below
rather than editing anyone else's.

## W4

**Task:** the part of Finance OS that decides there is something worth saying —
migrations 078 (alerts) and 079 (upsell trigger rules), the pure rule evaluator,
and the monthly optimization report re-aimed as a subscription artifact.
`status: done`

**Second pass (autonomous W1-W10 build).** The autonomous build plan names four
entry points for W4 — `evaluateUtilization`, `evaluateScore`,
`suggestCardUpgrade`, `monthlyReport`. Two existed under other names and are now
exported under these; two are new conditions (`score_improvement`,
`card_upgrade_candidate`) added as rule rows in 079 and rule functions in
`upsell.mjs`. Five conditions total. `WORKFLOW-AUTONOMY.md` **does not exist in
this repository** — searched the whole tree — so the decision rules came from the
build prompt itself; recorded rather than invented.

**What changed in plain language:** the system can now work out, from a client's
credit cards, whether something has happened that is worth telling somebody
about — their card balances dropped, their cards are old enough to be worth a
line of credit, or they look strong enough for a second business. It writes that
down as an "alert", which is just a note on a list. The rules for when to raise
one live in a table an owner can edit, not in code a developer has to change.

**It does not work yet, on purpose.** All five rules ship switched OFF, because
nobody has decided the numbers they need — see "The eleven numbers nobody has
decided" below. Nothing sends anything to anybody: an alert is a note in the
database and that is all it is.

---

### Assumptions recorded (CLAUDE.md §2 and §3 overridden for this run by the owner)

1. **The addendum is not in this repository.** The task points at "addendum §8".
   There is no addendum document on disk. `db/migrations/054_tradelines.sql:14`
   refers to "the addendum's Finance OS" as well, so the document is real and is
   simply not checked in. I built from the task text and from what the schema can
   actually answer, and every place I could not source something is reported
   rather than filled in. **If §8 names any of the eleven numbers below, they
   should go in as an UPDATE against the 079 rows and nothing in the code needs
   to change.**
2. **`docs/journeys/` does not exist.** CLAUDE.md §4 requires updating
   `<name>-actual.md` in the same commit as any code change touching a flow, and
   there is no journeys directory and no changelog at all in this repository.
   Nothing to update. Building the eight journey pairs from scratch is its own
   workflow, not a side effect of this one.
3. **`npm run lint` and `npx tsc --noEmit` do not exist here.** CLAUDE.md §6
   gates 1 and 2 name them; `package.json` has no `lint` script and there is no
   `tsconfig.json` (this is plain ESM JavaScript). `npm run diagrams:check`
   exists and passes. Recorded rather than worked around.
4. **Migrations 075–077 do not exist.** The highest migration on `main` is 067.
   078 and 079 were used as instructed; `db/migrate.mjs` applies files in
   filename order, so they will still sort after 075–077 whenever those land.
5. **Nothing was imported from W2 or W3.** The evaluator takes `clientId` and
   tradeline rows as parameters. Its only import is
   `src/commissions/money.mjs`, which the task named explicitly.
6. **`src/events/canonical.mjs` was not edited.** Three event names are proposed
   in `src/finance/PROPOSED-EVENTS.md` instead.
7. **The branch was cut from `origin/main`** at `4830465`.

---

### The eleven numbers nobody has decided — READ THIS FIRST

This is the finding, not a to-do I skipped. Every threshold the five conditions
need ships as `null`, every rule ships `active = false`, and the evaluator
refuses to fire a rule whose numbers are unset. That refusal is tested and
mutation-checked.

| Rule | Number | Why it is null |
|---|---|---|
| `utilization_drop_clean_pull` | `utilization_ceiling_pct` | The only utilization figure anywhere in the tree is `utilizationThreshold = 0.30`, a default argument in `src/calculators/deal-funding.mjs`. That answers a different question — whether a NEW DRAW pushes a card over a line — and sourcing a policy from a function's default argument is exactly the mistake this repo removed from `src/shifts/timesheet.mjs` on 2026-07-31. |
| `utilization_drop_clean_pull` | `min_drop_basis_points` | Optional; no source. Left null, which means "accept any drop across the ceiling". |
| `utilization_drop_clean_pull` | `clean_pull_max_inquiries_per_bureau` | The raw counts exist (`clients.custom_fields.crs_inquiries_ex / _eq / _tu`). How many still counts as clean does not. |
| `utilization_drop_clean_pull` | `clean_pull_max_late_payments` | Same — `crs_late_payments_count` exists, the limit does not. |
| `seasoned_tradelines` | `min_age_months` | No source. **Also blocked by the schema** — see below. |
| `seasoned_tradelines` | `min_seasoned_lines` | No source. |
| `strength_signals` | `min_total_limit_cents`, `min_open_revolving_lines`, `max_utilization_pct` | Nothing in this repository defines what a "strength signal" is or where it cuts. Grep for "second entity" returns nothing. |
| `score_improvement` | `min_score_gain`, `min_score` | No source for either. Unlike the tradeline position, both readings genuinely exist on disk — `snapshots` keeps one row per pull with a `score` column — so this rule is blocked only on the numbers, not on the schema. |
| `card_upgrade_candidate` | `apr_at_or_above`, `min_balance_cents` | No source. `apr_at_or_above` is a decimal fraction in [0,1] matching `tradelines.apr`; a value above 1 throws rather than being read as a percentage. |

They are reported on a screen, not just here: `v_upsell_config_gaps` returns one
row per unset number — 14 rows as shipped.

**To turn a rule on, set its numbers and flip it live in one statement:**

```sql
UPDATE upsell_trigger_rules
   SET params = params
         || jsonb_build_object('utilization_ceiling_pct', 30)
         || jsonb_build_object('clean_pull_max_inquiries_per_bureau', 2)
         || jsonb_build_object('clean_pull_max_late_payments', 0),
       severity = 'warning',
       active = true, needs_config = false
 WHERE rule_key = 'utilization_drop_clean_pull'
   AND org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1);
```

---

### Two things the schema cannot answer, reported rather than guessed

1. **`tradelines` has no opened date.** 054's columns are lender, kind, limit,
   balance, apr, source, source_ref, account_ref, raw, as_of, closed_at. There is
   no `opened_at`, and nothing else in the tree carries one (grep: zero hits for
   `opened_at`, `date_opened`, `months_open`, `seasoned`). So seasoning can only
   be measured for a line whose opened date the caller supplies. The rule counts
   such lines as **unknown, never as young**, and says so — an unknown age only
   ever blocks a negative answer, never a positive one. Adding the column means
   changing 054's ingest path and the normalizer that would fill it, which is
   outside this migration block. `v_upsell_config_gaps` reports it as
   `BLOCKED — schema, not configuration`.
2. **`tradelines` keeps no history.** `src/tradelines/store.mjs` upserts in place
   on `(client_id, account_ref)`, so a new pull overwrites the old balance and
   the previous position is gone. "Utilization dropped" therefore cannot be
   answered from that table alone. It is still recoverable — `crs_results` is
   per-pull history and `normalizeFromCrs()` re-reads an older row into the same
   shape — but making that call is a wiring decision for whoever drives the
   evaluator. The evaluator takes both sets of lines as arguments and, given no
   previous set, says so in the reason string rather than assuming anything.

---

### Files touched

| File | Change |
|---|---|
| `db/migrations/078_alerts.sql` | new — `alerts` table: org_id, client_id, kind, severity, payload, raised_at, acknowledged_at. Partial unique index `(org_id, client_id, kind) WHERE acknowledged_at IS NULL` is the dedupe guard; two read indexes; three CHECK constraints; `set_updated_at` trigger. |
| `db/migrations/079_upsell_trigger_rules.sql` | new — `upsell_trigger_rules` table (per-org unique `(org_id, rule_key)`, `NOT (needs_config AND active)`), three seeded rules with every threshold null and every rule inactive, plus the `v_upsell_config_gaps` view. |
| `src/finance/upsell.mjs` | new — the pure evaluator. No clock, no I/O, no threshold. Imports only `src/commissions/money.mjs`. |
| `src/finance/optimization-report.mjs` | new — the monthly artifact builder. Pure. |
| `src/finance/alerts.mjs` | new — the database half: raise / acknowledge / list, plus `loadUpsellRules` and `unconfiguredUpsellRules`. |
| `src/finance/index.mjs` | new — barrel for the four named entry points plus the store. |
| `src/finance/upsell.test.mjs` | new — 97 pure unit tests. |
| `src/finance/optimization-report.test.mjs` | new — 17 pure unit tests. |
| `src/finance/alerts.pg.test.mjs` | new — 13 real-Postgres tests, skipped when `DATABASE_URL` is unset. |
| `src/finance/PROPOSED-EVENTS.md` | new — three proposed canonical events. `src/events/canonical.mjs` untouched. |
| `docs/workflows/finish-the-build.md` | new — this board. |

Nothing else was modified. `src/shifts/**`, `src/commissions/**`, `src/mail/**`,
`db/migrations/075-077` and `public/app/**` were not touched.

### Exports added

Nothing existing changed name or shape. New exports, all from `src/finance/`:

* `upsell.mjs` — `evaluateUtilization`, `evaluateScore`, `suggestCardUpgrade`,
  `evaluate` (default too), `firedAlerts`, `blanksOf`, `UPSELL_RULES`,
  `DRAWABLE_KINDS`, `positionOf`, `headroomCents`, `openDrawableLines`,
  `utilizationBasisPoints`, `additionalCapacityCents`, `monthsBetween`,
  `cleanPull`, `centsOrNull`, `countOrNull`, `percentOrNull`, `dateOrNull`,
  `aprFractionOrNull`, `scoreOrNull`
* `optimization-report.mjs` — `buildMonthlyOptimizationReport` (default too),
  `monthlyReport` (the same function under the build plan's name), `monthKey`,
  `nextMonthStart`, `DOCUMENT_KIND`, `ENTITLEMENT_CODE`, `CADENCE`
* `index.mjs` — a barrel re-exporting the four entry points and the store.
  Re-exports only, so the barrel and the module cannot disagree.
* `alerts.mjs` — `raiseAlert`, `raiseAlerts`, `acknowledgeAlert`, `listAlerts`,
  `loadUpsellRules`, `unconfiguredUpsellRules`, `SEVERITIES`

### Routes, handlers, journeys

**None added.** No file under `api/`, no entry in `netlify/functions/api.mjs`'s
`ROUTES` map, no change to any screen. Deciding is the whole of this task;
serving the decision over HTTP is a separate one, and adding a handler without a
`ROUTES` entry is a trap this repository has fallen into twice.

### How the monthly report was re-aimed

The Credit Optimization Roadmap already exists as a ONE-OFF: a document kind
(`credit_optimization_roadmap`, 030) and a grantable entitlement
(`credit-optimization-roadmap`, 032) a client receives once when they buy.
`buildMonthlyOptimizationReport()` turns it into a per-period artifact:

* one artifact per client per calendar month, with a stable key
  (`credit_optimization_roadmap|<client>|2026-07`) so regenerating July replaces
  July rather than producing a second one;
* produced **every** period, including quiet ones — a month with no artifact is
  indistinguishable from a month the job failed, so a quiet month returns a full
  artifact with `signal_count: 0` and `blanks` saying why;
* it names the existing document kind and entitlement code rather than inventing
  a new deliverable, so a delivery path can gate on a grant that already exists.

It does **not** subscribe anybody, schedule anything, or send anything. No
billing, no card storage, no entitlement check, no cron — those belong to W2 and
to a provider decision nobody has made.

### Verification

| Check | Result |
|---|---|
| 078/079 on an empty database | 52 migrations applied clean from scratch (re-verified after the second pass) |
| re-apply | 0 applied — idempotent |
| `npm test` with `DATABASE_URL` unset | **2014 tests, 0 fail, 208 skipped** (baseline was 1887 / 0 fail / 195 skipped) |
| `npm test` against real Postgres | 2469 tests, 24 fail — **the same 24 names as the baseline**, diffed by name, zero new |
| `npm run diagrams:check` | up to date (12 files) |
| `npm run lint` | script does not exist in this repository |
| `npx tsc --noEmit` | no `tsconfig.json`; repository is plain ESM JavaScript |
| Playwright | no UI change, so nothing to drive |
| Mutation check | 20 deliberate defects introduced one at a time; every one was caught (see below) |

### Mutation check — what was broken, and what caught it

| # | Defect introduced | Tests that failed |
|---|---|---|
| 1 | utilization ceiling hardcoded to 30 instead of read from the rule row | 3 |
| 2 | a missing balance silently becomes zero | 3 |
| 3 | headroom counts installment and closed lines | 2 |
| 4 | "at the ceiling" reclassified as "still above it" | 1 |
| 5 | an absent bureau inquiry count treated as clean | 1 |
| 6 | the numeric type guard removed (so `[5]` reads as five cents) | 1 |
| 7 | a line with no opened date counted as "not seasoned" instead of unknown | 1 |
| 8 | unset thresholds fall back to a default instead of refusing | 5 |
| 9 | the alert dedupe guard dropped (plain INSERT) | 3 |
| 10 | `raised_at` overwritten by an out-of-order replay | 1 |
| 11 | the severity check accepts anything | 1 |
| 12 | a score gain measured from one reading (previous treated as 0) | 1 |
| 13 | the score floor ignored, only the gain checked | 2 |
| 14 | the score gain boundary flipped from `>=` to `>` | 1 |
| 15 | a card with an unknown APR treated as 100%, i.e. expensive | 1 |
| 16 | the APR fraction guard removed, so 24.99 reads as an APR | 1 |
| 17 | card upgrade includes lines of credit and closed cards | 1 |
| 18 | interest computed on twice the balance | 1 |
| 19 | the score typo guard removed, so 2500 reads as a score | 1 |
| 20 | a named entry point given its own divergent copy of the rule | 10 |

There is also a standing test that is not about this module at all:
`headroomCents()` is pinned to `calcFunding().totalAvailableCredit` over a shared
fixture, so the integer-cents restatement and the dollars original cannot drift
into two different answers to "how much is available".

### COMPLIANCE REVIEW REQUIRED

This touches credit-repair messaging. Three things a reviewer should look at:

1. **"Fundable for $X more" is defined, narrowly, and nowhere else.** X is
   `headroom_increase_cents` — the increase in drawable headroom since the
   previous pull, in integer cents. It is not a prediction, not an approval
   amount and not an offer. The report also carries
   `additional_capacity_cents` — how much more balance could be carried while
   staying at or below the rule's utilization ceiling — which is arithmetic from
   a policy row, not a lending decision.
2. **No customer-facing claim text is generated anywhere.** Every string in the
   output is a field name, a measured number, or a stated reason why a number is
   absent. A test asserts the artifact contains none of "approved",
   "pre-approved", "guarantee", "you qualify" and six other phrases. Wording is a
   human's to write; this code carries the evidence.
3. **Nothing is transmitted.** No email, no SMS, no outbound `fetch`, no
   scheduler. An alert is a row.
4. **`interest_at_current_balance_cents`** on a card-upgrade candidate is simple
   annual interest on today's balance at today's APR. It is **not** a projection
   of what the client will pay — payments move the balance — and it is named that
   way so nobody quotes it as one. If a screen renders it, the label needs a
   human's wording.
5. **`score_improvement` reads a bureau score.** It compares two readings and
   reports the gain. It makes no statement about what the score qualifies anybody
   for.

### Decisions made in the second pass (autonomous build, no questions asked)

| Decision | Why |
|---|---|
| Table named `upsell_trigger_rules`, not `upsell_triggers` | Matches `commission_rules` and `optimization_rules`, the two tables it is modelled on. The rows are rules, not triggers. |
| 079 amended in place rather than a new 080 | The migration block for W4 is 078–079 only. 079 had not merged and no shared database had applied it. **Anyone who applied the pre-amendment 079 to a scratch database must delete its `schema_migrations` row or rebuild** — editing an applied migration is a silent no-op, which is the point of saying so here. |
| `evaluateUtilization` / `evaluateScore` / `suggestCardUpgrade` are thin named wrappers over `UPSELL_RULES` | One implementation per condition. A test asserts each wrapper returns exactly what `evaluate()` returns for the same rule row, so the two call styles cannot drift. |
| `monthlyReport` is an alias export, not a new function | Same reason. |
| APR thresholds are decimal fractions in [0,1] | Matches `tradelines.apr` (054). A value above 1 **throws** rather than being divided by 100 — a threshold row that meant 24.99% and said `24.99` must fail loudly, not silently mean two different things in two modules. |
| Scores accepted in 0–1200 | A typo guard against a percentage or an amount arriving where a score belongs, not a policy about which scores matter. |
| Kept `seasoned_tradelines` and `strength_signals` | They were the original W4 ask and already shipped. Removing them to match a shorter list would be deleting working, tested code. |
| No HTTP endpoint | W9 owns the Finance OS screen and its `api/read/finance-os.mjs`. Adding a second reader here would be two answers to one question. |
| Most permissive reasonable gate | Not applicable — nothing here is reachable over HTTP. When W9 exposes it, the alert list is staff-level data (client PII), so `ROLE_SETS.STAFF` via `requireAuth` **then** `requireRole` — `requireAuth` ignores a `roles` key. |

### Out of scope, stated plainly

Sending an alert (no email, no SMS, no outbound fetch — none exists in this
repository and none was added), any scheduler or cron, subscriptions and card
storage (W2), the soft-pull request path (W3), an acknowledgement endpoint or an
`acknowledged_by` column, the Finance OS screen and its read endpoint (W9), and
adding an `opened_at` column to `tradelines` (054's block, not this one).

### Findings for other workflows

1. **Nothing calls the evaluator.** `src/finance/` has no production importer, by
   design — building the caller was out of scope. Whoever wires it needs to
   decide where the previous tradeline set comes from (see finding 2 above) and
   whether it runs on `analysis.completed` or on a monthly cadence.
2. **`tradelines` needs an `opened_at` column** before seasoning can work on
   stored data. That is a change to 054's ingest path plus the normalizer in
   `src/tradelines/index.mjs`, in whoever's block owns those.
3. **078 records when an alert was acknowledged, not by whom.** Deliberate: there
   is no acknowledgement endpoint yet, and an actor column nothing writes is
   worse than no column. If someone builds the ack path, add `acknowledged_by` in
   their own migration.
4. **`docs/journeys/` and `docs/journeys/CHANGELOG.md` do not exist**, so the
   CLAUDE.md §4 obligation currently cannot be met by anyone in this batch.
