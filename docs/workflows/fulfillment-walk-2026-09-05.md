# Fulfillment walkthrough — plan, 2026-09-05

Three walks, fulfillment only. Chris walks; an agent watches the data.
No ads, no survey, no sales calls. Each client starts at "they already paid."

* **Walk 1 — Funding.** Fundable file, deposit paid, through to funded + success-fee invoice.
* **Walk 2 — Repair, full program.** $1,000, six rounds.
* **Walk 3 — Repair, trial.** $200, two rounds, then the upsell.

All three carry Chris's own identity. Source of truth for the mapping work behind this
plan: the 2026-09-05 scout, 8 agents, recorded in this session.

---

## 0. STOP — five things that bite before anything is typed

These are not opinions. Each carries the file that proves it.

### 0.1 The outbound fence is OFF

`MESSAGING_DRY_RUN=0` in the local `.env` these scripts read, with Twilio and Bland
credentials beside it. `src/lib/dry-run.mjs` calls that fence the only reason production
cannot send. It is explicitly off.

This is exactly what produced **51 real texts to one phone** on 2026-09-03
(`docs/workflows/fix-batch-2026-09-03.md:610`). Deposit alone fires SMS-DOC-01-REQUEST
plus a round-started text. Pushing credit fires U-02 delivery and C-06 routing. Three
clients means three of everything.

### 0.2 Nothing marks a simulated client as fake

The dispatcher's one hard stop against a real provider is
`clients.custom_fields.synthetic === true` (`src/messaging/dispatch.mjs:512-521` —
refused permanently, no override). The AI bureau-call scheduler reads the same field
plus `clients.is_demo` (`src/inquiry-ops/call-scheduler.mjs:235-240`).

**Neither `push-payment.mjs` nor `push-credit.mjs` writes either field.** The two guards
built to stop sends about invented people are unarmed by default. Setting both on all
three clients before anything else is written costs one UPDATE and is the cheapest
safety step available.

### 0.3 The credit bureaus are pointed at PRODUCTION, live pulls authorised

`CRS_API_HOST` begins `mwar` (= `mware.crscreditapi.com`, the production constant at
`src/finance/crs-identities.mjs:27`) and `CRS_ALLOW_LIVE=1`. The three Pull buttons on
the Client Control Panel send no simulate flag — the code says so in a comment at
`public/app/client-control-panel.html:2450`.

So once a client carries a real SSN and DOB in `pii_identity` plus a `soft_pull_consent`
row, **one tap on Pull TransUnion / Experian / Equifax is a real bureau request against
Chris's own credit file.** Three taps, three bureaus, per client.

### 0.4 Paper mail is live and human-gated only

`api/repair/send.mjs` and `src/inquiry-ops/send.mjs` hand letters to PostGrid
(`src/messaging/providers/mail-letter.mjs:212`). There is no synthetic check and no
dry-run fence on that path. The only thing between a simulated client and real paper
arriving at a bureau in Chris's name is a person not pressing Send. Mailing also starts
the clock that later fires the AI bureau phone call.

### 0.5 A real SSN does not stay in one place

The document-check agent builds its model prompt with the client's address — proved by
`src/handlers/ghl-doc.test.mjs:180,198`, which assert `1005 W Hudson Way` appears inside
the prompt string sent to an outside AI vendor. Letters print name and address. Every
full-SSN reveal writes a `pii_access_log` row.

Deleting the client afterwards does not unsend a vendor prompt or a mailed letter. And
`scripts/sim/wipe-sim-clients.mjs` only matches emails like `%+sim-%@%` — a client
seeded under any other address is not covered by the cleanup that exists.

---

## 1. THE ONE DECISION ONLY CHRIS CAN MAKE

There is **no safe middle path** and the scout proved it:

* The **sandbox** bureau host refuses any identity that is not one of the vendor's three
  fixtures verbatim (error `identity_not_allowed_on_sandbox`).
* The **production** host refuses those same three fixtures (`test_identity_on_production`).

`src/finance/crs-identities.mjs`. So a made-up SSN works on neither host. The choice is
binary:

| | **A — real identity, no pull** | **B — sandbox identity, real pull** |
|---|---|---|
| SSN on file | Chris's real one | vendor fixture (BARBARA M DOTY etc, SSN starts 666) |
| Credit file | pushed by `push-credit.mjs`, marked simulated | a real sandbox pull |
| Pull buttons | **never touched** | safe to press |
| Proves | the whole fulfillment path | the pull path only |
| Risk | a mis-click on Pull is a real inquiry on Chris's credit | none |

**Recommendation: A.** This walk is about fulfillment, not about the pull. `push-credit`
already emits the same two events a real pull emits, so everything downstream behaves
identically. The 2026-08-24 run did exactly this and used a fake sandbox-pattern SSN,
recorded as "not Chris's real SSN".

Under A the SSN can be a sandbox-pattern number rather than Chris's real one — the pull
never happens, so nothing checks it. That removes 0.3 and most of 0.5 at no cost.

**Chris must say A or B before seeding starts.**

---

## 2. What blocks the walk, and who clears it

| # | Blocker | Proof | Who |
|---|---|---|---|
| 1 | `push-payment.mjs` refuses unless an OPEN `payment_links` row exists. Nothing in fulfillment mints one — only `POST /api/closer-deck {action:"send_pay_link"}` from the closer/Present screens. | `scripts/sim/push-payment.mjs`; `public/app/closer-call.js:665` | Chris opens the closer deck once per client |
| 2 | `SIM_WEBHOOK_SECRET` must exist in production Netlify and be set **without** `--secret`, or every receipt is refused 401. | `push-payment.mjs:82`; F26 on 2026-09-03 | agent verifies |
| 3 | The Commas webhook does no work. It writes raw bytes and returns 200; a Netlify cron sweeper does everything. If that cron is not firing, push-payment prints 200 and **nothing happens**. | `netlify/functions/commas-inbox-sweeper.mjs`, cron `* * * * *` | agent verifies before walk 1 |
| 4 | **Order matters:** `push-credit` must run BEFORE `push-payment`. `clients.outcome_tier` is written only by `onDecisionRendered` on `decision.rendered`. Pay first and the card still moves, but F-01, S-06 and C-06 all bail silently — no tag, no next action, no pod task, no deliverables. | `scripts/sim/push-credit.mjs:332`; `src/workflows/f-01-funding-intake.mjs:52` | agent, in the runbook order |
| 5 | Repair cards only reach the Specialist desk when an ACTIVE sales row joins a product of category `repair`, and that row exists **only** if the pay link carries the repair product id. | `src/handlers/purchase-routing.mjs:118-124`; `src/handlers/money-chain.mjs:790-812` | agent picks the right product on the link |
| 6 | The only Enroll button in the CRM hardcodes the **$200 trial** — `{program:"trial", price_total:200}`. The six-round $1,000 program is reachable only from the live sales screen. | `public/app/inquiry-remover.html:3859`; `src/repair/enroll.mjs:61` | needs a fix, or walk 2 enrols from Present |
| 7 | Repair letters have **TWO** gates. The second (`onRepairPath` — signed repair agreement OR tier in REPAIR_ONLY/FUNDING_PLUS_REPAIR) is what switches on derogatory claims. A dispute authorization alone does not satisfy it: the screen then says *"The credit file looks clean — nothing to dispute"* on a file with two collections, a charge-off and a late. | `src/repair/analyze.mjs:301-303, 345-351` | agent sets the tier before the walk |
| 8 | No committed script writes `pii_identity` or `client_consents`. One must be written. `PII_ENC_KEY` must be set in production or storing an SSN returns 503. | `src/pii/index.mjs:69-76` | agent builds it |
| 9 | The funding document hold can only be cleared by the DOC-CHECK AI agent — there is no manual override anywhere. If the agent is not live, the funding card is stuck on Apply Now permanently. | `src/handlers/doc-check.mjs:108-116` | agent verifies the agent row is live |
| 10 | Lender match passes every lender when the client's state is empty — all ~313 instead of ~20-26, with nothing on screen saying the list is meaningless. | `src/lenders/match.mjs:339-341` | agent writes a state |

---

## 3. The lender book — separate work, Chris flagged it

Counted against `credentials/lenders-audit/lenders-audited.csv`, 313 rows:

* `eligible_states` — **313 / 313** filled. The only column with data.
* `bureaus_pulled` — **3 / 313**. Bureau rotation is inert.
* `minimum_time_in_business_years`, `minimum_revenue_threshold`, `typical_approval_range`,
  `average_starting_loc`, `max_known_loc`, `loan_type`, `priority_tier` — **0 / 313**.
* `stated_requirements` — 75 / 313, free text. `insider_tips` — 157 / 313, free text.

Chris is sourcing the real bureau list. Once it lands, the swap is a data load, not a
code change: `src/lenders/store.mjs` already reads `bureaus_pulled` and the matcher
already spreads pulls across bureaus.

**Sequencing:** the lender list does NOT block walks 2 and 3 (repair). It only affects
step 1.10 of walk 1. Either do the bureau load first and walk funding after, or walk
funding now and treat the lender screen as known-broken.

---

## 4. Order of work

**Phase A — prep (agent, no Chris).**

1. Arm the safety guards: `synthetic=true` and `is_demo=true` on all three clients, first
   write, before anything else. (0.2)
2. Confirm the Commas cron sweeper is live, `SIM_WEBHOOK_SECRET` reads back whole,
   `PII_ENC_KEY` is set, and the DOC-CHECK agent row exists. (blockers 2, 3, 8, 9)
3. Write `scripts/sim/seed-fulfillment-client.mjs` — one named script that stands a client
   up at "paid", with identity, consent, state, tier and the right product. Reads the SSN
   and DOB from `credentials/sim-identity/` (gitignored), never from a literal.
4. Fix blocker 6 so a full six-round program can be enrolled from the Specialist desk,
   or record that walk 2 enrols from Present instead.
5. Load the identity documents so the upload steps have something to send.

**Phase B — the three walks (Chris types, agent watches).** Serial. Walk 1 funding,
then walk 2 repair full, then walk 3 repair trial.

**Phase C — invoices and receivables.** After the three walks have generated charges.

---

## 5. Time

| Phase | Who | Estimate |
|---|---|---|
| A — prep, safety, seeding script, blocker 6 | agent | 2-3 hours |
| B1 — funding walk | Chris | 60-90 min |
| B2 — repair full walk | Chris | 45-60 min |
| B3 — repair trial walk | Chris | 30-45 min |
| C — invoices and AR | Chris + agent | 30-45 min |

**Chris's own time: roughly 3 to 4 hours**, spread over the three walks, assuming the
prep lands clean. Last walk took 2 hours for the front half alone, and that was one
client through a funnel; these are three clients through a longer path, but with the
sales portion removed and the known defects already recorded.

Add time for findings. The last walk produced 50.
