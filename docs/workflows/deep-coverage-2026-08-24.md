# Deep coverage — Colin Schmidt BA-LIVE (2026-08-24)

**Status:** **DONE** · scorecard `docs/workflows/deep-coverage-scorecard-2026-08-24.md`  
**Door:** live associate audit (outbound fence)  
**Org:** `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6`  
**Client:** Colin Schmidt `e42c11e8-ec33-40b7-ac5a-99f733d18a3f` · `schmidtco16@gmail.com`  
**COMPLIANCE REVIEW REQUIRED** — soft-pull consent + diagnostic payment + live credit soft-pull + payment rails ($1 matrix / **OWNER-PASS**) + soft-pull biz add-ons ($10×n)

## Soft-pull email + business add-ons (this agent)

| Item | Status |
|------|--------|
| A) Soft-pull email (Present `sendDeckSoftPull`) | **FIXED** — consent first, pay second; HTML branded; consent clarity; biz add-on note. No resend to Colin. |
| B) Approve form businesses 0–5 | **FIXED** — name+address; total = $32 + $10×n; checkout minted/adjusted on submit |
| Choice | Approve form collects businesses **before** pay; checkout matches total (not pay-$32-then-upsell) |
| Deploy | **DONE** — Chris added Netlify credits. Prod deploy `6a8cf2788c39d811940446c5` (working tree, no commit). Live HTML proves “Total due” / “+ Add a business” (`soft-pull-biz-ui-live.json` 2026-08-25T01:44Z). |

## Owner fence (this file)

Outbound to Colin’s email **only**:

1. Soft-pull **authorization** link (`/app/soft-pull-approve.html`)
2. CRS / diagnostic **pay link** ($32 UnderwriteIQ soft-pull)

**No SMS** (even though phone is on file). No other packages, contracts, or blasts to this address until Chris names them.

**$1 webhook matrix:** **OWNER-PASS** (owner confirmed $1 webhook test worked 100%). Do **not** re-pay or re-test. Minted links remain for history only.

Everything else (CRM, internal pulls, evidence) stays internal for agent eyes.

## Done

| Step | Result | Evidence |
|------|--------|----------|
| Client on file | Existing row reused (not reminted) | DB id above |
| Diagnostic pay link | **sent** · Fanbasis checkout · $32 · purpose=diagnostic | `…/colin-schmidt/soft-pull-email-only.json` |
| Soft-pull approve URL | Signed · expires ~2026-08-25T05:26Z | same |
| Email to schmidtco16@gmail.com | **sent** · message `1c4f35ba-…` | same |
| SMS | **not sent** (fence) | same |
| Diagnostic paid | **paid** · $32 · paid_at 2026-08-24T23:37:02Z · link `4b1bf190-…` | `…/colin-schmidt/soft-pull-after-run.json` |
| Soft-pull consent | **granted** · kind=soft_pull_consent · granted_at 2026-08-24T23:38:57Z · not revoked | same |
| Soft-pull email delivery | status **delivered** (Resend) | same |
| Live CRS soft-pull (EX+EQ production) | **done** · environment=`production` · provider=`crs_softview` · EX score present (band 800+) · EQ file returned (no FICO in scores slot) · HTTP login hit `usage_exceeded` so same staff modules ran locally | `…/colin-schmidt/live-crs-pull.json` |
| Live CRS soft-pull (**TU only**) | **SKIP** · CRS **E1006** · owner skip — do not retry | `…/colin-schmidt/live-crs-pull-tu.json` + retry |
| $1 webhook-test links | **OWNER-PASS** · owner confirmed $1 webhook prove 100% · do not re-pay | `…/colin-schmidt/webhook-owner-pass.json` (+ mint history `dollar-webhook-links.json`) |
| Soft-pull biz form prod deploy | **PASS** · live HTML Total due / + Add a business | `…/colin-schmidt/soft-pull-biz-ui-live.json` |
| UnderwriteIQ / Present calcs | **PASS** · EX in adapter · band 800+ · recheck no new pull | `underwrite-present-check.json` + `present-ex-recheck-2026-08-25.json` |
| Disposition → call_outcomes → context | **PASS** · org row feeds `fetchContext.recent_calls` | `disposition-context-chain.json` |
| Site health | **PASS** · 200 ok | `health-2026-08-25T01-44Z.json` |
| Scorecard | **DONE** | `docs/workflows/deep-coverage-scorecard-2026-08-24.md` |

### $1 links (minted 2026-08-25) — history only; OWNER-PASS (do not re-pay)

| productCode | purpose | checkout |
|-------------|---------|----------|
| diagnostic | diagnostic | https://www.fanbasis.com/agency-checkout/fundhub-1/5wjm8 |
| card-stacking-dfy | deposit | https://www.fanbasis.com/agency-checkout/fundhub-1/1p50m |
| repair-bundle | repair | https://www.fanbasis.com/agency-checkout/fundhub-1/9AnqD |
| repair-trial | repair | https://www.fanbasis.com/agency-checkout/fundhub-1/0o45L |
| consulting-package | custom | https://www.fanbasis.com/agency-checkout/fundhub-1/4vglx |
| funding-mastery | custom | https://www.fanbasis.com/agency-checkout/fundhub-1/6xknR |
| inquiry-removal | custom | https://www.fanbasis.com/agency-checkout/fundhub-1/8zmp3 |

Ids + `link_ref` in `dollar-webhook-links.json`. **No email/SMS to Colin. Do not re-pay.**

## Self-loop prove (2026-08-25) — soft-pull / funding / repair

Owner model: email → Chris Gmail (`+colin-qa`); SMS → agent `+16616054248`.

| Check | Result |
|-------|--------|
| Soft-pull / funding / repair email in Gmail | **PASS** (confirmed 2026-08-25T19:47Z with fixed client) — all three + probe findable without INBOX (`from:noreply` / subject prefix / by id). Labels Updates/Promotions only (no Primary/INBOX). Prior FAIL was prove-tooling: `listMessages` AND’d `labelIds=INBOX` with `q`. Fixed in `src/gmail/client.mjs` (unit 8/8). Stale “zero Fundhub mail” in older prove JSON is superseded. |
| SMS to agent phone | **FAIL / blocked** — live Twilio **401 / 20003** since ~2026-08-24T18:15Z (last OK SMS 17:22Z). No Twilio changes this pass. |

Evidence: `…/colin-schmidt/qa-self-loop-email-pass-2026-08-25.json` (+ gap `qa-self-loop-email-gap-2026-08-25.json`, prior `qa-self-loop-prove-2026-08-25.json`, `qa-self-loop-sends.json`).

**SMS:** blocked on Twilio auth — leave alone until Chris names a Twilio fix. **Email:** PASS — check All Mail / Updates (and Promotions for repair), not Primary.

## Waiting

| Step | Blocker |
|------|---------|
| Self-loop SMS | **FAIL / blocked** on Twilio auth (401/20003) — out of scope until Chris names Twilio work |
| Self-loop email | **cleared / PASS** — false negative in Gmail client; mail present outside Primary |

## Leftovers (later / not this door)

1. TU soft-pull (owner skip; E1006)  
2. OP-06 / Brain approve / ads buy / Justice (beta)  
3. Aged Corps / multi-entity  
4. PostGrid live postage  
5. Optional: Present disposition on Colin so his own `call_outcomes` appear in context  

## SKIP beta

OP-06, Brain approve, ads, Justice contract, dialer — untouched.
