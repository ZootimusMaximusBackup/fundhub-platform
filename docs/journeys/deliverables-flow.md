# Deliverables flow — how a credit pull becomes five documents in the portal

Generated from the code on 2026-09-04, branch `fix/r2-w10-deliverables`.
Not a spec. If you cannot trace a box to a line of code, it is marked
`UNVERIFIED`.

**COMPLIANCE REVIEW REQUIRED** (CLAUDE.md §7) — credit-repair messaging and
projected-score adjacent. Marker only.

## The states a client's deliverables move through

```mermaid
flowchart TD
    PULL[Credit file lands<br/>src/finance/crs-pull.mjs finishStored] --> EV[["analysis.completed<br/>emitted with source=crs"]]

    EV --> ROW[(events row written<br/>src/events/bus.mjs emit)]

    ROW --> LOCAL[Local handlers run<br/>SYNCHRONOUSLY, in process]
    ROW --> FAN[Inngest fan-out<br/>bus.mjs:49-53]

    FAN -.->|"fire and forget,<br/>rejection thrown away"| INN[Inngest calls C-06]
    LOCAL --> H[src/handlers/crs-deliverables.mjs]

    H --> C06{{"C-06 handle()<br/>src/workflows/c-06-crs-results-router.mjs"}}
    INN --> C06

    C06 -->|source is not crs| STOP1[Nothing. reason: not_crs_source]
    C06 -->|no client| STOP2[Nothing. reason: no_client]
    C06 -->|no scores| TAG1[Tag hold:snapshot_missing]
    C06 -->|hard decline| TASK[Tag hold:declined + task<br/>DETECTOR IS A DEFERRED NO-OP]
    C06 -->|repair tier| TAG2[Tag path:repair. No documents.]
    C06 -->|funding tier| ONCE

    ONCE{{"deliverFundingLettersOnce<br/>already delivered this event id?"}}
    ONCE -->|yes| NOOP[Nothing. Already done.]
    ONCE -->|no| BUILD

    BUILD[buildLetterPackForClient pack=funding<br/>src/underwrite/letter-pack.mjs] --> ENGINE
    ENGINE[Tier engine re-runs the stored pull<br/>src/finance/crs-tier.mjs] --> DICT
    DICT[buildBlackReportClient<br/>src/underwrite/black-report-client.mjs] --> PRINT
    PRINT{WeasyPrint on this machine?}
    PRINT -->|yes, never on Netlify| PY[fundhub_gen.py]
    PRINT -->|no, always in production| NODE[printBlackReportsNode<br/>pdf-lib]
    PY --> FILES
    NODE --> FILES
    FILES[5 files] --> SAVE

    SAVE[persistFundingLetterFiles<br/>src/underwrite/funding-letter-pdf.mjs] --> DOCS[(documents +<br/>document_versions rows)]
    DOCS --> STAMP[Stamp funding_letters_delivered_event_id<br/>on the client]
    DOCS --> PORTAL[Client portal Documents tab<br/>listClientLibrary, no visibility filter]

    BUILD -->|zero files| WHY[delivered:false + the reason.<br/>Nothing saved, nothing claimed.]
```

## The five documents

| File | documents.subtype | Built by |
|---|---|---|
| `Credit-Analysis-Report.pdf` | `credit_analysis_report` | the printer |
| `Funding-Snapshot.pdf` | `funding_snapshot` | the printer |
| `Bank-Lender-Match-List.pdf` | `bank_lender_match_list` | the printer |
| `Credit-Optimization-Roadmap.pdf` | `credit_optimization_roadmap` | the printer |
| `Capital-Readiness-Summary.pdf` | `capital_readiness_summary` | the vendor summary generator |

The fifth was built and then dropped by the saver until 2026-09-04 (F46).

## Two rules that decide what these documents SAY

```mermaid
flowchart TD
    LEND[Vendor lender matcher<br/>availableNow / afterOptimization] --> GATE{Does the lender state a<br/>gate nothing has checked?}
    GATE -->|"revenue floor (minRevenue)"| AFTER["Shortlist, with the requirement<br/>printed as what is still needed"]
    GATE -->|"a requirement in its own whyFit text —<br/>business bank account, membership"| AFTER
    GATE -->|"a requirement nobody has classified yet"| AFTER
    GATE -->|"entity, months in business, score,<br/>fundable outcome — the four it checks"| NOW["Open to you today"]

    BIZ[Does this client have a company?] --> ROW{"A row in `businesses`?"}
    ROW -->|yes| HAS["Named, aged, no LLC advice.<br/>Business lenders are matched."]
    ROW -->|"no — only<br/>custom_fields.business_age_months"| NONE["No entity on file.<br/>Form an LLC advice stands."]
```

* **"Open to you today" means every gate the lender states is met.** The vendor
  matcher checks four things — entity, months in business, score, and a fundable
  outcome. It never reads `minRevenue`, though four of its lenders state one, and
  it never reads the requirements two more state in words: Fundbox wants a
  business bank account, Navy Federal wants membership. This product records none
  of the three, so those six are held in the shortlist with the requirement
  named. Unknown is not met, and unknown is never printed as zero. A requirement
  the classifier has not seen is treated as unverified too, so a vendor edit
  holds a lender back rather than over-promising it.
* **A card with no reported credit limit has no paydown target, anywhere.** There
  is no 10% of a limit the file does not have, so the paydown table, the 6-month
  checklist, the fastest-wins list and the application-order rule all say the
  limit is unknown instead of naming a figure. The 6-month checklist said "down
  to under 10% of its limit" until 2026-09-06 while the table two pages earlier
  said "-".
* **A company is a `businesses` row.** That is the owner's F15 rule, reused here
  rather than restated. A client whose only company fact is
  `clients.custom_fields.business_age_months` — the sim academy profile is one —
  has no entity as far as these documents are concerned and is still advised to
  form one.

## The other door: the presenter's deck

```mermaid
flowchart TD
    BTN["Send deliverables package now<br/>public/app/present.js"] --> API[POST /api/closer-deck<br/>action generate_letters]
    API --> GEN[generateDeckLetters<br/>src/sales/closer-deck.mjs]
    GEN --> WHICH{Education path?}
    WHICH -->|yes| FUND[pack = funding<br/>the five documents]
    WHICH -->|no| REP[pack = repair<br/>Metro 2 letters + complaints]
    FUND --> SAVE2[persistFundingLetterFiles]
    REP --> SAVE3[persistDiyPackageFiles]
    SAVE2 --> ANY{Anything saved?}
    SAVE3 --> ANY
    ANY -->|yes| MAIL[Email the client + tag them<br/>+ diy_status Delivered]
    ANY -->|no| HONEST["NO email. NO tag.<br/>diy_status Delivery Failed — Retry.<br/>The screen prints the reason."]
```

Before 2026-09-04 both branches asked for the repair pack, and the email went out
whether or not anything existed (F41).

## What is NOT in this picture

* **A hard-decline detector.** `isHardDecline` is a named no-op until CRS
  onboarding lands. The branch around it is wired end to end.
* **A projected credit score.** Nothing in this repository computes one. The
  documents print the engine's projected pre-approval instead.
* **A retry when the Inngest fan-out fails.** It still fails silently. The
  deliverables no longer depend on it; every other workflow still does.

## Gap against the intended journeys

`docs/journeys/client-intended.md` is a route-permission map. It carries no
deliverables flow, so there was nothing to reconcile and no step was invented to
match the code. No route was added, no route's principal gate moved, and
`npm run journeys` produced no diff on any of the eight pages — what changed is
what one existing endpoint's data path *does*, which that generator does not
model.
