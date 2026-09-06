# End-to-End Verification Report

Generated: 2026-08-22T20:31:59.464Z
Run id: verify-1787430715910
Node: v22.21.1
DATABASE_URL: 127.0.0.1/fundhub_e2e_scratch
Stance: skeptical operator / business architect. Prefer SILENTLY-DID-NOTHING and UNVERIFIED over a false pass.

## Operator headline

**Not ready for real money.** No confirmed P0 isolation leak in this run, but 44 FAIL and 2 silent no-ops remain.

Re-run: `DATABASE_URL=... npm run verify:e2e` (Playwright UI + data-layer). Data only: `node src/verification/run-all.mjs`.

## Tallies

| Status | Count |
|---|---:|
| PASS | 368 |
| FAIL | 44 |
| SILENTLY-DID-NOTHING | 2 |
| UNVERIFIED | 60 |
| SKIP | 0 |
| **Total** | **474** |
| P0 non-passes | 0 |

## 1. SECURITY (read this first)

No P0 isolation failures recorded in this run. That is not a claim that none exist — only that the attempts below did not succeed.

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
| PASS | owner | owner may access hiring |  |  |
| PASS | owner | owner may access hiring-write |  |  |
| PASS | owner | owner may access client-dashboard |  |  |
| PASS | owner | owner may access documents |  |  |
| PASS | owner | owner may access tradelines |  |  |
| PASS | owner | owner cannot read other org client (404) |  |  |
| PASS | owner | owner org_id/role query spoof does not elevate (200) |  |  |
| PASS | admin | admin may access commissions |  |  |
| PASS | admin | admin may access invoices |  |  |
| PASS | admin | admin may access staff |  |  |
| PASS | admin | admin may access failed-events |  |  |
| PASS | admin | admin may access hiring |  |  |
| PASS | admin | admin may access hiring-write |  |  |
| PASS | admin | admin may access client-dashboard |  |  |
| PASS | admin | admin may access documents |  |  |
| PASS | admin | admin may access tradelines |  |  |
| PASS | admin | admin cannot read other org client (404) |  |  |
| PASS | admin | admin org_id/role query spoof does not elevate (200) |  |  |
| PASS | sales_manager | sales_manager may access commissions |  |  |
| PASS | sales_manager | sales_manager may access invoices |  |  |
| PASS | sales_manager | sales_manager may access staff |  |  |
| PASS | sales_manager | sales_manager refused failed-events (403) |  |  |
| PASS | sales_manager | sales_manager refused hiring (403) |  |  |
| PASS | sales_manager | sales_manager refused hiring-write (403) |  |  |
| PASS | sales_manager | sales_manager may access client-dashboard |  |  |
| PASS | sales_manager | sales_manager may access documents |  |  |
| PASS | sales_manager | sales_manager may access tradelines |  |  |
| PASS | sales_manager | sales_manager cannot read other org client (404) |  |  |
| PASS | sales_manager | sales_manager org_id/role query spoof does not elevate (200) |  |  |
| PASS | funding_advisor | funding_advisor refused commissions (403) |  |  |
| PASS | funding_advisor | funding_advisor refused invoices (403) |  |  |
| PASS | funding_advisor | funding_advisor refused staff (403) |  |  |
| PASS | funding_advisor | funding_advisor refused failed-events (403) |  |  |
| PASS | funding_advisor | funding_advisor refused hiring (403) |  |  |
| PASS | funding_advisor | funding_advisor refused hiring-write (403) |  |  |
| PASS | funding_advisor | funding_advisor may access client-dashboard |  |  |
| PASS | funding_advisor | funding_advisor may access documents |  |  |
| PASS | funding_advisor | funding_advisor may access tradelines |  |  |
| PASS | funding_advisor | funding_advisor cannot read other org client (404) |  |  |
| PASS | funding_advisor | funding_advisor org_id/role query spoof does not elevate (403) |  |  |
| PASS | closer | closer refused commissions (403) |  |  |
| PASS | closer | closer refused invoices (403) |  |  |
| PASS | closer | closer refused staff (403) |  |  |
| PASS | closer | closer refused failed-events (403) |  |  |
| PASS | closer | closer refused hiring (403) |  |  |
| PASS | closer | closer refused hiring-write (403) |  |  |
| PASS | closer | closer may access client-dashboard |  |  |
| PASS | closer | closer may access documents |  |  |
| PASS | closer | closer may access tradelines |  |  |
| PASS | closer | closer cannot read other org client (404) |  |  |
| PASS | closer | closer org_id/role query spoof does not elevate (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused commissions (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused invoices (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused staff (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused failed-events (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused hiring (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused hiring-write (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist may access client-dashboard |  |  |
| PASS | inquiry_specialist | inquiry_specialist may access documents |  |  |
| PASS | inquiry_specialist | inquiry_specialist may access tradelines |  |  |
| PASS | inquiry_specialist | inquiry_specialist cannot read other org client (404) |  |  |
| PASS | inquiry_specialist | inquiry_specialist org_id/role query spoof does not elevate (403) |  |  |
| PASS | setter | setter refused commissions (403) |  |  |
| PASS | setter | setter refused invoices (403) |  |  |
| PASS | setter | setter refused staff (403) |  |  |
| PASS | setter | setter refused failed-events (403) |  |  |
| PASS | setter | setter refused hiring (403) |  |  |
| PASS | setter | setter refused hiring-write (403) |  |  |
| PASS | setter | setter may access client-dashboard |  |  |
| PASS | setter | setter may access documents |  |  |
| PASS | setter | setter may access tradelines |  |  |
| PASS | setter | setter cannot read other org client (404) |  |  |
| PASS | setter | setter org_id/role query spoof does not elevate (403) |  |  |
| PASS | closer | Closer refused hiring endpoint (403) |  |  |
| PASS | forged | Forged bearer token is refused |  | src/auth/session.mjs |
| PASS | closer | Session endpoint responds to auth probes (status 401) | Full revoke/expiry matrix also covered by src/auth/*.pg.test.mjs |  |
| PASS | closer | Closer brain access tiers exclude owner; owner includes owner |  | src/company-brain/access.mjs |
| PASS | closer | Closer brain SQL filter excludes owner-tier chunks; owner can see them |  | src/company-brain/retrieve.mjs |
| PASS | closer | Company Brain live retrieve is credential-gated (OPENAI_API_KEY); tier gate verified above | status=401 error=unauthorized | src/company-brain/embed.mjs |
| PASS | affiliate | Affiliate refused internal client (403) |  |  |
| UNVERIFIED | funding_advisor | Proxy session credential isolation between advisors | status=401 |  |
| PASS | sales_manager | sales_manager direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/hiring.html |
| PASS | sales_manager | sales_manager direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/ops-admin.html |
| PASS | closer | closer direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/hiring.html |
| PASS | closer | closer direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/ops-admin.html |
| PASS | closer | closer direct-URL to finance-os.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/finance-os.html |
| PASS | funding_advisor | funding_advisor direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/hiring.html |
| PASS | funding_advisor | funding_advisor direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/ops-admin.html |
| PASS | inquiry_specialist | inquiry_specialist direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/hiring.html |
| PASS | inquiry_specialist | inquiry_specialist direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/ops-admin.html |
| PASS | inquiry_specialist | inquiry_specialist direct-URL to products-commissions.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/products-commissions.html |
| PASS | setter | setter direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/hiring.html |
| PASS | setter | setter direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/ops-admin.html |
| PASS | setter | setter direct-URL to finance-os.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/finance-os.html |
| PASS | affiliate | affiliate direct-URL to pipeline.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/pipeline.html |
| PASS | affiliate | affiliate direct-URL to finance-os.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/finance-os.html |
| PASS | affiliate | affiliate direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/hiring.html |
| PASS | affiliate | affiliate direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/ops-admin.html |
| PASS | affiliate | affiliate direct-URL to client-control-panel.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/client-control-panel.html |
| PASS | partner | partner direct-URL to pipeline.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/pipeline.html |
| PASS | partner | partner direct-URL to finance-os.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/finance-os.html |
| PASS | partner | partner direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/hiring.html |
| PASS | closer | Closer direct-URL to owner screens triggers 403 on gated APIs | denied=8 allowed=18 | e2e/verification-security.spec.mjs |
| PASS | owner | Owner can open ops-admin without console death |  | public/app/ops-admin.html |

## 2. SILENTLY-DID-NOTHING (hunt results)

Code ran. No error. Nothing useful persisted — or the write was empty/zero.
These are more dangerous than hard failures because nothing alerts.

- **FUNDING** — Funding path queued at least one message with a template key
  - messages for clients=0, none queued/held. Workflows may have skipped sendTemplated (missing template, compliance, or early return).
  - `src/workflows/messaging.mjs`
  - actual: `{"messages":0,"statuses":[]}`
- **CLOSER_SHIFT** — Closer dashboard surfaces clock-in/shift requirement when no open shift
  - No clock/shift copy visible — closer may think they can work when writes will 403
  - `public/app/closer-dashboard.html`

## 3. Journey accounts (persisted values)

### A. Funding path

**Usable for a real person today: YES**

Primary client (lead): 8171b239-2521-4548-a386-2cb2d363acdd / e2e_verify.funding.1787430715928@verify.local
Simulated funding client: a57b31ec-66cb-46c0-973d-cf8289079390 / sim+1787430715982@demo.fundhub.local
Sale amount: 3000.00 (want 3000)
Closer front commission: 500.10 (want 500)
Advisor back commission: 125.00 (want 125)
Closeout fee: 5000.00 (want 5000)
The CRM link: dry-ghl-8171b2392521
Contract: ef64a2e8-a2a5-475d-aa99-59de3c8fcc36
Messages queued: 0

Operator verdict: YES for the money spine; still check the CRM link, contract send, and live webhooks separately.

| Step | Status | Persisted |
|---|---|---|
| Lead captured → client row | PASS | client.id=8171b239-2521-4548-a386-2cb2d363acdd email=e2e_verify.funding.1787430715928@verify.local |
| The CRM linkage | PASS | dry-ghl-8171b2392521 |
| Booking → closer task | PASS | task.id=992bfa5b-8619-4676-baaa-850b60aa9f45 title=Strategy session booked |
| Consent captured | PASS | kind=soft_pull_consent id=2cb89735-7f2a-4473-bb32-5008689e3b09 |
| CRS → tradelines | PASS | funding_client_tls=4 sim_tls=4 ingested=4 |
| Pipeline card | PASS | card=a1652aad-15d0-4fd7-8a10-c4a6792d20cd stage=new_lead |
| Sale + $500 closer commission + entitlement | PASS | sales=2 front=500.10 ents=credit-analysis-report,funding-snapshot |
| Contract | PASS | id=ef64a2e8-a2a5-475d-aa99-59de3c8fcc36 status=draft hash=none |
| Round funded + closeout 10% | PASS | fee=5000.00 balance_due=5000.00 basis=50000.00 |
| Messages queued | SILENTLY-DID-NOTHING | total=0 queued=0 keys= |

### B. Credit-repair / DIY downsell

**Usable for a real person today: YES**

Client 9a654d2e-6f9b-42dc-b4d1-5dee899f90ce
DIY sale: 1000.00
Entitlements: metro2-letter-pack
Ledger rows: 0
Messages: 0
Operator verdict: YES for sale/entitlement separation; letter delivery still vendor-gated.

| Step | Status | Persisted |
|---|---|---|
| DIY sale (not funding) | PASS | diy=1 funding=0 price=1000.00 |
| Letters / delivery message | PASS | ds02=done; msgs=0 |

### C. Inquiry removal

**Usable for a real person today: YES**

Inquiry 3d366be3-cf1d-4fdd-959a-ef1a018fd7ca; case 9326bd9c-75ca-4494-abee-55cc8ccaa7a6
call_state machine: 11 states exercised
Status bleed on call_state: no
Operator verdict: YES for status separation; real Bland voice still credential-gated.

| Step | Status | Persisted |
|---|---|---|
| Inquiry logged | PASS | id=3d366be3-cf1d-4fdd-959a-ef1a018fd7ca status=open call_state=not_started |
| Case created | PASS | case=9326bd9c-75ca-4494-abee-55cc8ccaa7a6 |
| All 11 call_states without status bleed | PASS | status remained open |
| cleared → inquiry.removed → C-03 | PASS | {"done":true,"branch":"resume","task":{"created":true}} |

### D. Agent runtime

**Usable for a real person today: NO**

Agents in org: draft=AG-04 shadow=VF-SHADOW live=VF-LIVE
handleInbound result: {"ok":true,"reason":"no_api_key","agent":"VF-LIVE","shadowed":true,"wouldSend":"[SHADOW — no API key] Model was not called. Inbound: Hi, what are my next steps?"}
Shadow logs: 2; agent outbound: 0
Operator verdict: NO for live client conversations — runtime has never sent a real reply; without ANTHROPIC_API_KEY it shadows. Do not put a client on an agent today.

| Step | Status | Persisted |
|---|---|---|
| Inbound → select → shadow/no-send | PASS | result={"ok":true,"reason":"no_api_key","agent":"VF-LIVE","shadowed":true,"wouldSend":"[SHADOW — no API key] Model was not called. Inbound: Hi, what are my next steps?"} shadows=2 outbound=0 |
| STOP halt | PASS | {"ok":true,"reason":"stop_word","halted":true,"agent":"VF-LIVE"} |

### E. Idempotency, replay, ordering

**Usable for a real person today: YES**

Operator verdict: YES for double-fire / replay / concurrency on deposit.paid.

| Step | Status | Persisted |
|---|---|---|
| Double deposit.paid | PASS | sales=1 ledger=1 ents=1 |
| Out-of-order round.funded | PASS | no round invented |
| Concurrent identical deposit.paid | PASS | sales=1 |

### F. Negative / adversarial

**Usable for a real person today: UNKNOWN / PARTIAL**

Adapter signatures fail-closed for commas/clickfunnels in-process. Full webhook HTTP path still depends on Netlify function wiring (see AUDIT-FINDINGS on plain-object req).

| Step | Status | Persisted |
|---|---|---|
| Bad amounts | PASS | salesDelta=0 |
| Signatures / opt-out / unicode / amounts | PASS | see assertions |

### G. Workflow engine

**Usable for a real person today: YES**

Registered workflows: 61
Reacted: 55
Errored: none
Never invoked this run: 6
Canonical events with no workflow listener: booking.rescheduled, booking.cancelled, decision.rendered, sale.closed, file.finalized, payment.failed, payment.expired, payment.canceled, payment.refunded, payment.disputed, inquiry.gate.raised, inquiry.gate.clear, inquiry.docs.needed, letter.generated, message.queued, message.sent, message.failed, message.blocked, commission.earned, commission.approved, commission.paid, invoice.created, invoice.paid, invoice.voided, contract.sent, contract.signed, repair.enrolled, repair.docs.needed, repair.docs.complete, repair.analysis.complete, repair.analysis.empty, repair.letters.ready, repair.letters.sent, repair.letters.delivered, repair.response.received, repair.response.parsed, repair.parse.low_confidence, repair.response.retake, repair.item.deleted, repair.item.verified, repair.item.updated, repair.item.unaddressed, repair.round.complete, repair.round.escalated, repair.program.complete, repair.stalled, repair.cancelled, diy.package.requested, diy.package.generating, diy.package.ready, diy.package.delivered, diy.package.downloaded
Operator note: Inngest does not schedule anything without INNGEST_EVENT_KEY. This run invokes handles directly.

| Step | Status | Persisted |
|---|---|---|
| Drive workflows from canonical events | PASS | reacted=55 errored=0 never=6 orphanEvents=52 |

### PART 3 — Security & isolation

**Usable for a real person today: YES**

Victim client 8fb23854-37ab-4c30-9a51-964a9a42ac6a in org 185e1531-d815-4e1b-abf1-dfbbc61dbc79
Other-org client bf3d5bc1-72cb-4050-a5bb-beb17b64ea77
Document id: none
Attacker stance: direct URL/API, id swap, org_id spoof, forged token, affiliate reach.

| Step | Status | Persisted |
|---|---|---|
| Role matrix + cross-org + spoof + brain + affiliate | PASS | see SECURITY assertions |

### PART 4 — Cross-cutting

**Usable for a real person today: NO**

Workflow keys: 79
Missing rows: EMAIL-AX07-FUNDING-PAUSED, EMAIL-C06-DECLINE, EMAIL-DPC05-NO-PROGRESS-72H, EMAIL-DS01-REPAIR-REFERRAL, EMAIL-DS02-DIY-LETTERS-READY, EMAIL-F02-ID-PORTAL-NEEDED, EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP, EMAIL-F03-ROUND-SUBMITTED, EMAIL-F04-ROUND-APPROVALS, EMAIL-F06-MISSING-DOCS, EMAIL-F07-FUNDING-LOCKED, EMAIL-F10-INBOX-SETUP, EMAIL-N01-COLD-NURTURE, EMAIL-N02-WARM-NURTURE, EMAIL-N03-HOT-NURTURE, EMAIL-N04-POST-FUNDING, EMAIL-N06-RENEWAL, EMAIL-S02-FINISH-APPLICATION, EMAIL-S05A-NOSHOW-RECOVERY, EMAIL-U02-ANALYZER-REPAIR-DELIVERY, SMS-AISET03-MSG1, SMS-AISET03-MSG2, SMS-AISET03-MSG3, SMS-AX07-FUNDING-PAUSED, SMS-C06-DECLINE, SMS-DPC04-RESCHEDULE-REBOOKING, SMS-DPC05-NO-PROGRESS-72H, SMS-DS01-REPAIR-REFERRAL, SMS-F02-ID-PORTAL-NEEDED, SMS-F03-ROUND-SUBMITTED, SMS-F04-ROUND-APPROVALS, SMS-F06-MISSING-DOCS, SMS-F07-FUNDING-LOCKED, SMS-F10-INBOX-SETUP, SMS-N01-COLD-NURTURE, SMS-N02-WARM-NURTURE, SMS-N03-HOT-NURTURE, SMS-N04-POST-FUNDING, SMS-N06-RENEWAL, SMS-ROUND-STARTED-NOTIFY, SMS-S05A-NOSHOW-RECOVERY
DRAFT keys (blocked by hard guard; rewrite before live send): none
Template table: {"total":52,"drafts":0,"compliant":51}
Canonical orphans (no emit site found): none
Hand-calcs: closer $500 / back $125 / fee $5000 / hourly $6.25

| Step | Status | Persisted |
|---|---|---|
| Workflow template keys → DB rows | FAIL | keys=79 missing=41 drafts=0 |
| Canonical event emit sites | PASS | emitted=71 orphans=0:  |

## 4. Full assertion table

| Status | Section | Journey | Role | Claim | File:line |
|---|---|---|---|---|---|
| PASS | DATA | FUNDING | system | ClickFunnels/entry.captured created a clients row | src/adapters/clickfunnels.mjs |
| PASS | DATA | FUNDING | system | S-01 tagged client lead:new | src/workflows/s-01-new-lead-intake.mjs |
| PASS | DATA | FUNDING | system | Client has ghl_contact_id linkage | src/handlers/client-lifecycle.mjs |
| PASS | DATA | FUNDING | system | Booking created a closer task | src/adapters/calcom.mjs |
| PASS | DATA | FUNDING | system | Soft-pull consent persisted | src/consent/index.mjs |
| PASS | DATA | FUNDING | system | Finance OS loadSimulatedClient created a demo client | src/demo/simulate-client.mjs:103 |
| PASS | DATA | FUNDING | system | CRS ingest stored tradelines for funding client | src/demo/simulate-client.mjs |
| FAIL | DATA | FUNDING | system | Tradeline creditorName survived ingest as creditor/lender | src/tradelines/store.mjs |
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
| FAIL | DATA | FUNDING | system | Closer front-end commission is $500 (hand-calc, not library) | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Funding entitlement funding-snapshot granted | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Payment link row created | src/payment-links/index.mjs |
| PASS | DATA | FUNDING | system | Contract row persisted | src/contracts/send.mjs |
| PASS | DATA | FUNDING | system | round.started created funding_rounds row | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Approved application row exists for the round | api/applications.mjs |
| PASS | DATA | FUNDING | system | Application status change wrote an audit/decision row | src/applications/status.mjs |
| PASS | DATA | FUNDING | system | Round status is funded with amount 50000 | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Advisor back-end commission is $125 (50000 × 0.25% hand-calc) | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Closer back-end commission is $125 when attributed | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Closeout total_fee is $5000 (10% of round funded_amount $50000) | src/funding/closeout.mjs |
| PASS | DATA | FUNDING | system | Closeout balance_due equals total_fee | src/funding/closeout.mjs |
| PASS | DATA | FUNDING | system | Success-fee invoice row exists | src/workflows/f-07-funding-locked.mjs |
| SILENTLY-DID-NOTHING | DATA | FUNDING | system | Funding path queued at least one message with a template key | src/workflows/messaging.mjs |
| PASS | DATA | FUNDING | system | Replay does not duplicate sales | src/events/bus.mjs |
| PASS | DATA | FUNDING | system | Replay does not duplicate commission_ledger | src/events/bus.mjs |
| PASS | DATA | DIY_DOWNSELL | system | DIY path wrote its OWN consulting-package sale | src/handlers/money-chain.mjs |
| PASS | DATA | DIY_DOWNSELL | system | DIY path did NOT write a funding (card-stacking-dfy) sale | src/handlers/money-chain.mjs |
| PASS | DATA | DIY_DOWNSELL | system | DIY entitlement metro2-letter-pack granted (not funding-snapshot) | src/handlers/money-chain.mjs |
| PASS | DATA | DIY_DOWNSELL | system | DIY letters path ran; email refused by DRAFT hard guard (correct) | src/workflows/ds-02-diy-letters.mjs |
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
| PASS | DATA | AGENT_RUNTIME | system | status=draft agents do nothing (or no live agent selected) | src/agents/runtime.mjs:95 |
| PASS | DATA | AGENT_RUNTIME | system | STOP word halts agent reply (no helpful outbound) | src/agents/guardrails.mjs |
| PASS | DATA | IDEMPOTENCY | system | Identical deposit.paid twice → exactly one sale | src/handlers/money-chain.mjs |
| PASS | DATA | IDEMPOTENCY | system | Identical deposit.paid twice → one front-end ledger row | src/handlers/money-chain.mjs |
| PASS | DATA | IDEMPOTENCY | system | Full bus replay does not duplicate sales | src/events/bus.mjs |
| PASS | DATA | IDEMPOTENCY | system | round.funded before round.started did not invent a funded round | src/handlers/money-chain.mjs |
| PASS | DATA | IDEMPOTENCY | system | Two concurrent identical deposit.paid → one sale | src/handlers/money-chain.mjs |
| PASS | DATA | ADVERSARIAL | attacker | clickfunnels refuses invalid signature | src/adapters/clickfunnels.mjs |
| PASS | DATA | ADVERSARIAL | attacker | clickfunnels accepts valid HMAC | src/adapters/clickfunnels.mjs |
| PASS | DATA | ADVERSARIAL | attacker | commas refuses invalid signature | src/adapters/commas.mjs |
| PASS | DATA | ADVERSARIAL | attacker | commas accepts valid HMAC | src/adapters/commas.mjs |
| PASS | DATA | ADVERSARIAL | attacker | Zero-amount deposit did not create a sale (or no client) |  |
| PASS | DATA | ADVERSARIAL | attacker | Opt-out recorded and isOptedOut returns true | src/lib/opt-out.mjs |
| PASS | DATA | ADVERSARIAL | attacker | Unicode/emoji/quotes name persists without injection error | src/handlers/client-lifecycle.mjs |
| PASS | DATA | ADVERSARIAL | attacker | entry.captured without email fail-closed or created intentionally (no throw) | src/handlers/client-lifecycle.mjs |
| PASS | DATA | ADVERSARIAL | attacker | Expired payment link status is expired | src/payment-links/index.mjs |
| PASS | DATA | ADVERSARIAL | attacker | booking.cancelled emits without throwing | src/events/canonical.mjs |
| PASS | DATA | ADVERSARIAL | attacker | payment.failed emits without creating a sale | src/handlers/money-chain.mjs |
| PASS | DATA | ADVERSARIAL | attacker | String amount coerced safely to 3000 or refused |  |
| PASS | DATA | ADVERSARIAL | attacker | Tampered contract fails integrity check | src/contracts/sign.mjs |
| UNVERIFIED | DATA | ADVERSARIAL | attacker | Quiet-hours message holds then releases |  |
| FAIL | DATA | WORKFLOWS | system | Workflow registry has 49–50 functions (contract chaser + sweeper included) | src/workflows/index.mjs |
| PASS | DATA | WORKFLOWS | system | Workflow af-02-referral-ownership-capture reacted to entry.captured |  |
| PASS | DATA | WORKFLOWS | system | Workflow at-01-first-touch-capture reacted to entry.captured |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-01-new-lead-intake reacted to entry.captured |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-00-welcome reacted to entry.captured |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-02-incomplete-survey-nudge reacted to entry.captured |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-nobook-chase reacted to survey.submitted |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-00-crs-soft-pull-request reacted to diagnostic.paid |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-02-inquiry-created reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-06-crs-results-router reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow dpc-01-analyzer-lock reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow u-02-analyzer-complete-delivery reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow u-03-crs-snapshot-sync reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow u-04-promote-crs-primary reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow u-05-data-health-monitor reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow ai-set-01-josh-setter reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow ai-set-04-3way-handoff reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow bs-01-precall-launcher reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow dpc-02-call-outcome-enforcement reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow dpc-05-no-progress-escalation reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-04-call-booked reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-04b-booking-reminders reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-portal-invite reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-05a-no-show-recovery reacted to booking.noshow |  |
| PASS | DATA | WORKFLOWS | system | Workflow ai-set-03-no-answer-cadence reacted to call.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow ds-01-repair-referral reacted to call.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-08-post-call-funding-declined reacted to call.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-offer-bucket reacted to call.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-02b-inquiry-removal-requested reacted to deposit.paid |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-06-post-call-funding-purchased reacted to deposit.paid |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-doc-collection reacted to deposit.paid |  |
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
| PASS | DATA | WORKFLOWS | system | Workflow n-06-renewal-second-wave reacted to round.funded |  |
| PASS | DATA | WORKFLOWS | system | Workflow sys-01-ltv-calculator reacted to round.funded |  |
| PASS | DATA | WORKFLOWS | system | Workflow n-04-post-funding-nurture reacted to round.closeout |  |
| PASS | DATA | WORKFLOWS | system | Workflow ds-02-diy-letters reacted to payment.received |  |
| PASS | DATA | WORKFLOWS | system | Workflow ghl-doc-document-check reacted to docs.received |  |
| PASS | DATA | WORKFLOWS | system | Workflow repair-bureau-response-reader reacted to docs.received |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-03-inquiry-removed-resume-or-hold reacted to inquiry.removed |  |
| PASS | DATA | WORKFLOWS | system | Workflow dpc-03-inbound-reply-router reacted to message.inbound |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-06-funding-conditions-missing-docs reacted to mail.response |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-09-funding-declined-no-path reacted to mail.response |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-11-bank-email-event-router reacted to mail.response |  |
| PASS | DATA | WORKFLOWS | system | Workflow ar-collections reacted to invoice.sent |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow contract-chaser never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow message-dispatch-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow inquiry-call-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow n-01-cold-nurture never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow n-02-warm-nurture never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow n-03-hot-nurture never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event booking.rescheduled has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event booking.cancelled has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event decision.rendered has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event sale.closed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event file.finalized has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event payment.failed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event payment.expired has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event payment.canceled has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event payment.refunded has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event payment.disputed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event inquiry.gate.raised has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event inquiry.gate.clear has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event inquiry.docs.needed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event letter.generated has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event message.queued has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event message.sent has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event message.failed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event message.blocked has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event commission.earned has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event commission.approved has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event commission.paid has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event invoice.created has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event invoice.paid has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event invoice.voided has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event contract.sent has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event contract.signed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.enrolled has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.docs.needed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.docs.complete has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.analysis.complete has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.analysis.empty has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.letters.ready has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.letters.sent has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.letters.delivered has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.response.received has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.response.parsed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.parse.low_confidence has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.response.retake has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.item.deleted has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.item.verified has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.item.updated has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.item.unaddressed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.round.complete has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.round.escalated has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.program.complete has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.stalled has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.cancelled has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event diy.package.requested has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event diy.package.generating has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event diy.package.ready has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event diy.package.delivered has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event diy.package.downloaded has no workflow listener |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager is in FINANCE | src/http/read-api.mjs |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager is NOT in HIRING | src/http/read-api.mjs |
| PASS | SECURITY | ISOLATION | closer | closer is NOT in HIRING (applicant PII) | src/http/read-api.mjs |
| PASS | SECURITY | ISOLATION | closer | closer is NOT in OPS | src/http/read-api.mjs |
| PASS | SECURITY | ISOLATION | owner | owner may access commissions |  |
| PASS | SECURITY | ISOLATION | owner | owner may access invoices |  |
| PASS | SECURITY | ISOLATION | owner | owner may access staff |  |
| PASS | SECURITY | ISOLATION | owner | owner may access failed-events |  |
| PASS | SECURITY | ISOLATION | owner | owner may access hiring |  |
| PASS | SECURITY | ISOLATION | owner | owner may access hiring-write |  |
| PASS | SECURITY | ISOLATION | owner | owner may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | owner | owner may access documents |  |
| PASS | SECURITY | ISOLATION | owner | owner may access tradelines |  |
| PASS | SECURITY | ISOLATION | owner | owner cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | owner | owner org_id/role query spoof does not elevate (200) |  |
| PASS | SECURITY | ISOLATION | admin | admin may access commissions |  |
| PASS | SECURITY | ISOLATION | admin | admin may access invoices |  |
| PASS | SECURITY | ISOLATION | admin | admin may access staff |  |
| PASS | SECURITY | ISOLATION | admin | admin may access failed-events |  |
| PASS | SECURITY | ISOLATION | admin | admin may access hiring |  |
| PASS | SECURITY | ISOLATION | admin | admin may access hiring-write |  |
| PASS | SECURITY | ISOLATION | admin | admin may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | admin | admin may access documents |  |
| PASS | SECURITY | ISOLATION | admin | admin may access tradelines |  |
| PASS | SECURITY | ISOLATION | admin | admin cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | admin | admin org_id/role query spoof does not elevate (200) |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access commissions |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access invoices |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access staff |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager refused failed-events (403) |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager refused hiring (403) |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager refused hiring-write (403) |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access documents |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access tradelines |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager org_id/role query spoof does not elevate (200) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused commissions (403) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused invoices (403) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused staff (403) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused failed-events (403) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused hiring (403) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused hiring-write (403) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor may access documents |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor may access tradelines |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor org_id/role query spoof does not elevate (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused commissions (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused invoices (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused staff (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused failed-events (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused hiring (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused hiring-write (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | closer | closer may access documents |  |
| PASS | SECURITY | ISOLATION | closer | closer may access tradelines |  |
| PASS | SECURITY | ISOLATION | closer | closer cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | closer | closer org_id/role query spoof does not elevate (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused commissions (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused invoices (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused staff (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused failed-events (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused hiring (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused hiring-write (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist may access documents |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist may access tradelines |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist org_id/role query spoof does not elevate (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused commissions (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused invoices (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused staff (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused failed-events (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused hiring (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused hiring-write (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | setter | setter may access documents |  |
| PASS | SECURITY | ISOLATION | setter | setter may access tradelines |  |
| PASS | SECURITY | ISOLATION | setter | setter cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | setter | setter org_id/role query spoof does not elevate (403) |  |
| PASS | SECURITY | ISOLATION | closer | Closer refused hiring endpoint (403) |  |
| PASS | SECURITY | ISOLATION | forged | Forged bearer token is refused | src/auth/session.mjs |
| PASS | SECURITY | ISOLATION | closer | Session endpoint responds to auth probes (status 401) |  |
| PASS | SECURITY | ISOLATION | closer | Closer brain access tiers exclude owner; owner includes owner | src/company-brain/access.mjs |
| PASS | SECURITY | ISOLATION | closer | Closer brain SQL filter excludes owner-tier chunks; owner can see them | src/company-brain/retrieve.mjs |
| PASS | SECURITY | ISOLATION | closer | Company Brain live retrieve is credential-gated (OPENAI_API_KEY); tier gate verified above | src/company-brain/embed.mjs |
| PASS | SECURITY | ISOLATION | affiliate | Affiliate refused internal client (403) |  |
| UNVERIFIED | SECURITY | ISOLATION | funding_advisor | Proxy session credential isolation between advisors |  |
| PASS | CROSS | CROSS_CUTTING | system | Workflow template keys discovered (79; spec said 41) | src/messaging/seed/workflow-keys.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-AR-01-FIRST-NOTICE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-AR-02-REMINDER exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-AR-03-FINAL-NOTICE exists (compliance_passed=true) |  |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-AX07-FUNDING-PAUSED resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-C06-DECLINE resolves to a message_templates row | src/messaging/seed/seed.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-DOC-01-REQUEST exists (compliance_passed=true) |  |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-DPC05-NO-PROGRESS-72H resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-DS01-REPAIR-REFERRAL resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-DS02-DIY-LETTERS-READY resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-F02-ID-PORTAL-NEEDED resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-F03-ROUND-SUBMITTED resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-F04-ROUND-APPROVALS resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-F06-MISSING-DOCS resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-F07-FUNDING-LOCKED resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-F10-INBOX-SETUP resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-N01-COLD-NURTURE resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-N02-WARM-NURTURE resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-N03-HOT-NURTURE resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-N04-POST-FUNDING resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-N06-RENEWAL resolves to a message_templates row | src/messaging/seed/seed.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-NOBOOK-01 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-NOBOOK-02 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-NOBOOK-03 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-OFFER-FUNDING-DFY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-OFFER-FUNDING-MASTERY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-OFFER-NONE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-OFFER-REPAIR-DFY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-OFFER-REPAIR-TRIAL exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-OFFER-SOFT-PULL exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-OFFER-UWIQ-DELIVERABLES exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-S00-WELCOME exists (compliance_passed=true) |  |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-S02-FINISH-APPLICATION resolves to a message_templates row | src/messaging/seed/seed.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-S04-01-CONFIRM exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-S05A-NOSHOW-02 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-S05A-NOSHOW-03 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-S05A-NOSHOW-04 exists (compliance_passed=true) |  |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-S05A-NOSHOW-RECOVERY resolves to a message_templates row | src/messaging/seed/seed.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-U02-ANALYZER-FUNDING-DELIVERY exists (compliance_passed=true) |  |
| FAIL | CROSS | CROSS_CUTTING | system | Template key EMAIL-U02-ANALYZER-REPAIR-DELIVERY resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-AISET03-MSG1 resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-AISET03-MSG2 resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-AISET03-MSG3 resolves to a message_templates row | src/messaging/seed/seed.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AISET04-HANDOFF exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AR-01-FIRST-NOTICE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AR-02-REMINDER exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AR-03-FINAL-NOTICE exists (compliance_passed=true) |  |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-AX07-FUNDING-PAUSED resolves to a message_templates row | src/messaging/seed/seed.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-BS01-01-BOOKED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-BS01-02-PRECALL exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-BS01-03-DAYOF exists (compliance_passed=true) |  |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-C06-DECLINE resolves to a message_templates row | src/messaging/seed/seed.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-DOC-01-REQUEST exists (compliance_passed=true) |  |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-DPC04-RESCHEDULE-REBOOKING resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-DPC05-NO-PROGRESS-72H resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-DS01-REPAIR-REFERRAL resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-F02-ID-PORTAL-NEEDED resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-F03-ROUND-SUBMITTED resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-F04-ROUND-APPROVALS resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-F06-MISSING-DOCS resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-F07-FUNDING-LOCKED resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-F10-INBOX-SETUP resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-N01-COLD-NURTURE resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-N02-WARM-NURTURE resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-N03-HOT-NURTURE resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-N04-POST-FUNDING resolves to a message_templates row | src/messaging/seed/seed.mjs |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-N06-RENEWAL resolves to a message_templates row | src/messaging/seed/seed.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-NOBOOK-01 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-NOBOOK-02 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-NOBOOK-03 exists (compliance_passed=true) |  |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-ROUND-STARTED-NOTIFY resolves to a message_templates row | src/messaging/seed/seed.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S00-WELCOME exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S04-01-CONFIRM exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S04-02-REMIND-24H exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S04-03-REMIND-2H exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S05A-NOSHOW-02 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S05A-NOSHOW-03 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S05A-NOSHOW-04 exists (compliance_passed=true) |  |
| FAIL | CROSS | CROSS_CUTTING | system | Template key SMS-S05A-NOSHOW-RECOVERY resolves to a message_templates row | src/messaging/seed/seed.mjs |
| PASS | CROSS | CROSS_CUTTING | system | No DRAFT workflow templates in inventory (guard unexercised) | src/messaging/draft-guard.mjs |
| PASS | CROSS | CROSS_CUTTING | system | compliance_passed=false blocks queue/send | src/workflows/messaging.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Hand-calc closer flat deposit = $500 |  |
| PASS | CROSS | CROSS_CUTTING | system | Hand-calc 0.25% of $50,000 = $125 |  |
| PASS | CROSS | CROSS_CUTTING | system | Hand-calc 10% of $50,000 = $5,000 |  |
| PASS | CROSS | CROSS_CUTTING | system | Advisor hourly rate constant $6.25 (shift pay — not ledger) |  |
| PASS | CROSS | CROSS_CUTTING | system | affiliate.html has no obvious fabricated sample dollars in static markup | public/app/affiliate.html |
| PASS | CROSS | CROSS_CUTTING | system | agent-editor.html has no obvious fabricated sample dollars in static markup | public/app/agent-editor.html |
| PASS | CROSS | CROSS_CUTTING | system | automations.html has no obvious fabricated sample dollars in static markup | public/app/automations.html |
| PASS | CROSS | CROSS_CUTTING | system | brand-studio.html has no obvious fabricated sample dollars in static markup | public/app/brand-studio.html |
| PASS | CROSS | CROSS_CUTTING | system | calendar.html has no obvious fabricated sample dollars in static markup | public/app/calendar.html |
| PASS | CROSS | CROSS_CUTTING | system | campaign-manager.html has no obvious fabricated sample dollars in static markup | public/app/campaign-manager.html |
| PASS | CROSS | CROSS_CUTTING | system | client-control-panel.html has no obvious fabricated sample dollars in static markup | public/app/client-control-panel.html |
| PASS | CROSS | CROSS_CUTTING | system | client-portal.html has no obvious fabricated sample dollars in static markup | public/app/client-portal.html |
| PASS | CROSS | CROSS_CUTTING | system | closer-call.html has no obvious fabricated sample dollars in static markup | public/app/closer-call.html |
| PASS | CROSS | CROSS_CUTTING | system | closer-dashboard.html has no obvious fabricated sample dollars in static markup | public/app/closer-dashboard.html |
| PASS | CROSS | CROSS_CUTTING | system | company-brain.html has no obvious fabricated sample dollars in static markup | public/app/company-brain.html |
| PASS | CROSS | CROSS_CUTTING | system | consent-capture.html has no obvious fabricated sample dollars in static markup | public/app/consent-capture.html |
| PASS | CROSS | CROSS_CUTTING | system | content-admin.html has no obvious fabricated sample dollars in static markup | public/app/content-admin.html |
| PASS | CROSS | CROSS_CUTTING | system | contracts.html has no obvious fabricated sample dollars in static markup | public/app/contracts.html |
| PASS | CROSS | CROSS_CUTTING | system | creative-factory.html has no obvious fabricated sample dollars in static markup | public/app/creative-factory.html |
| PASS | CROSS | CROSS_CUTTING | system | documents.html has no obvious fabricated sample dollars in static markup | public/app/documents.html |
| PASS | CROSS | CROSS_CUTTING | system | finance-os.html has no obvious fabricated sample dollars in static markup | public/app/finance-os.html |
| PASS | CROSS | CROSS_CUTTING | system | galaxy.html has no obvious fabricated sample dollars in static markup | public/app/galaxy.html |
| PASS | CROSS | CROSS_CUTTING | system | hiring.html has no obvious fabricated sample dollars in static markup | public/app/hiring.html |
| PASS | CROSS | CROSS_CUTTING | system | index.html has no obvious fabricated sample dollars in static markup | public/app/index.html |
| PASS | CROSS | CROSS_CUTTING | system | inquiry-remover.html has no obvious fabricated sample dollars in static markup | public/app/inquiry-remover.html |
| PASS | CROSS | CROSS_CUTTING | system | journeys.html has no obvious fabricated sample dollars in static markup | public/app/journeys.html |
| PASS | CROSS | CROSS_CUTTING | system | lenders.html has no obvious fabricated sample dollars in static markup | public/app/lenders.html |
| PASS | CROSS | CROSS_CUTTING | system | messaging.html has no obvious fabricated sample dollars in static markup | public/app/messaging.html |
| PASS | CROSS | CROSS_CUTTING | system | my-numbers.html has no obvious fabricated sample dollars in static markup | public/app/my-numbers.html |
| PASS | CROSS | CROSS_CUTTING | system | ops-admin.html has no obvious fabricated sample dollars in static markup | public/app/ops-admin.html |
| PASS | CROSS | CROSS_CUTTING | system | partner-galaxy.html has no obvious fabricated sample dollars in static markup | public/app/partner-galaxy.html |
| PASS | CROSS | CROSS_CUTTING | system | payment-success.html has no obvious fabricated sample dollars in static markup | public/app/payment-success.html |
| PASS | CROSS | CROSS_CUTTING | system | pipeline.html has no obvious fabricated sample dollars in static markup | public/app/pipeline.html |
| PASS | CROSS | CROSS_CUTTING | system | present.html has no obvious fabricated sample dollars in static markup | public/app/present.html |
| PASS | CROSS | CROSS_CUTTING | system | products-commissions.html has no obvious fabricated sample dollars in static markup | public/app/products-commissions.html |
| PASS | CROSS | CROSS_CUTTING | system | sales-floor.html has no obvious fabricated sample dollars in static markup | public/app/sales-floor.html |
| PASS | CROSS | CROSS_CUTTING | system | sidebar.fragment.html has no obvious fabricated sample dollars in static markup | public/app/sidebar.fragment.html |
| PASS | CROSS | CROSS_CUTTING | system | social-studio.html has no obvious fabricated sample dollars in static markup | public/app/social-studio.html |
| PASS | CROSS | CROSS_CUTTING | system | soft-pull-approve.html has no obvious fabricated sample dollars in static markup | public/app/soft-pull-approve.html |
| PASS | CROSS | CROSS_CUTTING | system | staff-teams.html has no obvious fabricated sample dollars in static markup | public/app/staff-teams.html |
| PASS | CROSS | CROSS_CUTTING | system | message_templates inventory: total=52 drafts=0 compliant=51 |  |
| PASS | UI | ROLE_SCREENS | owner | owner opened pipeline.html with no console errors | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened finance-os.html with no console errors | public/app/finance-os.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened ops-admin.html with no console errors | public/app/ops-admin.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened agent-editor.html with no console errors | public/app/agent-editor.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened brand-studio.html with no console errors | public/app/brand-studio.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened staff-teams.html with no console errors | public/app/staff-teams.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened company-brain.html with no console errors | public/app/company-brain.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened lenders.html with no console errors | public/app/lenders.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened consent-capture.html with no console errors | public/app/consent-capture.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened hiring.html with no console errors | public/app/hiring.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened galaxy.html with no console errors | public/app/galaxy.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened pipeline.html with no console errors | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened finance-os.html with no console errors | public/app/finance-os.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened ops-admin.html with no console errors | public/app/ops-admin.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened agent-editor.html with no console errors | public/app/agent-editor.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened staff-teams.html with no console errors | public/app/staff-teams.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened company-brain.html with no console errors | public/app/company-brain.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened lenders.html with no console errors | public/app/lenders.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened galaxy.html with no console errors | public/app/galaxy.html |
| PASS | UI | ROLE_SCREENS | sales_manager | sales_manager opened pipeline.html with no console errors | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | sales_manager | sales_manager opened products-commissions.html with no console errors | public/app/products-commissions.html |
| PASS | UI | ROLE_SCREENS | sales_manager | sales_manager opened staff-teams.html with no console errors | public/app/staff-teams.html |
| PASS | UI | ROLE_SCREENS | sales_manager | sales_manager opened closer-dashboard.html with no console errors | public/app/closer-dashboard.html |
| PASS | SECURITY | DIRECT_URL | sales_manager | sales_manager direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | public/app/hiring.html |
| PASS | SECURITY | DIRECT_URL | sales_manager | sales_manager direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | public/app/ops-admin.html |
| PASS | UI | ROLE_SCREENS | closer | closer opened closer-dashboard.html with no console errors | public/app/closer-dashboard.html |
| PASS | UI | ROLE_SCREENS | closer | closer opened pipeline.html with no console errors | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | closer | closer opened messaging.html with no console errors | public/app/messaging.html |
| PASS | UI | ROLE_SCREENS | closer | closer opened client-control-panel.html with no console errors | public/app/client-control-panel.html |
| PASS | UI | ROLE_SCREENS | closer | closer opened calendar.html with no console errors | public/app/calendar.html |
| PASS | SECURITY | DIRECT_URL | closer | closer direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | public/app/hiring.html |
| PASS | SECURITY | DIRECT_URL | closer | closer direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | public/app/ops-admin.html |
| PASS | SECURITY | DIRECT_URL | closer | closer direct-URL to finance-os.html: static HTML may load; API isolation enforced server-side | public/app/finance-os.html |
| PASS | UI | ROLE_SCREENS | funding_advisor | funding_advisor opened lenders.html with no console errors | public/app/lenders.html |
| PASS | UI | ROLE_SCREENS | funding_advisor | funding_advisor opened client-control-panel.html with no console errors | public/app/client-control-panel.html |
| PASS | UI | ROLE_SCREENS | funding_advisor | funding_advisor opened pipeline.html with no console errors | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | funding_advisor | funding_advisor opened messaging.html with no console errors | public/app/messaging.html |
| PASS | SECURITY | DIRECT_URL | funding_advisor | funding_advisor direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | public/app/hiring.html |
| PASS | SECURITY | DIRECT_URL | funding_advisor | funding_advisor direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | public/app/ops-admin.html |
| PASS | UI | ROLE_SCREENS | inquiry_specialist | inquiry_specialist opened inquiry-remover.html with no console errors | public/app/inquiry-remover.html |
| PASS | UI | ROLE_SCREENS | inquiry_specialist | inquiry_specialist opened messaging.html with no console errors | public/app/messaging.html |
| PASS | SECURITY | DIRECT_URL | inquiry_specialist | inquiry_specialist direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | public/app/hiring.html |
| PASS | SECURITY | DIRECT_URL | inquiry_specialist | inquiry_specialist direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | public/app/ops-admin.html |
| PASS | SECURITY | DIRECT_URL | inquiry_specialist | inquiry_specialist direct-URL to products-commissions.html: static HTML may load; API isolation enforced server-side | public/app/products-commissions.html |
| PASS | UI | ROLE_SCREENS | setter | setter opened pipeline.html with no console errors | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | setter | setter opened calendar.html with no console errors | public/app/calendar.html |
| PASS | UI | ROLE_SCREENS | setter | setter opened messaging.html with no console errors | public/app/messaging.html |
| PASS | SECURITY | DIRECT_URL | setter | setter direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | public/app/hiring.html |
| PASS | SECURITY | DIRECT_URL | setter | setter direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | public/app/ops-admin.html |
| PASS | SECURITY | DIRECT_URL | setter | setter direct-URL to finance-os.html: static HTML may load; API isolation enforced server-side | public/app/finance-os.html |
| PASS | UI | ROLE_SCREENS | affiliate | affiliate opened affiliate.html with no console errors | public/app/affiliate.html |
| PASS | SECURITY | DIRECT_URL | affiliate | affiliate direct-URL to pipeline.html: static HTML may load; API isolation enforced server-side | public/app/pipeline.html |
| PASS | SECURITY | DIRECT_URL | affiliate | affiliate direct-URL to finance-os.html: static HTML may load; API isolation enforced server-side | public/app/finance-os.html |
| PASS | SECURITY | DIRECT_URL | affiliate | affiliate direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | public/app/hiring.html |
| PASS | SECURITY | DIRECT_URL | affiliate | affiliate direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | public/app/ops-admin.html |
| PASS | SECURITY | DIRECT_URL | affiliate | affiliate direct-URL to client-control-panel.html: static HTML may load; API isolation enforced server-side | public/app/client-control-panel.html |
| PASS | UI | ROLE_SCREENS | partner | partner opened partner-galaxy.html with no console errors | public/app/partner-galaxy.html |
| PASS | UI | ROLE_SCREENS | partner | partner opened brand-studio.html with no console errors | public/app/brand-studio.html |
| PASS | UI | ROLE_SCREENS | partner | partner opened social-studio.html with no console errors | public/app/social-studio.html |
| PASS | UI | ROLE_SCREENS | partner | partner opened creative-factory.html with no console errors | public/app/creative-factory.html |
| PASS | SECURITY | DIRECT_URL | partner | partner direct-URL to pipeline.html: static HTML may load; API isolation enforced server-side | public/app/pipeline.html |
| PASS | SECURITY | DIRECT_URL | partner | partner direct-URL to finance-os.html: static HTML may load; API isolation enforced server-side | public/app/finance-os.html |
| PASS | SECURITY | DIRECT_URL | partner | partner direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | public/app/hiring.html |
| SILENTLY-DID-NOTHING | UI | CLOSER_SHIFT | closer | Closer dashboard surfaces clock-in/shift requirement when no open shift | public/app/closer-dashboard.html |
| PASS | UI | CLIENT_PORTAL | client | Client portal loads without console errors | public/app/client-portal.html |
| PASS | UI | PARTNER_BRAND | partner | Partner brand studio does not present internal CRM theming as editable | public/app/brand-studio.html |
| PASS | SECURITY | DIRECT_URL | closer | Closer direct-URL to owner screens triggers 403 on gated APIs | e2e/verification-security.spec.mjs |
| PASS | SECURITY | DIRECT_URL | owner | Owner can open ops-admin without console death | public/app/ops-admin.html |
| PASS | UI | VIEWPORT | owner | pipeline console-clean at 1280px | public/app/pipeline.html |
| PASS | UI | VIEWPORT | owner | pipeline console-clean at 390px | public/app/pipeline.html |

## 5. Breaks (FAIL + SILENT) with file and line

- **FAIL** Tradeline creditorName survived ingest as creditor/lender — `src/tradelines/store.mjs`
  - Wanted "Chase Sapphire Preferred"; got "Toyota Motor Credit".
- **FAIL** Closer front-end commission is $500 (hand-calc, not library) — `src/handlers/money-chain.mjs`
  - Wanted 500; got 500.1.
- **FAIL** Workflow registry has 49–50 functions (contract chaser + sweeper included) — `src/workflows/index.mjs`
  - Wanted true; got false.
- **FAIL** Template key EMAIL-AX07-FUNDING-PAUSED resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-C06-DECLINE resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-DPC05-NO-PROGRESS-72H resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-DS01-REPAIR-REFERRAL resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-DS02-DIY-LETTERS-READY resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-F02-ID-PORTAL-NEEDED resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-F03-ROUND-SUBMITTED resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-F04-ROUND-APPROVALS resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-F06-MISSING-DOCS resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-F07-FUNDING-LOCKED resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-F10-INBOX-SETUP resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-N01-COLD-NURTURE resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-N02-WARM-NURTURE resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-N03-HOT-NURTURE resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-N04-POST-FUNDING resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-N06-RENEWAL resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-S02-FINISH-APPLICATION resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-S05A-NOSHOW-RECOVERY resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key EMAIL-U02-ANALYZER-REPAIR-DELIVERY resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-AISET03-MSG1 resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-AISET03-MSG2 resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-AISET03-MSG3 resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-AX07-FUNDING-PAUSED resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-C06-DECLINE resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-DPC04-RESCHEDULE-REBOOKING resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-DPC05-NO-PROGRESS-72H resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-DS01-REPAIR-REFERRAL resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-F02-ID-PORTAL-NEEDED resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-F03-ROUND-SUBMITTED resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-F04-ROUND-APPROVALS resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-F06-MISSING-DOCS resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-F07-FUNDING-LOCKED resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-F10-INBOX-SETUP resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-N01-COLD-NURTURE resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-N02-WARM-NURTURE resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-N03-HOT-NURTURE resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-N04-POST-FUNDING resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-N06-RENEWAL resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-ROUND-STARTED-NOTIFY resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **FAIL** Template key SMS-S05A-NOSHOW-RECOVERY resolves to a message_templates row — `src/messaging/seed/seed.mjs`
- **SILENTLY-DID-NOTHING** Funding path queued at least one message with a template key — `src/workflows/messaging.mjs`
  - messages for clients=0, none queued/held. Workflows may have skipped sendTemplated (missing template, compliance, or early return).
- **SILENTLY-DID-NOTHING** Closer dashboard surfaces clock-in/shift requirement when no open shift — `public/app/closer-dashboard.html`
  - No clock/shift copy visible — closer may think they can work when writes will 403

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
| Company Brain live embedding retrieve | OPENAI_API_KEY (or COMPANY_BRAIN_OPENAI_API_KEY) |
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
- YES — system / E. Idempotency, replay, ordering — money/data spine held in this run
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
- NO — system / PART 4 — Cross-cutting — see journey account
- YES — owner / daily UI screens — screens load under mocked API; live backend not proven here
- YES — admin / daily UI screens — screens load under mocked API; live backend not proven here
- YES — sales_manager / daily UI screens — screens load under mocked API; live backend not proven here
- YES — closer / daily UI screens — screens load under mocked API; live backend not proven here
- YES — funding_advisor / daily UI screens — screens load under mocked API; live backend not proven here
- YES — inquiry_specialist / daily UI screens — screens load under mocked API; live backend not proven here
- YES — setter / daily UI screens — screens load under mocked API; live backend not proven here
- YES — affiliate / daily UI screens — screens load under mocked API; live backend not proven here
- YES — partner / daily UI screens — screens load under mocked API; live backend not proven here
- NO — closer / clock-in gate — no shift UX — silent 403 risk on writes
- YES — client / portal — static load ok under mock; magic-link + pay + sign need live credentials

## 8. Operator notes

Skeptical operator stance. PASS means a write path was exercised and the persisted value matched.

SILENTLY-DID-NOTHING means the operation returned without error and left no useful row — the recurring Fundhub failure mode.

UNVERIFIED means this run could not honestly prove the claim (missing credential, empty corpus, or UI not run).

Adapters used mock secrets. ANTHROPIC_API_KEY unset. messaging_settings.outbound_enabled=false. Nothing transmitted.

Money checked via src/verification/fixtures.mjs MONEY constants (hand-calc), not by calling commission helpers under test.

## 9. UNVERIFIED inventory

- Quiet-hours message holds then releases — Requires controlling clock + dispatcher drain; dispatcher sends only with provider creds. Exercised in unit tests; not end-to-end here.
- Workflow contract-chaser never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow message-dispatch-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow inquiry-call-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow n-01-cold-nurture never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow n-02-warm-nurture never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow n-03-hot-nurture never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Canonical event booking.rescheduled has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event booking.cancelled has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event decision.rendered has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event sale.closed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event file.finalized has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event payment.failed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event payment.expired has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event payment.canceled has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event payment.refunded has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event payment.disputed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event inquiry.gate.raised has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event inquiry.gate.clear has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event inquiry.docs.needed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event letter.generated has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event message.queued has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event message.sent has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event message.failed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event message.blocked has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event commission.earned has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event commission.approved has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event commission.paid has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event invoice.created has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event invoice.paid has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event invoice.voided has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event contract.sent has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event contract.signed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.enrolled has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.docs.needed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.docs.complete has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.analysis.complete has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.analysis.empty has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.letters.ready has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.letters.sent has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.letters.delivered has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.response.received has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.response.parsed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.parse.low_confidence has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.response.retake has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.item.deleted has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.item.verified has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.item.updated has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.item.unaddressed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.round.complete has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.round.escalated has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.program.complete has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.stalled has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.cancelled has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event diy.package.requested has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event diy.package.generating has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event diy.package.ready has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event diy.package.delivered has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event diy.package.downloaded has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Proxy session credential isolation between advisors — status=401
