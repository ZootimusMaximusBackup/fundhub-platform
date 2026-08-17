# role-sales-manager — reverify spot-check (2b1eed0 side effects)

Ran 2026-08-17T05:52:01.678Z against https://fundhub.ai as `sales@fundhub.ai`.

| Check | Result |
|---|---|
| Sign in | left login.html; demo/mode calls during login: 0; api 4xx/5xx during login: none |
| localStorage keys | fh_role, fh_token |
| fh_role | sales_manager |
| fh_token | present=true |
| fh_account | present=false; shape=null |
| Landing | /app/sales-floor.html (Sales floor · Fundhub); header chip: ["TEST — Sales Manager Role","TEST — Sales Manager Role"]; demo banner nodes: 0 |

## Per screen

| Screen | HTTP | Final URL | /api/demo/mode calls | API 4xx/5xx | Console errors | Notes |
|---|---|---|---|---|---|---|
| sales-floor.html | 200 | /app/sales-floor.html | none | — | 0 | — |
| command-center.html | 200 | /app/command-center.html | none | — | 0 | — |
| pipeline.html | 200 | /app/pipeline.html | none | — | 0 | — |
| staff-teams.html | 200 | /app/staff-teams.html | none | — | 0 | — |
| hiring.html | 200 | /app/sales-floor.html | none | — | 0 | — |
| ops-admin.html | 200 | /app/ops-admin.html | GET → 403 | GET /api/read/failed-events?status=pending&limit=200 → 403<br>GET /api/demo/mode → 403 | 2 | messages?status=blocked: 200; failed-events: 403; compliance panel: "CLIENT CHANNEL REASON WHEN No messages stopped by the compliance gate"; "Loading blocked messages" on page: false; "request was rejected" on page: false |
| sample-data.html | 200 | /app/sample-data.html | GET → 403 | GET /api/demo/mode → 403 | 1 | "limited to owner, admin" on page: true |
| closer-dashboard.html | 200 | /app/closer-dashboard.html | GET → 403 | GET /api/demo/mode → 403 | 1 | — |
| finance-os.html | 200 | /app/finance-os.html | GET → 403 | GET /api/demo/mode → 403 | 1 | — |
| client-control-panel.html | 200 | /app/client-control-panel.html | GET → 403 | GET /api/demo/mode → 403 | 1 | — |
| documents.html | 200 | /app/documents.html | GET → 403 | GET /api/demo/mode → 403 | 1 | — |
| messaging.html | 200 | /app/messaging.html | none | — | 0 | — |
| products-commissions.html | 200 | /app/products-commissions.html | none | — | 0 | — |
