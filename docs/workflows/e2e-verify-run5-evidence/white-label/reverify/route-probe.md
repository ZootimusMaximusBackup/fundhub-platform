# white-label — live route probe

Ran 2026-08-17T05:48:54.693Z against https://fundhub.ai as `partner@fundhub.ai`.

| Check | Result |
|---|---|
| Login | HTTP 200, ok=true, role=—, token=true, cookie=false |
| Session | HTTP 200, role=partner |
| Not signed in → 401 | 6/6 correct |
| Should reach | 17/18 probed OK · 21 UNVERIFIED (write-only) · 1 FAIL |
| Should stay blocked | 15/107 probed 403 · 10 UNVERIFIED · 92 FAIL |

## Intended vs actual group counts

| Side | Group | Intended | Actual (code) |
|---|---|---|---|
| reach | Signing in and out | 6 | 6 |
| reach | Campaigns | 6 | 8 ⚠️ |
| reach | contracts | 1 | 1 |
| reach | Creative Factory | 4 | 7 ⚠️ |
| reach | Documents | 1 | 1 |
| reach | Reading data | 1 | 1 |
| reach | Everything else | 2 | 7 ⚠️ |
| reach | Incoming webhooks | 1 | 1 |
| reach | climate | 0 | 2 ⚠️ |
| reach | public | 0 | 3 ⚠️ |
| reach | social | 0 | 2 ⚠️ |
| blocked | Signing in and out | 1 | 3 ⚠️ |
| blocked | banking | 3 | 3 |
| blocked | consent | 1 | 1 |
| blocked | The dashboard | 4 | 6 ⚠️ |
| blocked | Finance | 10 | 10 |
| blocked | Hiring | 6 | 6 |
| blocked | journeys | 2 | 2 |
| blocked | privacy | 1 | 1 |
| blocked | Reading data | 25 | 45 ⚠️ |
| blocked | Everything else | 13 | 24 ⚠️ |
| blocked | chat | 0 | 4 ⚠️ |
| blocked | company-brain | 0 | 2 ⚠️ |
| blocked | demo | 0 | 2 ⚠️ |
| blocked | partner-brand | 0 | 1 ⚠️ |
| blocked | proxy | 0 | 2 ⚠️ |
| blocked | repair | 0 | 2 ⚠️ |
| blocked | social | 0 | 1 ⚠️ |
| blocked | staff | 0 | 2 ⚠️ |

## Failures — should reach but got 401/403/404/5xx

| Route | Method | Status | Error | Gate (code says) |
|---|---|---|---|---|
| `/api/contracts/sign` | GET | 404 | not_found | anyone |

## Failures — should be blocked but was not 403

| Route | Method | Status | Error | Gate (code says) |
|---|---|---|---|---|
| `/api/agents` | POST | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/ai-bureau-config` | POST | 401 | unauthorized | owner, admin, funding_advisor |
| `/api/applications` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/auth/admin-reset` | POST | 401 | unauthorized | owner, admin |
| `/api/auth/invite` | POST | 401 | unauthorized | owner, admin |
| `/api/auth/suspend` | POST | 401 | unauthorized | owner, admin |
| `/api/banking/accounts` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/banking/revoke` | GET | 401 | unauthorized | owner, admin |
| `/api/banking/sync-accounts` | POST | 401 | unauthorized | owner, admin, sales_manager |
| `/api/call-outcomes` | POST | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/chat/ask` | POST | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/chat/peers` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/closer-deck` | POST | 401 | unauthorized | closer, sales_manager, owner, admin |
| `/api/company-brain/reviews` | GET | 401 | unauthorized | owner |
| `/api/company-brain/sync` | GET | 401 | unauthorized | owner, admin, sales_manager |
| `/api/contracts` | POST | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/customer-insights` | POST | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/dashboard/client-archive` | POST | 401 | unauthorized | staff |
| `/api/demo/mode` | GET | 401 | unauthorized | owner, admin |
| `/api/demo/simulate` | POST | 401 | unauthorized | owner, admin |
| `/api/finance/alerts` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/finance/bank-accounts` | GET | 401 | unauthorized | owner, admin, sales_manager |
| `/api/finance/bills` | GET | 401 | unauthorized | owner, admin, sales_manager |
| `/api/finance/cards` | GET | 401 | unauthorized | owner, admin, sales_manager |
| `/api/finance/cashflow` | GET | 401 | unauthorized | owner, admin, sales_manager |
| `/api/finance/entities` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/finance/liabilities` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/finance/model` | POST | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/finance/subscriptions` | GET | 401 | unauthorized | owner, admin, sales_manager |
| `/api/hiring/application` | GET | 401 | unauthorized | owner, admin |
| `/api/hiring/bench` | GET | 401 | unauthorized | owner, admin |
| `/api/hiring/candidates` | GET | 401 | unauthorized | owner, admin |
| `/api/hiring/decisions` | GET | 401 | unauthorized | owner, admin |
| `/api/hiring/funnel` | GET | 401 | unauthorized | owner, admin |
| `/api/hiring/postings` | GET | 401 | unauthorized | owner, admin |
| `/api/inquiry-cases` | POST | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/journeys` | GET | 401 | unauthorized | owner, admin |
| `/api/journeys/ask` | POST | 401 | unauthorized | owner, admin |
| `/api/journeys/run` | POST | 401 | unauthorized | owner, admin, sales_manager |
| `/api/lender-observations` | POST | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/lenders` | POST | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/marketing-flags` | POST | 401 | unauthorized | owner, admin, sales_manager |
| `/api/message-templates` | POST | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/messages-outbound` | POST | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/partner-brand/verify-domain` | POST | 401 | unauthorized | owner, admin |
| `/api/payment-links` | GET | 401 | unauthorized | owner, admin, sales_manager |
| `/api/pipeline-cards` | POST | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/privacy/erasure` | GET | 401 | unauthorized | owner, admin |
| `/api/products` | POST | 401 | unauthorized | owner, admin, sales_manager |
| `/api/proxy/end` | POST | 401 | unauthorized | owner, funding_advisor |
| `/api/proxy/launch` | POST | 401 | unauthorized | owner, funding_advisor |
| `/api/read/agents` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/ai-bureau-config` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/banking-surface` | GET | 401 | unauthorized | owner, admin, sales_manager |
| `/api/read/call-outcomes` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/closer-call` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/closer-deck` | GET | 401 | unauthorized | closer, sales_manager, owner, admin |
| `/api/read/commissions` | GET | 401 | unauthorized | owner, admin, sales_manager |
| `/api/read/company-activity` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/company-brain` | POST | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/company-brain-affiliate` | POST | 400 | question_required | affiliate, partner |
| `/api/read/contracts` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/conversations` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/customer-insights` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/documents` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/failed-events` | GET | 401 | unauthorized | owner, admin |
| `/api/read/finance-ask` | POST | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/finance-command` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/finance-os` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/funding-rounds` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/inbox` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/inquiries` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/inquiry-cases` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/invoices` | GET | 401 | unauthorized | owner, admin, sales_manager |
| `/api/read/lender-matches` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/lender-observations` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/lenders` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/message-templates` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/messages` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/money-map` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/my-numbers` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/products` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/proxy-sessions` | GET | 401 | unauthorized | owner, funding_advisor |
| `/api/read/sales-floor` | GET | 401 | unauthorized | owner, admin, sales_manager |
| `/api/read/search` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/staff` | GET | 401 | unauthorized | owner, admin, sales_manager |
| `/api/read/transactions` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/underwrite` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/read/workflows` | GET | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/repair/send` | POST | 401 | unauthorized | owner, admin, funding_advisor, closer, inquiry_specialist, setter, sales_manager |
| `/api/staff/monitoring-consent` | POST | 401 | unauthorized | owner |
| `/api/staff/telemetry` | GET | 401 | unauthorized | owner, admin, sales_manager |

## Not signed in

| Route | Status (expect 401) |
|---|---|
| `/api/campaigns/action-log` | 401 |
| `/api/campaigns/connections` | 401 |
| `/api/campaigns/detail` | 401 |
| `/api/campaigns/fatigue` | 401 |
| `/api/campaigns/list` | 401 |
| `/api/campaigns/spend` | 401 |

## Every probe

| Side | Route | Method | Status | Note |
|---|---|---|---|---|
| reach | `/api/auth/login` | GET | 200 |  |
| reach | `/api/auth/logout` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/auth/magic-link` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/auth/magic-link-verify` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/auth/reset` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/auth/session` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/campaigns/action-log` | GET | 200 |  |
| reach | `/api/campaigns/connections` | GET | 200 |  |
| reach | `/api/campaigns/detail` | GET | 400 | bad_request |
| reach | `/api/campaigns/fatigue` | GET | 200 |  |
| reach | `/api/campaigns/list` | GET | 200 |  |
| reach | `/api/campaigns/spend` | GET | 200 |  |
| reach | `/api/campaigns/sync` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/campaigns/write` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/climate` | OPTIONS | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/climate/config` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/climate/geocode` | OPTIONS | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/contracts/sign` | GET | 404 | not_found |
| reach | `/api/creative/actions` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/creative/approvals` | GET | 200 |  |
| reach | `/api/creative/brand-kits` | GET | 200 |  |
| reach | `/api/creative/generate` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/creative/jobs` | GET | 200 |  |
| reach | `/api/creative/library` | GET | 200 |  |
| reach | `/api/creative/run` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/documents/:id` | HEAD | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/health` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/inngest` | — | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/org-brand` | GET | 200 |  |
| reach | `/api/partner-brand` | GET | 400 | partner_id_required |
| reach | `/api/partner-pages` | GET | 400 | partner_id_required |
| reach | `/api/public/partner-apply` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/public/partner-page` | GET | 400 | partner_id_and_slug_or_domain_required |
| reach | `/api/public/survey-submit` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/read/partners` | GET | 200 |  |
| reach | `/api/social/publish` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/social/schedule` | POST | — | UNVERIFIED — write-only route, not probed |
| reach | `/api/soft-pull-approve` | GET | 400 | bad_token |
| reach | `/api/webhooks/:provider` | — | — | UNVERIFIED — write-only route, not probed |
| blocked | `/api/agents` | POST | 401 | unauthorized |
| blocked | `/api/ai-bureau-config` | POST | 401 | unauthorized |
| blocked | `/api/applications` | GET | 401 | unauthorized |
| blocked | `/api/auth/admin-reset` | POST | 401 | unauthorized |
| blocked | `/api/auth/invite` | POST | 401 | unauthorized |
| blocked | `/api/auth/suspend` | POST | 401 | unauthorized |
| blocked | `/api/banking/accounts` | GET | 401 | unauthorized |
| blocked | `/api/banking/revoke` | GET | 401 | unauthorized |
| blocked | `/api/banking/sync-accounts` | POST | 401 | unauthorized |
| blocked | `/api/call-outcomes` | POST | 401 | unauthorized |
| blocked | `/api/chat/ask` | POST | 401 | unauthorized |
| blocked | `/api/chat/messages` | GET | 403 | forbidden |
| blocked | `/api/chat/peers` | GET | 401 | unauthorized |
| blocked | `/api/chat/portal-message` | POST | 403 | forbidden |
| blocked | `/api/closer-deck` | POST | 401 | unauthorized |
| blocked | `/api/company-brain/reviews` | GET | 401 | unauthorized |
| blocked | `/api/company-brain/sync` | GET | 401 | unauthorized |
| blocked | `/api/consent/capture` | GET | 403 | forbidden |
| blocked | `/api/contracts` | POST | 401 | unauthorized |
| blocked | `/api/customer-insights` | POST | 401 | unauthorized |
| blocked | `/api/dashboard/client` | — | — | UNVERIFIED — no GET/POST method to probe safely |
| blocked | `/api/dashboard/client-archive` | POST | 401 | unauthorized |
| blocked | `/api/dashboard/clients` | — | — | UNVERIFIED — no GET/POST method to probe safely |
| blocked | `/api/dashboard/kpis` | — | — | UNVERIFIED — no GET/POST method to probe safely |
| blocked | `/api/dashboard/pipeline` | — | — | UNVERIFIED — no GET/POST method to probe safely |
| blocked | `/api/dashboard/seed` | — | — | UNVERIFIED — no GET/POST method to probe safely |
| blocked | `/api/demo/mode` | GET | 401 | unauthorized |
| blocked | `/api/demo/simulate` | POST | 401 | unauthorized |
| blocked | `/api/documents-upload` | POST | 403 | forbidden |
| blocked | `/api/finance/alerts` | GET | 401 | unauthorized |
| blocked | `/api/finance/bank-accounts` | GET | 401 | unauthorized |
| blocked | `/api/finance/bills` | GET | 401 | unauthorized |
| blocked | `/api/finance/cards` | GET | 401 | unauthorized |
| blocked | `/api/finance/cashflow` | GET | 401 | unauthorized |
| blocked | `/api/finance/entities` | GET | 401 | unauthorized |
| blocked | `/api/finance/liabilities` | GET | 401 | unauthorized |
| blocked | `/api/finance/model` | POST | 401 | unauthorized |
| blocked | `/api/finance/soft-pull` | GET | 403 | forbidden |
| blocked | `/api/finance/subscriptions` | GET | 401 | unauthorized |
| blocked | `/api/hiring/application` | GET | 401 | unauthorized |
| blocked | `/api/hiring/bench` | GET | 401 | unauthorized |
| blocked | `/api/hiring/candidates` | GET | 401 | unauthorized |
| blocked | `/api/hiring/decisions` | GET | 401 | unauthorized |
| blocked | `/api/hiring/funnel` | GET | 401 | unauthorized |
| blocked | `/api/hiring/postings` | GET | 401 | unauthorized |
| blocked | `/api/inquiries` | GET | 403 | forbidden |
| blocked | `/api/inquiry` | — | — | UNVERIFIED — no GET/POST method to probe safely |
| blocked | `/api/inquiry-cases` | POST | 401 | unauthorized |
| blocked | `/api/journeys` | GET | 401 | unauthorized |
| blocked | `/api/journeys/ask` | POST | 401 | unauthorized |
| blocked | `/api/journeys/run` | POST | 401 | unauthorized |
| blocked | `/api/lender-observations` | POST | 401 | unauthorized |
| blocked | `/api/lenders` | POST | 401 | unauthorized |
| blocked | `/api/marketing-flags` | POST | 401 | unauthorized |
| blocked | `/api/message-templates` | POST | 401 | unauthorized |
| blocked | `/api/messages` | POST | 403 | forbidden |
| blocked | `/api/messages-outbound` | POST | 401 | unauthorized |
| blocked | `/api/partner-brand/verify-domain` | POST | 401 | unauthorized |
| blocked | `/api/payment-links` | GET | 401 | unauthorized |
| blocked | `/api/pii` | GET | 403 | forbidden |
| blocked | `/api/pipeline-cards` | POST | 401 | unauthorized |
| blocked | `/api/privacy/erasure` | GET | 401 | unauthorized |
| blocked | `/api/products` | POST | 401 | unauthorized |
| blocked | `/api/proxy/end` | POST | 401 | unauthorized |
| blocked | `/api/proxy/launch` | POST | 401 | unauthorized |
| blocked | `/api/read/affiliates` | GET | 403 | forbidden |
| blocked | `/api/read/agent-context` | — | — | UNVERIFIED — no GET/POST method to probe safely |
| blocked | `/api/read/agent-shadow-log` | — | — | UNVERIFIED — no GET/POST method to probe safely |
| blocked | `/api/read/agents` | GET | 401 | unauthorized |
| blocked | `/api/read/ai-bureau-config` | GET | 401 | unauthorized |
| blocked | `/api/read/banking-surface` | GET | 401 | unauthorized |
| blocked | `/api/read/call-outcomes` | GET | 401 | unauthorized |
| blocked | `/api/read/closer-call` | GET | 401 | unauthorized |
| blocked | `/api/read/closer-deck` | GET | 401 | unauthorized |
| blocked | `/api/read/commissions` | GET | 401 | unauthorized |
| blocked | `/api/read/company-activity` | GET | 401 | unauthorized |
| blocked | `/api/read/company-brain` | POST | 401 | unauthorized |
| blocked | `/api/read/company-brain-affiliate` | POST | 400 | question_required |
| blocked | `/api/read/contracts` | GET | 401 | unauthorized |
| blocked | `/api/read/conversations` | GET | 401 | unauthorized |
| blocked | `/api/read/customer-insights` | GET | 401 | unauthorized |
| blocked | `/api/read/documents` | GET | 401 | unauthorized |
| blocked | `/api/read/entitlements` | GET | 403 | forbidden |
| blocked | `/api/read/failed-events` | GET | 401 | unauthorized |
| blocked | `/api/read/finance-ask` | POST | 401 | unauthorized |
| blocked | `/api/read/finance-command` | GET | 401 | unauthorized |
| blocked | `/api/read/finance-os` | GET | 401 | unauthorized |
| blocked | `/api/read/funding-rounds` | GET | 401 | unauthorized |
| blocked | `/api/read/inbox` | GET | 401 | unauthorized |
| blocked | `/api/read/inquiries` | GET | 401 | unauthorized |
| blocked | `/api/read/inquiry-cases` | GET | 401 | unauthorized |
| blocked | `/api/read/invoices` | GET | 401 | unauthorized |
| blocked | `/api/read/lender-matches` | GET | 401 | unauthorized |
| blocked | `/api/read/lender-observations` | GET | 401 | unauthorized |
| blocked | `/api/read/lenders` | GET | 401 | unauthorized |
| blocked | `/api/read/message-templates` | GET | 401 | unauthorized |
| blocked | `/api/read/messages` | GET | 401 | unauthorized |
| blocked | `/api/read/money-map` | GET | 401 | unauthorized |
| blocked | `/api/read/my-numbers` | GET | 401 | unauthorized |
| blocked | `/api/read/portal-contracts` | GET | 403 | forbidden |
| blocked | `/api/read/portal-summary` | GET | 403 | forbidden |
| blocked | `/api/read/products` | GET | 401 | unauthorized |
| blocked | `/api/read/proxy-sessions` | GET | 401 | unauthorized |
| blocked | `/api/read/sales-floor` | GET | 401 | unauthorized |
| blocked | `/api/read/search` | GET | 401 | unauthorized |
| blocked | `/api/read/staff` | GET | 401 | unauthorized |
| blocked | `/api/read/tradelines` | — | — | UNVERIFIED — no GET/POST method to probe safely |
| blocked | `/api/read/transactions` | GET | 401 | unauthorized |
| blocked | `/api/read/underwrite` | GET | 401 | unauthorized |
| blocked | `/api/read/workflows` | GET | 401 | unauthorized |
| blocked | `/api/repair/exceptions` | GET | 403 | forbidden |
| blocked | `/api/repair/send` | POST | 401 | unauthorized |
| blocked | `/api/shifts` | GET | 403 | forbidden |
| blocked | `/api/social/oauth` | — | — | UNVERIFIED — no GET/POST method to probe safely |
| blocked | `/api/staff/monitoring-consent` | POST | 401 | unauthorized |
| blocked | `/api/staff/telemetry` | GET | 401 | unauthorized |
| blocked | `/api/tasks` | GET | 403 | forbidden |
