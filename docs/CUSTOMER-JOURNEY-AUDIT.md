# Customer journey audit — 2026-08-02

Written for a human who was not watching the session and cannot open the CRM.
Plain English. Measured against `main` after the go-live batch (`87a7355`).

Diagnostic only — nothing was fixed here.

Two paths matter: the **funding path** (application → soft pull → decision →
contract → payment → onboarding) and the **credit-repair / DIY downsell** path.
Each step says whether a real client could complete it **today**, and what they
would see if not.

---

## A. Funding path (happy path)

### 1. Application / lead entry

**What should happen**  
Client submits a funnel (or staff enters them). System creates a client record
and fires `entry.captured` / survey events.

**Works today?**  
**Mostly yes for capture.** Handlers for `entry.captured` and `survey.submitted`
exist and write client data. Funnels / Clickfunnels-style ingress depend on
adapters and webhooks being configured in the environment.

**If it breaks, the client sees**  
Form may appear to succeed while nothing lands in the CRM (misconfigured
webhook), or staff must enter them by hand.

---

### 2. Soft pull consent + soft pull

**What should happen**  
Client consents; system records consent; soft pull runs; results land for the
decision engine.

**Works today?**  
**Partial.**

- Consent capture API and screen exist (`api/consent/capture.mjs`,
  consent-capture UI).  
- Soft-pull finance API exists (`api/finance/soft-pull.mjs`) and checks valid
  consent.  
- Bureau fulfilment still depends on external CRS/config. CONTROLS-AUDIT notes
  soft-pull fulfilment as unfinished relative to a full bureau path.  
- `analysis.completed` handler stores CRS results when that event is emitted.

**If it breaks, the client sees**  
Consent may save, but no scores / no decision — or staff see a client with
consent and no pull. Automation that should run after the $32 diagnostic may
never fire if payments / workflows are off.

---

### 3. Funding decision

**What should happen**  
Analyzer / CRS outcome stamps tier and funding estimate (`decision.rendered`).

**Works today?**  
**Yes when the event is emitted.** `onDecisionRendered` writes `outcome_tier`
and funding estimate custom fields. Producing the event still depends on the
analysis pipeline running (workflows / Inngest / upstream payment).

**If it breaks, the client sees**  
No “you’re pre-approved for $X” content; SMS/email templates merge empty
amounts; staff see no tier on the client.

---

### 4. Contract

**What should happen**  
Staff builds or picks a template, sends for e-sign; client opens link and signs.

**Works today?**  
**Yes for the CRM and signing surface**, after recent fixes:

- Templates can be saved (migration 129 repair + grants).  
- Send queues per-signer messages and can dispatch those rows.  
- Client signing page is open (HMAC link), PDF path supported.  

**Caveats**

- Actual **email delivery** still needs outbound provider credentials and the
  company outbound switch. Without them, the contract is ready and the message
  may sit **queued**.  
- Reminders / chaser exist as workflow + button; full auto-chase needs Inngest
  if you rely on the registered function alone.

**If it breaks, the client sees**  
No email in inbox (queue only), or a signing link that works if staff paste it.
Staff may see “sent” while nothing left the building.

---

### 5. Payment (deposit / fees)

**What should happen**  
Client pays via Commas (payment link or product checkout). System records
payment and unlocks next steps.

**Works today?**  
**Payment links: yes** (create in CRM, settle on webhook).  
**Product checkout webhooks: partial** — payments can stamp flags / transactions;
they do **not** write sales / commissions / entitlements (see money-chain audit).

**If it breaks, the client sees**  
Paid in Commas, but portal still locked; staff see a flag or transaction without
a clean sale/entitlement trail.

---

### 6. Onboarding after pay

**What should happen**  
Entitlements unlock, tasks/messages fire, funding advisor pipeline moves.

**Works today?**  
**Weak.** Entitlement grants are not written by live payment handlers. Pipeline
moves work when staff move cards. Automated onboarding messages need outbound
dispatch + credentials. Workflows that should run after pay need Inngest on.

**If it breaks, the client sees**  
Paid but portal features still locked; no welcome email; staff manually chase.

---

## B. Credit-repair / DIY downsell path

**What should happen**  
Client fails or opts out of full funding; buys DIY letters (`sale.closed` from
Commas DIY product); DS-02 raises invoice, prepares letters, emails.

**Works today?**  
**Partial.**

- Commas mapper emits `sale.closed` for DIY.  
- Handler only sets `sale_closed` flag — **no sale row, no entitlement grant.**  
- DS-02 workflow can create an invoice and continue letter steps **when workflows
  run**.  
- Letter delivery still posts to the configured letter URL from the workflow
  (existing exception path). Email of invoice uses the outbound stack.

**If it breaks, the client sees**  
Charged for DIY, flag set in CRM, but no package unlock and no email unless
workflows + mail are on. Staff cannot rely on commission or entitlement tables
for that purchase.

---

## C. Cross-cutting blockers (every journey)

| Blocker | Effect on a real client today |
|---------|-------------------------------|
| `INNGEST_EVENT_KEY` unset (owner switch) | Most of the 47+ workflows do not run on live events |
| Outbound provider credentials / `outbound_enabled` | Emails and many SMS stay queued or never transmit |
| Staff SMS via CRM relay + missing `ghl_contact_id` | New clients may not get text replies (known defect) |
| Company Brain Drive/OpenAI keys unset (intentional) | Brain search works extractively on stored chunks only; Drive sync does not run |
| Money writers missing (sales, ledger, entitlements, funding insert) | CRM looks alive; money truth tables stay empty |

---

## D. Step scoreboard (funding path)

| Step | Client-ready today? | One-line gap |
|------|---------------------|--------------|
| Apply / enter CRM | Yes if webhook/config OK | Misconfig = silent miss |
| Consent | Yes | — |
| Soft pull | Partial | Bureau/automation wiring |
| Decision stamped | Yes if event fires | Needs analysis pipeline |
| Contract sign | Yes (link + UI) | Email may not leave queue |
| Pay (payment link) | Yes | — |
| Pay (product → unlock) | No for entitlements/sales | Writers missing |
| Onboarding automation | No / manual | Workflows + mail + grants |

---

## E. What a careful dry-run would feel like

1. Staff create a payment link → client pays → **link shows paid** (good).  
2. Staff send a contract → client can sign **if they have the URL**; email may
   never arrive until outbound is fully on.  
3. Client “closes” a DIY or funding product via Commas → CRM flag flips →  
   **no sale row, no commission, no entitlement** → portal and payout screens
   disagree with reality.  
4. Advisor expects a funding round record after funds wire → **table never gets
   a row from the app**.

That is the customer-visible shape of the money-chain gaps.

---

## Related docs

- `docs/MONEY-CHAIN-AUDIT.md` — writer-by-writer money detail  
- `docs/FULL-SYSTEM-AUDIT-2026-08-02.md` — Playwright, wiring, controls rollup  
- `docs/MERGE-LOG.md` — what just went live  
- `docs/CONTRACTS-SPEC.md` / `docs/PAYMENT-LINKS-SPEC.md` / `docs/REPLY-INBOX-SPEC.md` — deeper product specs  
