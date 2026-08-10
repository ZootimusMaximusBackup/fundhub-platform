# Metro 2 dispute engine — knowledge base and rules

## Origin of the knowledge base

`METRO2_MASTER_KNOWLEDGE_BASE.md` (v1.0, 2026-04-24) is the human source of truth
for this build. The original Drive asset was only exportable as a PDF, so it was
text-extracted from `METRO2_MASTER_KNOWLEDGE_BASE.md.pdf` into the Markdown file
here. The extracted Markdown is what everything in `src/metro2/` was built
against, and it is what `src/metro2/rules/agreement.test.mjs` tests against.

**Agents do not edit `METRO2_MASTER_KNOWLEDGE_BASE.md.** It is hand-authored
domain material. If code and the knowledge base disagree, the knowledge base is
right and the code is the bug. If the knowledge base itself looks wrong,
that is a finding to report — not an edit to make.

The edition is stamped in `src/metro2/version.mjs` and attached to every report
the engine produces, so a letter mailed eighteen months ago can be traced to the
code tables it was written from. Bump `KB_VERSION` and `KB_DATE` together, in the
same commit as the rule-table change a new edition forces.

Sample letters used as reference output live in `fixtures/`.

## What is here

| Path | What it is |
|---|---|
| `src/metro2/version.mjs` | Which edition of the knowledge base this engine was built against |
| `src/metro2/provenance.mjs` | The observed / absent / not_visible model — read this first |
| `src/metro2/dates.mjs` | Calendar arithmetic with no system clock |
| `src/metro2/rules/` | The code tables from the knowledge base exhibits, as data |
| `src/metro2/checks/` | The 38 violation checks, one pure function each |
| `src/metro2/normalize.mjs` | CRS soft-pull payload → Metro 2 field shape |
| `src/metro2/crs-field-coverage.mjs` | Which fields a real payload gives us, and which rules can therefore fire |
| `CRS-FIELD-COVERAGE.md` | The answer, measured against the CRS sandbox library |

## The one idea the whole design rests on

Every field arriving at a check is one of exactly three things.

| | Meaning | Can a rule fire on it? |
|---|---|---|
| `observed` | We can see the field and it has a value | Yes |
| `absent` | We can see the field and the furnisher left it empty | **Yes** — an empty Original Creditor on a collection *is* the violation |
| `not_visible` | This report format never carries the field | **Never** |

Shape: `{ value, provenance }`.

Confusing `absent` with `not_visible` is how this system would mail a letter
claiming Field 25 (Date of First Delinquency) is missing, when the truth is that
a soft-pull report simply never shows Field 25. That letter is worse than no
letter — it is the evidence a furnisher needs to call the dispute frivolous under
12 CFR 1022.43 and close it without investigating, burning the consumer's 30-day
clock and the round.

So: rules fire on `observed` and `absent`, never on `not_visible`. There is no
override. `observed(null)` throws rather than let a null through wearing an
"observed" label. A rule handed a bare value instead of a wrapper treats it as
unreadable and stays silent, because a rule that cannot tell `absent` from
`not_visible` must not speak.

Three tests in `src/metro2/checks/index.test.mjs` hold this. The load-bearing one
takes a clean tradeline, makes each field invisible one at a time, and asserts the
engine still finds nothing — which catches a rule that reads a wrapper without
checking its provenance, since such a rule fires the moment its input goes dark.

## The context object

A tradeline alone cannot answer most of the questions the rules ask. "Is this
account number the consumer's?" needs the consumer. "Did two bureaus disagree?"
needs the other bureaus. `context` carries all of it, and every field in it is
provenance-wrapped for the same reason the tradeline fields are.

```js
{
  // The date of the report being examined. NOT today. Every date comparison in
  // the engine is against this, so a rerun in six months produces the same
  // violations — a finding the engine cannot reproduce is one it cannot defend.
  asOf: "2026-03-01",
  kbVersion: "METRO2_MASTER_KNOWLEDGE_BASE v1.0 (2026-04-24)",

  // What the consumer says. From intake, never from a credit report — a report
  // cannot tell us the consumer's own account of their name or their debts.
  consumer: {
    legalName:            { value: { first, middle, last }, provenance },
    dateOfBirth:          { value: "1970-01-01", provenance },
    knownAccountNumbers:  { value: ["2222"], provenance },
    employers:            { value: ["EXAMPLE EMPLOYER"], provenance }
  },

  // What the bureau's file says about the person. From the report.
  file: {
    names:       { value: [{ first, middle, last }], provenance },
    dateOfBirth: { value: "1970-01-01", provenance },
    addresses:   { value: [{ line1, city, state, postal, isCurrent, reportedOn }], provenance },
    employments: { value: [{ name, reportedOn }], provenance }
  },

  // Inquiries on the file. `hard` matters: a soft pull is invisible to lenders
  // and affects no score, so a claim about one is not worth making.
  inquiries: { value: [{
    creditor, inquiryDate, bureau,
    hard:               { value: true, provenance },
    consumerAuthorized: { value: false, provenance },
    consumerRecognizes: { value: false, provenance }
  }], provenance },

  // Dispute history. Drives M2-028 to M2-030 and nothing else.
  dispute: {
    active:                       { value: true, provenance },
    investigationCompleted:       { value: false, provenance },
    consumerDisagreesWithOutcome: { value: true, provenance }
  },

  // Bankruptcy. `discharged` and `dismissed` are different facts with opposite
  // consequences, so both are carried rather than one being inferred.
  bankruptcy: {
    included:   { value: true, provenance },
    discharged: { value: true, provenance },
    dismissed:  { value: false, provenance },
    chapter:    { value: "7", provenance }
  },

  // What the consumer says this account actually is, where they know.
  expected: {
    portfolioType: { value: "R", provenance },
    accountType:   { value: "18", provenance },
    ecoa:          { value: "3", provenance }
  },

  // Cross-bureau comparison. The same account as another bureau reports it,
  // matched on creditor AND the last four digits of the account number. Both,
  // because matching on creditor alone pairs two different cards from one bank
  // and manufactures a Date Opened disagreement out of two correct accounts.
  bureauPeers: [{ bureau, date_opened, /* ...any tradeline field */ }],

  // Everything else on the file, so the double-reporting rule can see the
  // original creditor and the collector reporting the same debt.
  relatedTradelines: { value: [tradeline], provenance },
  reportedCreditors: { value: ["MIDLAND FUNDING LLC"], provenance },

  // What this furnisher reported previously, for the prohibited-sequence rule.
  priorStatusReports: { value: [{ status: "89", reportedOn: "2025-01-01" }], provenance },
  saleIndicated: { value: true, provenance },

  // Thresholds from the knowledge base. Omit to take the documented defaults.
  options: { staleDoaiDays: 30, medicalMinCents: 50000, medicalWaitDays: 365, inquiryMaxAgeYears: 2 }
}
```

Anything you cannot fill in, leave as `notVisible()` — that is the whole point.
`normalizeContext()` builds the bureau's half from a CRS payload and marks the
consumer's half invisible, because a credit report does not contain the
consumer's side of the argument.

Note that `absent()` and `notVisible()` say different things about the consumer
too. `consumer.legalName: absent()` claims the consumer told us nothing. If we
simply have not asked yet, that is `notVisible()`.

## Running the engine

```js
import { normalizeFromCrs } from "./src/metro2/normalize.mjs";
import { runReport } from "./src/metro2/checks/index.mjs";

const { tradelines, context } = normalizeFromCrs(crsPayload, {
  asOf: "2026-03-01",
  consumerContext: { consumer: { /* intake facts, provenance-wrapped */ } }
});

const { violations, counts, highestSeverity, errors } = runReport(tradelines, context);
```

Violations come back strongest first. Each one is frozen — nothing downstream can
rewrite a finding — and carries:

```js
{
  ruleId,      // M2-001 … M2-038
  severity,    // deletion | strong | moderate | supporting
  field,       // the Metro 2 field number, as a string
  observed,    // what the report says
  expected,    // what it should say
  reason,      // plain language, for the letter
  citations,   // statute and case law, from the rule's citation table
  metro2Ref,   // where in the knowledge base
  subcase,     // which branch of the rule fired, when it has more than one
  scope,       // tradeline | report
  subject      // which account or which inquiry
}
```

`severity` is derived from the rule and cannot be passed in by a caller.

`errors` is non-enumerable and holds any rule that threw. A rule throwing is a
bug in that rule; losing the other thirty-seven findings to it would turn a small
defect into a blank letter. Read it — a thrown rule is never the same thing as a
rule that found nothing.

## Severity

| Tier | Means | Examples |
|---|---|---|
| `deletion` | Grounds to demand the tradeline come off | Seven-year window expired, unverifiable DOFD, discharged bankruptcy still showing a balance |
| `strong` | A clear contradiction a furnisher must resolve | Re-aging, missing Original Creditor on a collection, the same debt reported twice, status and balance that cannot both be true |
| `moderate` | A real defect, weaker on its own | Compliance Condition Code errors, payment-history contradictions, missing special comments |
| `supporting` | Adds weight, rarely wins alone | Personal information, inquiries |

## Ground rules for this directory

- **Detection is code. Prose is a language model's job, later.** A model never
  decides whether a violation exists, only how to word one that the engine
  already found. Everything in `checks/` is arithmetic, comparisons and code-table
  lookups.
- **No clock, no network, no database.** Pure functions throughout. `asOf` is
  passed in. Same inputs, same violations, forever.
- **Money is integer cents.** Null means unknown and must survive as null. A
  balance that becomes `0` because it was unreadable is the one wrong answer that
  both satisfies M2-011 and trips M2-012.
- **Never invent a code.** If a field is not in the source, it is `not_visible`.
  Prefer silence to a guess, every time.

## Known contradictions in the knowledge base

Found while building the rule tables. Both are resolved conservatively — the
narrower reading, so the engine cannot claim a defect that may not exist — and
both are recorded in `src/metro2/rules/status-codes.mjs`.

1. Exhibit 4's notes say statuses 71–84 require a Payment Rating (Field 17B).
   § 1.5 lists only 05, 13, 61–65 and 88–97. The engine follows § 1.5.
2. Status 11's required balance is stated two ways. The engine takes the narrower
   reading and does not fire on status 11 with a zero balance.

Both should be checked against the CDIA Credit Reporting Resource Guide before
the first letter goes out.
