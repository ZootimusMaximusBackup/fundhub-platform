# White-label marketing suite

Owner: Chris. Plan GO: 2026-08-17 (“Proceed”).
Shared board for this batch. Agents claim a row before editing.

## Task list

| id | unit | owner | status |
|---|---|---|---|
| 1 | Switch, meter, cap, tables | this session | shipped live 2026-08-17 |
| 2 | Brand Studio partner lane (templates, copy, history, logo) | this session | shipped live 2026-08-17 |
| 3 | Live pages on our site | this session | shipped live 2026-08-17 |
| 4 | Social Studio generate / queue / list | this session | shipped live 2026-08-17 |
| 5 | Creative Factory Anthropic copy + usage | this session | shipped live 2026-08-17 |

Chris takes none of these in other sessions unless this board says otherwise.
Content Admin is not a task — leave the client-portal tile screen alone.

## Shared context

- Role: white-label partner. Owner uses the same screens for one partner.
- Per-partner switch `marketing_suite_enabled`, default off, owner-only write.
- Cap: 250,000 tokens per partner per calendar month. Count, do not charge.
- Same sidebar names. Partner also sees Social Studio and Creative Factory.
- No Commas. No Meta/Google live ads. No new DNS product.
- Compliance blocks stay locked. Org/CRM brand lane in Brand Studio stays as-is.
- Live pages: `/sites/{partner}/{slug}` plus a verified custom domain.

## Change manifests

### 1–5 this session

**Files created**
- `db/migrations/172_wl_marketing.sql`
- `src/brand/meter.mjs`, `templates.mjs`, `copy-generate.mjs`, `wordmark.mjs` (+ tests)
- `api/partner-marketing/enable.mjs`, `usage.mjs`, `generate-copy.mjs`, `copy-history.mjs`, `generate-logo.mjs`
- `api/social/posts.mjs`, `api/social/generate.mjs`

**Files touched**
- `netlify/functions/api.mjs` — routes
- `api/partner-pages.mjs` — templates + publish needs the switch on
- `src/brand/partner-site.mjs` — live page HTML
- `src/agents/model.mjs` — token usage on every reply
- `src/creative/providers/copy.mjs`, `src/creative/generate.mjs`, `api/creative/generate.mjs`
- `api/social/schedule.mjs` — suite gate
- `src/partners/scope.mjs` — new tables
- `public/app/shell.js` — partner tabs include Social Studio + Creative Factory
- `public/app/brand-studio.html`, `social-studio.html`, `creative-factory.html`
- `e2e/verification-roles.spec.mjs` — partner screen list

**Not touched**
- `public/app/content-admin.html`

**Journeys**
- `docs/journeys/white-label-intended.md` — marketing suite section
- actuals regenerated with `npm run journeys`

## Blockers

none

## Fix pass (2026-08-17, after audit)

Named rows from `docs/workflows/wl-marketing-audit.md` — the four CRITICAL plus the Social queue drafts HIGH.

**Files touched**
- `api/partner-marketing/generate-logo.mjs` — upsert `partner_brand` when the row is missing
- `src/http/partner-marketing-logo.test.mjs` — unit test for that upsert
- `public/app/brand-studio.html` — hide Turn on when already On; preview uses the first page hero; wordmark errors in plain words
- `public/app/social-studio.html` — clear “no partner” once one is picked; Queue includes `draft`
- `public/app/creative-factory.html` — Enqueue off until the budget loads; banner matches the picker; header chip matches write state

**Not touched**
- `public/app/content-admin.html`
- owner nav (33 tabs)
- OPEN-QUESTION rows (Brand Studio under Admin, beta banner)
