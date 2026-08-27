# Fulfillment-machine audit — 2026-08-18

Findings only. No app / config / env / intended-journey edits. No deploy.

**COMPLIANCE REVIEW REQUIRED** — consent capture + pull gate (W-CONSENT; no live pull). Payment event path (W-PAY; no card rail).

**This session owns:** W-INTAKE (create + shared ids + later teardown merge).
Other units run as parallel agents after ids land.

Live: `https://fundhub.ai`
Evidence: `docs/workflows/audit-engine-2026-08-18-evidence/`
Shared ids: `docs/workflows/audit-engine-2026-08-18-evidence/SHARED.json`

## Ground truth

Chris’s 2026-08-18 order (this board) is the working checklist for “does the machine do the work.”

Written journey files (`docs/journeys/*-intended.md`) only say **who can open which routes**. They do **not** name intake → CRS → underwrite → letters → desks → consent → pay → sign → message → conveyor → inbound. That absence is **MISSING ground truth**, not a license to invent a journey.

Named specs that are **not in this repo**:

- `fundhub-docs/sources/spec-client-control-panel.md` — **MISSING** (folder only has email / SMS / Airtable extracts)
- `fundhub-docs/sources/spec-inquiry-remover-dashboard.md` — **MISSING**

Specialist desk observable steps (the one named fulfillment screen) live in `docs/journeys/role-inquiry-remover-intended.md` “Specialist desk (observable)”. Use that for inquiry / repair desk only.

Anything this board does not name is **MISSING**. Do not invent.

## Sandbox / hard stops

- Every write hits **only** the simulated `client_id` in SHARED.json.
- Never touch live credit file `9af65808-a619-4e65-ae91-239766a006b7`.
- Existing test client `8556bedc-46e1-4d85-b0cd-a24adfee1521` is **read-compare only**.
- No live bureau call. No live TransUnion (E1006, owner 2026-08-16).
- No real card charge. No PostGrid physical mail. No real-person email or text.
- `emitCrsResult()` may be fed the **simulated** engine result — that is its designed input.
- Dry-run to the last safe step. Record what the next call would be.
- Do not press inquiry Send. Do not press repair Send. Do not complete a live pull.
- Payments: event path only. No card rail.
- Messaging: `FUNDHUB_TEST_INBOX` / `FUNDHUB_TEST_PHONE` only if the screen resolves them.
- Do not turn on `INNGEST_EVENT_KEY`. Do not set `CRS_ALLOW_LIVE`.
- Read-only for app code, tests, baselines, hooks, env, intended journeys. Write **only** evidence files + board status/manifest.

## Score

Score “does the machine do the work,” not “does the button exist.” Screen layer is already covered by W1–W16 / G1–G5. Do not re-audit screens except where this board needs a paint proof (CCP scores, closer dashboard, Repair tab rows, pull-button refuse vs accept, extension fallback string).

No PASS without one observable artifact per step: DB row, network status, or screenshot. Code-looks-like = **UNVERIFIED**.

## Shared client (filled by W-INTAKE)

| field | value |
|---|---|
| client_id | `41a3199f-1835-4ac8-91c0-d4f37bd92037` |
| crs_id | `c1f83e6b-a624-4f28-a32a-531a530b3ad4` |
| email | `sim+1787079946953@demo.fundhub.local` |
| card_id | `0a8e8863-5094-4fbc-af0f-c37e5a457c97` |
| org_id | `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6` |
| forbidden_live | `9af65808-a619-4e65-ae91-239766a006b7` |
| read_compare | `8556bedc-46e1-4d85-b0cd-a24adfee1521` |

## Tasks

| id | owns | status | depends |
|---|---|---|---|
| W-INTAKE | Create simulated client via POST /api/demo/simulate. Prove tables + pipeline card. Record ids. | done | — |
| W-CRS | Feed simulated result through `emitCrsResult()`. Events, handlers, scores/util/estimate on client + paint on CCP + closer dashboard. | done | W-INTAKE ids |
| W-UW | `src/underwrite/engine.mjs` on the file. Tiers, reason codes, preapprovals. Does `funding-letter-pdf.mjs` render. Plausible vs seeded tradelines. | done | W-INTAKE ids |
| W-OPT | `src/optimize/` ceilings/rules. `src/metro2/` letter pack: `letters_generated` rows, HTML exists, content matches seeded tradelines. | done | W-INTAKE ids |
| W-DESKS | Inquiry desk real rows + open case + `buildCaseSendRequest` valid (do not Send). Repair tab rows / gap. FTC upload store? `buildRepairSendRequest` valid. `api/repair/send.mjs` requirements / next call / missing creds. Do not send. | done | W-INTAKE ids |
| W-CONSENT | POST /api/consent/capture soft-pull on simulated client. Row shape vs pull gate. Button refuse vs accept. Stop at gate. No live pull. | done | W-INTAKE ids |
| W-PAY | `payment.received` / `diagnostic.paid` resolve this client? `onDiagnosticPaid` stage / `crs_paid` / entitlement 0/6 → n/6. Event path only. | done | W-INTAKE ids |
| W-SIG | Send + sign a contract on the simulated client (test inbox). Does `contract.signed` unlock anything for THIS file. Cross-check W10. | done | W-INTAKE ids |
| W-MSG | One message to FUNDHUB_TEST_INBOX / FUNDHUB_TEST_PHONE if screen resolves them. Inbox landing or honest fail (A2P pending expected). | done | W-INTAKE ids |
| W-CONV | Conveyor: inquiries removed → file optimized → banks populate → apply via proxy, as far as data exists. Lender matches. Proxy launch to credential error only. Extension detect-or-fallback manual string. | done | W-INTAKE ids |
| W-INB | `src/metro2/inbound/` + `mail.response` / `docs.received`. Safe inject or document payload + UNVERIFIED. Does `c-03-inquiry-removed-resume-or-hold` have a path for this file. | done | W-INTAKE ids |
| W-WF | For each registered workflow whose event fired this audit: ran / didn't / errored. List ones that could never fire for this file and why. | done | other units’ event logs |
| W-TEAR | DELETE the simulated client. Prove rows gone. List orphans. | done | all prove units done |
| W-MERGE | Write REPORT.md + board findings. | done | W-TEAR |

## Parallel vs wait

- No dependencies among W-CRS, W-UW, W-OPT, W-DESKS, W-CONSENT, W-PAY, W-SIG, W-MSG, W-CONV after ids exist. All parallel.
- W-INB can start after ids; may wait on inquiry rows if W-DESKS creates them.
- W-WF reads event logs after the prove units write them.
- W-TEAR waits for every prove unit.
- Cap 5 agents at a time. Waves: (1) CRS UW OPT DESKS CONSENT (2) PAY SIG MSG CONV INB (3) WF + TEAR + MERGE.

## Seeded tradelines (from `src/demo/simulate-client.mjs`)

Used to judge “plausible” and “right accounts / right bureaus”:

| creditor | type | limit | balance | id | bureau |
|---|---|---|---|---|---|
| Chase Sapphire Preferred | revolving | 12000 | 2100 | SIM-CHASE-001 | EX |
| American Express Blue Business Cash | revolving | 25000 | 4800 | SIM-AMEX-001 | EQ |
| Capital One Spark | revolving | 8000 | 950 | SIM-CAP1-001 | TU |
| Toyota Motor Credit | installment | 28000 | 14200 | SIM-TOYO-001 | EX |

Seeded scores: EX 718 / EQ 724 / TU 731. Utilization 18%. Estimate 125000. Outcome FULL_FUNDING. Email domain `demo.fundhub.local`. Phone `+1555…`. `is_demo=true`.

## Registered workflows (`src/workflows/index.mjs`)

af-02, ai-set-03, ai-set-04, at-01, bc-01, bc-02, bs-01, contractChaser, messageDispatchSweeper, c-00, c-02, c-02b, c-03, c-05, c-06, dpc-01..03, dpc-05, ds-01, ds-02, f-01..f-11, n-01..n-04, n-06, round-started-client-notify, s-01, s-04, s-04b, s-nobook, s-05a, s-06, s-08, sys-01-client-value, sys-01-ltv, u-02, u-03, u-04, u-05.

Inngest does nothing until `INNGEST_EVENT_KEY` is on (owner-reserved). Sync bus handlers live in `src/register-all.mjs` (lifecycle, comms, payment-links, money-chain, customer-insights, inquiry-gate, inquiry-docs, commas-disputes, diagnostic-soft-pull, agent-runtime). `c-06` is an Inngest function, not a register-all handler.

## Evidence rules

Each unit writes `docs/workflows/audit-engine-2026-08-18-evidence/<id>/` with:

- `proofs.json` — one object per step: `{ id, result, expected, observed, evidence }`
- Screenshots / JSON dumps named after the step
- A short `NOTES.md` (findings only, 5th-grade language)
- Claim the task on this board before starting. Write a manifest when done.

Never print secrets, passwords, or full env values. Confirm credentials by **name only**.

## Change manifests

### W-WF
- Files: `audit-engine-2026-08-18-evidence/w-wf/*` only. App code: none.
- Writes: evidence only. Did not emit. Did not turn on `INNGEST_EVENT_KEY`. Did not set `CRS_ALLOW_LIVE`. Did not teardown.
- Events on THIS file (DB + W-PAY null-client rows): `docs.received`, `analysis.completed`, `decision.rendered`, `payment.received`, `diagnostic.paid`, `contract.sent`, `contract.signed`, `mail.response`, `round.approved`, `inquiry.removed`. 10 names. Inngest live = didn't.
- 51 functions in `src/workflows/index.mjs`. Ran on Inngest: 0. Errored: 0. Local handle only: 6 (c-00, c-03, c-06, f-06, f-09, f-11). Could never fire: 34 (wrong event or cron). Trigger fired / Inngest didn't / no local handle: 11.
- Sync bus ran: client-lifecycle, money-chain, diagnostic-soft-pull, comms (`mail.response`), inquiry-docs (no flip), payment-links (0 links). Silent: customer-insights, inquiry-gate, commas-disputes, agent-runtime.
- SIG/INB folders complete. No incomplete note.
- App code: none.

### W-INB
- Files: `audit-engine-2026-08-18-evidence/w-inb/*` only. App code: none.
- Writes (THIS client only): local `registerAll` + `emit` of `mail.response` / `docs.received` / `inquiry.removed` (`skipInngest`). Local `handle()` for f-06 / f-09 / f-11 / c-03. `handleInboundResponse` for metro2 (held ok; high-confidence write refused by RLS). No bureau. No Mailgun. No PostGrid. Inngest not sent. Client left in place.
- Metro2: no `bureau-response` bus event. Function expects `{ orgId, clientId, caseId, ocrText, items }`. Returns `repair.parse.low_confidence` / `repair.response.parsed` and does not emit. Persist **UNVERIFIED** — `repair_decision_log` RLS 42501. 0 dispute cases. 0 decision-log rows.
- `mail.response` `9e56ad39-…` → `bank_inbox` `304146d6-…` APPROVED. Bus handler `onMailResponse` only. Local f-06/f-09 no-op. Local f-11 made task `170414e0-…` + funding card `aaa14525-…` + `round.approved` `dc16b5e0-…`. F-06 MISSING_DOCS skipped; next call `sendTemplated` (queue only).
- `docs.received`: W-DESKS already wrote `b9ee35c4-…` on FTC upload. Second local emit `03d3666c-…`. Case stayed Queued (not Blocked; packet incomplete). Local f-06 docs path ran; hold stayed “Awaiting CRS.”
- C-03: trigger is `inquiry.removed` (Inngest only; no bus handler). THIS file has no real path (Queued, not sent). Local `handle()` ran resume. Tag `inquiry:completed`. Task `d10ea1d6-…`. Inngest did not run.
- Events log: `w-inb/events-fired.json` for W-WF.
- W-TEAR extras: that inbox row + two tasks + funding card + four events + tag/fields above.
- App code: none.

### W-SIG
- Files: `audit-engine-2026-08-18-evidence/w-sig/*` only. App code: none.
- Writes (THIS client only): `POST /api/contracts` create_draft + send → contract `82f9232a-3c6d-4cd5-85eb-b4995e4f539a` template `FUNDING-AGREEMENT`. Signer email overridden to `FUNDHUB_TEST_INBOX` via designed `signers[]` (sim+ address is not a real inbox). Signed in-app with test name. `contracts.status=signed`. Event `contract.signed` `98346e63-327c-4e9c-969e-42b76938dbfc` (`client_id` present). Send mail `12e64626-…` `CONTRACT-SEND-EMAIL` status=sent via Resend. Documents `9e11d5b1-…` (sent copy) + `864fd394-…` (signed copy, `not_delivered`). Signer `78e99a73-…`. Event `contract.sent` `678a8671-…`. Did not sign a dispute letter. Did not press inquiry/repair Send. Client left in place (no teardown).
- Unlock on THIS file: none. Stage stayed `decision_rendered`. No task, entitlement, consent, pull, letter, follow-up mail/SMS, GHL change, or `clients.updated_at` change after the sign. Listeners: empty (`canonical.mjs` says none on purpose; `register-all.mjs` none; Inngest none). W10 still true.
- W10 table: listener-less sign **SAME**; soft-pull unlock **N/A** (this file signed funding, not SOFT-PULL-CONSENT); dispute letter **SAME** unsigned; signed copy not sent **SAME**.
- W-TEAR extras: that contract + signer + two documents + one message + two events.
- App code: none.

### W-CONV
- Files: `audit-engine-2026-08-18-evidence/w-conv/*` only. App code: none.
- Writes: none on this client. One live `POST /api/proxy/launch` (dummy lender id) → 503 `oxylabs_credentials_missing`. `proxy_sessions` stayed 0. Did not open a bank site. Did not retry.
- Hops on THIS file: inquiries removed **empty** (0 `inquiry.removed`; case `d1635579-…` still Queued). File optimized **empty** (0 letters; util still seed 18). Banks **empty / simulate mock only** (`bank_accounts.id=3bcd460c-…` Simulated Checking, `raw.provider=mock`). Apply path **exists**; apply **does not run**.
- Lender matches: `GET /api/read/lender-matches?client_id=` 200, `match_count=0`, org `lenders` 0. No round/id required. Compare 8556 also 0.
- Extension fallback string: **MISSING** on screen (launch never returned ok). Designed copy saved. CCP: “Lender list is empty — import CSV on Lenders.”
- Cred names checked (values not printed): `OXYLABS_USERNAME`, `OXYLABS_PASSWORD`. W-TEAR: 0 rows from this unit.

### W-PAY
- Files: `audit-engine-2026-08-18-evidence/w-pay/*` (proofs.json, NOTES.md, events-fired.json, before.json, after.json, before-after-delta.json, emits.json, resolve-path.json, live-payment-events.json, live-email-shape.json, soft-pull.json, c00.json).
- Writes (THIS client only): local `registerAll` + `emit` of `payment.received` / `diagnostic.paid` (event path; no card rail). Event ids in `events-fired.json`. Two `$32` `transactions` rows. One `sales` row `75429aa0-2105-4e4d-858a-1b57b605f4ed` + two `sale_payments`. `clients.custom_fields.crs_paid=true` plus C-00 stamps (`crs_status=Requested`, no portal account). No entitlement rows. Card stayed `decision_rendered`. No bureau. Inngest not sent. Client left in place (no teardown).
- How client resolves: `emit()` stores `opts.clientId` or null. Handlers use `resolveClient` (id, else email, else null). Without `clientId` + this email still wrote this file. Without both, resolve is null (W10 no-op). Live payment rows: all `client_id` null; they do have emails (W10 “no email” not confirmed). Two live emails match forbidden file `9af658…` — read only.
- Stage / unlock: `crs_paid` json field yes. `clients.crs_paid` column MISSING. `client_custom_fields` no row. Entitlements stayed 0/5 catalog (portal paints 6 tiles). `product_entitlements` empty. Journey for payment unlock MISSING.
- App code: none.

### W-DESKS
- Files: `audit-engine-2026-08-18-evidence/w-desks/*` only. App code: none.
- Writes (THIS client only): `POST /api/inquiry-cases` action=create → `inquiry_removal_cases.id=d1635579-eda9-4961-8ca8-50abe7151ecf` (Queued, EX, request_source=w-desks-audit, is_demo=false). `POST /api/documents-upload` subtype `additional_fraud_docs` → `documents.id=bf55375a-b4c7-48aa-8241-9b818bc60c82`. Did not Send inquiry. Did not Send letters. Did not call PostGrid / bureau / inquiry-removal-ai-sigma.
- Findings: Simulate seeds no inquiries (empty log is correct). Machine can open a case without a bureau. `buildCaseSendRequest` valid. Repair list empty — simulate does not seed `dispute_*` or an optimization card (G2 gap). FTC upload stores. `buildRepairSendRequest` valid; live file has 0 letters. Repair send next call is PostGrid; `mail:false` refused.
- W-TEAR extras: that case row + that documents row.

### W-OPT
- Files: `audit-engine-2026-08-18-evidence/w-opt/*`
- Writes: none (in-process generate only; persist skipped; PostGrid not called).
- Findings: `src/optimize/` is ad-spend, not credit-file work — no rules/ceilings fired on this client. No `letters_generated` table (stage name only). Simulate seeded 0 letter rows. Designed metro2 path (`from-crs` → `buildDiyPackage`) returned 0 violations / 0 dispute letters because stored CRS has no `bureaus` map and no `sourceType`. Instruction text only; no HTML; seeded accounts unnamed. W-TEAR: 0 rows from this unit.
- App code: none.

### W-INTAKE
- Files: `audit-engine-2026-08-18-evidence/w-intake/*`, `SHARED.json`
- Writes: one live `POST /api/demo/simulate` as owner. Client `41a3199f-1835-4ac8-91c0-d4f37bd92037` (`is_demo=true`).
- Tables that hold the report: `clients`, `crs_results`, `tradelines` (lender/kind/cents/account_ref; bureau lives in seed payload, not a tradelines.bureau column). Optional `bank_accounts` row "Simulated Checking".
- Pipeline card: **yes** — `cards.id=0a8e8863-5094-4fbc-af0f-c37e5a457c97`. Created by `src/demo/simulate-client.mjs` when a sales-pipeline first stage exists.
- App code: none.

### W-CRS
- Files: `audit-engine-2026-08-18-evidence/w-crs/*`
- Writes (THIS client only): local `registerAll` + `emitCrsResult()` of simulated `crs_results.result`. Events `analysis.completed` `a091eafb-7af8-472e-94d5-bd89ccb54911` + `decision.rendered` `8bff4125-ee2d-41e5-b6bb-f24e6c897a2e`. Lifecycle merged scores/util onto `crs_results.result`, wrote `custom_fields` estimate 125000, moved card `new_lead` → `decision_rendered`. Local c-06 `handle()` tagged `path:funding` (Inngest off; letters empty). No bureau. No teardown.
- Events log: `w-crs/events-fired.json` for W-WF.
- App code: none.

### W-UW
- Files: `audit-engine-2026-08-18-evidence/w-uw/*` (proofs.json, NOTES.md, engine-output.json, letter-error.txt / letter-result.json, stored-*.json, funding-columns.json, documents.json, plausibility.json).
- Writes: none to the simulated client. Engine is in-memory only. Client `41a3199f-1835-4ac8-91c0-d4f37bd92037` left in place (no teardown).
- How: local node script used `DATABASE_URL` and the same chain as `src/underwrite/underwriteiq.pg.test.mjs` step 4: stored tradelines + crs_results → `toBureaus` → `computeUnderwrite` → `buildSuggestions` → `buildReport`. Then called exports on `funding-letter-pdf.mjs`.
- Engine: ran. `fundable=false`. `total_combined_funding=0`. No `tiers` / `reason_codes` / `preapprovals` keys. Adapter found **zero** bureaus because seed scores sit under `consumerSignals.scores.perBureau` and `crm_payload.scores`, not `result.scores`.
- Letter: `funding-letter-pdf.mjs` does not render PDF/buffer/HTML from an engine result. persist stored 0. load EX/EQ/TU = null. Error dump: `w-uw/letter-error.txt`.
- Plausibility: stored 4 lines match the seed (Toyota installment, revolving util 17.44% vs seed 18%). Engine never saw those lines on this run. $0 vs seed $125000. Engine does not read the seed FULL_FUNDING outcome.
- Columns: simulate wrote `clients.outcome_tier` and `crs_results.outcome_tier` = FULL_FUNDING plus seed reason_codes / preapprovals on the CRS JSON. Engine wrote nothing. `funding_rounds` 0. `documents` 0. `client_custom_fields` 0.
- App code: none.

### W-CONSENT
- Files: `audit-engine-2026-08-18-evidence/w-consent/*` only.
- Writes: one live `POST /api/consent/capture` grant (`checkbox`, kind `soft_pull_consent`) on simulated client `41a3199f-1835-4ac8-91c0-d4f37bd92037`. New row `7057e732-9411-4512-98b9-23a7a1fe7d77`.
- One live `POST /api/finance/crs-pull` bureau=TU **before** capture only → 403 `consent_required`. No `soft_pull_requests` row. After capture: did not press pull.
- Gate match: capture writes `client_consents`; `requestSoftPull` reads that table, kind `soft_pull_consent`, validity columns. `clients.consent_sms` is not the gate.
- Simulate stamp: `consent_sms=true`, zero consent rows before capture.
- Stop: next hop `POST /api/finance/crs-pull` → `runCrsPull`. Live host class is production; `CRS_ALLOW_LIVE` on. Sandbox exists in code but would not run on fundhub.ai.
- App code: none.

### W-MSG
- Files: `audit-engine-2026-08-18-evidence/w-msg/*` only. App code: none.
- Writes: none. Did not POST `/api/messages`. Did not email or text anyone. Client left in place.
- Seed: email `sim+1787079946953@demo.fundhub.local` + phone `+1555…` (11 digits) on this client. Unlike W1/W6/G3, both are present.
- Screen: live Messaging opens Simulated Client. Right rail shows that demo email and the 555 phone. Channel Text. No To field. `FUNDHUB_TEST_INBOX` set: yes (not this address). `FUNDHUB_TEST_PHONE` set: yes (not this phone).
- Send: blocked — destination would be the unmonitored demo address / 555 number, not the test inbox or test phone.
- Inbox landing: UNVERIFIED (no send). SMS: not tried (A2P not reached). `message.*` events: 0.
- W-TEAR: 0 rows from this unit.

## Blockers

- Named CCP / inquiry-remover specs are missing from `fundhub-docs/sources/`.
- Intended journeys do not describe the fulfillment machine.

## Findings (merge)

Full write-up: `docs/workflows/audit-engine-2026-08-18-evidence/REPORT.md`

The machine does **not** do the work on a simulated file. Simulate plants a pretty CRS + 4 cards + a pipeline card. Underwrite returns $0. Letters pack is empty. Repair is empty. Conveyor does not run. Job service did not run. Signature and paid unlock nothing. Pull next hop is live bureau (stopped). Live DELETE 504; extra deletes of this id only then removed the file.

### W-TEAR
- Live `DELETE /api/demo/simulate` **504**. Client still present after that call.
- Designed `teardownSimulated` skips contracts, documents, consents, inquiry cases, events, sales, bank inbox. Those blocked `clients` delete.
- Extra deletes of **this id only** then removed the client. `final.json`: leftover `{}`. Forbidden + compare still exist.
- App code: none.

### W-MERGE
- Files: `audit-engine-2026-08-18-evidence/REPORT.md`
- App code: none.
