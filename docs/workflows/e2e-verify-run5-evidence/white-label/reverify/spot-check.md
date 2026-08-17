# white-label — reverify spot-check (fix side effects)

Ran 2026-08-17T05:51:44.687Z against https://fundhub.ai as `partner@fundhub.ai`. One browser login. Read-only (GET + empty-body POST only).

| Item | Result |
|---|---|
| Sign in | left login.html → /app/partner-galaxy.html; api calls during login: GET /api/auth/login → 200, POST /api/auth/login → 200, GET /api/read/partners?limit=200 → 200, GET /api/auth/session → 200, GET /api/health → 200, GET /api/auth/session → 200, GET /api/org-brand → 200; console errors 0 |
| /api/demo/mode called during login/landing | no |
| localStorage fh_role | partner |
| localStorage fh_token present | true |
| localStorage fh_account | {"keys":["accountId","affiliateId","clientId","email","kind","name","orgId","partnerId"],"kind":"partner","partnerId_present":true,"clientId_present":false,"affiliateId_present":false,"accountId_present":true,"orgId_present":true} |
| localStorage keys | fh_account, fh_role, fh_token |

## Screens (every /api/ call, not just failures)

| Screen | HTTP | Final URL | demo/mode called | API calls | 4xx/5xx | Console errors | Shot |
|---|---|---|---|---|---|---|---|
| partner-galaxy | 200 | /app/partner-galaxy.html | no | GET /api/auth/session → 200<br>GET /api/read/partners?limit=200 → 200<br>GET /api/health → 200<br>GET /api/org-brand → 200<br>GET /api/auth/session → 200 | 0 | — | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/sc-partner-galaxy.png |
| brand-studio | 200 | /app/brand-studio.html | no | GET /api/auth/session → 200<br>GET /api/partner-brand?partner_id=<uuid> → 200<br>GET /api/partner-pages?partner_id=<uuid> → 200<br>GET /api/health → 200<br>GET /api/org-brand → 200 | 0 | — | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/sc-brand-studio.png |
| ops-admin-direct | 200 | /app/partner-galaxy.html | no | GET /api/auth/session → 200<br>GET /api/read/partners?limit=200 → 200<br>GET /api/health → 200<br>GET /api/auth/session → 200<br>GET /api/org-brand → 200 | 0 | — | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/sc-ops-admin-direct.png |

Brand Studio partner-mode marker ("partner brand" text present): true · brand name field: empty

## Token-bearing API calls (partner token)

| Method | Route | Status | Error | Body keys |
|---|---|---|---|---|
| GET | `/api/read/messages?status=blocked&limit=30` | 401 | unauthorized | ok, error |
| GET | `/api/read/messages` | 401 | unauthorized | ok, error |
| GET | `/api/demo/mode` | 401 | unauthorized | ok, error |
| POST | `/api/read/company-brain-affiliate` | 400 | question_required | ok, error |
| GET | `/api/auth/session` | 200 | — | ok, principal, staff |
