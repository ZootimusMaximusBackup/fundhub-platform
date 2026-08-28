# Optimize — Fundhub Credit Solutions LLC referral page

**COMPLIANCE REVIEW REQUIRED** — credit-repair referral copy. No score-up claims. Page says Audit, not credit repair.

Worktree: `/Users/zootimusmaximus/fundhub-optimize`  
Branch: `feat/optimize-apply` (from `origin/main`)

## Workflows

| # | Unit | Owner | Status |
|---|---|---|---|
| 1 | Hidden public page `/optimize` + `/optimize.com` — book, optional Audit checkout, gated Smart Credit, Audit roadmap from existing repair brain | this chat | **done** |
| 2 | Smart Credit enroll live on this page | waiting | **wired-but-dark** — no CONSUMER_DIRECT / SMART_CREDIT client key + PID in `.env` or Netlify |

## Shared brief

- Entity on every public word: **Fundhub Credit Solutions LLC**
- Referrals only. Low-key. No “your score will go up.” No “credit repair” on the page.
- Book URL (reuse, do not invent): `https://apply.fundhub.ai/funding-book-call`
- Audit checkout: keep title **Consulting Services Assessment**. Never POST `/public-api/products/create`.
- Smart Credit: Enrollment Widget only, and only when client key + PID exist.
- No Identity IQ. No CRS on this page. No Blake ingest. No Twilio from Gmail.

## Workflow 1 manifest

- `public/optimize.html` — page
- `api/public/optimize.mjs` — GET config / POST Audit checkout
- `netlify.toml` — `/optimize.com` → `/optimize.html` (200 rewrite)
- `netlify/functions/api.mjs` — route `public/optimize`
- `src/pulse/registry.mjs` — `public/optimize`
- `src/http/optimize-html.test.mjs`
- `src/http/optimize-public.test.mjs`
- `docs/journeys/optimize-intended.md`
- `docs/journeys/optimize-actual.md`
- `docs/journeys/CHANGELOG.md` — one line

## Left waiting

Smart Credit affiliate / partner client key + PID. When those names exist in env, the Enrollment Widget renders. Until then the slot stays hidden.

## Deploy

In progress this turn — Chris said COMMIT AND LIVE AFTER.
