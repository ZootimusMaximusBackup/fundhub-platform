# role-sales-manager — live route probe

Ran 2026-08-17T05:48:39.817Z against https://fundhub.ai as `sales@fundhub.ai`.

| Check | Result |
|---|---|
| Login | HTTP 200, ok=true, role=sales_manager, token=true, cookie=true |
| Session | HTTP 200, role=sales_manager |
| Not signed in → 401 | 6/6 correct |
| Should reach | 69/72 probed OK · 53 UNVERIFIED (write-only) · 3 FAIL |
| Should stay blocked | 30/30 probed 403 · 1 UNVERIFIED · 0 FAIL |

## Intended vs actual group counts

| Side | Group | Intended | Actual (code) |
|---|---|---|---|
| reach | Signing in and out | 6 | 6 |
| reach | banking | 2 | 2 |
| reach | Campaigns | 6 | 8 ⚠️ |
| reach | contracts | 1 | 1 |
| reach | Creative Factory | 4 | 7 ⚠️ |
| reach | The dashboard | 4 | 6 ⚠️ |
| reach | Documents | 1 | 1 |
| reach | Finance | 9 | 9 |
| reach | journeys | 1 | 1 |
| reach | Reading data | 25 | 43 ⚠️ |
| reach | Everything else | 11 | 25 ⚠️ |
| reach | Incoming webhooks | 1 | 1 |
| reach | chat | 0 | 3 ⚠️ |
| reach | climate | 0 | 2 ⚠️ |
| reach | company-brain | 0 | 1 ⚠️ |
| reach | public | 0 | 3 ⚠️ |
| reach | repair | 0 | 2 ⚠️ |
| reach | social | 0 | 3 ⚠️ |
| reach | staff | 0 | 1 ⚠️ |
| blocked | Signing in and out | 1 | 3 ⚠️ |
| blocked | banking | 1 | 1 |
| blocked | consent | 1 | 1 |
| blocked | Finance | 1 | 1 |
| blocked | Hiring | 6 | 6 |
| blocked | journeys | 1 | 1 |
| blocked | privacy | 1 | 1 |
| blocked | Reading data | 1 | 3 ⚠️ |
| blocked | Everything else | 4 | 6 ⚠️ |
| blocked | chat | 0 | 1 ⚠️ |
| blocked | company-brain | 0 | 1 ⚠️ |
| blocked | demo | 0 | 2 ⚠️ |
| blocked | partner-brand | 0 | 1 ⚠️ |
| blocked | proxy | 0 | 2 ⚠️ |
| blocked | staff | 0 | 1 ⚠️ |

## Failures — should reach but got 401/403/404/5xx

| Route | Method | Status | Error | Gate (code says) |
|---|---|---|---|---|
| `/api/contracts/sign` | GET | 404 | not_found | anyone |
| `/api/read/banking-surface` | GET | 403 | banking surface requires plaid configuration | owner, admin, sales_manager |
| `/api/repair/exceptions` | GET | 403 | role_forbidden | staff |

## Failures — should be blocked but was not 403

| Route | Method | Status | Error | Gate (code says) |
|---|---|---|---|---|
| — | | | | |

## Not signed in

| Route | Status (expect 401) |
|---|---|
| `/api/applications` | 401 |
| `/api/banking/accounts` | 401 |
| `/api/campaigns/action-log` | 401 |
| `/api/campaigns/connections` | 401 |
| `/api/campaigns/detail` | 401 |
| `/api/campaigns/fatigue` | 401 |

## Every probe

| Side | Route | Method | Status | Note |
|---|---|---|---|---|
| reach | `/api/agents` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/applications` | GET | 400 | application_id required |
| reach | `/api/auth/login` | GET | 200 |  |
| reach | `/api/auth/logout` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/auth/magic-link` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/auth/magic-link-verify` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/auth/reset` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/auth/session` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/banking/accounts` | GET | 400 | client_id is required and must be a uuid |
| reach | `/api/banking/sync-accounts` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/call-outcomes` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/campaigns/action-log` | GET | 400 | partner_id_required |
| reach | `/api/campaigns/connections` | GET | 400 | partner_id_required |
| reach | `/api/campaigns/detail` | GET | 400 | partner_id_required |
| reach | `/api/campaigns/fatigue` | GET | 400 | partner_id_required |
| reach | `/api/campaigns/list` | GET | 400 | partner_id_required |
| reach | `/api/campaigns/spend` | GET | 400 | partner_id_required |
| reach | `/api/campaigns/sync` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/campaigns/write` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/chat/ask` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/chat/messages` | GET | 200 |  |
| reach | `/api/chat/peers` | GET | 200 |  |
| reach | `/api/climate` | OPTIONS | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/climate/config` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/climate/geocode` | OPTIONS | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/closer-deck` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/company-brain/sync` | GET | 200 |  |
| reach | `/api/contracts` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/contracts/sign` | GET | 404 | not_found |
| reach | `/api/creative/actions` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/creative/approvals` | GET | 400 | partner_id_required |
| reach | `/api/creative/brand-kits` | GET | 400 | partner_id_required |
| reach | `/api/creative/generate` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/creative/jobs` | GET | 400 | partner_id_required |
| reach | `/api/creative/library` | GET | 400 | partner_id_required |
| reach | `/api/creative/run` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/customer-insights` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/dashboard/client` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/dashboard/client-archive` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/dashboard/clients` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/dashboard/kpis` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/dashboard/pipeline` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/dashboard/seed` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/documents-upload` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/documents/:id` | HEAD | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/finance/alerts` | GET | 200 |  |
| reach | `/api/finance/bank-accounts` | GET | 400 | client_id must be a uuid |
| reach | `/api/finance/bills` | GET | 400 | client_id or bill_id must be a uuid |
| reach | `/api/finance/cards` | GET | 400 | client_id must be a uuid |
| reach | `/api/finance/cashflow` | GET | 400 | client_id must be a uuid |
| reach | `/api/finance/entities` | GET | 400 | client_id must be a uuid |
| reach | `/api/finance/liabilities` | GET | 400 | client_id or tradeline_id must be a uuid |
| reach | `/api/finance/model` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/finance/subscriptions` | GET | 400 | client_id must be a uuid |
| reach | `/api/health` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/inngest` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/inquiries` | GET | 400 | inquiry_id must be a uuid |
| reach | `/api/inquiry-cases` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/journeys/run` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/lender-observations` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/lenders` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/marketing-flags` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/message-templates` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/messages` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/messages-outbound` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/org-brand` | GET | 200 |  |
| reach | `/api/payment-links` | GET | 400 | client_id must be a uuid |
| reach | `/api/pipeline-cards` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/products` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/public/partner-apply` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/public/partner-page` | GET | 400 | partner_id_and_slug_or_domain_required |
| reach | `/api/public/survey-submit` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/read/affiliates` | GET | 200 |  |
| reach | `/api/read/agent-context` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/read/agent-shadow-log` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/read/agents` | GET | 200 |  |
| reach | `/api/read/ai-bureau-config` | GET | 200 |  |
| reach | `/api/read/banking-surface` | GET | 403 | banking surface requires plaid configuration |
| reach | `/api/read/call-outcomes` | GET | 200 |  |
| reach | `/api/read/closer-call` | GET | 400 | client_id is required and must be a uuid |
| reach | `/api/read/closer-deck` | GET | 400 | client_id is required and must be a uuid |
| reach | `/api/read/commissions` | GET | 200 |  |
| reach | `/api/read/company-activity` | GET | 200 |  |
| reach | `/api/read/company-brain` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/read/contracts` | GET | 200 |  |
| reach | `/api/read/conversations` | GET | 400 | invalid_parameter |
| reach | `/api/read/customer-insights` | GET | 200 |  |
| reach | `/api/read/documents` | GET | 200 |  |
| reach | `/api/read/entitlements` | GET | 200 |  |
| reach | `/api/read/finance-ask` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/read/finance-command` | GET | 200 |  |
| reach | `/api/read/finance-os` | GET | 400 | client_id is required and must be a uuid |
| reach | `/api/read/funding-rounds` | GET | 200 |  |
| reach | `/api/read/inbox` | GET | 200 |  |
| reach | `/api/read/inquiries` | GET | 200 |  |
| reach | `/api/read/inquiry-cases` | GET | 200 |  |
| reach | `/api/read/invoices` | GET | 200 |  |
| reach | `/api/read/lender-matches` | GET | 400 | client_id is required and must be a uuid |
| reach | `/api/read/lender-observations` | GET | 200 |  |
| reach | `/api/read/lenders` | GET | 200 |  |
| reach | `/api/read/message-templates` | GET | 200 |  |
| reach | `/api/read/messages` | GET | 400 | invalid_parameter |
| reach | `/api/read/money-map` | GET | 400 | client_id is required and must be a uuid |
| reach | `/api/read/my-numbers` | GET | 200 |  |
| reach | `/api/read/partners` | GET | 200 |  |
| reach | `/api/read/portal-contracts` | GET | 400 | client_id_required |
| reach | `/api/read/portal-summary` | GET | 400 | client_id_required |
| reach | `/api/read/products` | GET | 200 |  |
| reach | `/api/read/sales-floor` | GET | 200 |  |
| reach | `/api/read/search` | GET | 200 |  |
| reach | `/api/read/staff` | GET | 200 |  |
| reach | `/api/read/tradelines` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/read/transactions` | GET | 400 | client_id is required and must be a uuid |
| reach | `/api/read/underwrite` | GET | 400 | client_id is required and must be a uuid |
| reach | `/api/read/workflows` | GET | 200 |  |
| reach | `/api/repair/exceptions` | GET | 403 | role_forbidden |
| reach | `/api/repair/send` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/shifts` | GET | 200 |  |
| reach | `/api/social/oauth` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/social/publish` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/social/schedule` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/soft-pull-approve` | GET | 400 | bad_token |
| reach | `/api/staff/telemetry` | GET | 400 | staff_id must be a uuid |
| reach | `/api/tasks` | GET | 200 |  |
| reach | `/api/webhooks/:provider` | — | — | UNVERIFIED — write-only route, not probed |
| blocked | `/api/ai-bureau-config` | POST | 403 | forbidden |
| blocked | `/api/auth/admin-reset` | POST | 403 | forbidden |
| blocked | `/api/auth/invite` | POST | 403 | forbidden |
| blocked | `/api/auth/suspend` | POST | 403 | forbidden |
| blocked | `/api/banking/revoke` | GET | 403 | forbidden |
| blocked | `/api/chat/portal-message` | POST | 403 | forbidden |
| blocked | `/api/company-brain/reviews` | GET | 403 | forbidden |
| blocked | `/api/consent/capture` | GET | 403 | forbidden |
| blocked | `/api/demo/mode` | GET | 403 | forbidden |
| blocked | `/api/demo/simulate` | POST | 403 | forbidden |
| blocked | `/api/finance/soft-pull` | GET | 403 | forbidden |
| blocked | `/api/hiring/application` | GET | 403 | forbidden |
| blocked | `/api/hiring/bench` | GET | 403 | forbidden |
| blocked | `/api/hiring/candidates` | GET | 403 | forbidden |
| blocked | `/api/hiring/decisions` | GET | 403 | forbidden |
| blocked | `/api/hiring/funnel` | GET | 403 | forbidden |
| blocked | `/api/hiring/postings` | GET | 403 | forbidden |
| blocked | `/api/inquiry` | — | — | UNVERIFIED — no GET/POST method to probe safely |
| blocked | `/api/journeys` | GET | 403 | forbidden |
| blocked | `/api/journeys/ask` | POST | 403 | forbidden |
| blocked | `/api/partner-brand` | GET | 403 | forbidden |
| blocked | `/api/partner-brand/verify-domain` | POST | 403 | forbidden |
| blocked | `/api/partner-pages` | GET | 403 | forbidden |
| blocked | `/api/pii` | GET | 403 | forbidden |
| blocked | `/api/privacy/erasure` | GET | 403 | forbidden |
| blocked | `/api/proxy/end` | POST | 403 | forbidden |
| blocked | `/api/proxy/launch` | POST | 403 | forbidden |
| blocked | `/api/read/company-brain-affiliate` | POST | 403 | forbidden |
| blocked | `/api/read/failed-events` | GET | 403 | forbidden |
| blocked | `/api/read/proxy-sessions` | GET | 403 | forbidden |
| blocked | `/api/staff/monitoring-consent` | POST | 403 | forbidden |
