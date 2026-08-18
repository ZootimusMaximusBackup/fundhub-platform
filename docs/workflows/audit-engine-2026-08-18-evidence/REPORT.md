# Fulfillment machine — findings 2026-08-18

**COMPLIANCE REVIEW REQUIRED** — consent capture and pull gate (no live pull). Payment events only (no card charge).

Findings only. No app edits. No deploy.

The machine was scored on one fresh simulated client (`41a3199f-1835-4ac8-91c0-d4f37bd92037`). That file is now deleted. The live credit file and the old test client were not touched.

Ground truth: Chris’s 2026-08-18 order. Intended journeys only say who can open routes. They do **not** name this machine. Named specs `spec-client-control-panel.md` and `spec-inquiry-remover-dashboard.md` are **MISSING** from `fundhub-docs/sources/`. Anything unnamed stayed MISSING.

Board: `docs/workflows/audit-engine-2026-08-18.md`

---

## Does the machine do the work?

**Mostly no.** Simulate plants a pretty file. The desks, letters, underwrite, conveyor, and job service do not run on that file. A few pieces do work when we push them by hand.

---

## What worked

| Step | What we saw | Evidence |
|---|---|---|
| Intake | Live simulate 200. Client, CRS row, 4 tradelines, pipeline card, mock bank. | `w-intake/` |
| CRS emit | `analysis.completed` + `decision.rendered`. Money estimate $125,000 landed. CCP shows 718 / 724 / 731 and $125,000. | `w-crs/` |
| Consent capture | Live 200. Gate reads that same consent row. | `w-consent/` |
| Inquiry case | Machine can open a case with no bureau. Send payload is valid. We did not Send. | `w-desks/` |
| FTC upload | Tiny pdf stored. | `w-desks/` |
| Contract sign | Funding Agreement sent to the test inbox and signed. `contract.signed` has this client id. | `w-sig/` |
| Payment event | With client id or email, handlers find this file. `crs_paid` stamped in custom fields. | `w-pay/` |
| Teardown (after extra deletes) | This client is gone. Live file still there. | `w-tear/final.json` |

---

## What is broken

### 1. Simulate does not feed the rest of the machine

- **Journey:** fulfillment intake → CRS → underwrite → letters → desks  
- **Expected:** One seed is enough for the file to be scored, lettered, and shown on Repair.  
- **Observed:** Seed writes `FULL_FUNDING` and 4 cards. Scores sit in keys the underwrite adapter does not read. Metro2 sees 0 problems. Repair list is empty. No inquiries in the seed (empty inquiry log is correct).  
- **Evidence:** `w-uw/engine-output.json` · `w-opt/05-designed-from-crs.json` · `w-desks/04-repair-empty.png`

### 2. Underwrite says $0 on a $125,000 seed

- **Expected:** Tiers, reason codes, preapprovals, a funding letter file.  
- **Observed:** Engine `fundable=false`, combined **$0**. No those keys. `funding-letter-pdf.mjs` does not make a PDF from the engine result. Stored cards themselves look right (util 17.44% vs seed 18%).  
- **Evidence:** `w-uw/proofs.json` · `w-uw/plausibility.json`

### 3. Credit-file optimize does not exist here

- **Expected:** `src/optimize/` ceilings/rules on this credit file. Letter pack names Chase / Amex / Cap One / Toyota.  
- **Observed:** `src/optimize` is ad-spend. 0 dispute letters. No `letters_generated` table. Instruction pages only.  
- **Evidence:** `w-opt/NOTES.md`

### 4. Repair is empty (G2 gap)

- **Expected:** Repair tab shows this file if the machine seeded repair work.  
- **Observed:** “No repair files yet.” Simulate plants no `dispute_*` rows. Send-letters payload is valid; nothing to mail. Next call would be PostGrid. Not sent.  
- **Evidence:** `w-desks/04-repair-empty.png`

### 5. Pull button does not follow the gate

- **Expected:** Button locked without consent; unlocked after. Next hop sandbox if one exists.  
- **Observed:** Button looks enabled both ways. Before consent, TransUnion press = 403 “no consent.” After consent, gate is valid. Next hop on the live site is a **live** bureau pull (`CRS_ALLOW_LIVE` on). Stopped. `clients.consent_sms=true` is not the gate.  
- **Evidence:** `w-consent/ccp-before-pull-refuse.png` · `w-consent/stop-at-gate.json`

### 6. Closer dashboard does not paint this file

- **Expected:** Scores / util / estimate / cards show.  
- **Observed:** CCP shows scores and $125,000. Utilization box missing (API has 18%). Closer page stays on dashes. Tradeline API has 4 cards and $37,150. Scores never live on the client row — only on the CRS blob.  
- **Evidence:** `w-crs/07-ccp-scores.png` · `w-crs/07-closer-dashboard.png`

### 7. Paid does not unlock the file

- **Expected:** `diagnostic.paid` moves the stage and unlocks tiles 0/6 → n/6.  
- **Observed:** Card stayed Decision Rendered (will not move backward). Still 0 held / 5 catalog locked. Product-to-unlock map is empty. Event row keeps a client id only if emit is told the id. Live money rows are all `client_id` null (they do have emails).  
- **Evidence:** `w-pay/before-after-delta.json` · `w-pay/live-payment-events.json`

### 8. Signature unlocks nothing (same as W10)

- **Expected:** unnamed in journeys (**MISSING**).  
- **Observed:** `contract.signed` fired. Nobody listens. No stage, task, mail, or `updated_at` change. Signed PDF not delivered.  
- **Evidence:** `w-sig/dumps/07-after-vs-before.json`

### 9. Messaging cannot hit the watched inbox

- **Expected:** One send to `FUNDHUB_TEST_INBOX` / `FUNDHUB_TEST_PHONE`.  
- **Observed:** File has email + phone. Screen shows the fake demo address and a 555 number. No To box. Did not send. Inbox landing **UNVERIFIED**.  
- **Evidence:** `w-msg/02-messaging.png`

### 10. Conveyor does not run

- **Expected:** inquiries removed → file optimized → banks populate → apply via proxy.  
- **Observed:** Case still Queued. 0 letters. Bank row is the simulate mock. Lender list is 0. Proxy launch **503** `oxylabs_credentials_missing` (`OXYLABS_USERNAME`, `OXYLABS_PASSWORD`). Manual proxy string never painted.  
- **Evidence:** `w-conv/03-proxy-launch.json` · `w-conv/04-ccp-apply-door.png`

### 11. Job service never ran

- **Expected:** Registered workflows react when their event fires.  
- **Observed:** Inngest off (owner rule). 0 jobs ran live. 10 event names fired. 6 local `handle()` only (c-00, c-03, c-06, f-06, f-09, f-11). 34 could never fire (wrong event). 11 had their event and still did not run. `c-03` has no real path — case was never sent.  
- **Evidence:** `w-wf/NOTES.md` · `w-wf/workflow-status.json`

### 12. Live teardown does not finish

- **Expected:** `DELETE /api/demo/simulate` removes this demo file.  
- **Observed:** Live call **504**. Designed function skips contracts, documents, consent, cases, events, sales. Those blocked the client delete. Extra deletes of this id only then removed the file.  
- **Evidence:** `w-tear/delete-response.json` · `w-tear/local-cleanup.json` · `w-tear/final.json`

### 13. Bureau letter inbound did not store

- **Expected:** A safe simulated bureau reply stores.  
- **Observed:** No `bureau-response` event. Log insert refused. **UNVERIFIED** as a stored reply. Bank email / docs events can be fired locally.  
- **Evidence:** `w-inb/NOTES.md`

---

## Workflows (short)

Inngest ran: **0**. Errored: **0**. Local-handle-only: **6**. Could never fire: **34**.

Fired names: `docs.received`, `analysis.completed`, `decision.rendered`, `payment.received`, `diagnostic.paid`, `contract.sent`, `contract.signed`, `mail.response`, `round.approved`, `inquiry.removed`.

---

## Teardown

This simulated client is **gone**. Known audit rows are gone. Live credit file and old test client still exist.

Live DELETE did not do that. The designed teardown list is too short. Extra deletes of this id only finished the job.

---

## Left undone

- No live bureau pull (stopped at the gate).  
- No inquiry Send. No repair Send. No PostGrid mail.  
- No card charge.  
- Messaging not sent (wrong destination).  
- Inbox landing unproven.  
- Bureau-letter inbound storage UNVERIFIED.  
- Named CCP / inquiry-remover specs still missing.
