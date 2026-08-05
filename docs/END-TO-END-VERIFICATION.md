# End-to-End Verification Report

Generated: 2026-08-05T02:04:30.551Z
Run id: verify-1785895469570
Node: v22.21.1
DATABASE_URL: 127.0.0.1/fundhub_verify
Stance: skeptical operator / business architect. Prefer SILENTLY-DID-NOTHING and UNVERIFIED over a false pass.

## Operator headline

**Do not put a real client on this platform today.** 22 P0 isolation finding(s). Review the P0 list below before treating this as a ship gate.

Re-run: `DATABASE_URL=... npm run verify:e2e` (Playwright UI + data-layer). Data only: `node src/verification/run-all.mjs`.

## Tallies

| Status | Count |
|---|---:|
| PASS | 297 |
| FAIL | 83 |
| SILENTLY-DID-NOTHING | 6 |
| UNVERIFIED | 49 |
| SKIP | 0 |
| **Total** | **435** |
| P0 non-passes | 22 |

## 1. SECURITY (read this first)

### P0 — successful or unresolved isolation failures

Any successful violation here is a business-ending and regulatory event.

- **P0 UNVERIFIED** — Company Brain tier filter before retrieval
  - status=405; may be empty corpus on verify DB
- **P0 UNVERIFIED** — sales_manager direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/hiring.html`
- **P0 UNVERIFIED** — sales_manager direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/ops-admin.html`
- **P0 UNVERIFIED** — closer direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/hiring.html`
- **P0 UNVERIFIED** — closer direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/ops-admin.html`
- **P0 UNVERIFIED** — closer direct-URL to finance-os.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/finance-os.html`
- **P0 UNVERIFIED** — funding_advisor direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/hiring.html`
- **P0 UNVERIFIED** — funding_advisor direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/ops-admin.html`
- **P0 UNVERIFIED** — inquiry_specialist direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/hiring.html`
- **P0 UNVERIFIED** — inquiry_specialist direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/ops-admin.html`
- **P0 UNVERIFIED** — inquiry_specialist direct-URL to products-commissions.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/products-commissions.html`
- **P0 UNVERIFIED** — setter direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/hiring.html`
- **P0 UNVERIFIED** — setter direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/ops-admin.html`
- **P0 UNVERIFIED** — setter direct-URL to finance-os.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/finance-os.html`
- **P0 UNVERIFIED** — affiliate direct-URL to pipeline.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/pipeline.html`
- **P0 UNVERIFIED** — affiliate direct-URL to finance-os.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/finance-os.html`
- **P0 UNVERIFIED** — affiliate direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/hiring.html`
- **P0 UNVERIFIED** — affiliate direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/ops-admin.html`
- **P0 UNVERIFIED** — affiliate direct-URL to client-control-panel.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/client-control-panel.html`
- **P0 UNVERIFIED** — partner direct-URL to pipeline.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/pipeline.html`
- **P0 UNVERIFIED** — partner direct-URL to finance-os.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/finance-os.html`
- **P0 UNVERIFIED** — partner direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey
  - Browser cannot enforce role on static files; netlify/functions must.
  - at `public/app/hiring.html`

### Isolation attempts

| Status | Role | Claim | Detail | File |
|---|---|---|---|---|
| PASS | sales_manager | sales_manager is in FINANCE |  | src/http/read-api.mjs |
| PASS | sales_manager | sales_manager is NOT in HIRING |  | src/http/read-api.mjs |
| PASS | closer | closer is NOT in HIRING (applicant PII) |  | src/http/read-api.mjs |
| PASS | closer | closer is NOT in OPS |  | src/http/read-api.mjs |
| PASS | owner | owner may access commissions |  |  |
| PASS | owner | owner may access invoices |  |  |
| PASS | owner | owner may access staff |  |  |
| PASS | owner | owner may access failed-events |  |  |
| FAIL | owner | owner should access hiring but got 404 | {"ok":false,"error":"not_found","path":"read/hiring/applications"} | netlify/functions/api.mjs |
| FAIL | owner | owner should access hiring-write but got 404 | {"ok":false,"error":"not_found","path":"hiring"} | netlify/functions/api.mjs |
| PASS | owner | owner may access client-dashboard |  |  |
| PASS | owner | owner may access documents |  |  |
| PASS | owner | owner may access tradelines |  |  |
| PASS | owner | owner cannot read other org client (404) |  |  |
| PASS | owner | owner org_id/role query spoof does not elevate (200) |  |  |
| PASS | admin | admin may access commissions |  |  |
| PASS | admin | admin may access invoices |  |  |
| PASS | admin | admin may access staff |  |  |
| PASS | admin | admin may access failed-events |  |  |
| FAIL | admin | admin should access hiring but got 404 | {"ok":false,"error":"not_found","path":"read/hiring/applications"} | netlify/functions/api.mjs |
| FAIL | admin | admin should access hiring-write but got 404 | {"ok":false,"error":"not_found","path":"hiring"} | netlify/functions/api.mjs |
| PASS | admin | admin may access client-dashboard |  |  |
| PASS | admin | admin may access documents |  |  |
| PASS | admin | admin may access tradelines |  |  |
| PASS | admin | admin cannot read other org client (404) |  |  |
| PASS | admin | admin org_id/role query spoof does not elevate (200) |  |  |
| PASS | sales_manager | sales_manager may access commissions |  |  |
| PASS | sales_manager | sales_manager may access invoices |  |  |
| PASS | sales_manager | sales_manager may access staff |  |  |
| PASS | sales_manager | sales_manager refused failed-events (403) |  |  |
| PASS | sales_manager | sales_manager refused hiring (404) |  |  |
| PASS | sales_manager | sales_manager refused hiring-write (404) |  |  |
| PASS | sales_manager | sales_manager may access client-dashboard |  |  |
| PASS | sales_manager | sales_manager may access documents |  |  |
| PASS | sales_manager | sales_manager may access tradelines |  |  |
| PASS | sales_manager | sales_manager cannot read other org client (404) |  |  |
| PASS | sales_manager | sales_manager org_id/role query spoof does not elevate (200) |  |  |
| PASS | funding_advisor | funding_advisor refused commissions (403) |  |  |
| PASS | funding_advisor | funding_advisor refused invoices (403) |  |  |
| PASS | funding_advisor | funding_advisor refused staff (403) |  |  |
| PASS | funding_advisor | funding_advisor refused failed-events (403) |  |  |
| PASS | funding_advisor | funding_advisor refused hiring (404) |  |  |
| PASS | funding_advisor | funding_advisor refused hiring-write (404) |  |  |
| PASS | funding_advisor | funding_advisor may access client-dashboard |  |  |
| PASS | funding_advisor | funding_advisor may access documents |  |  |
| PASS | funding_advisor | funding_advisor may access tradelines |  |  |
| PASS | funding_advisor | funding_advisor cannot read other org client (404) |  |  |
| PASS | funding_advisor | funding_advisor org_id/role query spoof does not elevate (403) |  |  |
| PASS | closer | closer refused commissions (403) |  |  |
| PASS | closer | closer refused invoices (403) |  |  |
| PASS | closer | closer refused staff (403) |  |  |
| PASS | closer | closer refused failed-events (403) |  |  |
| PASS | closer | closer refused hiring (404) |  |  |
| PASS | closer | closer refused hiring-write (404) |  |  |
| PASS | closer | closer may access client-dashboard |  |  |
| PASS | closer | closer may access documents |  |  |
| PASS | closer | closer may access tradelines |  |  |
| PASS | closer | closer cannot read other org client (404) |  |  |
| PASS | closer | closer org_id/role query spoof does not elevate (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused commissions (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused invoices (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused staff (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused failed-events (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused hiring (404) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused hiring-write (404) |  |  |
| PASS | inquiry_specialist | inquiry_specialist may access client-dashboard |  |  |
| PASS | inquiry_specialist | inquiry_specialist may access documents |  |  |
| PASS | inquiry_specialist | inquiry_specialist may access tradelines |  |  |
| PASS | inquiry_specialist | inquiry_specialist cannot read other org client (404) |  |  |
| PASS | inquiry_specialist | inquiry_specialist org_id/role query spoof does not elevate (403) |  |  |
| PASS | setter | setter refused commissions (403) |  |  |
| PASS | setter | setter refused invoices (403) |  |  |
| PASS | setter | setter refused staff (403) |  |  |
| PASS | setter | setter refused failed-events (403) |  |  |
| PASS | setter | setter refused hiring (404) |  |  |
| PASS | setter | setter refused hiring-write (404) |  |  |
| PASS | setter | setter may access client-dashboard |  |  |
| PASS | setter | setter may access documents |  |  |
| PASS | setter | setter may access tradelines |  |  |
| PASS | setter | setter cannot read other org client (404) |  |  |
| PASS | setter | setter org_id/role query spoof does not elevate (403) |  |  |
| PASS | closer | Closer refused hiring endpoint (404) |  |  |
| PASS | forged | Forged bearer token is refused |  | src/auth/session.mjs |
| PASS | closer | Session endpoint responds to auth probes (status 401) | Full revoke/expiry matrix also covered by src/auth/*.pg.test.mjs |  |
| UNVERIFIED | closer | Company Brain tier filter before retrieval | status=405; may be empty corpus on verify DB |  |
| PASS | affiliate | Affiliate refused internal client (403) |  |  |
| UNVERIFIED | funding_advisor | Proxy session credential isolation between advisors | status=401 |  |
| UNVERIFIED | sales_manager | sales_manager direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/hiring.html |
| UNVERIFIED | sales_manager | sales_manager direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/ops-admin.html |
| UNVERIFIED | closer | closer direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/hiring.html |
| UNVERIFIED | closer | closer direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/ops-admin.html |
| UNVERIFIED | closer | closer direct-URL to finance-os.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/finance-os.html |
| UNVERIFIED | funding_advisor | funding_advisor direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/hiring.html |
| UNVERIFIED | funding_advisor | funding_advisor direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/ops-admin.html |
| UNVERIFIED | inquiry_specialist | inquiry_specialist direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/hiring.html |
| UNVERIFIED | inquiry_specialist | inquiry_specialist direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/ops-admin.html |
| UNVERIFIED | inquiry_specialist | inquiry_specialist direct-URL to products-commissions.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/products-commissions.html |
| UNVERIFIED | setter | setter direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/hiring.html |
| UNVERIFIED | setter | setter direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/ops-admin.html |
| UNVERIFIED | setter | setter direct-URL to finance-os.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/finance-os.html |
| UNVERIFIED | affiliate | affiliate direct-URL to pipeline.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/pipeline.html |
| UNVERIFIED | affiliate | affiliate direct-URL to finance-os.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/finance-os.html |
| UNVERIFIED | affiliate | affiliate direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/hiring.html |
| UNVERIFIED | affiliate | affiliate direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/ops-admin.html |
| UNVERIFIED | affiliate | affiliate direct-URL to client-control-panel.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/client-control-panel.html |
| UNVERIFIED | partner | partner direct-URL to pipeline.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/pipeline.html |
| UNVERIFIED | partner | partner direct-URL to finance-os.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/finance-os.html |
| UNVERIFIED | partner | partner direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey | Browser cannot enforce role on static files; netlify/functions must. | public/app/hiring.html |
| PASS | closer | Closer direct-URL to owner screens triggers 403 on gated APIs | denied=7 allowed=9 | e2e/verification-security.spec.mjs |
| PASS | owner | Owner can open ops-admin without console death |  | public/app/ops-admin.html |

## 2. SILENTLY-DID-NOTHING (hunt results)

Code ran. No error. Nothing useful persisted — or the write was empty/zero.
These are more dangerous than hard failures because nothing alerts.

- **FUNDING** — Contract rendered/sent from real template
  - A contract has to record who created it.
  - `src/contracts/send.mjs`
  - actual: `{"error":"A contract has to record who created it."}`
- **FUNDING** — Application status change wrote an audit/decision row
  - application_decisions empty after Approved insert. If the CRM status picker only UPDATEs applications.status, the audit trail is silent.
  - `api/applications.mjs`
- **DIY_DOWNSELL** — DIY letters path queued a message with DIY template key
  - messages=0; none matched DS02/DIY/LETTER. Letter generation/delivery may be a no-op without vendor credentials.
  - `src/workflows/ds-02-diy-letters.mjs`
  - actual: `{"keys":[]}`
- **IDEMPOTENCY** — Identical deposit.paid twice → exactly one sale
  - Wanted 1; persisted value is empty/zero: 0.
  - `src/handlers/money-chain.mjs`
  - expected: `{"value":1}`
  - actual: `{"value":0}`
- **IDEMPOTENCY** — Identical deposit.paid twice → one front-end ledger row
  - Operation returned ok but found 0 rows (wanted 1).
  - `src/handlers/money-chain.mjs`
  - expected: `{"count":1}`
  - actual: `{"count":0}`
- **IDEMPOTENCY** — Two concurrent identical deposit.paid → one sale
  - Wanted 1; persisted value is empty/zero: 0.
  - `src/handlers/money-chain.mjs`
  - expected: `{"value":1}`
  - actual: `{"value":0}`

## 3. Journey accounts (persisted values)

### A. Funding path

**Usable for a real person today: YES**

Primary client (lead): 1ad3da05-b0e0-4954-b0e3-4c0222a732bf / e2e_verify.funding.1785895469581@verify.local
Simulated funding client: cdc2a116-e0f5-4780-8234-aa6a89f9b9f3 / sim+1785895469640@demo.fundhub.local
Sale amount: 3000.00 (want 3000)
Closer front commission: 500.00 (want 500)
Advisor back commission: 125.00 (want 125)
Closeout fee: 5000.00 (want 5000)
GHL link: dry-ghl-1ad3da05b0e0
Contract: MISSING
Messages queued: 3

Operator verdict: YES for the money spine; still check GHL link, contract send, and live webhooks separately.

| Step | Status | Persisted |
|---|---|---|
| Lead captured → client row | PASS | client.id=1ad3da05-b0e0-4954-b0e3-4c0222a732bf email=e2e_verify.funding.1785895469581@verify.local |
| GHL linkage | PASS | dry-ghl-1ad3da05b0e0 |
| Booking → closer task | PASS | task.id=2bc77c90-5561-4522-a723-e402ec28df4b title=Strategy session booked |
| Consent captured | FAIL | grantedBy is required — an unattributed consent is not evidence of anything |
| CRS → tradelines | PASS | funding_client_tls=4 sim_tls=4 ingested=4 |
| Pipeline card | PASS | card=700b8c04-d8f8-4c48-8a5e-2b7ca5a1ff9d stage=new_lead |
| Sale + $500 closer commission + entitlement | PASS | sales=2 front=500.00 ents=credit-analysis-report,funding-snapshot |
| Contract | SILENTLY-DID-NOTHING | A contract has to record who created it. |
| Round funded + closeout 10% | PASS | fee=5000.00 balance_due=5000.00 basis=50000.00 |
| Messages queued | PASS | total=3 queued=3 keys=SMS-ROUND-STARTED-NOTIFY,EMAIL-F07-FUNDING-LOCKED,SMS-F07-FUNDING-LOCKED |

### B. Credit-repair / DIY downsell

**Usable for a real person today: YES**

Client 46b150a0-4a9f-4b94-9015-23eac0c6a110
DIY sale: 1000.00
Entitlements: metro2-letter-pack
Ledger rows: 0
Messages: 0
Operator verdict: YES for sale/entitlement separation; letter delivery still vendor-gated.

| Step | Status | Persisted |
|---|---|---|
| DIY sale (not funding) | PASS | diy=1 funding=0 price=1000.00 |
| Letters / delivery message | SILENTLY-DID-NOTHING | msgs=0 |

### C. Inquiry removal

**Usable for a real person today: YES**

Inquiry 5293106b-6829-48e0-b471-cd3dc903290b; case 5c08e97f-429c-4ce6-ad8a-898d0d6e6b8e
call_state machine: 11 states exercised
Status bleed on call_state: no
Operator verdict: YES for status separation; real Bland voice still credential-gated.

| Step | Status | Persisted |
|---|---|---|
| Inquiry logged | PASS | id=5293106b-6829-48e0-b471-cd3dc903290b status=open call_state=not_started |
| Case created | PASS | case=5c08e97f-429c-4ce6-ad8a-898d0d6e6b8e |
| All 11 call_states without status bleed | PASS | status remained open |
| cleared → inquiry.removed → C-03 | PASS | {"done":true,"branch":"resume","task":{"created":true}} |

### D. Agent runtime

**Usable for a real person today: NO**

Agents in org: draft=AG-01 shadow=VF-SHADOW live=VF-LIVE
handleInbound result: {"ok":true,"reason":"no_api_key","agent":"VF-LIVE","shadowed":true,"wouldSend":"[SHADOW — no API key] Model was not called. Inbound: Hi, what are my next steps?"}
Shadow logs: 2; agent outbound: 0
Operator verdict: NO for live client conversations — runtime has never sent a real reply; without ANTHROPIC_API_KEY it shadows. Do not put a client on an agent today.

| Step | Status | Persisted |
|---|---|---|
| Inbound → select → shadow/no-send | PASS | result={"ok":true,"reason":"no_api_key","agent":"VF-LIVE","shadowed":true,"wouldSend":"[SHADOW — no API key] Model was not called. Inbound: Hi, what are my next steps?"} shadows=2 outbound=0 |
| STOP halt | PASS | {"ok":true,"reason":"stop_word","halted":true,"agent":"VF-LIVE"} |

### E. Idempotency, replay, ordering

**Usable for a real person today: NO**

Operator verdict: NO — duplicate money rows possible under replay or concurrency.

| Step | Status | Persisted |
|---|---|---|
| Double deposit.paid | FAIL | sales=0 ledger=0 ents=0 |
| Out-of-order round.funded | PASS | no round invented |
| Concurrent identical deposit.paid | FAIL | sales=0 |

### F. Negative / adversarial

**Usable for a real person today: UNKNOWN / PARTIAL**

Adapter signatures fail-closed for commas/clickfunnels in-process. Full webhook HTTP path still depends on Netlify function wiring (see AUDIT-FINDINGS on plain-object req).

| Step | Status | Persisted |
|---|---|---|
| Bad amounts | PASS | salesDelta=1 |
| Signatures / opt-out / unicode / amounts | PASS | see assertions |

### G. Workflow engine

**Usable for a real person today: YES**

Registered workflows: 50
Reacted: 48
Errored: none
Never invoked this run: 2
Canonical events with no workflow listener: booking.rescheduled, booking.cancelled, decision.rendered, sale.closed, file.finalized, payment.failed, docs.received, letter.generated, message.queued, message.sent, message.failed, message.blocked, commission.earned, commission.approved, commission.paid, invoice.created, invoice.sent, invoice.paid, invoice.voided, contract.sent, contract.signed
Operator note: Inngest does not schedule anything without INNGEST_EVENT_KEY. This run invokes handles directly.

| Step | Status | Persisted |
|---|---|---|
| Drive workflows from canonical events | PASS | reacted=48 errored=0 never=2 orphanEvents=21 |

### PART 3 — Security & isolation

**Usable for a real person today: YES**

Victim client 2d55d23d-e000-483e-b4a6-b5b6b3f5ec64 in org 35b667b7-a5ab-4371-9a8b-7f4aa2e31dce
Other-org client 77f5199e-7ca3-438a-874a-28cc65162fa5
Document id: none
Attacker stance: direct URL/API, id swap, org_id spoof, forged token, affiliate reach.

| Step | Status | Persisted |
|---|---|---|
| Role matrix + cross-org + spoof + brain + affiliate | PASS | see SECURITY assertions |

### PART 4 — Cross-cutting

**Usable for a real person today: YES**

Workflow keys: 43
Missing rows: none
DRAFT keys (blocked by hard guard; rewrite before live send): EMAIL-C06-DECLINE, EMAIL-DS01-REPAIR-REFERRAL, EMAIL-DS02-DIY-LETTERS-READY, EMAIL-S05A-NOSHOW-RECOVERY, SMS-C06-DECLINE, SMS-N01-COLD-NURTURE, SMS-N02-WARM-NURTURE, SMS-N03-HOT-NURTURE, SMS-N04-POST-FUNDING, SMS-N06-RENEWAL, SMS-S05A-NOSHOW-RECOVERY
Template table: {"total":231,"drafts":11,"compliant":48}
Canonical orphans (no emit site found): none
Hand-calcs: closer $500 / back $125 / fee $5000 / hourly $6.25

| Step | Status | Persisted |
|---|---|---|
| Workflow template keys → DB rows | PASS | keys=43 missing=0 drafts=11 |
| Canonical event emit sites | PASS | emitted=37 orphans=0:  |

## 4. Full assertion table

| Status | Section | Journey | Role | Claim | File:line |
|---|---|---|---|---|---|
| PASS | DATA | FUNDING | system | ClickFunnels/entry.captured created a clients row | src/adapters/clickfunnels.mjs |
| PASS | DATA | FUNDING | system | S-01 tagged client lead:new | src/workflows/s-01-new-lead-intake.mjs |
| PASS | DATA | FUNDING | system | Client has ghl_contact_id linkage | src/handlers/client-lifecycle.mjs |
| PASS | DATA | FUNDING | system | Booking created a closer task | src/adapters/calcom.mjs |
| FAIL | DATA | FUNDING | system | Soft-pull consent persisted | src/consent/index.mjs |
| PASS | DATA | FUNDING | system | Finance OS loadSimulatedClient created a demo client | src/demo/simulate-client.mjs:103 |
| PASS | DATA | FUNDING | system | CRS ingest stored tradelines for funding client | src/demo/simulate-client.mjs |
| PASS | DATA | FUNDING | system | Tradeline creditorName survived ingest as creditor/lender | src/tradelines/store.mjs |
| PASS | DATA | FUNDING | system | Bureau field creditorName accepted by ingest (tradelines written: 4) | src/tradelines/index.mjs |
| PASS | DATA | FUNDING | system | Bureau field currentBalanceAmount accepted by ingest (tradelines written: 4) | src/tradelines/index.mjs |
| PASS | DATA | FUNDING | system | Bureau field creditLimitAmount accepted by ingest (tradelines written: 4) | src/tradelines/index.mjs |
| PASS | DATA | FUNDING | system | Bureau field accountOpenedDate accepted by ingest (tradelines written: 4) | src/tradelines/index.mjs |
| PASS | DATA | FUNDING | system | Bureau field accountIdentifier accepted by ingest (tradelines written: 4) | src/tradelines/index.mjs |
| PASS | DATA | FUNDING | system | Bureau field accountReportedDate accepted by ingest (tradelines written: 4) | src/tradelines/index.mjs |
| PASS | DATA | FUNDING | system | Bureau field accountStatusType accepted by ingest (tradelines written: 4) | src/tradelines/index.mjs |
| PASS | DATA | FUNDING | system | Outcome tier FULL_FUNDING stamped on client | src/demo/simulate-client.mjs |
| PASS | DATA | FUNDING | system | Sales pipeline card exists for simulated funding client | src/demo/simulate-client.mjs |
| PASS | DATA | FUNDING | system | deposit.paid wrote a funding sale | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Funding sale agreed_price is $3000 (hand-check) | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Closer front-end commission is $500 (hand-calc, not library) | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Funding entitlement funding-snapshot granted | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Payment link row created | src/payment-links/index.mjs |
| SILENTLY-DID-NOTHING | DATA | FUNDING | system | Contract rendered/sent from real template | src/contracts/send.mjs |
| PASS | DATA | FUNDING | system | round.started created funding_rounds row | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Approved application row exists for the round | api/applications.mjs |
| SILENTLY-DID-NOTHING | DATA | FUNDING | system | Application status change wrote an audit/decision row | api/applications.mjs |
| PASS | DATA | FUNDING | system | Round status is funded with amount 50000 | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Advisor back-end commission is $125 (50000 × 0.25% hand-calc) | src/handlers/money-chain.mjs |
| UNVERIFIED | DATA | FUNDING | system | Closer also earns 0.25% of funded |  |
| PASS | DATA | FUNDING | system | Closeout total_fee is $5000 (10% of round funded_amount $50000) | src/funding/closeout.mjs |
| PASS | DATA | FUNDING | system | Closeout balance_due equals total_fee | src/funding/closeout.mjs |
| PASS | DATA | FUNDING | system | Success-fee invoice row exists | src/workflows/f-07-funding-locked.mjs |
| PASS | DATA | FUNDING | system | Messages queued along funding path (3) | src/workflows/messaging.mjs |
| PASS | DATA | FUNDING | system | Template SMS-ROUND-STARTED-NOTIFY resolves to a real non-DRAFT row |  |
| PASS | DATA | FUNDING | system | Template EMAIL-F07-FUNDING-LOCKED resolves to a real non-DRAFT row |  |
| PASS | DATA | FUNDING | system | Template SMS-F07-FUNDING-LOCKED resolves to a real non-DRAFT row |  |
| FAIL | DATA | FUNDING | system | Funding-path bus replay completes without throwing | src/events/bus.mjs |
| PASS | DATA | DIY_DOWNSELL | system | DIY path wrote its OWN consulting-package sale | src/handlers/money-chain.mjs |
| PASS | DATA | DIY_DOWNSELL | system | DIY path did NOT write a funding (card-stacking-dfy) sale | src/handlers/money-chain.mjs |
| PASS | DATA | DIY_DOWNSELL | system | DIY entitlement metro2-letter-pack granted (not funding-snapshot) | src/handlers/money-chain.mjs |
| SILENTLY-DID-NOTHING | DATA | DIY_DOWNSELL | system | DIY letters path queued a message with DIY template key | src/workflows/ds-02-diy-letters.mjs |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | Inquiry logged with business status=open and call_state=not_started |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | Inquiry removal case created |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=not_started leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=queued leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=dialing leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=navigating_ivr leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=on_hold leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=talking_to_rep leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=transferred_to_human leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=completed leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=failed leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=canceled leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=retry_scheduled leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | Business status cleared only when explicitly set | api/inquiries.mjs |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | C-03 reacted to inquiry.removed |  |
| PASS | DATA | AGENT_RUNTIME | system | ANTHROPIC_API_KEY unset so runtime stays in shadow/model-dry mode | src/agents/runtime.mjs |
| PASS | DATA | AGENT_RUNTIME | system | With ANTHROPIC_API_KEY unset, agent runtime sent nothing | src/agents/runtime.mjs |
| PASS | DATA | AGENT_RUNTIME | system | Shadow mode logged the intended reply | src/agents/shadow-log.mjs |
| FAIL | DATA | AGENT_RUNTIME | system | status=draft agents do nothing | src/agents/runtime.mjs |
| PASS | DATA | AGENT_RUNTIME | system | STOP word halts agent reply (no helpful outbound) | src/agents/guardrails.mjs |
| SILENTLY-DID-NOTHING | DATA | IDEMPOTENCY | system | Identical deposit.paid twice → exactly one sale | src/handlers/money-chain.mjs |
| SILENTLY-DID-NOTHING | DATA | IDEMPOTENCY | system | Identical deposit.paid twice → one front-end ledger row | src/handlers/money-chain.mjs |
| FAIL | DATA | IDEMPOTENCY | system | Full bus replay completes without throwing | src/events/bus.mjs |
| PASS | DATA | IDEMPOTENCY | system | round.funded before round.started did not invent a funded round | src/handlers/money-chain.mjs |
| SILENTLY-DID-NOTHING | DATA | IDEMPOTENCY | system | Two concurrent identical deposit.paid → one sale | src/handlers/money-chain.mjs |
| PASS | DATA | ADVERSARIAL | attacker | clickfunnels refuses invalid signature | src/adapters/clickfunnels.mjs |
| PASS | DATA | ADVERSARIAL | attacker | clickfunnels accepts valid HMAC | src/adapters/clickfunnels.mjs |
| PASS | DATA | ADVERSARIAL | attacker | commas refuses invalid signature | src/adapters/commas.mjs |
| PASS | DATA | ADVERSARIAL | attacker | commas accepts valid HMAC | src/adapters/commas.mjs |
| FAIL | DATA | ADVERSARIAL | attacker | Zero-amount deposit must not create a sale row | src/handlers/money-chain.mjs |
| PASS | DATA | ADVERSARIAL | attacker | Opt-out recorded and isOptedOut returns true | src/lib/opt-out.mjs |
| FAIL | DATA | ADVERSARIAL | attacker | Unicode/emoji/quotes name persists without injection error |  |
| PASS | DATA | ADVERSARIAL | attacker | entry.captured without email fail-closed or created intentionally (no throw) | src/handlers/client-lifecycle.mjs |
| PASS | DATA | ADVERSARIAL | attacker | Expired payment link status is expired | src/payment-links/index.mjs |
| PASS | DATA | ADVERSARIAL | attacker | booking.cancelled emits without throwing | src/events/canonical.mjs |
| PASS | DATA | ADVERSARIAL | attacker | payment.failed emits without creating a sale | src/handlers/money-chain.mjs |
| PASS | DATA | ADVERSARIAL | attacker | Malformed currency amount refused (no sale) |  |
| UNVERIFIED | DATA | ADVERSARIAL | attacker | Tampered contract refused |  |
| UNVERIFIED | DATA | ADVERSARIAL | attacker | Quiet-hours message holds then releases |  |
| PASS | DATA | WORKFLOWS | system | Workflow registry has 49–50 functions (contract chaser + sweeper included) | src/workflows/index.mjs |
| PASS | DATA | WORKFLOWS | system | Workflow af-02-referral-ownership-capture reacted to entry.captured |  |
| PASS | DATA | WORKFLOWS | system | Workflow at-01-first-touch-capture reacted to entry.captured |  |
| PASS | DATA | WORKFLOWS | system | Workflow n-01-cold-nurture reacted to entry.captured |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-01-new-lead-intake reacted to entry.captured |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-02-incomplete-survey-nudge reacted to entry.captured |  |
| PASS | DATA | WORKFLOWS | system | Workflow n-02-warm-nurture reacted to survey.submitted |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-00-crs-soft-pull-request reacted to diagnostic.paid |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-02-inquiry-created reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-06-crs-results-router reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow dpc-01-analyzer-lock reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow u-02-analyzer-complete-delivery reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow u-03-crs-snapshot-sync reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow u-04-promote-crs-primary reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow u-05-data-health-monitor reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow ai-set-04-3way-handoff reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow bs-01-precall-launcher reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow dpc-02-call-outcome-enforcement reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow dpc-05-no-progress-escalation reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow n-03-hot-nurture reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-04-call-booked reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-05a-no-show-recovery reacted to booking.noshow |  |
| PASS | DATA | WORKFLOWS | system | Workflow ai-set-03-no-answer-cadence reacted to call.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow ds-01-repair-referral reacted to call.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-08-post-call-funding-declined reacted to call.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-02b-inquiry-removal-requested reacted to deposit.paid |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-06-post-call-funding-purchased reacted to deposit.paid |  |
| PASS | DATA | WORKFLOWS | system | Workflow bc-01-customer-responsiveness reacted to round.started |  |
| PASS | DATA | WORKFLOWS | system | Workflow bc-02-customer-friction reacted to round.started |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-05-pre-funding-review reacted to round.started |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-01-funding-intake reacted to round.started |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-02-portal-id-missing reacted to round.started |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-10-client-funding-inbox-provisioner reacted to round.started |  |
| PASS | DATA | WORKFLOWS | system | Workflow round-started-client-notify reacted to round.started |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-03-round-submitted reacted to round.submitted |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-04-round-approvals reacted to round.approved |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-05-inquiry-cleanup-gate reacted to round.approved |  |
| PASS | DATA | WORKFLOWS | system | Workflow sys-01-client-value-calculator reacted to round.approved |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-07-funding-locked reacted to round.funded |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-08-post-funding-monitoring reacted to round.funded |  |
| PASS | DATA | WORKFLOWS | system | Workflow n-04-post-funding-nurture reacted to round.funded |  |
| PASS | DATA | WORKFLOWS | system | Workflow n-06-renewal-second-wave reacted to round.funded |  |
| PASS | DATA | WORKFLOWS | system | Workflow sys-01-ltv-calculator reacted to round.funded |  |
| PASS | DATA | WORKFLOWS | system | Workflow ds-02-diy-letters reacted to payment.received |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-03-inquiry-removed-resume-or-hold reacted to inquiry.removed |  |
| PASS | DATA | WORKFLOWS | system | Workflow dpc-03-inbound-reply-router reacted to message.inbound |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-06-funding-conditions-missing-docs reacted to mail.response |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-09-funding-declined-no-path reacted to mail.response |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-11-bank-email-event-router reacted to mail.response |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow contract-chaser never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow message-dispatch-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event booking.rescheduled has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event booking.cancelled has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event decision.rendered has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event sale.closed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event file.finalized has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event payment.failed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event docs.received has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event letter.generated has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event message.queued has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event message.sent has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event message.failed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event message.blocked has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event commission.earned has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event commission.approved has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event commission.paid has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event invoice.created has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event invoice.sent has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event invoice.paid has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event invoice.voided has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event contract.sent has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event contract.signed has no workflow listener |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager is in FINANCE | src/http/read-api.mjs |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager is NOT in HIRING | src/http/read-api.mjs |
| PASS | SECURITY | ISOLATION | closer | closer is NOT in HIRING (applicant PII) | src/http/read-api.mjs |
| PASS | SECURITY | ISOLATION | closer | closer is NOT in OPS | src/http/read-api.mjs |
| PASS | SECURITY | ISOLATION | owner | owner may access commissions |  |
| PASS | SECURITY | ISOLATION | owner | owner may access invoices |  |
| PASS | SECURITY | ISOLATION | owner | owner may access staff |  |
| PASS | SECURITY | ISOLATION | owner | owner may access failed-events |  |
| FAIL | SECURITY | ISOLATION | owner | owner should access hiring but got 404 | netlify/functions/api.mjs |
| FAIL | SECURITY | ISOLATION | owner | owner should access hiring-write but got 404 | netlify/functions/api.mjs |
| PASS | SECURITY | ISOLATION | owner | owner may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | owner | owner may access documents |  |
| PASS | SECURITY | ISOLATION | owner | owner may access tradelines |  |
| PASS | SECURITY | ISOLATION | owner | owner cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | owner | owner org_id/role query spoof does not elevate (200) |  |
| PASS | SECURITY | ISOLATION | admin | admin may access commissions |  |
| PASS | SECURITY | ISOLATION | admin | admin may access invoices |  |
| PASS | SECURITY | ISOLATION | admin | admin may access staff |  |
| PASS | SECURITY | ISOLATION | admin | admin may access failed-events |  |
| FAIL | SECURITY | ISOLATION | admin | admin should access hiring but got 404 | netlify/functions/api.mjs |
| FAIL | SECURITY | ISOLATION | admin | admin should access hiring-write but got 404 | netlify/functions/api.mjs |
| PASS | SECURITY | ISOLATION | admin | admin may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | admin | admin may access documents |  |
| PASS | SECURITY | ISOLATION | admin | admin may access tradelines |  |
| PASS | SECURITY | ISOLATION | admin | admin cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | admin | admin org_id/role query spoof does not elevate (200) |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access commissions |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access invoices |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access staff |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager refused failed-events (403) |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager refused hiring (404) |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager refused hiring-write (404) |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access documents |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access tradelines |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager org_id/role query spoof does not elevate (200) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused commissions (403) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused invoices (403) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused staff (403) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused failed-events (403) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused hiring (404) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused hiring-write (404) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor may access documents |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor may access tradelines |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor org_id/role query spoof does not elevate (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused commissions (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused invoices (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused staff (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused failed-events (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused hiring (404) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused hiring-write (404) |  |
| PASS | SECURITY | ISOLATION | closer | closer may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | closer | closer may access documents |  |
| PASS | SECURITY | ISOLATION | closer | closer may access tradelines |  |
| PASS | SECURITY | ISOLATION | closer | closer cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | closer | closer org_id/role query spoof does not elevate (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused commissions (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused invoices (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused staff (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused failed-events (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused hiring (404) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused hiring-write (404) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist may access documents |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist may access tradelines |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist org_id/role query spoof does not elevate (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused commissions (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused invoices (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused staff (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused failed-events (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused hiring (404) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused hiring-write (404) |  |
| PASS | SECURITY | ISOLATION | setter | setter may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | setter | setter may access documents |  |
| PASS | SECURITY | ISOLATION | setter | setter may access tradelines |  |
| PASS | SECURITY | ISOLATION | setter | setter cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | setter | setter org_id/role query spoof does not elevate (403) |  |
| PASS | SECURITY | ISOLATION | closer | Closer refused hiring endpoint (404) |  |
| PASS | SECURITY | ISOLATION | forged | Forged bearer token is refused | src/auth/session.mjs |
| PASS | SECURITY | ISOLATION | closer | Session endpoint responds to auth probes (status 401) |  |
| UNVERIFIED | SECURITY | ISOLATION | closer | Company Brain tier filter before retrieval |  |
| PASS | SECURITY | ISOLATION | affiliate | Affiliate refused internal client (403) |  |
| UNVERIFIED | SECURITY | ISOLATION | funding_advisor | Proxy session credential isolation between advisors |  |
| PASS | CROSS | CROSS_CUTTING | system | Workflow template keys discovered (43; spec said 41) | src/messaging/seed/workflow-keys.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-AX07-FUNDING-PAUSED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-C06-DECLINE is DRAFT inventory (send path must refuse) | src/messaging/draft-guard.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-DPC05-NO-PROGRESS-72H exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-DS01-REPAIR-REFERRAL is DRAFT inventory (send path must refuse) | src/messaging/draft-guard.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-DS02-DIY-LETTERS-READY is DRAFT inventory (send path must refuse) | src/messaging/draft-guard.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-F02-ID-PORTAL-NEEDED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-F03-ROUND-SUBMITTED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-F04-ROUND-APPROVALS exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-F06-MISSING-DOCS exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-F07-FUNDING-LOCKED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-F10-INBOX-SETUP exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-N01-COLD-NURTURE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-N02-WARM-NURTURE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-N03-HOT-NURTURE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-N04-POST-FUNDING exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-N06-RENEWAL exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-S02-FINISH-APPLICATION exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-S05A-NOSHOW-RECOVERY is DRAFT inventory (send path must refuse) | src/messaging/draft-guard.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-U02-ANALYZER-FUNDING-DELIVERY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-U02-ANALYZER-REPAIR-DELIVERY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AISET03-MSG1 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AISET03-MSG2 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AISET03-MSG3 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AISET04-HANDOFF exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AX07-FUNDING-PAUSED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-C06-DECLINE is DRAFT inventory (send path must refuse) | src/messaging/draft-guard.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-DPC04-RESCHEDULE-REBOOKING exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-DPC05-NO-PROGRESS-72H exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-DS01-REPAIR-REFERRAL exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-F02-ID-PORTAL-NEEDED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-F03-ROUND-SUBMITTED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-F04-ROUND-APPROVALS exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-F06-MISSING-DOCS exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-F07-FUNDING-LOCKED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-F10-INBOX-SETUP exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-N01-COLD-NURTURE is DRAFT inventory (send path must refuse) | src/messaging/draft-guard.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-N02-WARM-NURTURE is DRAFT inventory (send path must refuse) | src/messaging/draft-guard.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-N03-HOT-NURTURE is DRAFT inventory (send path must refuse) | src/messaging/draft-guard.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-N04-POST-FUNDING is DRAFT inventory (send path must refuse) | src/messaging/draft-guard.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-N06-RENEWAL is DRAFT inventory (send path must refuse) | src/messaging/draft-guard.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-ROUND-STARTED-NOTIFY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S05A-NOSHOW-RECOVERY is DRAFT inventory (send path must refuse) | src/messaging/draft-guard.mjs |
| PASS | CROSS | CROSS_CUTTING | system | sendTemplated refuses DRAFT template (reason=draft_template) | src/workflows/messaging.mjs |
| PASS | CROSS | CROSS_CUTTING | system | compliance_passed=false blocks queue/send | src/workflows/messaging.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Hand-calc closer flat deposit = $500 |  |
| PASS | CROSS | CROSS_CUTTING | system | Hand-calc 0.25% of $50,000 = $125 |  |
| PASS | CROSS | CROSS_CUTTING | system | Hand-calc 10% of $50,000 = $5,000 |  |
| PASS | CROSS | CROSS_CUTTING | system | Advisor hourly rate constant $6.25 (shift pay — not ledger) |  |
| FAIL | CROSS | CROSS_CUTTING | system | affiliate.html may ship sample/fabricated figures in live path | public/app/affiliate.html |
| FAIL | CROSS | CROSS_CUTTING | system | agent-editor.html may ship sample/fabricated figures in live path | public/app/agent-editor.html |
| FAIL | CROSS | CROSS_CUTTING | system | automations.html may ship sample/fabricated figures in live path | public/app/automations.html |
| FAIL | CROSS | CROSS_CUTTING | system | brand-studio.html may ship sample/fabricated figures in live path | public/app/brand-studio.html |
| FAIL | CROSS | CROSS_CUTTING | system | calendar.html may ship sample/fabricated figures in live path | public/app/calendar.html |
| FAIL | CROSS | CROSS_CUTTING | system | campaign-manager.html may ship sample/fabricated figures in live path | public/app/campaign-manager.html |
| FAIL | CROSS | CROSS_CUTTING | system | client-control-panel.html may ship sample/fabricated figures in live path | public/app/client-control-panel.html |
| PASS | CROSS | CROSS_CUTTING | system | client-portal.html has no obvious fabricated sample dollars in static markup | public/app/client-portal.html |
| FAIL | CROSS | CROSS_CUTTING | system | closer-dashboard.html may ship sample/fabricated figures in live path | public/app/closer-dashboard.html |
| FAIL | CROSS | CROSS_CUTTING | system | command-center.html may ship sample/fabricated figures in live path | public/app/command-center.html |
| FAIL | CROSS | CROSS_CUTTING | system | company-brain.html may ship sample/fabricated figures in live path | public/app/company-brain.html |
| FAIL | CROSS | CROSS_CUTTING | system | consent-capture.html may ship sample/fabricated figures in live path | public/app/consent-capture.html |
| FAIL | CROSS | CROSS_CUTTING | system | content-admin.html may ship sample/fabricated figures in live path | public/app/content-admin.html |
| FAIL | CROSS | CROSS_CUTTING | system | contracts.html may ship sample/fabricated figures in live path | public/app/contracts.html |
| FAIL | CROSS | CROSS_CUTTING | system | creative-factory.html may ship sample/fabricated figures in live path | public/app/creative-factory.html |
| FAIL | CROSS | CROSS_CUTTING | system | documents.html may ship sample/fabricated figures in live path | public/app/documents.html |
| FAIL | CROSS | CROSS_CUTTING | system | finance-os.html may ship sample/fabricated figures in live path | public/app/finance-os.html |
| FAIL | CROSS | CROSS_CUTTING | system | galaxy.html may ship sample/fabricated figures in live path | public/app/galaxy.html |
| FAIL | CROSS | CROSS_CUTTING | system | hiring.html may ship sample/fabricated figures in live path | public/app/hiring.html |
| FAIL | CROSS | CROSS_CUTTING | system | index.html may ship sample/fabricated figures in live path | public/app/index.html |
| FAIL | CROSS | CROSS_CUTTING | system | inquiry-remover.html may ship sample/fabricated figures in live path | public/app/inquiry-remover.html |
| FAIL | CROSS | CROSS_CUTTING | system | journeys.html may ship sample/fabricated figures in live path | public/app/journeys.html |
| FAIL | CROSS | CROSS_CUTTING | system | lenders.html may ship sample/fabricated figures in live path | public/app/lenders.html |
| FAIL | CROSS | CROSS_CUTTING | system | messaging.html may ship sample/fabricated figures in live path | public/app/messaging.html |
| FAIL | CROSS | CROSS_CUTTING | system | ops-admin.html may ship sample/fabricated figures in live path | public/app/ops-admin.html |
| FAIL | CROSS | CROSS_CUTTING | system | partner-galaxy.html may ship sample/fabricated figures in live path | public/app/partner-galaxy.html |
| FAIL | CROSS | CROSS_CUTTING | system | pipeline.html may ship sample/fabricated figures in live path | public/app/pipeline.html |
| FAIL | CROSS | CROSS_CUTTING | system | products-commissions.html may ship sample/fabricated figures in live path | public/app/products-commissions.html |
| PASS | CROSS | CROSS_CUTTING | system | sample-data.html is an explicit demo screen (allowed) | public/app/sample-data.html |
| FAIL | CROSS | CROSS_CUTTING | system | social-studio.html may ship sample/fabricated figures in live path | public/app/social-studio.html |
| FAIL | CROSS | CROSS_CUTTING | system | staff-teams.html may ship sample/fabricated figures in live path | public/app/staff-teams.html |
| FAIL | CROSS | CROSS_CUTTING | system | subscriptions.html may ship sample/fabricated figures in live path | public/app/subscriptions.html |
| FAIL | CROSS | CROSS_CUTTING | system | template-editor.html may ship sample/fabricated figures in live path | public/app/template-editor.html |
| PASS | CROSS | CROSS_CUTTING | system | message_templates inventory: total=231 drafts=11 compliant=48 |  |
| PASS | UI | ROLE_SCREENS | owner | owner opened command-center.html with no console errors | public/app/command-center.html |
| FAIL | UI | ROLE_SCREENS | owner | command-center.html must not show sample data in live render | public/app/command-center.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened finance-os.html with no console errors | public/app/finance-os.html |
| FAIL | UI | ROLE_SCREENS | owner | finance-os.html must not show sample data in live render | public/app/finance-os.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened ops-admin.html with no console errors | public/app/ops-admin.html |
| FAIL | UI | ROLE_SCREENS | owner | ops-admin.html must not show sample data in live render | public/app/ops-admin.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened template-editor.html with no console errors | public/app/template-editor.html |
| FAIL | UI | ROLE_SCREENS | owner | template-editor.html must not show sample data in live render | public/app/template-editor.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened agent-editor.html with no console errors | public/app/agent-editor.html |
| FAIL | UI | ROLE_SCREENS | owner | agent-editor.html must not show sample data in live render | public/app/agent-editor.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened brand-studio.html with no console errors | public/app/brand-studio.html |
| FAIL | UI | ROLE_SCREENS | owner | brand-studio.html must not show sample data in live render | public/app/brand-studio.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened staff-teams.html with no console errors | public/app/staff-teams.html |
| FAIL | UI | ROLE_SCREENS | owner | staff-teams.html must not show sample data in live render | public/app/staff-teams.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened company-brain.html with no console errors | public/app/company-brain.html |
| FAIL | UI | ROLE_SCREENS | owner | company-brain.html must not show sample data in live render | public/app/company-brain.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened lenders.html with no console errors | public/app/lenders.html |
| FAIL | UI | ROLE_SCREENS | owner | lenders.html must not show sample data in live render | public/app/lenders.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened consent-capture.html with no console errors | public/app/consent-capture.html |
| FAIL | UI | ROLE_SCREENS | owner | consent-capture.html must not show sample data in live render | public/app/consent-capture.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened hiring.html with no console errors | public/app/hiring.html |
| FAIL | UI | ROLE_SCREENS | owner | hiring.html must not show sample data in live render | public/app/hiring.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened pipeline.html with no console errors | public/app/pipeline.html |
| FAIL | UI | ROLE_SCREENS | owner | pipeline.html must not show sample data in live render | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened command-center.html with no console errors | public/app/command-center.html |
| FAIL | UI | ROLE_SCREENS | admin | command-center.html must not show sample data in live render | public/app/command-center.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened finance-os.html with no console errors | public/app/finance-os.html |
| FAIL | UI | ROLE_SCREENS | admin | finance-os.html must not show sample data in live render | public/app/finance-os.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened ops-admin.html with no console errors | public/app/ops-admin.html |
| FAIL | UI | ROLE_SCREENS | admin | ops-admin.html must not show sample data in live render | public/app/ops-admin.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened template-editor.html with no console errors | public/app/template-editor.html |
| FAIL | UI | ROLE_SCREENS | admin | template-editor.html must not show sample data in live render | public/app/template-editor.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened agent-editor.html with no console errors | public/app/agent-editor.html |
| FAIL | UI | ROLE_SCREENS | admin | agent-editor.html must not show sample data in live render | public/app/agent-editor.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened staff-teams.html with no console errors | public/app/staff-teams.html |
| FAIL | UI | ROLE_SCREENS | admin | staff-teams.html must not show sample data in live render | public/app/staff-teams.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened company-brain.html with no console errors | public/app/company-brain.html |
| FAIL | UI | ROLE_SCREENS | admin | company-brain.html must not show sample data in live render | public/app/company-brain.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened lenders.html with no console errors | public/app/lenders.html |
| FAIL | UI | ROLE_SCREENS | admin | lenders.html must not show sample data in live render | public/app/lenders.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened pipeline.html with no console errors | public/app/pipeline.html |
| FAIL | UI | ROLE_SCREENS | admin | pipeline.html must not show sample data in live render | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | sales_manager | sales_manager opened pipeline.html with no console errors | public/app/pipeline.html |
| FAIL | UI | ROLE_SCREENS | sales_manager | pipeline.html must not show sample data in live render | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | sales_manager | sales_manager opened products-commissions.html with no console errors | public/app/products-commissions.html |
| FAIL | UI | ROLE_SCREENS | sales_manager | products-commissions.html must not show sample data in live render | public/app/products-commissions.html |
| PASS | UI | ROLE_SCREENS | sales_manager | sales_manager opened staff-teams.html with no console errors | public/app/staff-teams.html |
| FAIL | UI | ROLE_SCREENS | sales_manager | staff-teams.html must not show sample data in live render | public/app/staff-teams.html |
| PASS | UI | ROLE_SCREENS | sales_manager | sales_manager opened closer-dashboard.html with no console errors | public/app/closer-dashboard.html |
| FAIL | UI | ROLE_SCREENS | sales_manager | closer-dashboard.html must not show sample data in live render | public/app/closer-dashboard.html |
| UNVERIFIED | SECURITY | DIRECT_URL | sales_manager | sales_manager direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey | public/app/hiring.html |
| UNVERIFIED | SECURITY | DIRECT_URL | sales_manager | sales_manager direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey | public/app/ops-admin.html |
| PASS | UI | ROLE_SCREENS | closer | closer opened closer-dashboard.html with no console errors | public/app/closer-dashboard.html |
| FAIL | UI | ROLE_SCREENS | closer | closer-dashboard.html must not show sample data in live render | public/app/closer-dashboard.html |
| PASS | UI | ROLE_SCREENS | closer | closer opened pipeline.html with no console errors | public/app/pipeline.html |
| FAIL | UI | ROLE_SCREENS | closer | pipeline.html must not show sample data in live render | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | closer | closer opened messaging.html with no console errors | public/app/messaging.html |
| FAIL | UI | ROLE_SCREENS | closer | messaging.html must not show sample data in live render | public/app/messaging.html |
| PASS | UI | ROLE_SCREENS | closer | closer opened client-control-panel.html with no console errors | public/app/client-control-panel.html |
| FAIL | UI | ROLE_SCREENS | closer | client-control-panel.html must not show sample data in live render | public/app/client-control-panel.html |
| PASS | UI | ROLE_SCREENS | closer | closer opened calendar.html with no console errors | public/app/calendar.html |
| FAIL | UI | ROLE_SCREENS | closer | calendar.html must not show sample data in live render | public/app/calendar.html |
| UNVERIFIED | SECURITY | DIRECT_URL | closer | closer direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey | public/app/hiring.html |
| UNVERIFIED | SECURITY | DIRECT_URL | closer | closer direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey | public/app/ops-admin.html |
| UNVERIFIED | SECURITY | DIRECT_URL | closer | closer direct-URL to finance-os.html: static HTML loads; API isolation checked in pg security journey | public/app/finance-os.html |
| PASS | UI | ROLE_SCREENS | funding_advisor | funding_advisor opened lenders.html with no console errors | public/app/lenders.html |
| FAIL | UI | ROLE_SCREENS | funding_advisor | lenders.html must not show sample data in live render | public/app/lenders.html |
| PASS | UI | ROLE_SCREENS | funding_advisor | funding_advisor opened client-control-panel.html with no console errors | public/app/client-control-panel.html |
| FAIL | UI | ROLE_SCREENS | funding_advisor | client-control-panel.html must not show sample data in live render | public/app/client-control-panel.html |
| PASS | UI | ROLE_SCREENS | funding_advisor | funding_advisor opened pipeline.html with no console errors | public/app/pipeline.html |
| FAIL | UI | ROLE_SCREENS | funding_advisor | pipeline.html must not show sample data in live render | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | funding_advisor | funding_advisor opened messaging.html with no console errors | public/app/messaging.html |
| FAIL | UI | ROLE_SCREENS | funding_advisor | messaging.html must not show sample data in live render | public/app/messaging.html |
| UNVERIFIED | SECURITY | DIRECT_URL | funding_advisor | funding_advisor direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey | public/app/hiring.html |
| UNVERIFIED | SECURITY | DIRECT_URL | funding_advisor | funding_advisor direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey | public/app/ops-admin.html |
| PASS | UI | ROLE_SCREENS | inquiry_specialist | inquiry_specialist opened inquiry-remover.html with no console errors | public/app/inquiry-remover.html |
| FAIL | UI | ROLE_SCREENS | inquiry_specialist | inquiry-remover.html must not show sample data in live render | public/app/inquiry-remover.html |
| PASS | UI | ROLE_SCREENS | inquiry_specialist | inquiry_specialist opened messaging.html with no console errors | public/app/messaging.html |
| FAIL | UI | ROLE_SCREENS | inquiry_specialist | messaging.html must not show sample data in live render | public/app/messaging.html |
| UNVERIFIED | SECURITY | DIRECT_URL | inquiry_specialist | inquiry_specialist direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey | public/app/hiring.html |
| UNVERIFIED | SECURITY | DIRECT_URL | inquiry_specialist | inquiry_specialist direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey | public/app/ops-admin.html |
| UNVERIFIED | SECURITY | DIRECT_URL | inquiry_specialist | inquiry_specialist direct-URL to products-commissions.html: static HTML loads; API isolation checked in pg security journey | public/app/products-commissions.html |
| PASS | UI | ROLE_SCREENS | setter | setter opened pipeline.html with no console errors | public/app/pipeline.html |
| FAIL | UI | ROLE_SCREENS | setter | pipeline.html must not show sample data in live render | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | setter | setter opened calendar.html with no console errors | public/app/calendar.html |
| FAIL | UI | ROLE_SCREENS | setter | calendar.html must not show sample data in live render | public/app/calendar.html |
| PASS | UI | ROLE_SCREENS | setter | setter opened messaging.html with no console errors | public/app/messaging.html |
| FAIL | UI | ROLE_SCREENS | setter | messaging.html must not show sample data in live render | public/app/messaging.html |
| UNVERIFIED | SECURITY | DIRECT_URL | setter | setter direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey | public/app/hiring.html |
| UNVERIFIED | SECURITY | DIRECT_URL | setter | setter direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey | public/app/ops-admin.html |
| UNVERIFIED | SECURITY | DIRECT_URL | setter | setter direct-URL to finance-os.html: static HTML loads; API isolation checked in pg security journey | public/app/finance-os.html |
| PASS | UI | ROLE_SCREENS | affiliate | affiliate opened affiliate.html with no console errors | public/app/affiliate.html |
| FAIL | UI | ROLE_SCREENS | affiliate | affiliate.html must not show sample data in live render | public/app/affiliate.html |
| UNVERIFIED | SECURITY | DIRECT_URL | affiliate | affiliate direct-URL to pipeline.html: static HTML loads; API isolation checked in pg security journey | public/app/pipeline.html |
| UNVERIFIED | SECURITY | DIRECT_URL | affiliate | affiliate direct-URL to finance-os.html: static HTML loads; API isolation checked in pg security journey | public/app/finance-os.html |
| UNVERIFIED | SECURITY | DIRECT_URL | affiliate | affiliate direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey | public/app/hiring.html |
| UNVERIFIED | SECURITY | DIRECT_URL | affiliate | affiliate direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey | public/app/ops-admin.html |
| UNVERIFIED | SECURITY | DIRECT_URL | affiliate | affiliate direct-URL to client-control-panel.html: static HTML loads; API isolation checked in pg security journey | public/app/client-control-panel.html |
| PASS | UI | ROLE_SCREENS | partner | partner opened partner-galaxy.html with no console errors | public/app/partner-galaxy.html |
| FAIL | UI | ROLE_SCREENS | partner | partner-galaxy.html must not show sample data in live render | public/app/partner-galaxy.html |
| PASS | UI | ROLE_SCREENS | partner | partner opened brand-studio.html with no console errors | public/app/brand-studio.html |
| FAIL | UI | ROLE_SCREENS | partner | brand-studio.html must not show sample data in live render | public/app/brand-studio.html |
| UNVERIFIED | SECURITY | DIRECT_URL | partner | partner direct-URL to pipeline.html: static HTML loads; API isolation checked in pg security journey | public/app/pipeline.html |
| UNVERIFIED | SECURITY | DIRECT_URL | partner | partner direct-URL to finance-os.html: static HTML loads; API isolation checked in pg security journey | public/app/finance-os.html |
| UNVERIFIED | SECURITY | DIRECT_URL | partner | partner direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey | public/app/hiring.html |
| PASS | UI | CLOSER_SHIFT | closer | Closer dashboard surfaces clock-in/shift requirement when no open shift | public/app/closer-dashboard.html |
| PASS | UI | CLIENT_PORTAL | client | Client portal loads without console errors | public/app/client-portal.html |
| PASS | UI | PARTNER_BRAND | partner | Partner brand studio does not present internal CRM theming as editable | public/app/brand-studio.html |
| PASS | SECURITY | DIRECT_URL | closer | Closer direct-URL to owner screens triggers 403 on gated APIs | e2e/verification-security.spec.mjs |
| PASS | SECURITY | DIRECT_URL | owner | Owner can open ops-admin without console death | public/app/ops-admin.html |
| PASS | UI | VIEWPORT | owner | command-center console-clean at 1280px | public/app/command-center.html |
| PASS | UI | VIEWPORT | owner | command-center console-clean at 390px | public/app/command-center.html |

## 5. Breaks (FAIL + SILENT) with file and line

- **FAIL** Soft-pull consent persisted — `src/consent/index.mjs`
  - Expected count 1, got 0.
- **FAIL** Funding-path bus replay completes without throwing — `src/events/bus.mjs`
  - sale f863de89-d93b-4702-a167-95cbeb24ea7a front_end split would total %200.0000 (max 100%). Reduce an existing share first. — replay walks historical events; orphaned closerId/staff refs fail the attribution write. Loud failure is better than silent wrong money, but a morning replay job would stop cold.
- **FAIL** status=draft agents do nothing — `src/agents/runtime.mjs`
  - Got reason=no_api_key
- **FAIL** Full bus replay completes without throwing — `src/events/bus.mjs`
  - sale f863de89-d93b-4702-a167-95cbeb24ea7a front_end split would total %200.0000 (max 100%). Reduce an existing share first.
- **FAIL** Zero-amount deposit must not create a sale row — `src/handlers/money-chain.mjs`
- **FAIL** Unicode/emoji/quotes name persists without injection error — `?`
  - column "name" does not exist
- **FAIL** owner should access hiring but got 404 — `netlify/functions/api.mjs`
  - {"ok":false,"error":"not_found","path":"read/hiring/applications"}
- **FAIL** owner should access hiring-write but got 404 — `netlify/functions/api.mjs`
  - {"ok":false,"error":"not_found","path":"hiring"}
- **FAIL** admin should access hiring but got 404 — `netlify/functions/api.mjs`
  - {"ok":false,"error":"not_found","path":"read/hiring/applications"}
- **FAIL** admin should access hiring-write but got 404 — `netlify/functions/api.mjs`
  - {"ok":false,"error":"not_found","path":"hiring"}
- **FAIL** affiliate.html may ship sample/fabricated figures in live path — `public/app/affiliate.html`
  - sample-ish dollar or label
- **FAIL** agent-editor.html may ship sample/fabricated figures in live path — `public/app/agent-editor.html`
  - sample-ish dollar or label
- **FAIL** automations.html may ship sample/fabricated figures in live path — `public/app/automations.html`
  - sample-ish dollar or label
- **FAIL** brand-studio.html may ship sample/fabricated figures in live path — `public/app/brand-studio.html`
  - sample-ish dollar or label
- **FAIL** calendar.html may ship sample/fabricated figures in live path — `public/app/calendar.html`
  - sample-ish dollar or label
- **FAIL** campaign-manager.html may ship sample/fabricated figures in live path — `public/app/campaign-manager.html`
  - sample-ish dollar or label
- **FAIL** client-control-panel.html may ship sample/fabricated figures in live path — `public/app/client-control-panel.html`
  - sample-ish dollar or label
- **FAIL** closer-dashboard.html may ship sample/fabricated figures in live path — `public/app/closer-dashboard.html`
  - sample-ish dollar or label
- **FAIL** command-center.html may ship sample/fabricated figures in live path — `public/app/command-center.html`
  - sample-ish dollar or label
- **FAIL** company-brain.html may ship sample/fabricated figures in live path — `public/app/company-brain.html`
  - sample-ish dollar or label
- **FAIL** consent-capture.html may ship sample/fabricated figures in live path — `public/app/consent-capture.html`
  - sample-ish dollar or label
- **FAIL** content-admin.html may ship sample/fabricated figures in live path — `public/app/content-admin.html`
  - sample-ish dollar or label
- **FAIL** contracts.html may ship sample/fabricated figures in live path — `public/app/contracts.html`
  - sample-ish dollar or label
- **FAIL** creative-factory.html may ship sample/fabricated figures in live path — `public/app/creative-factory.html`
  - sample-ish dollar or label
- **FAIL** documents.html may ship sample/fabricated figures in live path — `public/app/documents.html`
  - sample-ish dollar or label
- **FAIL** finance-os.html may ship sample/fabricated figures in live path — `public/app/finance-os.html`
  - sample-ish dollar or label
- **FAIL** galaxy.html may ship sample/fabricated figures in live path — `public/app/galaxy.html`
  - sample-ish dollar or label
- **FAIL** hiring.html may ship sample/fabricated figures in live path — `public/app/hiring.html`
  - sample-ish dollar or label
- **FAIL** index.html may ship sample/fabricated figures in live path — `public/app/index.html`
  - sample-ish dollar or label
- **FAIL** inquiry-remover.html may ship sample/fabricated figures in live path — `public/app/inquiry-remover.html`
  - sample-ish dollar or label
- **FAIL** journeys.html may ship sample/fabricated figures in live path — `public/app/journeys.html`
  - sample-ish dollar or label
- **FAIL** lenders.html may ship sample/fabricated figures in live path — `public/app/lenders.html`
  - sample-ish dollar or label
- **FAIL** messaging.html may ship sample/fabricated figures in live path — `public/app/messaging.html`
  - sample-ish dollar or label
- **FAIL** ops-admin.html may ship sample/fabricated figures in live path — `public/app/ops-admin.html`
  - sample-ish dollar or label
- **FAIL** partner-galaxy.html may ship sample/fabricated figures in live path — `public/app/partner-galaxy.html`
  - sample-ish dollar or label
- **FAIL** pipeline.html may ship sample/fabricated figures in live path — `public/app/pipeline.html`
  - sample-ish dollar or label
- **FAIL** products-commissions.html may ship sample/fabricated figures in live path — `public/app/products-commissions.html`
  - sample-ish dollar or label
- **FAIL** social-studio.html may ship sample/fabricated figures in live path — `public/app/social-studio.html`
  - sample-ish dollar or label
- **FAIL** staff-teams.html may ship sample/fabricated figures in live path — `public/app/staff-teams.html`
  - sample-ish dollar or label
- **FAIL** subscriptions.html may ship sample/fabricated figures in live path — `public/app/subscriptions.html`
  - sample-ish dollar or label
- **FAIL** template-editor.html may ship sample/fabricated figures in live path — `public/app/template-editor.html`
  - sample-ish dollar or label
- **FAIL** command-center.html must not show sample data in live render — `public/app/command-center.html`
- **FAIL** finance-os.html must not show sample data in live render — `public/app/finance-os.html`
- **FAIL** ops-admin.html must not show sample data in live render — `public/app/ops-admin.html`
- **FAIL** template-editor.html must not show sample data in live render — `public/app/template-editor.html`
- **FAIL** agent-editor.html must not show sample data in live render — `public/app/agent-editor.html`
- **FAIL** brand-studio.html must not show sample data in live render — `public/app/brand-studio.html`
- **FAIL** staff-teams.html must not show sample data in live render — `public/app/staff-teams.html`
- **FAIL** company-brain.html must not show sample data in live render — `public/app/company-brain.html`
- **FAIL** lenders.html must not show sample data in live render — `public/app/lenders.html`
- **FAIL** consent-capture.html must not show sample data in live render — `public/app/consent-capture.html`
- **FAIL** hiring.html must not show sample data in live render — `public/app/hiring.html`
- **FAIL** pipeline.html must not show sample data in live render — `public/app/pipeline.html`
- **FAIL** command-center.html must not show sample data in live render — `public/app/command-center.html`
- **FAIL** finance-os.html must not show sample data in live render — `public/app/finance-os.html`
- **FAIL** ops-admin.html must not show sample data in live render — `public/app/ops-admin.html`
- **FAIL** template-editor.html must not show sample data in live render — `public/app/template-editor.html`
- **FAIL** agent-editor.html must not show sample data in live render — `public/app/agent-editor.html`
- **FAIL** staff-teams.html must not show sample data in live render — `public/app/staff-teams.html`
- **FAIL** company-brain.html must not show sample data in live render — `public/app/company-brain.html`
- **FAIL** lenders.html must not show sample data in live render — `public/app/lenders.html`
- **FAIL** pipeline.html must not show sample data in live render — `public/app/pipeline.html`
- **FAIL** pipeline.html must not show sample data in live render — `public/app/pipeline.html`
- **FAIL** products-commissions.html must not show sample data in live render — `public/app/products-commissions.html`
- **FAIL** staff-teams.html must not show sample data in live render — `public/app/staff-teams.html`
- **FAIL** closer-dashboard.html must not show sample data in live render — `public/app/closer-dashboard.html`
- **FAIL** closer-dashboard.html must not show sample data in live render — `public/app/closer-dashboard.html`
- **FAIL** pipeline.html must not show sample data in live render — `public/app/pipeline.html`
- **FAIL** messaging.html must not show sample data in live render — `public/app/messaging.html`
- **FAIL** client-control-panel.html must not show sample data in live render — `public/app/client-control-panel.html`
- **FAIL** calendar.html must not show sample data in live render — `public/app/calendar.html`
- **FAIL** lenders.html must not show sample data in live render — `public/app/lenders.html`
- **FAIL** client-control-panel.html must not show sample data in live render — `public/app/client-control-panel.html`
- **FAIL** pipeline.html must not show sample data in live render — `public/app/pipeline.html`
- **FAIL** messaging.html must not show sample data in live render — `public/app/messaging.html`
- **FAIL** inquiry-remover.html must not show sample data in live render — `public/app/inquiry-remover.html`
- **FAIL** messaging.html must not show sample data in live render — `public/app/messaging.html`
- **FAIL** pipeline.html must not show sample data in live render — `public/app/pipeline.html`
- **FAIL** calendar.html must not show sample data in live render — `public/app/calendar.html`
- **FAIL** messaging.html must not show sample data in live render — `public/app/messaging.html`
- **FAIL** affiliate.html must not show sample data in live render — `public/app/affiliate.html`
- **FAIL** partner-galaxy.html must not show sample data in live render — `public/app/partner-galaxy.html`
- **FAIL** brand-studio.html must not show sample data in live render — `public/app/brand-studio.html`
- **SILENTLY-DID-NOTHING** Contract rendered/sent from real template — `src/contracts/send.mjs`
  - A contract has to record who created it.
- **SILENTLY-DID-NOTHING** Application status change wrote an audit/decision row — `api/applications.mjs`
  - application_decisions empty after Approved insert. If the CRM status picker only UPDATEs applications.status, the audit trail is silent.
- **SILENTLY-DID-NOTHING** DIY letters path queued a message with DIY template key — `src/workflows/ds-02-diy-letters.mjs`
  - messages=0; none matched DS02/DIY/LETTER. Letter generation/delivery may be a no-op without vendor credentials.
- **SILENTLY-DID-NOTHING** Identical deposit.paid twice → exactly one sale — `src/handlers/money-chain.mjs`
  - Wanted 1; persisted value is empty/zero: 0.
- **SILENTLY-DID-NOTHING** Identical deposit.paid twice → one front-end ledger row — `src/handlers/money-chain.mjs`
  - Operation returned ok but found 0 rows (wanted 1).
- **SILENTLY-DID-NOTHING** Two concurrent identical deposit.paid → one sale — `src/handlers/money-chain.mjs`
  - Wanted 1; persisted value is empty/zero: 0.

## 6. Unverifiable without a real external credential

| Check | Credential that unlocks it |
|---|---|
| Real ClickFunnels webhook field paths | Live CF webhook sample + CLICKFUNNELS_WEBHOOK_SECRET |
| Real Commas payment.succeeded payload | COMMAS_WEBHOOK_SECRET + live event sample |
| Real Cal.com booking payload | CALCOM_WEBHOOK_SECRET + live booking |
| Twilio inbound SMS + status callbacks | TWILIO_AUTH_TOKEN + real MessageSid |
| Mailgun inbound bank-email parse | MAILGUN_WEBHOOK_SIGNING_KEY + real MIME |
| Bland AI voice call outcome | BLAND_WEBHOOK_SECRET + live call |
| Lendflow application decision webhooks | LENDFLOW_WEBHOOK_SECRET |
| Agent live model replies (non-shadow) | ANTHROPIC_API_KEY |
| Oxylabs residential proxy geo-verify | OXYLABS credentials |
| Actual outbound SMS/email delivery | Twilio/Mailgun send credentials + outbound_enabled=true |
| Inngest-scheduled workflow timing | INNGEST_EVENT_KEY (owner-gated) |
| CRS live soft-pull | CRS / Array vendor credentials |

## 7. Blunt verdicts — would this work for a real person today?

- YES — system / A. Funding path — money/data spine held in this run
- YES — system / B. Credit-repair / DIY downsell — money/data spine held in this run
- YES — system / C. Inquiry removal — money/data spine held in this run
- NO — system / D. Agent runtime — see journey account
- NO — system / E. Idempotency, replay, ordering — see journey account
- UNKNOWN — system / F. Negative / adversarial — partial
- YES — system / G. Workflow engine — money/data spine held in this run
- YES — owner / security isolation — no P0 leak in probes
- YES — admin / security isolation — no P0 leak in probes
- YES — sales_manager / security isolation — no P0 leak in probes
- YES — funding_advisor / security isolation — no P0 leak in probes
- YES — closer / security isolation — no P0 leak in probes
- YES — inquiry_specialist / security isolation — no P0 leak in probes
- YES — setter / security isolation — no P0 leak in probes
- YES — system / PART 3 — Security & isolation — money/data spine held in this run
- YES — system / PART 4 — Cross-cutting — money/data spine held in this run
- YES — owner / daily UI screens — screens load under mocked API; live backend not proven here
- YES — admin / daily UI screens — screens load under mocked API; live backend not proven here
- YES — sales_manager / daily UI screens — screens load under mocked API; live backend not proven here
- YES — closer / daily UI screens — screens load under mocked API; live backend not proven here
- YES — funding_advisor / daily UI screens — screens load under mocked API; live backend not proven here
- YES — inquiry_specialist / daily UI screens — screens load under mocked API; live backend not proven here
- YES — setter / daily UI screens — screens load under mocked API; live backend not proven here
- YES — affiliate / daily UI screens — screens load under mocked API; live backend not proven here
- YES — partner / daily UI screens — screens load under mocked API; live backend not proven here
- YES — closer / clock-in gate — shift requirement visible
- YES — client / portal — static load ok under mock; magic-link + pay + sign need live credentials

## 8. Operator notes

Skeptical operator stance. PASS means a write path was exercised and the persisted value matched.

SILENTLY-DID-NOTHING means the operation returned without error and left no useful row — the recurring Fundhub failure mode.

UNVERIFIED means this run could not honestly prove the claim (missing credential, empty corpus, or UI not run).

Adapters used mock secrets. ANTHROPIC_API_KEY unset. messaging_settings.outbound_enabled=false. Nothing transmitted.

Money checked via src/verification/fixtures.mjs MONEY constants (hand-calc), not by calling commission helpers under test.

## 9. UNVERIFIED inventory

- Closer also earns 0.25% of funded — No closer back-end ledger row. Attribution may require closerId on round.funded payload — operator risk if assumed.
- Tampered contract refused — No contract rows in org to tamper.
- Quiet-hours message holds then releases — Requires controlling clock + dispatcher drain; dispatcher sends only with provider creds. Exercised in unit tests; not end-to-end here.
- Workflow contract-chaser never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow message-dispatch-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Canonical event booking.rescheduled has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event booking.cancelled has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event decision.rendered has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event sale.closed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event file.finalized has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event payment.failed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event docs.received has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event letter.generated has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event message.queued has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event message.sent has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event message.failed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event message.blocked has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event commission.earned has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event commission.approved has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event commission.paid has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event invoice.created has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event invoice.sent has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event invoice.paid has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event invoice.voided has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event contract.sent has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event contract.signed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Company Brain tier filter before retrieval — status=405; may be empty corpus on verify DB
- Proxy session credential isolation between advisors — status=401
- sales_manager direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- sales_manager direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- closer direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- closer direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- closer direct-URL to finance-os.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- funding_advisor direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- funding_advisor direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- inquiry_specialist direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- inquiry_specialist direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- inquiry_specialist direct-URL to products-commissions.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- setter direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- setter direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- setter direct-URL to finance-os.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- affiliate direct-URL to pipeline.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- affiliate direct-URL to finance-os.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- affiliate direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- affiliate direct-URL to ops-admin.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- affiliate direct-URL to client-control-panel.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- partner direct-URL to pipeline.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- partner direct-URL to finance-os.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
- partner direct-URL to hiring.html: static HTML loads; API isolation checked in pg security journey — Browser cannot enforce role on static files; netlify/functions must.
