# RUN 5 — Full build to ad-launch ready

Board for all phases. Agents claim tasks here. Push after every green phase.

## Standing law

- Live Playwright stays green and grows; 100% vs https://fundhub.ai + https://apply.fundhub.ai before phase done.
- `MESSAGING_DRY_RUN=1`. No live Inngest emits outside normal handlers. Never print secrets.
- Schema: additive migrations only + real-Postgres `*.pg.test.mjs`.
- ⛔ = stop and ask owner.

## Phase 2 homepage widget (owner-set)

Embedded multi-step survey widget on homepage (CF-style slides, progress, one Q per step). Clone CF flow exactly (10 steps + has-business branch, same headlines/options/order, `cf_svy_*` keys). Look **like current fundhub.ai** (fixed dark hero/CTA grids, Inter, site tokens — floating card). On complete: POST → `entry.captured` + `survey.submitted` → same routing → redirect PASS → `apply.fundhub.ai/funding-book-call`, DOWNSELL/MANUAL_REVIEW → downsell/thank-you. No page reloads between steps.

Other marketing pages: simple name/email/phone → `entry.captured` only.

## ClickFunnels attributes (⛔ PHASE 0 owner)

Chris maps Contact Attribute on all survey questions:

| Attribute key | Notes |
|---|---|
| `cf_svy_funding_target_amount` | existing |
| `cf_svy_planned_use` | existing |
| `cf_svy_money_change_now` | existing |
| `cf_svy_self_reported_fico` | existing |
| `cf_svy_annual_income_range` | existing |
| `cf_svy_income_verifiable` | existing |
| `cf_svy_has_business` | NEW |
| `cf_svy_business_revenue` | NEW |
| `cf_svy_revenue_verifiable` | NEW |
| `cf_svy_available_capital` | NEW |
| `cf_svy_has_negatives` | NEW — Yes/No — routing gate 2 |

Add question: "Any negatives on your credit report? (collections, charge-offs, late payments)" Yes/No → `cf_svy_has_negatives`.

**Owner signal:** reply `attributes set` when done. Phase 1 waits on that.

## Task list

| id | unit | owner | status |
|---|---|---|---|
| p0-cf | CF attributes + has_negatives question | Chris | pending ⛔ |
| p0-mig | Migration 163: add 5 typed `cf_svy_*` columns | agent | claimed |
| p0-writer | Carbon-copy writer + wire `survey.submitted` + pg tests | agent | claimed |
| p1-seam | Funnel seam proof (watch → payload → adapter → land → classify) | — | blocked on p0-cf |
| p2-home | Homepage survey widget | — | pending |
| p2-other | Other marketing page capture forms | — | pending |
| p3-pay | Checkout-session + Commas poller | — | pending |
| p4-tx | Transmit MVP (dry-run queue) | — | pending |
| p5-ops | Ops closeout | — | pending |

## Shared brief — Phase 0

- Table: `client_custom_fields` (`db/schema/005_client_custom_fields.sql`). 11 `cf_svy_*` today; **missing:** `cf_svy_has_business`, `cf_svy_business_revenue`, `cf_svy_revenue_verifiable`, `cf_svy_available_capital`, `cf_svy_has_negatives`.
- No INSERT/UPDATE writer in repo (RUN4 FAIL).
- `onSurveySubmitted` in `src/handlers/client-lifecycle.mjs` only merges jsonb via `mergeCustomFields`.
- Next migration: **163**. Writer inserts after jsonb merge in `onSurveySubmitted`.
- `classifySurvey` reads `cf_svy_has_negatives` from jsonb; absent → MANUAL_REVIEW.

## Change manifests

_(append per phase)_

## Blockers

- Phase 1 blocked until owner says `attributes set`.
