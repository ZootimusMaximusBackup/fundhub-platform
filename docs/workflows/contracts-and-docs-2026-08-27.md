# Contracts + Funding Docs — 2026-08-27

Owner: Chris. Board for a 4-workflow batch. Human-readable on purpose.

## Task list

| # | Task | Owner | Status |
|---|---|---|---|
| WF-1 | Shared contract brief + White Label / Partner Agreement ($10,000 + 50/50) | this session | claimed |
| WF-2 | Funding doc package — zip 3 Chase statements + build YTD P&L | unassigned | pending |
| WF-3 | Capital Academy agreement ($5,000, client-facing) | unassigned | pending |
| WF-4 | Capital Blueprint agreement ($5,000, client-facing) | unassigned | pending |

No dependencies between WF-2 and anything. WF-3 and WF-4 read the Shared Contract Brief below and then run independently.

---

## FINDING 1 — the two $5k programs already have names, and they are published

Chris said "I forgot the names." They are in a live, dated terms-of-service document:

`~/Documents/File-Sweep/Work-Bucket/Fundhub-Education-Service-Agreement.pdf`
Last updated **July 23, 2026**, published at tryfundhub.com. It says, word for word, that the current
programs are the **Credit Mastery System** and the **Capital Strategy Program**, each a 10-module video
curriculum priced at $5,000.

There is a third naming system. `docs/company-resources/closer-playbook-2026-08-24.md` sells
**"Funding Mastery"** at $5,000 and an **"UnderwriteIQ pack"** at $1,000–$5,000.

So the same two products have three sets of names across the website, the closer script, and now the
contracts. Chris chose **Capital Academy** and **Capital Blueprint** on 2026-08-27.

**This is not a blocker, it is a cleanup job.** Renaming is fine — it is the owner's call and it is made.
But the published terms of service and the closer playbook still carry the old names, and a client who
buys "Capital Academy" and then reads terms of service about the "Credit Mastery System" has a real
question nobody wants to answer on a call. Whoever takes WF-3/WF-4 should note this in their manifest.
A separate follow-up task should update the published TOS and the playbook. Not in this batch.

Mapping used for this batch (assumed — Chris to confirm):
- **Capital Academy** = the full financial education suite = was "Credit Mastery System"
- **Capital Blueprint** = the roadmap / diagnostic = was "Capital Strategy Program"

---

## FINDING 2 — the white label deal crosses two different businesses

The education side (tryfundhub.com) says in writing that Fundhub is **not** a lender, loan broker,
financial advisor, or credit repair organization, and that it does **not** contact bureaus, creditors, or
lenders on a client's behalf. Education only, client does the work themselves.

The closer playbook sells done-for-you services: "Funding, we do it" ($3,000 deposit + 10% later),
"Funding + repair", "Full repair" ($1,000), "Repair trial" ($200).

Those two positions do not describe the same company. The white label offer — "you send clients, we
fulfill" — sits across both. The partner agreement therefore has to be explicit about *which* services a
referred client is being sold, because the answer changes what the partner is allowed to say in an ad.
Handled in WF-1 via Schedule A + the marketing-control clause. Flagged, not solved.

**COMPLIANCE REVIEW REQUIRED** on the partner agreement (credit-repair messaging, fee timing).

---

## Shared Contract Brief — WF-3 and WF-4 use this verbatim

### Entity block
- Legal name: **Fundhub LLC** (lowercase h — not "FundHub", not "FUNDHUB")
- Place of business: **218 Bostick Rd 64, Bowling Green, FL 33834**
- Education brand: **Fundhub Education**, a program of Fundhub LLC
- Website / support: tryfundhub.com | support@tryfundhub.com
- Governing law: **Florida**
- Do NOT put the EIN, routing number, or account number in any client-facing contract. They are not
  needed and they are in a gitignored file for a reason.

### Defined terms (use these exact words)
- **Net Revenue** — all money actually collected by Fundhub from a client, minus refunds and chargebacks
  actually paid out, minus third-party payment processing fees actually incurred. It excludes sales tax
  collected and remitted, and excludes loan or financing proceeds that go to the client and never pass
  through Fundhub.
- **Program** — the specific $5,000 curriculum being purchased.
- **Materials** — video lessons, templates, workbooks, reference documents.

### Compliance schedule — every client-facing contract carries all of these
1. Education only. Fundhub Education is not a lender, loan broker, financing company, financial advisor,
   investment advisor, accountant, law firm, or credit repair organization.
2. No guarantees about credit scores, dispute outcomes, funding approval, income, or business results.
3. The client drafts, signs, and submits their own documents. Fundhub does not contact bureaus,
   creditors, or lenders on the client's behalf.
4. No using any template to submit information the client knows to be false.
5. Three-day right to cancel, stated in plain language, before any work begins.
6. Tuition is a single one-time charge. No recurring billing, no subscription.
7. Any financing at checkout is offered by an independent third party. Fundhub is not the lender and is
   not a party to that financing agreement.
8. Lifetime access to the purchased Program, including future curriculum updates.

### Tone
Match `Fundhub-Education-Service-Agreement.pdf`. It is already well drafted — plain sentences, numbered
sections, no throat-clearing. Copy its structure. Do not invent new clause styles.

---

## Source files — already located, do not re-hunt

- Business bank statements (Chase, Fundhub LLC): `credentials/fundhub-chase-statements/`
  `chase-2026-04-fundhub-llc.pdf`, `-05-`, `-06-`, `-07-`. Four months. Newest three are May/Jun/Jul.
- Existing client contract to match: `~/Documents/File-Sweep/Work-Bucket/Fundhub-Education-Service-Agreement.pdf`
- Articles of Organization: `~/Documents/File-Sweep/Legal/Fundhub LLC Articles of Organization.pdf`
- Offer ladder + prices: `docs/company-resources/closer-playbook-2026-08-24.md` §1

## Open questions for Chris

1. **P&L does not exist.** Searched the repo, Documents, Desktop, Downloads, iCloud. There is no
   profit-and-loss statement on this machine. WF-2 will build one from the four Chase statements and
   label it bank-derived and unaudited. Confirm that is what you want rather than a real bookkeeping export.
2. Your upload form also asks for a **YTD Balance Sheet** and **most recent business financial
   statements**. Neither exists either. Not in scope for this batch — say the word and it becomes WF-5.
3. Confirm the Capital Academy / Capital Blueprint mapping in Finding 1.
4. Media buying add-on: who owns the ad account, and is the fee a flat monthly or a percentage of spend?
   WF-1 leaves both as fill-in blanks.

## Manifests

_(each workflow appends here when done)_

### WF-1 — in progress

**WF-1 status: DONE.**

Delivered: `~/Desktop/fundhub-contracts/Fundhub-White-Label-Partner-Agreement.docx`
21 sections + Schedule A (services, pricing, brand election) + Schedule B (media buying add-on),
dual signature blocks. Deal shape per Chris 2026-08-27: Partner refers, Fundhub fulfills and is
merchant of record, $10,000 one-time Program Fee, 50/50 split of Net Revenue, optional media buying
on Schedule B at a separate fee. 12-month term, 12-month revenue tail, Florida law, AAA arbitration.

**COMPLIANCE REVIEW REQUIRED** — the agreement carries credit-repair messaging controls (§9) and
fee-timing language (§9.3).

---

## FINDING 3 — the Fundhub LLC bank account is empty and dormant. This blocks the funding application.

Verified by reading all four Chase statements directly.

| Statement period | Beginning | Ending | Activity |
|---|---|---|---|
| Apr 24 – Apr 30, 2026 | $0.00 | $0.00 | none |
| May 01 – May 29, 2026 | $0.00 | $0.00 | none |
| May 30 – Jun 30, 2026 | $0.00 | $0.00 | none |
| Jul 01 – Jul 31, 2026 | $0.00 | $0.00 | none |

Chase's own text on the April and May statements: "There has been no activity on your account during
this statement period." The account is Chase Platinum Business Checking, opened 2026-04-24, in the
name FUNDHUB LLC at the Bowling Green FL address. It has never been used.

It is also accruing **$95.00 per month** in service charges — visible on the June and July statements,
with the July charge noted as assessed on 8/3/26. That is roughly $380 so far on an unused account.

**Consequences, in order:**

1. **WF-2's P&L task is void as written.** A profit-and-loss statement is built from transactions.
   There are zero transactions. There is nothing to derive. A P&L must not be authored from anything
   other than real records — do not let any workflow generate one.
2. **These three statements will not pass a funding underwriter.** Business funding is underwritten on
   average daily balance and monthly deposit volume. Three consecutive months of $0.00 and no activity
   reads as a dormant shell account and is a decline at the first automated screen.
3. **The real question is where the revenue actually lands.** The closer playbook sells a live offer
   ladder and there is a live Commas payment catalog, so money is being collected somewhere. It is not
   arriving in the Fundhub LLC Chase account. Whichever account receives the Commas settlements is the
   account whose statements the funder needs, and whose transactions a real P&L would come from.

The only other statements on this machine are Vantage West Credit Union member statements in **Chris's
personal name** at a Gilbert AZ address (balances $0.27 and $5.00). Those are personal, not Fundhub
LLC, and are not business bank statements for this application.

Nothing was fabricated and nothing was submitted. Statements delivered as-is for Chris to decide.

### WF-3 — DONE
`~/Desktop/fundhub-contracts/Fundhub-Capital-Academy-Enrollment-Agreement.docx`
$5,000 ten-module education suite. 15 sections, plain-language "what you get / what this is not" box,
three-day cancellation right (§7), no-guarantees clause (§3), education-only positioning (§2),
Florida law, AAA consumer rules. Signature block for student + Fundhub.

### WF-4 — DONE
`~/Desktop/fundhub-contracts/Fundhub-Capital-Blueprint-Service-Agreement.docx`
$5,000 one-time assessment and written plan. Same skeleton as WF-3 so the two do not disagree.
Delivery is 15 business days from completed intake (§6.1), one round of written clarification,
framed as educational assessment rather than personalised financial advice.

Both carry the full §Compliance schedule from the Shared Contract Brief. Both use the names Chris
chose on 2026-08-27. FINDING 1 still stands and is unaddressed: the published terms of service at
tryfundhub.com and the closer playbook still carry the old program names. That is a separate task.

## Batch status: all four workflows complete.

---

## FINDING 4 — the rename is NOT a small job. Do not run it unattended.

I said earlier this was a cleanup task. I was wrong, and here is the evidence.

`funding-mastery` is not a display label. It is a product code with live data behind it:

| Where | What it is | Risk if renamed |
|---|---|---|
| `db/migrations/180_product_entitlements_seed.sql:128` | entitlement `funding-mastery-course` | **paying clients lose access to what they bought** |
| `db/migrations/181_offer_prices_and_trial_product.sql:89,125` | catalog product code + a prior code migration | orphans existing order rows |
| `src/config/offers.mjs:45` | maps to the Commas checkout title | checkout stops matching the processor |
| `src/config/offers.mjs:142` | `productCode: "funding-mastery"` | breaks the offer-to-product link |
| `public/app/pipeline.html:701` | `<option value="funding-mastery">` | value is persisted on existing records |
| `public/app/client-portal.html:662,667,879` | client-facing tile + `data-book` string | booking automation matches on this string |

Migration 181 already notes this is "the sixth catalog code migration" for this product. Renaming the
code a seventh time, at night, in a tree shared by five other live sessions, with no one awake to
check whether a client lost portal access, is the most expensive mistake available here.

### The safe version, for when Chris is awake

**Display names and product codes are two different things.** The client-visible name can change
without touching a single line of code that gates access. That turns this from a database migration
into a small, reversible edit.

Change ONLY these, all display strings:
- `src/config/offers.mjs:137` — `name:` field (leave `key:` and `productCode:` alone)
- `public/app/pipeline.html:701` — the option's visible text (leave `value="funding-mastery"` alone)
- `public/app/present.js:386` — sales deck copy
- `public/app/client-portal.html:662,670` — tile title and label
- The five closer docs in `docs/company-resources/`

Never touch: any `productCode`, `key`, `value=`, entitlement code, or migration file.

**One thing to verify first:** `data-book="Funding Mastery course (A to Z)"` in client-portal.html
appears twice and may be string-matched by booking automation. Grep for that exact string across
`src/` before changing it, or the "Talk to an advisor" button silently stops booking.

**Do it all at once or not at all.** A partial rename is worse than none: the closer reads
"Capital Academy" off the script while the client is looking at "Funding Mastery" on their screen.

### Also unresolved: the two-versus-one problem

The published terms of service names **two** $5,000 programs (Credit Mastery System, Capital Strategy
Program). The product has **one** ($5,000 Funding Mastery). Neither old TOS name appears anywhere in
this repo — they exist only in the published document on tryfundhub.com. So before any rename, Chris
needs to answer: is Capital Blueprint an existing product being renamed, or a new product that needs
a code, a price, an entitlement, and a checkout item? The contract for it is written either way.
