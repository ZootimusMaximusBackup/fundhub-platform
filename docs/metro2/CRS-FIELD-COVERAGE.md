# What a CRS soft pull actually tells us

Plain-language summary for Chris, then the detail.

**The short version.** The credit report we buy from CRS does not contain most of
the specific codes the dispute rules need. We can read the money, the dates, who
is reporting, and the personal information. We cannot read the code that says
"this account was charged off" or "this account went into bankruptcy" or "the
consumer disputed this" — those are in the raw industry file the bureaus send
each other, not in the report they sell us.

**What that means for the product.** Twelve of the thirty-eight checks can run on
a CRS soft pull today. Twenty-six cannot, because a piece of information they
need is not in the data. Those twenty-six are not broken and they are not
disabled — they stay silent, which is the correct and safe behaviour. Give them
the missing information and they work.

**What would unlock the rest.** One thing, mostly: the consumer's own copy of
their credit report, which by law they can get free from each bureau at
annualcreditreport.com and which does show the charge-off and bankruptcy
markers. That is a document the client uploads, not a data feed we buy. The
second-biggest unlock is intake questions we already plan to ask (has the client
filed bankruptcy, did they dispute this before, do they recognise this inquiry).

**Measured, not assumed.** Every number below comes from running the normalizer
over the three real CRS sandbox payloads — 31 consumer tradelines and 74
inquiries across TransUnion, Experian and Equifax. Nothing here is an estimate.

---

## Evidence

| Source | Payload | Tradelines | Inquiries |
|---|---|---|---|
| CRS sandbox library | TransUnion consumer | 4 | 0 |
| CRS sandbox library | Experian consumer | 14 | 23 |
| CRS sandbox library | Equifax consumer | 13 | 51 |
| | **Total** | **31** | **74** |

Measured on 2026-08-07 against
`/Users/zootimusmaximus/Downloads/CRS Sandbox — JSON Payload Library.md`, with
the report date set to each payload's own `dateRequested` (2026-03-01). The two
Experian *business* reports in that file are commercial-credit data and are out
of scope for Metro 2 consumer dispute work.

Counts are `observed / absent / not_visible` across all 31 tradelines.

- **observed** — the field is there with a value.
- **absent** — CRS carries the field and the furnisher left it empty. This is
  reportable; on some accounts the emptiness *is* the violation.
- **not_visible** — CRS never carries the field. Not reportable. A limit on what
  we know, not a defect in what the furnisher did.

---

## Fields we can read

| Metro 2 | Field | CRS source | Counts | Note |
|---|---|---|---|---|
| — | Furnisher name | `creditorName` | 30 / 1 / 0 | One Equifax tradeline reports no creditor name |
| — | Bureau | `sourceType` | 31 / 0 / 0 | Rename only: TransUnion→TU, Experian→EX, Equifax→EQ |
| 7 | Account number | `accountIdentifier` | 31 / 0 / 0 | Last four digits only |
| 8 | Portfolio Type | `accountType` | 29 / 0 / 2 | Rename on four values; `Unknown` refused (2 tradelines) |
| 10 | Date Opened | `accountOpenedDate` | 31 / 0 / 0 | |
| 21 | Current Balance | `currentBalanceAmount` | 29 / 2 / 0 | |
| 22 | Amount Past Due | `pastDueAmount` | 7 / 24 / 0 | Empty on current accounts, as expected |
| 23 | Original Charge-off Amount | `chargeOffAmount` | 1 / 30 / 0 | Only one charged-off account in the sandbox |
| 24 | Date of Account Information | `accountReportedDate` | 31 / 0 / 0 | |
| 26 | Date Closed | `accountClosedDate` | 5 / 26 / 0 | Empty on open accounts, as expected |
| 37 | ECOA Code | `accountOwnershipType` | 27 / 0 / 4 | Six values translate; `JointParticipating` and `Undesignated` refused (4 tradelines) |

### The three translations, and why each is allowed

A translation is permitted only where the vendor's own enumeration name is the
same category under a different label — a rename, not an inference.

**Portfolio Type (Field 8).** Metro 2 uses C/I/M/O/R. CRS `accountType` sends
`Revolving`, `Installment`, `Mortgage`, `Open`, `Unknown`. Four of those are the
same four categories spelled out; `Unknown` maps to nothing and stays invisible.
Metro 2's "C" (Line of Credit) has no CRS counterpart and is never produced.

**ECOA Code (Field 37).** Exhibit 10's own wording and the CRS wording coincide
exactly on six values: `Individual`→1, `JointContractualLiability`→2,
`AuthorizedUser`→3, `Comaker`→5, `Maker`→7, `Terminated`→T.

The refusals matter more than the matches. `JointParticipating` means a joint
account *without* contractual liability, and Exhibit 10 has no code for that. A
bare `Joint` does not say which kind it is. `Undesignated` is CRS stating it does
not know. Mapping any of these to ECOA 2 would assert that the consumer is
contractually liable for a debt on the strength of an ambiguous label — the
opposite of what an accuracy dispute is for.

**Bureau.** A rename.

---

## Fields we cannot read

| Metro 2 | Field | Why not |
|---|---|---|
| 9 | Account Type | A two-digit industry code from Exhibit 1. The knowledge base references Exhibit 1 but does not reproduce it, so there is no code table in this repo to map CRS's prose `loanType` onto. |
| 17A | Account Status | **The big one.** CRS sends `accountStatusType` (Open/Closed/Paid/Transferred) and `currentRatingType` (AsAgreed/Late60Days/ChargeOff/BankruptcyOrWageEarnerPlan/TooNew/NoDataAvailable). Neither is an Exhibit 4 code. Fifteen of the thirty-eight checks read this field. |
| 17B | Payment Rating | `currentRatingCode` uses `C`, `N`, `-`, `2`, `7`, `9`. Field 17B is 0–6, G, L. The alphabets do not overlap, so there is nothing to map. |
| 18 | Payment History Profile | `paymentPatternData` uses C, X and digits and runs 1 to 35 characters. Field 18 is exactly 24 characters from 0–6/B/D/E/G/H/J/K/L. |
| 19 | Special Comment | `comments[].commentCode` carries bureau narrative codes, not Exhibit 7 codes. The sandbox proves the clash: `commentCode: "AV"` with `commentText: "CHARGE"`, where Exhibit 7's AV is "First payment never received". |
| 20 | Compliance Condition Code | No dispute or closure flag on a consumer tradeline. `customerDisputeIndicator` appears only in the commercial business reports. |
| 25 | Date of First Delinquency | Not in the payload. `adverseRatings.priorAdverseRatings` and the "Late Dates:" comment text carry dated delinquencies, and the earliest of those is **not** the DOFD — it is the earliest delinquency still inside the reporting window. |
| 27 | Date of Last Payment | No field means "date of last payment". `lastActivityDate` is activity of any kind; `accountPaidDate` is the date an account was settled. |
| 38 | Consumer Information Indicator | Bankruptcy appears only as prose (`currentRatingType: "BankruptcyOrWageEarnerPlan"`, comment text "BANKRUPTCY DISCHARGED"), which does not separate a petition (CII A–D) from a discharge (CII E–H). That separation is the whole of check M2-025. |
| K1 | Original Creditor | No original-creditor field. `creditorName` is whoever is reporting, which on a collection is the collector — the opposite of what K1 records. |
| K2 | Purchased From / Sold To | No counterparty field. Comment text "ACCOUNT TRANSFERRED OR SOLD" names nobody. |
| — | Third-party collector flag | Lives in Field 9's Exhibit 1 industry code. `businessType` is broad (Automotive, Banking, Finance, HomeFurnishing, JewelryAndCamera) and does not separate a collector from a lender. |
| — | Medical debt flag | Same: an Exhibit 1 industry code. |

### Why Field 17A is refused, at length

This is the decision most likely to be second-guessed, so the reasoning is
written down.

The tempting mapping is `accountStatusType: "Paid"` with a zero balance → Metro 2
status 13 (Paid or closed account, zero balance), and
`currentRatingType: "ChargeOff"` → status 97 (Unpaid balance reported as a loss).
Both look safe in isolation.

They are not, for three reasons.

1. **It needs two fields to agree.** `accountStatusType: "Closed"` with
   `currentRatingType: "ChargeOff"` could be 64, 97, or 62 depending on the
   balance and what the furnisher meant. That is inference, not translation.

2. **Fifteen checks read this field.** M2-011, M2-012, M2-013, M2-014, M2-015,
   M2-017, M2-019, M2-020, M2-027 and the six subcases beneath them all branch on
   17A. A mapping that is right nine times in ten is wrong fifteen ways on the
   tenth account.

3. **The failure mode is a letter, not an exception.** A wrong status code does
   not crash anything. It produces a fluent, confident paragraph claiming a Metro
   2 defect that exists only in our own guess. That paragraph is what a furnisher
   needs to call the dispute frivolous under 12 CFR 1022.43 and close it without
   investigating — burning the consumer's 30-day clock and the round.

So 17A stays invisible, and every check that reads it stays silent on soft-pull
data. Silence is recoverable. A bad letter is not.

---

## Which checks can run

Twelve live, twenty-six inert, on a CRS soft pull with no other data.

**Live — these can fire today**

| Rule | What it catches |
|---|---|
| M2-001 | Account number does not match the consumer's records |
| M2-002 | Two bureaus show different Date Opened for the same account |
| M2-003 | Portfolio Type contradicts what the account actually is |
| M2-005 | Account information is stale — not updated monthly |
| M2-008 | Wrong ECOA code (e.g. reported as the consumer's own debt when they were an authorised user) |
| M2-021 | Same debt reported twice, by the original creditor and the collector |
| M2-031 | Old addresses still on the file |
| M2-032 | Name variants that do not belong to the consumer |
| M2-033 | Wrong date of birth |
| M2-034 | Employers the consumer never worked for |
| M2-036 | Duplicate inquiries from one application |
| M2-037 | Inquiries from companies the consumer does not recognise |

M2-001, M2-008, M2-032, M2-033, M2-034 and M2-037 need the consumer's side of the
comparison from intake. Without it they stay silent rather than guessing, which
is why they are "live" but produce nothing on report data alone.

**Inert — silent, grouped by what is missing.** A rule appears more than once when
it needs more than one of these, so supplying a single row does not necessarily
wake every rule listed in it.

| Missing input | Rules held back |
|---|---|
| Field 17A Account Status | M2-006, M2-011, M2-012, M2-013, M2-014, M2-015, M2-017, M2-019, M2-020, M2-027 |
| Field 38 CII (bankruptcy) | M2-009, M2-024, M2-025, M2-026, M2-027 |
| Field 20 Compliance Condition Code | M2-010, M2-028, M2-029, M2-030 |
| Field 25 DOFD | M2-006, M2-007, M2-023 |
| Field 18 Payment History Profile | M2-007, M2-014 |
| Field 19 Special Comment | M2-016 |
| Field 17B Payment Rating | M2-013 |
| Field 9 Account Type | M2-004 |
| K1 Original Creditor | M2-019 |
| K2 Sold To | M2-018 |
| Medical debt flag | M2-022, M2-023 |
| Third-party collector flag | M2-017 |
| Whether an inquiry is hard or soft | M2-035, M2-038 |

---

## What the engine actually found on the sandbox data

Run with no intake data at all — report in, findings out.

| Payload | Findings |
|---|---|
| TransUnion | M2-005 × 4 |
| Experian | M2-005 × 14, M2-031 × 3 |
| Equifax | M2-005 × 13, M2-036 × 25 |

No errors. Two things worth reading closely.

**M2-005 fires on all 31 tradelines, and that needs a caveat before anyone
quotes it.** The rule says a furnisher must update monthly, and flags a Date of
Account Information more than 30 days before the report date. On this data the
gaps run from 90 days to 1,610 days. The 1,610-day one is a real finding — a
furnisher four years behind is exactly what the rule is for. But a 100% hit rate
across three bureaus is the signature of *static sandbox data*, frozen while the
report date moved on, not of three bureaus all being four years stale. Expect a
much lower rate on live pulls, and do not size the product on this number. The
30-day threshold is adjustable per run if live data shows it is too tight.

**M2-036 fires 25 times on Equifax, and that one is real.** 51 inquiries with
heavy same-day duplication — `KROLL FACTUAL DATA -` twice on 2026-01-06,
`CITIBANK SD NA` twice on 2024-05-09, and so on. One application producing
multiple entries overstates how often the consumer sought credit. This is
genuine, findable value on soft-pull data alone, and it needs no intake
information whatsoever.

**M2-031 fires 3 times on Experian** — former addresses last reported 14, 20 and
98 months ago, still on the file.

---

## Open items

These are recorded, not resolved. Two need a decision from Chris; one needs a
question answered by CRS.

**1. Are the inquiries CRS returns all hard inquiries?** The inquiry records carry
`creditorName`, `inquiryDate`, `businessType`, `subscriberCode` and `sourceType`
— and no field saying whether the inquiry is hard (a credit application, visible
to lenders, affects the score) or soft (a promotional or account-review pull,
not visible, no score effect). Bureaus conventionally disclose only hard
inquiries to a third party, but that is a convention, not a documented guarantee,
so the engine marks it invisible. **Cost of the gap: M2-035 and M2-038 cannot
fire.** M2-038 is the easiest check in the whole engine (an inquiry older than
two years should have aged off) and it is currently unusable. Confirming this
with CRS is the cheapest single unlock available.

**2. Exhibit 1 is not in the knowledge base.** The KB references Exhibit 1 (the
two-digit industry code list) but does not reproduce it. That single omission
holds back Field 9 entirely, and with it the medical-debt and third-party-
collector flags. **Cost: M2-004, M2-017, M2-022 and M2-023.** Getting Exhibit 1
out of the CDIA guide would unlock four checks.

**3. Field 17A, and what would actually unlock the twenty-six.** Nothing CRS
sells contains Metro 2 status codes, so no CRS product tier fixes this. The
consumer's own bureau disclosure does show charge-off and bankruptcy markers, and
the consumer can obtain it free by law. That is a client upload flow, and it is
the difference between twelve checks and most of thirty-eight. It is a product
decision, not an engineering one.

**4. Two contradictions inside the knowledge base itself**, found while building
the rule tables and resolved conservatively. Both are recorded in
`src/metro2/rules/status-codes.mjs`:

- Exhibit 4's notes say statuses 71–84 require a Payment Rating (17B); § 1.5 says
  only 05, 13, 61–65 and 88–97 do. The engine follows § 1.5, the narrower list,
  so it cannot claim a missing 17B that is not actually required.
- Status 11's required balance is stated two ways. The engine takes the narrower
  reading and does not fire on status 11 with a zero balance.

Neither blocks anything. Both should be checked against the CDIA guide before the
first letter goes out, since a wrong reading here is a wrong claim in a letter.

---

## Where the numbers come from

`src/metro2/crs-field-coverage.mjs` produces everything in this document:

- `crsFieldCoverage(payload)` — the observed/absent/not_visible counts per field.
- `ruleReadiness(payload)` — which rules can fire and which field silences each.
- `contextCoverage(payload)` — what the personal-information and inquiry side of
  the file gave us.

Two tests in `src/metro2/normalize.test.mjs` keep this document honest. One fails
if the normalizer's declared coverage and its actual output disagree. The other
fails if a rule is added to the engine without being added to the readiness
table — otherwise a new rule would be silently reported as ready on a data source
that cannot feed it.

The extraction script that parsed the sandbox markdown was throwaway and is not
in the repo; the payload library it read is the Downloads file named above.
