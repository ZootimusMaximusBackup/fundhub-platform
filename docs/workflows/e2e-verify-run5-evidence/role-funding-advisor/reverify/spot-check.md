# role-funding-advisor — reverify spot-check

Ran 2026-08-17T05:51:47.802Z against https://fundhub.ai as `advisor@fundhub.ai`.

| Screen | API calls | /api/demo/mode calls | API 4xx/5xx | Console errors |
|---|---|---|---|---|
| login+landing | 12 | none | none | 0 |
| ops-admin.html | 9 | GET /api/demo/mode -> 403 | GET /api/read/staff?limit=200 -> 403<br>GET /api/demo/mode -> 403<br>GET /api/read/failed-events?status=pending&limit=200 -> 403<br>GET /api/read/invoices?status=open&limit=50 -> 403 | 4 |
| sample-data.html | 4 | GET /api/demo/mode -> 403 | GET /api/demo/mode -> 403 | 1 |
| closer-dashboard.html | 5 | GET /api/demo/mode -> 403 | GET /api/demo/mode -> 403 | 1 |
| pipeline.html | 11 | none | none | 0 |

## login localStorage (presence only)

```json
{
  "fhKeys": [
    "fh_role",
    "fh_token"
  ],
  "fh_role": "funding_advisor",
  "fh_token_present": true,
  "fh_account_present": false,
  "fh_account_shape": null
}
```

## ops-admin GET /api/read/messages?status=blocked

```json
{
  "messagesBlocked": [
    {
      "method": "GET",
      "url": "/api/read/messages?status=blocked&limit=30",
      "status": 200,
      "bodyShape": {
        "ok": true,
        "keys": [
          "ok",
          "count",
          "limit",
          "offset",
          "hasMore",
          "items"
        ],
        "itemsLen": 0,
        "error": null
      }
    }
  ],
  "complianceTableText": "CLIENT CHANNEL REASON WHEN No messages stopped by the compliance gate",
  "bodyHasLoadingBlocked": false,
  "footerStripText": "sample staff tables — not signed in for real data · sample ops health — not signed in for real data · live compliance gate · 0 blocked · sample AR table — not signed in for real data TEST — Funding Advisor Role ",
  "bannerTexts": [
    "Beta — under development. Data may be incomplete or inaccurate. Do not use for client decisions.Dismiss",
    "sample staff tables — not signed in for real data · sample ops health — not signed in for real data · live compliance ga"
  ]
}
```

Shots: docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/reverify/shots/spot-01-landing.png, spot-02-ops-admin.png, spot-03-sample-data.png, spot-04-pipeline.png
