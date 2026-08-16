# Live Playwright 100 — shared board

**Status:** **100/100 PASS** (2026-08-15, re-verified after credit restore) — **31/31** after the 2026-08-16 affiliate + white-label additions. A separate 2026-08-15 attempt in a workspace with no gitignored `.env` was blocked at setup; last live PASS there stayed the 2026-08-14 P4 reconfirm until credentials were available again.
**Canonical:** `https://fundhub.ai` · funnel `https://apply.fundhub.ai`
**Gate law:** No manual review from Chris until AI-run Playwright scores **100/100** against live; then exactly one manual pass.
**Command:** `npm run test:e2e:live`
**Branch:** `cursor/resume-gold-break-1dea`

### Hard rules
- Never print secrets. Read local `.env` / Netlify runtime. Never ask to rotate keys.
- Do not wipe demo data. Do not flip `MESSAGING_DRY_RUN`. Do not emit live Inngest.
- Live score only counts `e2e/live-*.spec.mjs` against deployed sites.
- Prefer fixing honest tests; if a real product bug blocks 100, fix the product carefully.

## Task list

| Unit | Owner | Status |
|------|-------|--------|
| R Rule + scoreboard + docs commit | this thread | **done** |
| C Config + live auth fixture | this thread | **done** |
| S Specs for RUN4 PASS surfaces | this thread | **done** |
| L Loop run → fix → 100/100 | this thread | **done — 31/31** (2026-08-16). Hit two 2026-08-15 blockers along the way: Netlify `usage_exceeded` (resolved after credit restore) and, in a separate workspace with no gitignored `.env`, `STAFF_E2E_PASSWORD` unset (last PASS there stayed **19/19** from 2026-08-14). |

## Score

`score = (passed_required / required) * 100`

**Final:** **100/100** (19/19 site gate) — evidence `docs/workflows/e2e-verify-run4-evidence/live-playwright-100/` (P4 reconfirm 2026-08-14; re-verified 2026-08-15 after credit restore).

**Separate 2026-08-15 blocked attempt (workspace with no gitignored `.env`):** **0/19 = 0/100** — not a site failure. `npm run test:e2e:live` exited in `beforeAll`: `STAFF_E2E_PASSWORD` / `STAFF_INITIAL_PASSWORD` **UNSET**. 1 test failed (setup), 18 did not run. Chrome binary present. Did not guess a password. Did not `--prod`. Did not drain outbox. Did not ask to rotate keys. That workspace's last confirmed PASS stayed the 2026-08-14 P4 reconfirm until credentials were restored elsewhere (see credit-restore run below).

**2026-08-16 affiliate + white-label:** required is now **31** (old 19 + 5 affiliate + 7 white-label). Live run **31/31 = 100**. Full command **26/26**.

## Required live test ids

| id | Covered by | 2026-08-13 live |
|----|------------|-----------------|
| `auth:staff_session` (chris/owner/admin) | live-run4-pass auth | **PASS** |
| `api:auth/login` bad password | live-run4-pass | **PASS** |
| `api:auth/session` anon | live-run4-pass | **PASS** |
| `api:auth/login` demo off | live-run4-pass | **PASS** |
| `CRM shells static 200` | live-run4-pass | **PASS** |
| `CRM rows+filters / demo banner` | live-run4-pass (UI + `/api/read/search`) | **PASS** |
| `route:dirty_letter_artifact` | live-run4-pass search `w4c+test` | **PASS** |
| `wh:clickfunnels` fail-closed | live-run4-pass | **PASS** |
| `wh:commas` signature unsigned | live-run4-pass | **PASS** |
| `api:dashboard/*` anonymous refuse | live-run4-pass | **PASS** |
| `api:read/products` | live-run4-pass | **PASS** |
| `api:payment-links` list | live-run4-pass | **PASS** |
| `api:read/commissions` | live-run4-pass | **PASS** |
| `screen:thank-you` calendar | live-run4-pass → apply.fundhub.ai | **PASS** |
| `screen:thank-you` no booking | live-run4-pass | **PASS** |
| `funnel:fixed-grid` | live-run4-pass `/watch` | **PASS** |
| `api:health` pending0 | live-run4-pass | **PASS** |
| `aff:website_entry` | live-affiliate-onboard homepage → /affiliates/ | added 2026-08-16 |
| `aff:apply_form` | live-affiliate-onboard fake e2e+aff apply | added 2026-08-16 |
| `aff:own_login` | live-affiliate-onboard seeded affiliate login | added 2026-08-16 |
| `aff:dashboard` | live-affiliate-onboard referral link + funnel card | added 2026-08-16 |
| `aff:session_affiliate` | live-affiliate-onboard session names affiliate | added 2026-08-16 |
| `wl:website_entry` | live-white-label-onboard homepage → /affiliates/ | added 2026-08-16 |
| `wl:white_label_apply` | live-white-label-onboard fake e2e+wl apply | added 2026-08-16 |
| `wl:partner_login` | live-white-label-onboard partner sign-in | added 2026-08-16 |
| `wl:partner_galaxy` | live-white-label-onboard Your Galaxy | added 2026-08-16 |
| `wl:own_url` | live-white-label-onboard /sites/ path in studio | added 2026-08-16 |
| `wl:funnel_studio` | live-white-label-onboard Brand Studio | added 2026-08-16 |
| `wl:public_partner_page` | live-white-label-onboard unpublished is not live | added 2026-08-16 |

The first 19 ids above are the **site** gate; individually confirmed **PASS** against live on 2026-08-13. They do **not** cover the five sample-pack emails (email roster: `docs/workflows/sample-roster-usable-packs.md`). The affiliate and white-label ids were added 2026-08-16, bringing the required total to 31.

## Harness-only inventory (excluded from live score)

All non-`live-*` specs under `e2e/` use `e2e/harness.mjs` + static server (`npm run test:e2e`). Examples: `login.spec.mjs`, `crm-flows.spec.mjs`, `messaging-inbox.spec.mjs`, `pipeline.spec.mjs`, etc. **Harness-only — not in live 100.**

## Config

- `test:e2e:live` → `playwright test -c playwright.live.config.mjs`
- `BASE_URL` default `https://fundhub.ai`
- `FUNNEL_URL` default `https://apply.fundhub.ai`
- Auth: `STAFF_E2E_PASSWORD` from gitignored `.env`

## Loop log

| Run | Score | Failures | Fix |
|-----|-------|----------|-----|
| 1 | 7/19 | CRM goto crm.html ERR_ABORTED | use /app/ |
| 2 | 17/19 | search input hidden / banner | open overlay; API search |
| 3 | 17/19 | `/api/read/search` 503 `c.business_name` | fix `api/read/search.mjs` + deploy |
| 4–5 | 18/19 | Meta+k / force click flaky | evaluate open overlay; skip flaky re-goto |
| 6 | **19/19 = 100** | — | — |
| 7 (P4 2026-08-14) | **19/19 = 100** | — | reconfirm only |
| 8 (2026-08-15, no-`.env` workspace) | **0/19 = 0** (blocked) | missing `STAFF_E2E_PASSWORD` — no `.env` in this workspace | none (env, not product). Last PASS remains run 7. |
| 9 (2026-08-15) | 5/19 | Netlify `usage_exceeded` | wait for credits |
| 10 (2026-08-15) | **19/19 = 100** | — | credits restored; health + login green |
| 11 (2026-08-16) | **24/24 = 100** | — | Workflow 2 added 5 affiliate ids; full `test:e2e:live` 26/26 |
| 12 (2026-08-16) | **31/31 = 100** | — | partner sites + Brand Studio writes; added 7 white-label ids after green |
| 13 (2026-08-16) | **31/31 = 100** | — | Workflow 3 re-ran full `test:e2e:live` **26/26** after partner lockout wait |

## Product fix shipped

- `api/read/search.mjs`: stop selecting nonexistent `clients.business_name`; use `businesses.name` / `custom_fields->>'business_name'`. Deployed to prod.

## Change manifests

- `.cursor/rules/live-playwright-100-before-manual.mdc`, `secrets-env-law.mdc`
- `playwright.live.config.mjs`, `e2e/live-auth.mjs`, `e2e/live-run4-pass.spec.mjs`
- `package.json` `test:e2e:live`
- `api/read/search.mjs`
- `docs/workflows/live-playwright-100.md` + evidence
- `CLAUDE.md` env law; `.gitignore` conflict cleanup; E2E/W4 docs

### 2026-08-16 Workflow 2 (append)

- `e2e/live-affiliate-onboard.spec.mjs`
- five required ids: `aff:website_entry`, `aff:apply_form`, `aff:own_login`, `aff:dashboard`, `aff:session_affiliate`
