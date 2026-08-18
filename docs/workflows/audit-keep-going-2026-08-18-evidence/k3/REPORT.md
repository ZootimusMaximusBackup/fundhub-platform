# K3 — Consent, then one bureau pull (TEST)

Date: 2026-08-18  
**COMPLIANCE REVIEW REQUIRED** — consent capture, credit-pull type.

TEST only: `8556bedc-…`. Never opened `9af65808-…`. Did **not** click TransUnion. Did not mail a bureau letter. No SSN typed.

Ground truth for this hop is **MISSING**. Intended journeys do not name consent → bureau pull. Scored against Chris’s claim.

Env names: `STAFF_E2E_PASSWORD`, `DATABASE_URL`. Values not printed.

---

## Score

| Ask | Result |
|---|---|
| Staff can open the consent page and click Record | **FAIL** — page dumps you on Pipeline |
| Consent row the pull actually reads | **PASS** — API wrote `soft_pull_consent` `935649c6-…` |
| Experian pull comes back with a score | **FAIL** — **422** “no identity on file” |

Chris’s claim (capture consent on TEST, then a bureau pull comes back): **BROKEN**. Consent can be saved. The pull still dies. Scores stay dashes.

---

## FAIL — consent screen bounces

- Journey: consent capture (Chris’s claim; **MISSING**)
- Step: open `/app/consent-capture.html` for TEST and press Record
- Expected: name box + Record consent
- Observed: first load aborted. Landed on `/app/pipeline.html`. No `#ccName`. Shot `01-consent.png` is the Pipeline.
- Workaround used: `POST /api/consent/capture` **200** (same door the page would call). That is not a staff click on the form.
- Evidence: `walk.json` `01-consent.png`

---

## PASS — pull now sees consent

- Before: only `dispute_authorization`. `soft_pull_consent` **0**. Pulls **0**.
- After API grant: `soft_pull_consent` active, method `typed`.
- Experian click was **not** the old 403 “no soft-pull consent.” The consent gate opened.
- Evidence: `walk.json`

---

## FAIL — Experian still will not run

- Journey: bureau pull (Chris’s claim; **MISSING**)
- Step: click Pull Experian once on TEST
- Expected: a report comes back, or a clear next ask
- Observed:
  - File is TEST, not the live file.
  - `POST /api/finance/crs-pull` **422** `no identity on file for this client — a credit report cannot be ordered`
  - Screen same words.
  - `soft_pull_requests` row `1f988a98-…` status **failed**, provider `internal`, no stored result.
  - `crs_results` still **0**. EX / EQ / TU still dashes.
  - Did not type SSN. Did not click TransUnion. Did not click again.
- Evidence: `03-ccp-after-experian.png` `walk.json`

---

## Left undone

- Did not invent an identity / SSN step. That was not asked.
- Did not click Equifax or TransUnion after the 422.

## Next

Closer Present send-contract on TEST (K4).
