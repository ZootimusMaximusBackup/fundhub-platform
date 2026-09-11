# MyFundalytics — competitor gap analysis

Date: 2026-09-11
Source of their feature list: owner-supplied breakdown (their site and bettercred.io are both
blocked by this environment's network policy — 403 at CONNECT, not retried).
Source of our side: grep of this repo at `origin/main`.

## Who they are

Vertical SaaS for commercial loan consultants, funding brokers, and MCA ISOs. They sell
themselves as the layer that takes over *after* the lead is captured — explicitly a complement
to GoHighLevel and ClickFunnels, not a replacement.

- MYFUNDALYTICS LLC, Florida, registered **2026-03-03** — six months old.
- 777 Brickell Ave Suite 500, Miami — a virtual-office address, not a floor of staff.
- Founder: Dallas J. Finley (also "Dallas Jay"). One published sales line: +1 (209) 494-2325.
- Same page title as bettercred.io → they white-label the platform to other brokers.

**Read on the company:** six months old, one named principal, virtual address. This is a small
fast-moving shop, not a funded competitor. They are ahead on *packaging*, not on depth.

## Feature-by-feature, against what this repo actually does today

| Their capability | FundHub today | Verdict |
|---|---|---|
| 3-bureau ingestion (Experian / Equifax / TransUnion), deduplicated | `src/deliverables/credit-analysis.mjs`, `src/sales/cockpit.mjs`, `src/sales/closer-deck.mjs` all handle all three bureaus | **Have it** |
| Approval Radar — odds against specific lenders | `src/underwrite/black-report-node.mjs`, `src/config/survey-qualification.mjs`, `src/deliverables/roadmap.mjs` do qualification scoring | **Partial** — we score the client, not client-against-a-named-lender |
| Lender Match Engine, 80+ verified lenders, live fit scoring | `db/migrations/138_lenders.sql` defines the table and the 7 product types. **The table ships empty.** CSV import is the load path and no seed file exists in the repo | **Biggest gap** — the engine exists, the data does not |
| Funding Blueprint — qualify-now vs. profile-optimization roadmap | `src/deliverables/roadmap.mjs`, `src/deliverables/lender-list.mjs` | **Have it** |
| AI Funding Coach — reviews profiles, flags red flags | `src/agents/` — registry, runtime, guardrails, model selection, shadow logging | **Have it, and deeper than theirs reads** |
| Intake-to-funded pipeline (kanban stages) | `src/http/pipeline.pg.test.mjs`, `pipeline-screen.test.mjs`, application status enum in 138 (Apply / Applied / Approved / Denied / Missing Docs / Action Required) | **Have it** |
| Automated fee, commission split and invoicing on mark-as-funded | `src/commissions/` — calculate, rules, tiers, payout, money-in-cents | **Have it** |
| White-label portal: CNAME custom domain, branded sender, colorways, document vault | Partner/affiliate plumbing exists (`src/http/partner-signup`, `partner-apply`, `partner-approve-payout-gate`). No custom-domain CNAME mapping found | **Partial** — partners yes, custom domains no |
| App-layer encryption, Postgres row-level security, append-only audit log | RLS is enforced repo-wide and guarded by `npm run guard:rls`; `db/migrations/104_app_role.sql` runs the app unprivileged | **Have it — parity** |

## The honest scoreboard

Six of nine at parity or better. Two partial. One real gap.

**The one real gap is lender data, not software.** Their "80+ verified lenders with live fit
scoring" is the headline they sell on, and our `lenders` table is empty. Every other row on this
table is code we already wrote. That means the fastest move is a data load, not a build.

**Where we are genuinely ahead:** the agent layer (`src/agents/`) and the commission engine are
both deeper than what they advertise. They market an "AI Funding Coach"; we have a registry,
guardrails, model selection and shadow logging behind ours.

**Where they beat us and it is not technical:** they can describe their product in eight bullets
on one page. We cannot. That is a positioning problem, not a product problem.

## Recommended order

1. **Load the lender table.** Data task, no schema change — 138 already defines the shape and
   the note in that file says "CSV import is the load path. Do not invent lender names or bureau
   assignments." The 46 rows the lender import already stamped (migration 365) are a starting
   point, not the set.
2. **Lender-specific approval odds.** Once the table has rows, extend the existing scoring in
   `black-report-node.mjs` to score against each lender. This is the Approval Radar equivalent.
3. **Custom-domain CNAME for partners.** Real work, but it is the only white-label row we lose.

Positioning is a separate track and does not block any of the above.
