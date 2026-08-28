# Deep coverage scorecard — 2026-08-24

**Overall: DONE** (in-scope live lanes green; beta/later leftovers named below)  
**Org:** `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6`  
**Client:** Colin Schmidt `e42c11e8-ec33-40b7-ac5a-99f733d18a3f`  
**Door:** live associate audit (outbound fence)  
**COMPLIANCE REVIEW REQUIRED** — soft-pull consent + diagnostic payment + live credit soft-pull + payment rails ($1 matrix / owner-pass) + soft-pull biz add-ons

**Auditor close:** 2026-08-25T01:45Z · Fixer: **no FAIL product bugs** (0 fixes)

## Lanes

| Lane | Result | Evidence |
|------|--------|----------|
| Soft-pull email → Colin | **PASS** | `…/colin-schmidt/soft-pull-email-only.json` + `soft-pull-after-run.json` — delivered; consent first |
| Diagnostic $32 paid | **PASS** | `soft-pull-after-run.json` — paid; consent granted |
| Soft-pull consent on file | **PASS** | same — kind=`soft_pull_consent`, not revoked |
| Live CRS soft-pull EX+EQ | **PASS** | `live-crs-pull.json` — production `crs_softview`; EX present |
| Live CRS soft-pull TU | **SKIP** | `live-crs-pull-tu.json` + retry — CRS E1006; owner skip; do not retry |
| Soft-pull approve biz add UI (live) | **PASS** | `soft-pull-biz-ui-live.json` — deploy `6a8cf278…`; HTML has “Total due” + “+ Add a business” (curl 200) |
| Present / UnderwriteIQ shows EX | **PASS** | `underwrite-present-check.json` + `present-ex-recheck-2026-08-25.json` — primary bureau experian, band 800_plus; no new pull |
| $1 package webhook matrix | **OWNER-PASS** | `webhook-owner-pass.json` — owner confirmed $1 webhook prove 100%; **do not re-pay / re-test** |
| Disposition → `call_outcomes` → `fetchContext` | **PASS** | `disposition-context-chain.json` — org disposition row appears in `fetchContext.recent_calls` + prompt block (Colin has 0 rows yet; path proven on live org data) |
| Site health | **PASS** | `health-2026-08-25T01-44Z.json` — HTTP 200, `ok`, db up, pending 0 |
| Launch-100 (earlier) | **PASS** | `docs/workflows/launch-100-scorecard-2026-08-24.md` |
| Self-loop email (soft-pull / funding / repair → `+colin-qa`) | **PASS** | `qa-self-loop-email-pass-2026-08-25.json` — found without INBOX via fixed `src/gmail/client.mjs`; Updates/Promotions (not Primary). Older “zero Fundhub mail” FAIL was prove-tool false negative. |
| Self-loop SMS → agent phone | **FAIL / blocked** | Twilio **401 / 20003** — leave blocked; no Twilio change this pass (`qa-self-loop-prove-2026-08-25.json`) |

## SKIP beta / later (not this door)

| Item | Status |
|------|--------|
| OP-06 | SKIP beta |
| Brain approve | SKIP beta |
| Ads buy | SKIP beta |
| Justice contract | SKIP beta |
| Aged Corps / multi-entity | Later |
| PostGrid live mail | Later (`test_sk_` locally) |
| TransUnion soft-pull | SKIP (owner; E1006) |

## Fixer

No in-scope **FAIL** product bugs. Nothing fixed this pass.

## Leftovers (one list)

1. Self-loop SMS — blocked on Twilio auth (401/20003); wait for Chris to name Twilio work  
2. TU soft-pull (owner skip until he says otherwise)  
3. OP-06 / Brain approve / ads buy / Justice (beta)  
4. Aged Corps / multi-entity  
5. PostGrid live postage  
6. Optional: log a Present disposition on Colin so his own `call_outcomes` row appears in agent context (org path already PASS)

## Risk

COMPLIANCE: live soft-pull + paid diagnostic + payment rails already exercised on Colin. No new pulls / no re-pay this close.
