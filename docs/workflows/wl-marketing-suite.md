# White-label marketing suite

Owner: Chris. Plan GO: 2026-08-17 (“Proceed”).
Shared board for this batch. Agents claim a row before editing.

## Task list

| id | unit | owner | status |
|---|---|---|---|
| 1 | Switch, meter, cap, tables | this session | done |
| 2 | Brand Studio partner lane (templates, copy, history, logo) | this session | done |
| 3 | Live pages on our site | this session | done |
| 4 | Social Studio generate / queue / list | this session | done |
| 5 | Creative Factory Anthropic copy + usage | this session | done |

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
