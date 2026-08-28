# Launch-100 scorecard — 2026-08-24

**Overall: PASS** (all launch lanes green)  
**Org:** `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6`  
**Sims:** Repair `fcd71a6d-…` · Combo `90ec6cee-…`  
**Deploy:** `6a8cb9d90f5a931d39d9e181` (Phase 4 UI + KPI)  
**COMPLIANCE REVIEW REQUIRED** — Phase 3 PostGrid sandbox mail (`test_sk_` only; no live postage)

## Lanes

| Lane | Result | Evidence |
|------|--------|----------|
| Phase 1 — Durable docs / FAIL-D1 | **PASS** | `docs/workflows/company-sim-2026-08-24-evidence/launch-100-phase1/VERDICT.json` — `DOCUMENT_STORE_PROVIDER=netlify-blobs` all contexts; no env deploy needed; 14 packs re-stored + `delivery_status=delivered`; live signed download 200 + `%PDF` |
| Phase 2 — Gallery walk | **PASS** | `…/launch-100-phase2/VERDICT.json` + marked shots — Specialist READY=2, letter drawer Equifax/Experian generated; Documents Sim Repair/Combo packs SENT |
| Phase 3 — PostGrid sandbox | **PASS** | `…/launch-100-phase3/VERDICT.json` — Repair+Combo 4 letters `status=sent` + `postgrid_letter_id` (`letter_…`); prefix `test_sk_` |
| Phase 4a — Inquiry upload door | **PASS** | `…/launch-100-phase4/VERDICT.json` — `credit-analysis-report` opens inquiry door (unit + live paint) |
| Phase 4b — Present pay-link | **PASS** | same — primary offers (`REPAIR_DFY` etc.) no longer force downsell/upsell; live `send_pay_link` 200 without `sale_motion_required` |
| Phase 4c — Invoice button CCP/Present | **PASS** | same + marked `02-ccp-invoice-MARKED.png` — CCP button live; Present wired; click returned already-emailed (success path) |
| Phase 4d — Pulse funded count | **PASS** | same — KPI `funded_count=2` from `funding_rounds` status=funded (was 0 via `clients.funded`) |
| Live Playwright (required board) | **100/100** | `…/launch-100-phase5/live-playwright-required.txt` — **26/26** (run4 + affiliate + white-label). Full `live-*.spec` also ran: Company Brain 2 fails (`embed_failed` 502) — **outside** launch-100 required ids; not a launch lane fail |
| Harden | **DEFERRED** | Scorecard green. No separate harden checklist named for this batch beyond live gate + evidence; leave Company Brain embed fail as its own follow-up |

## Prior letters / unlock (already green)

| Check | Result | Evidence |
|-------|--------|----------|
| FAIL-L1 letters READY | PASS | `e2e-revalidate-2026-08-24/` |
| GO-PULL sandbox | PASS | same |
| FAIL-C1 contracts | PASS | same |
| FAIL-S1 SMS retarget | PASS | same |
| FAIL-F1 apply apex | NARROWED | `/watch` PASS; apex ClickFunnels-owned |

## What changed (product)

- DIY packs durable on Netlify Blobs + delivered
- Inquiry portal door opens on `credit-analysis-report`
- Present/CCP: primary pay offers skip sale-motion gate; Invoice this client button
- Pulse/KPI funded count reads `funding_rounds`

## What Chris should check (one manual pass)

1. Open Specialist → Repair → Sim Repair — Send letters already mailed (sandbox). Documents → filter Sim Repair — packs Sent.
2. Open CCP for Sim Funding — see **Invoice this client**. Ops Admin / Pulse — funded files **2** this window.

## Risk

COMPLIANCE: sandbox PostGrid letters exist with provider ids — do not treat as live postage. Company Brain upload embed still failing live (separate).

## Left undone

- ClickFunnels apex → `/watch` redirect (outside repo)
- Company Brain `embed_failed` (not launch lane)
- Harden pass deferred (scorecard green; no named harden pack)

## Next

Chris: one manual pass on Documents + CCP Invoice + Pulse funded = 2. Then say if Company Brain embed should be its own Fixer.
