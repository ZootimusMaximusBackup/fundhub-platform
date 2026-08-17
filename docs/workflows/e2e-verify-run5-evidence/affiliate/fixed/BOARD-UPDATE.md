# Ticket 6 — BOARD UPDATE

- ticket: 6
- journey: affiliate
- step: Company Brain Ask
- observed: affiliate@fundhub.ai on http://localhost:8888. POST /api/read/company-brain-affiliate with body {} and the affiliate token returned 400 question_required (not 401). Playwright login landed on /app/affiliate.html with the Ask approved partner docs control visible.
- evidence path: docs/workflows/e2e-verify-run5-evidence/affiliate/fixed/
- status: FIXED-UNCLICKED
- files changed:
  - api/read/company-brain-affiliate.mjs
  - src/http/company-brain.test.mjs
  - docs/workflows/e2e-verify-run5-evidence/affiliate/fixed/ask-network.json
  - docs/workflows/e2e-verify-run5-evidence/affiliate/fixed/ask-shot.png
  - docs/workflows/e2e-verify-run5-evidence/affiliate/fixed/ask-prove.mjs
  - docs/workflows/e2e-verify-run5-evidence/affiliate/fixed/BOARD-UPDATE.md
