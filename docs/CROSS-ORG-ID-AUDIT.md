# Cross-org id-lookup audit (2026-08-04)

P0 fix for `GET /api/dashboard/client` and the same class of bug under `api/`.

## Rule

Org comes from the **session only**. Looking up a row by request id without
binding `org_id` (or partner scope / HMAC) is a cross-company leak.

## Vulnerable — fixed this session

| Endpoint | Defect | Fix |
|---|---|---|
| `GET /api/dashboard/client?id=` | `WHERE id = $1` only; child tables by `client_id` only | `requireSessionOrg` + `requireClientInOrg` + `AND org_id` on every query |
| `GET /api/dashboard/clients` | Listed every client in the database | `WHERE c.org_id = $session` |
| `GET /api/dashboard/pipeline?key=` | Pipeline key alone crossed orgs | `p.org_id` / `cd.org_id` from session |
| `GET/PATCH /api/tasks` | Queue + PATCH by task id with no org | Bind `principal.orgId` on SELECT/UPDATE |
| `GET/POST /api/inquiries` | `inquiry_id` without org | `orgId` through `src/inquiries/work.mjs` |
| `GET /api/hiring/application?id=` | Used default org, not session | `a.org_id = staff.org_id` |
| `POST /api/inquiry-cases` create | Inserted foreign `client_id` under session org | Own-client check before insert |
| `PATCH /api/partner-pages` published_at | Secondary UPDATE by id only | `AND org_id = $session` |

## Checked — already scoped (or sessionless by design)

All of these were reviewed. They already bind session org, partner scope/RLS,
`requireClientInOrg` / `ownsClient`, or use HMAC / public token auth:

- `api/dashboard/kpis.mjs`, `api/dashboard/seed.mjs` (write via bus; no foreign id read)
- `api/read/*` (banking-surface, finance-os, tradelines, underwrite, money-map, finance-command, finance-ask, transactions, agent-context, inquiries, inquiry-cases, documents, funding-rounds, invoices, lenders, …)
- `api/finance/*`, `api/banking/*`, `api/payment-links.mjs`, `api/pipeline-cards.mjs`
- `api/messages.mjs`, `api/chat/messages.mjs`, `api/contracts.mjs` (session org)
- `api/lenders.mjs`, `api/lender-observations.mjs`, `api/applications.mjs`, `api/products.mjs`, `api/agents.mjs`
- `api/campaigns/detail.mjs`, `write.mjs`, `sync.mjs` (partner scope / connection ownership)
- `api/creative/*`, `api/social/*` (partner_id from session partner)
- `api/documents/[id].mjs`, `api/contracts/sign.mjs` — **HMAC signed URL, not session**
- `api/webhooks/[provider].mjs`, `api/public/partner-page.mjs`, `api/inquiry.mjs` (proxy), auth routes

## Recurrence guard

- Static: `src/http/cross-org-guard.test.mjs` auto-discovers every `api/` handler that accepts an id/client_id and fails CI if it lacks an org/partner scope marker (or the sessionless allowlist).
- Runtime: `src/http/cross-org-isolation.pg.test.mjs` seeds org A, calls every runtime probe as org B, asserts 403/404 and no leaked PII.

## Verification

Before (commit `cc56c16`): **29 P0** non-passes — 7 confirmed FAIL for
`GET /api/dashboard/client` cross-org reads across staff roles.

After this fix: **22 P0** non-passes — all remaining are UNVERIFIED (static HTML
direct-URL / Company Brain), **zero confirmed cross-org client leaks**. Every
role now PASSes `cannot read other org client (404)`.
