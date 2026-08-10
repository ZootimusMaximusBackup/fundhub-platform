# Metro 2 credit repair — shared board

**Batch:** metro2-credit-repair  
**Started:** 2026-08-07  
**Owner decisions locked:** no specialist stage (fails → `stalled`); new `repair.*` events; pdf-lib only; new `src/metro2/` normalizer; DIY replaces placeholder (later); CROA advance-fee = flag only; build all 38 checks without waiting for fuller CRS fields; a check whose required Softview field is absent returns `not_visible` (never pass/fail/clean); CRS funding and Metro 2 normalizers stay separate.

## Task list

| ID | Unit | Owner | Status | Notes |
|---|---|---|---|---|
| W1-U1 | Engine Unit 1 — KB into repo + rule tables | this session | **done** | 8 rule tables + version stamp + KB agreement test |
| W1-U3 | Engine Unit 3 — 38 violation checks | this session | **done** | M2-001…M2-038, 7 modules, 223 tests |
| W1-U2 | Engine Unit 2 — tradeline normalizer + provenance | this session | **done** | + coverage helper and `CRS-FIELD-COVERAGE.md` |
| W2 | Engine Units 4–7 | this session | **done** | Letters, variance, rounds, PostGrid, inbound |
| W3 | DFY pipeline | this session | **done** | Stages, repair.* events, CROA, SLAs, portal |
| W4 | DIY package | this session | **done** | Conditional ZIP package + ds-02 in-repo path |

## Required assets (before Unit 1) — resolved

All three are in the repo. The knowledge base arrived from Drive as a PDF only
and was text-extracted to Markdown; the extracted Markdown is the source of truth
for this build, and `docs/metro2/README.md` records the origin.

1. `docs/metro2/METRO2_MASTER_KNOWLEDGE_BASE.md` (v1.0, 2026-04-24, ~63 KB)
2. `docs/metro2/fixtures/02a-Round1-Metro2-Equifax.docx`
3. `docs/metro2/fixtures/02b-Round1-Metro2-TransUnion.docx.pdf`

## Shared context brief

- Detection is deterministic code; prose is AI (later). They never mix.
- Build order for W1: Unit 1 → Unit 3 → Unit 2. Done in that order.
- **Read `docs/metro2/README.md` before touching anything in `src/metro2/`.** It
  documents the provenance model and the full `context` object shape, which every
  downstream unit has to construct.
- **Read `docs/metro2/CRS-FIELD-COVERAGE.md` before building letters or the
  pipeline.** 12 of 38 checks can fire on a CRS soft pull. The other 26 stay
  silent because the data is not there. Letter templates must not assume a
  finding exists.
- Every field into the engine is `{ value, provenance }` where provenance is
  `observed` | `absent` | `not_visible`. Rules fire on the first two and **never**
  on `not_visible`.
- `runReport(tradelines, context)` is the entry point. It runs the 30 account
  rules once per tradeline and the 8 file rules exactly once, so a misspelled name
  produces one finding rather than one per account.
- Nothing in `src/metro2/` reads a clock, a database or the network. `asOf` is
  passed in. Reruns are byte-identical.

## Change manifests

### W1-U1 + W1-U3 + W1-U2 — Metro 2 engine (this session, 2026-08-07)

**Files created**

| Path | What |
|---|---|
| `docs/metro2/README.md` | KB origin + do-not-edit note; provenance model; `context` shape; severity tiers |
| `docs/metro2/CRS-FIELD-COVERAGE.md` | Measured field coverage and rule readiness against the CRS sandbox |
| `src/metro2/version.mjs` | KB edition stamp (v1.0 / 2026-04-24), attached to every report |
| `src/metro2/provenance.mjs` | `observed` / `absent` / `not_visible` and the guards |
| `src/metro2/dates.mjs` | Strict ISO date arithmetic, no system clock |
| `src/metro2/rules/status-codes.mjs` | Exhibit 4 (17A) + required-balance constraints |
| `src/metro2/rules/payment-ratings.mjs` | Field 17B |
| `src/metro2/rules/php-codes.mjs` | Field 18 |
| `src/metro2/rules/special-comments.mjs` | Exhibit 7 (19) + required-condition constraints |
| `src/metro2/rules/compliance-codes.mjs` | Exhibit 8 (20) |
| `src/metro2/rules/ecoa-codes.mjs` | Exhibit 10 (37), incl. withdrawn 0/4/6 |
| `src/metro2/rules/cii-codes.mjs` | Exhibit 11 (38) |
| `src/metro2/rules/citations.mjs` | Statute + case law keyed M2-001…M2-038 |
| `src/metro2/rules/agreement.test.mjs` | Fails if a rule table and the KB text disagree, both directions |
| `src/metro2/checks/severity.mjs` | deletion / strong / moderate / supporting per § 5.8 |
| `src/metro2/checks/violation.mjs` | Violation factory, field readers, documented thresholds |
| `src/metro2/checks/universal.mjs` | M2-001…M2-010 |
| `src/metro2/checks/status-consistency.mjs` | M2-011…M2-017 |
| `src/metro2/checks/chargeoff-collection.mjs` | M2-018…M2-023 |
| `src/metro2/checks/bankruptcy.mjs` | M2-024…M2-027 |
| `src/metro2/checks/dispute-status.mjs` | M2-028…M2-030 |
| `src/metro2/checks/personal-info.mjs` | M2-031…M2-034 (file-scoped) |
| `src/metro2/checks/inquiries.mjs` | M2-035…M2-038 (file-scoped) |
| `src/metro2/checks/index.mjs` | `runAllChecks`, `runTradelineChecks`, `runReportChecks`, `runReport`, `coverageReport` |
| `src/metro2/checks/fixtures/tradelines.mjs` | Clean / blind / KB-example builders and contexts |
| `src/metro2/checks/*.test.mjs` | 8 files, 223 tests |
| `src/metro2/normalize.mjs` | CRS payload → Metro 2 field shape, every field wrapped |
| `src/metro2/normalize.test.mjs` | 46 tests |
| `src/metro2/crs-field-coverage.mjs` | Field coverage + rule readiness reporting |

**Files changed:** none outside `src/metro2/` and `docs/metro2/`. `src/tradelines/`
(funding) untouched. No routes, no handlers, no migrations, no env vars.

**Exports other workflows will need**

- `src/metro2/checks/index.mjs` → `runReport(tradelines, context)` returning
  `{ violations, counts, highestSeverity, errors, asOf, kbVersion, tradelines }`.
  Violations are frozen and sorted strongest first.
- `src/metro2/normalize.mjs` → `normalizeFromCrs(payload, { asOf, consumerContext })`
  returning `{ tradelines, context, byTradeline }`.
- `src/metro2/provenance.mjs` → `observed()`, `absent()`, `notVisible()` and the
  `isObserved` / `isAbsent` / `isNotVisible` guards. **Use these to build any
  context.** A bare value is treated as unreadable and silences the rule.
- `src/metro2/rules/citations.mjs` → `CITATIONS[ruleId]` for letter footnotes.
- `src/metro2/crs-field-coverage.mjs` → `ruleReadiness(payload)` to find out which
  rules can fire before generating a letter that assumes one did.

**Routes affected:** none. **Journeys affected:** none — this is library code with
no caller yet. No `-actual.md` regeneration and no changelog line, because no
documented flow changed. W3 (DFY pipeline) is the workflow that will wire this in
and will owe the journey update.

**Verification:** `npm run lint` clean (1053 files). `npm test` 0 failures
(4978 pass / 3 skip in the unit phase, 583 database tests skipped with
`DATABASE_URL` unset). `node --test src/metro2/**/*.test.mjs` → 269 pass, 0 fail.
No Playwright — no UI change. `npx tsc --noEmit` is a no-op in this repo: there is
no `tsconfig.json` and no TypeScript source, so tsc prints its help text and
exits 0. Pre-existing condition, not introduced here.

**Not committed.** Working tree only, per instruction.

## Findings from the build

1. **12 of 38 checks can fire on a CRS soft pull.** The other 26 are silent
   because CRS does not carry the field they read. Full detail with counts in
   `docs/metro2/CRS-FIELD-COVERAGE.md`. This is the single most important input to
   W2 and W3 — a letter template must not assume a finding that cannot exist.
2. **Field 17A (Account Status) is deliberately `not_visible` from CRS.** 15
   checks read it. CRS sends prose status and a rating code from a different
   alphabet; reconstructing 17A would need inference across two fields, and a
   wrong reconstruction produces a confident false claim in a mailed letter. The
   reasoning is written out in the coverage doc.
3. **Two self-contradictions in the knowledge base**, both resolved to the
   narrower reading and recorded in `src/metro2/rules/status-codes.mjs`: whether
   statuses 71–84 require a Payment Rating (Exhibit 4 notes say yes, § 1.5 says
   no — engine follows § 1.5), and status 11's required balance. Should be checked
   against the CDIA guide before the first letter.
4. **Exhibit 1 (industry codes) is referenced by the KB but not reproduced in
   it.** That single gap holds back Field 9, the medical-debt flag and the
   third-party-collector flag, and with them M2-004, M2-017, M2-022 and M2-023.
5. **CRS inquiry records do not say whether an inquiry is hard or soft.** M2-035
   and M2-038 cannot fire. Confirming this with CRS is the cheapest single unlock
   available — M2-038 is the simplest check in the engine.
6. **M2-036 (duplicate inquiries) found 25 real duplicates** in the Equifax
   sandbox payload with no intake data at all. Genuine value available on
   soft-pull data today.
7. **M2-005 fired on all 31 sandbox tradelines.** Almost certainly static sandbox
   data rather than three bureaus all being years stale. Do not size the product
   on that rate; see the caveat in the coverage doc.

## Blockers

1. ~~KB + sample letters not reachable~~ — resolved, all three in the repo.
2. ~~Named CRS client is absent.~~ **Superseded by a parallel workflow.** A CRS
   client has appeared in the working tree since this blocker was written
   (`src/finance/crs-client.mjs`, `src/finance/crs-pull.mjs`,
   `src/messaging/providers/crs-softview.mjs`) — not this session's work, and not
   reviewed here. The Metro 2 normalizer takes a payload as an argument and does
   not import any of it, so the two are independent. Whoever owns that workflow
   should confirm the payload shape their client returns matches the field names
   in `docs/metro2/CRS-FIELD-COVERAGE.md`, which were read off the sandbox
   library rather than off a live response.
3. **Production credentials are absent.** Neither CRS variable is present and
   non-empty in the shell, local `.env`, or Netlify production context. Values
   were not supplied, so nothing can be set safely.
4. **Open decision for Chris: client-uploaded bureau disclosures.** Nothing CRS
   sells contains Metro 2 status or bankruptcy codes, so no CRS tier fixes the 26
   inert checks. The consumer's own free bureau disclosure does. That is a client
   upload flow, and it is the difference between 12 checks and most of 38. Product
   decision, not engineering.


### W2 + W3 + W4 — finished 2026-08-10

Built in-session after Opus/Sonnet API limits killed parallel agents.

**W2:** `src/metro2/letters/*`, `rounds/*`, `delivery/*`, `inbound/*`, migration `160_metro2_dispute_engine.sql`
**W3:** migration `161_optimization_repair_pipeline.sql`, `src/repair/*`, repair.* + diy.package.* canonical events, `/api/repair/exceptions`
**W4:** `src/metro2/diy/*`, ds-02 prefers in-repo package when violations present

No specialist_review. Fails → stalled. Auto-send gated by safety rules.
