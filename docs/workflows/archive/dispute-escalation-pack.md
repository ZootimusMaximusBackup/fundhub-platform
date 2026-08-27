# Dispute escalation pack

**Started:** 2026-08-15  
**COMPLIANCE REVIEW REQUIRED** — dispute letters, CFPB/AG complaints, consent, signatures.

**Owner laws**
- Metro 2 **engine** decides violations. A model only fills blanks. Never invent Field 17A / 20 / 25 from a CRS soft-pull.
- No Fundhub logo on bureau, furnisher, or complaint PDFs.
- Inquiry **phone** remover is ON HOLD. Inquiry **mail** letters are in this pack.
- Human still presses send. Nothing mails itself.
- Client signs onboarding authorization, and signs CFPB/AG declarations.
- Round 1 is not Round 3. Do not put willful-noncompliance as the first letter.

## Task list

| ID | Unit | Owner | Status | Files they may touch |
|----|------|-------|--------|----------------------|
| W1 | Spec + shared modules | this chat | **done** | `docs/workflows/dispute-escalation-pack.md`, `src/metro2/letters/catalog.mjs`, `ag-statutes.mjs`, `sign-block.mjs`, `catalog.test.mjs` |
| W2a | Dispute-authorization consent (backend) | agent | **done** | migration `167_…sql`, `src/consent/*`, `src/documents/kinds.mjs`, consent tests. **Not** HTML. |
| W2b | Sign box UI (canvas) onboarding | agent | **done** | `public/app/consent-capture.html`, `public/app/client-portal.html` only |
| W3a | R1/R2/R3 letter labels + escalation | agent | **done** | `src/metro2/letters/generate.mjs`, `prompts.mjs`, `variance.mjs`, `letters.test.mjs` |
| W3b | CFPB + state AG complaints | agent | **done** | **new** `src/metro2/letters/complaints.mjs` + `complaints.test.mjs` |
| W3c | Furnisher debt validation | agent | **done** | **new** `src/metro2/letters/furnisher-validation.mjs` + test |
| W3d | Wire pack | this chat | **done** | `src/metro2/diy/package.mjs`, `src/metro2/letters/index.mjs` |

## The eight letter types (locked)

Owner said “nine”; the chain names eight. Ninth (goodwill / pay-for-delete) is **deferred**.

| Type | When | Sign on PDF |
|------|------|-------------|
| `r1_metro2` | First bureau mail. Label every item `Violation M2-xxx`, Metro 2 field, severity. | Hand sign line |
| `r2_fcra_mov` | After R1 verified / remains / silent 30+ days. MOV + 611(a)(7) + furnisher contact. | Hand sign line |
| `r3_final_notice` | After R2. 611(a)(5)(A) delete-if-unverified, 15-day demand, 616/617 reserved. Not the first letter. | Hand sign line |
| `furnisher_validation` | Direct to collector/furnisher. Original agreement, itemization, chain of title, SOL. FDCPA 809(b) + 813 warning. Cover: send if still in 30-day window. | Hand sign line |
| `cfpb_complaint` | After R3 failed (DIY: undated + “SEND ONLY IF”). Ready-to-file. | **Perjury declaration** |
| `state_ag_complaint` | With or after CFPB. State from client address via `agForState`. | **Perjury declaration** |
| `personal_info` | M2-031–034. Never dispute the current street as “former”. | Hand sign line |
| `inquiry_removal` | M2-035–038. Mail only. | Hand sign line |

Code: `src/metro2/letters/catalog.mjs`.

## Signatures (locked)

1. **Onboarding — `dispute_authorization` consent**  
   New kind next to `soft_pull_consent`. Capture method **signature** must use a **draw box** (canvas), not only a typed name. Server owns the words (`disclosures.mjs`, append-only version `dispute-auth-v1`). No credit-outcome promises. Client may also type their legal name.  
   This is the “sign during onboarding” box.

2. **Bureau / furnisher letters**  
   PDF sign line (`sign-block.mjs` `handwrittenSignOff`). Client signs on paper before mail.

3. **CFPB and AG**  
   PDF declaration (`perjuryDeclaration`). `clientSignRequired: true`. Do not treat the onboarding consent as the complaint signature.

Gate: do not build a live (dated) complaint pack without a valid `dispute_authorization` consent. DIY undated templates may still generate with a cover that says sign the declaration before filing.

## Shared modules (do not rewrite)

- `src/metro2/letters/catalog.mjs`
- `src/metro2/letters/ag-statutes.mjs` — TX/CA/FL/NY/IL + fallback
- `src/metro2/letters/sign-block.mjs`
- `src/metro2/letters/render.mjs` — no brand
- Engine: `normalizeFromCrs` + `runReport`

## CFPB / AG fill rules

Fill only from: client identity, bureau/furnisher name+address, engine violations (ruleId, field, observed, reason), round dates if the case store has them. If a round was never mailed, write `[DATE — not mailed yet]` — do not invent a mail date.

Do not list Metro 2 fields the CRS soft-pull cannot see unless that rule actually fired.

CFPB filing: consumerfinance.gov/complaint, (855) 411-2372, P.O. Box 27170, Washington, DC 20038. Company has 15 days after CFPB forwards.

## Change manifests

### W3a

- `src/metro2/letters/generate.mjs` — each item labeled `Violation M2-xxx — <plain name>`, Metro 2 field line, Severity (Deletion-tier / Strong / Moderate / Supporting). Engine reason/observed/expected kept. Statutes capped at 2–3 per item. Re: line is `Round N Metro 2 dispute —` plus rule ids. Close with `handwrittenSignOff`. Last four of SSN only if `identity.ssn` is present. Removed mill `Tone:` / `Hooks for this round:` lines; attempt 0/1/2 still rearrange human Round-1/2/3 copy.
- `src/metro2/letters/prompts.mjs` — R1 = 30-day reinvestigation + MOV request, CFPB/AG reserved, not a final notice. R2 = 611(a)(7) MOV + 611(a)(6)(B)(iii) furnisher contact, then furnisher, CFPB if they fail. R3 = 611(a)(5)(A) + 15-day deletion, 1681n/1681o reserved, last bureau letter, not a lawsuit. Openings/closings are round-specific pools (seed/attempt still pick a unique line).
- `src/metro2/letters/variance.mjs` — fingerprint now strips `Violation M2-xxx` item blocks (and leftover `Item N (M2-000)`).
- `src/metro2/letters/letters.test.mjs` — added Violation/Field/Severity/Signature/no-Fundhub, SSN last-four, round-escalation, fallback-name tests. Old M2-007 / M2-011 / CITATIONS / Jane Consumer / undated DATE / PDF tests still pass.
- Did not edit `package.mjs`, `complaints.mjs`, consent, HTML, or `catalog.mjs`. Imported `handwrittenSignOff` from `sign-block.mjs`.

**Sample R1 item header:**

```
Violation M2-007 — Obsolete item
Metro 2 field: Field 25
Severity: Deletion-tier
```

**Verify:** `node --test src/metro2/letters/letters.test.mjs src/metro2/letters/catalog.test.mjs` — 23 passed, 0 failed (plus DIY package consumer still green).

### W1

- Board + catalog + AG table + sign blocks + tests.

**Verify:** `node --test src/metro2/letters/catalog.test.mjs`

### W2a

- Constraint dropped and re-added: `client_consents_kind_check` (looked up on the `kind` column; live name matched). Was `CHECK ((kind = 'soft_pull_consent'::text))`. Now `soft_pull_consent` and `dispute_authorization`.
- `db/migrations/167_dispute_authorization_consent.sql` + `db/expected-migrations.mjs`.
- `CONSENT_KINDS` includes `dispute_authorization`. Capture API already takes `kind`; clients can grant. Method `signature` unchanged.
- Append-only disclosure `DISPUTE_AUTH_DISCLOSURES` version `dispute-auth-v1`. `soft-pull-v1` text not edited. Wired in `BY_KIND`.
- `src/documents/kinds.mjs` authorization subtype `dispute_authorization` + title.
- Gate helper `src/repair/dispute-auth.mjs` `hasDisputeAuthorization` — wraps `hasValidConsent`. **Not** wired into live mail (W3d).
- Applied on live Postgres and recorded in `schema_migrations`.

**Verify:** `node --test src/consent/consent.test.mjs src/consent/consent.pg.test.mjs src/repair/dispute-auth.test.mjs` — 79 pass, 0 fail; pg suite skipped without `DATABASE_URL`.

### W2b

- `public/app/consent-capture.html` — `?kind=` (default `soft_pull_consent`, allow `dispute_authorization`). Signature method shows canvas `#ccSignPad` + Clear `#ccSignClear`. Ink required before Record consent. Still POSTs `/api/consent/capture` with `capture_method` + `granted_name`. No new upload. Disclosure still from GET.
- `public/app/client-portal.html` — onboarding card "Sign to authorize dispute letters" with embedded pad + POST `kind=dispute_authorization` `capture_method: "signature"`, plus link to consent-capture.
- `src/http/consent-sign-pad-html.test.mjs` — HTML string proof of canvas + dispute kind.
- Did not edit `src/consent/*`, disclosures, migrations, `kinds.mjs`. Did not attach PNG (no existing consent-signature upload kind without inventing one).

**Verify:** `node --test src/http/consent-sign-pad-html.test.mjs` — 2 passed, 0 failed.

**See the sign box:** `/app/consent-capture.html?client_id=<uuid>&kind=dispute_authorization` (or Client Portal after welcome video).

### W3b

- New `src/metro2/letters/complaints.mjs` + `complaints.test.mjs` only.
- Exports: `buildCfpbComplaint`, `buildStateAgComplaint`, `renderComplaintPdf`.
- Imports catalog types, `agForState` / `CFPB_FILING` / `BUREAU_DISPUTE_ADDRESSES`, `perjuryDeclaration`, `renderLetterPdf`.
- Missing timeline dates → `[DATE — not mailed yet]`. Field 20/25 only if passed in. No Fundhub in body.
- Did not edit `generate.mjs`, `package.mjs`, consent, HTML, `catalog.mjs`, `ag-statutes.mjs`.

**Verify:** `node --test src/metro2/letters/complaints.test.mjs` — 9 passed, 0 failed.

### W3c

- **New** `src/metro2/letters/furnisher-validation.mjs` — FDCPA § 809(b) / 15 U.S.C. § 1692g(b) validation letter to the collector/furnisher. Not the Metro 2 furnisher dispute (`ROUND.FURNISHER` in `generate.mjs`). Did not edit `generate.mjs`.
- **New** `src/metro2/letters/furnisher-validation.test.mjs`
- API: `buildFurnisherValidationLetter({ identity, furnisher, account, asOf, solYears })` → `{ type: LETTER_TYPES.FURNISHER_VALIDATION, text, solYears }`; `renderFurnisherValidationPdf(opts)` via `render.mjs`.
- Cover: 30-day validation window; else bureau/furnisher FCRA dispute.
- Demands: original signed agreement; Reg F 12 C.F.R. § 1006.34 itemization; chain of title; proof of authority to collect; SOL (Texas 4 years only when `identity.state` is TX; otherwise “verify the statute of limitations in my state”).
- 809(b) cease-collection including credit bureau reporting until validation is mailed; § 813 / 1692k statutory-damages warning, not a lawsuit filing.
- Alleged debt, last four only, `handwrittenSignOff`, Certified Mail. No Fundhub. No Metro 2 field numbers.
- `asOf` ISO date or undated blank. `solYears` from caller; default 4 only for TX.

**Verify:** `node --test src/metro2/letters/furnisher-validation.test.mjs` — 7 passed, 0 failed.

### W3d

- `src/metro2/letters/index.mjs` re-exports catalog, AG table, sign blocks, CFPB/AG complaints, furnisher validation.
- `src/metro2/diy/package.mjs` now builds the eight-type pack: R1 metro2 + personal-info + inquiry (mail), undated R2/R3 with covers, furnisher validation when a collector is named, undated CFPB + state AG under `06-complaints-CONDITIONAL/` with **SEND ONLY IF Round 3 failed**. Current street dropped from personal-info letters. Dated/live complaints refuse without `hasAuthorization`.
- `src/documents/kinds.mjs` subtypes `cfpb_complaint`, `state_ag_complaint`, `furnisher_validation` (titles only; pack still ships as one DIY folder).
- `src/repair/dispute-auth.mjs` comment: dated packs must pass the gate; DIY undated still generates.
- Migration `167` already on live `schema_migrations` (`2026-08-16`). Kind check allows `dispute_authorization`. Did not re-apply.
- No new API routes. Journeys unchanged. Nothing mails itself.
- `src/metro2/diy/persist.mjs` saves each pack PDF to the documents registry. `deliver.mjs` calls it. Cover `.txt` files are skipped.
- `src/metro2/diy/collectors.mjs` adds a collector validation letter only when the engine fired a collection rule (M2-019 / M2-022 / M2-023) or `collection: true`. Does not guess from a creditor name.
- Prove run 2026-08-15: live CRS sandbox → 17 PDFs emailed to stanbridgejchris@gmail.com. Barbara/TU 5, Willie/EX 6 (incl. personal-info), John/EQ 6 (incl. inquiry). No collector letter: sandbox files did not fire collection rules. Memory persist stored 17/17 PDFs.
- Live DIY now reads the stored credit pull (`crs_results`) when the payment event does not hand in violations. Engine findings pick the flow (bureau R1–R3, personal-info, inquiry mail, collector only if a collection rule fired). Gold letter pack is fallback only when the engine finds nothing.

**Verify:** `node --test src/metro2/diy/from-crs.test.mjs src/metro2/diy/deliver.test.mjs src/workflows/ds-02-diy-letters.test.mjs` — 20 passed, 0 failed.
