# role-funding-advisor — UI walk: original (2026-08-17T03:37Z) vs reverify (2026-08-17T05:49:06.859Z)

```json
{
  "origScreens": 24,
  "newScreens": 24,
  "origSidebar": {
    "visible": 25,
    "total": 34
  },
  "newSidebar": {
    "visible": 25,
    "total": 34
  },
  "origWithAny4xx": 24,
  "newWithAny4xx": 10,
  "origDemoModeScreens": 24,
  "newDemoModeScreens": 6,
  "newDemoModeScreenList": [
    "closer-dashboard.html",
    "finance-os.html",
    "client-control-panel.html",
    "documents.html",
    "ops-admin.html",
    "sample-data.html"
  ],
  "newFailingEndpointsTotal": 0,
  "removedFailingEndpointsTotal": 19,
  "orig5xx": 0,
  "new5xx": 0,
  "origBounced": 0,
  "newBounced": 0,
  "loginApiFails": {
    "orig": 1,
    "new": 0
  },
  "roleStored": {
    "orig": "funding_advisor",
    "new": "funding_advisor"
  },
  "landing": {
    "orig": "/app/command-center.html",
    "new": "/app/command-center.html"
  }
}
```

| Screen | HTTP orig/new | Orig 4xx/5xx (distinct) | Reverify 4xx/5xx (distinct) | New failing endpoints | Verdict |
|---|---|---|---|---|---|
| command-center.html | 200/200 | GET /api/demo/mode -> 403 | — | none | CHANGED-NOT-REGRESSION (fewer) |
| pipeline.html | 200/200 | GET /api/demo/mode -> 403 | — | none | CHANGED-NOT-REGRESSION (fewer) |
| closer-dashboard.html | 200/200 | GET /api/demo/mode -> 403 | GET /api/demo/mode -> 403 | none | PASS-STILL |
| calendar.html | 200/200 | GET /api/demo/mode -> 403 | — | none | CHANGED-NOT-REGRESSION (fewer) |
| lenders.html | 200/200 | GET /api/demo/mode -> 403 | — | none | CHANGED-NOT-REGRESSION (fewer) |
| finance-os.html | 200/200 | GET /api/demo/mode -> 403 | GET /api/demo/mode -> 403 | none | PASS-STILL |
| contracts.html | 200/200 | GET /api/demo/mode -> 403 | — | none | CHANGED-NOT-REGRESSION (fewer) |
| client-control-panel.html | 200/200 | GET /api/demo/mode -> 403 | GET /api/demo/mode -> 403 | none | PASS-STILL |
| messaging.html | 200/200 | GET /api/demo/mode -> 403 | — | none | CHANGED-NOT-REGRESSION (fewer) |
| documents.html | 200/200 | GET /api/demo/mode -> 403 | GET /api/demo/mode -> 403 | none | PASS-STILL |
| inquiry-remover.html | 200/200 | GET /api/demo/mode -> 403 | — | none | CHANGED-NOT-REGRESSION (fewer) |
| company-brain.html | 200/200 | GET /api/demo/mode -> 403 | — | none | CHANGED-NOT-REGRESSION (fewer) |
| galaxy.html | 200/200 | GET /api/demo/mode -> 403 | — | none | CHANGED-NOT-REGRESSION (fewer) |
| ops-admin.html | 200/200 | GET /api/read/messages -> 400<br>GET /api/read/staff -> 403<br>GET /api/read/invoices -> 403<br>GET /api/demo/mode -> 403<br>GET /api/read/failed-events -> 403 | GET /api/read/staff -> 403<br>GET /api/read/failed-events -> 403<br>GET /api/demo/mode -> 403<br>GET /api/read/invoices -> 403 | none | CHANGED-NOT-REGRESSION (fewer) |
| agent-editor.html | 200/200 | GET /api/read/staff -> 403<br>GET /api/demo/mode -> 403 | GET /api/read/staff -> 403 | none | CHANGED-NOT-REGRESSION (fewer) |
| automations.html | 200/200 | GET /api/demo/mode -> 403 | — | none | CHANGED-NOT-REGRESSION (fewer) |
| template-editor.html | 200/200 | GET /api/demo/mode -> 403 | — | none | CHANGED-NOT-REGRESSION (fewer) |
| campaign-manager.html | 200/200 | GET /api/campaigns/spend -> 400<br>GET /api/campaigns/list -> 400<br>GET /api/campaigns/action-log -> 400<br>GET /api/campaigns/connections -> 400<br>GET /api/campaigns/fatigue -> 400<br>GET /api/demo/mode -> 403 | GET /api/campaigns/spend -> 400<br>GET /api/campaigns/list -> 400<br>GET /api/campaigns/action-log -> 400<br>GET /api/campaigns/connections -> 400<br>GET /api/campaigns/fatigue -> 400 | none | CHANGED-NOT-REGRESSION (fewer) |
| social-studio.html | 200/200 | GET /api/demo/mode -> 403 | — | none | CHANGED-NOT-REGRESSION (fewer) |
| creative-factory.html | 200/200 | GET /api/demo/mode -> 403 | — | none | CHANGED-NOT-REGRESSION (fewer) |
| content-admin.html | 200/200 | GET /api/demo/mode -> 403 | — | none | CHANGED-NOT-REGRESSION (fewer) |
| staff-teams.html | 200/200 | GET /api/demo/mode -> 403<br>GET /api/read/staff -> 403 | GET /api/read/staff -> 403 | none | CHANGED-NOT-REGRESSION (fewer) |
| products-commissions.html | 200/200 | GET /api/read/commissions -> 403<br>GET /api/demo/mode -> 403 | GET /api/read/commissions -> 403 | none | CHANGED-NOT-REGRESSION (fewer) |
| sample-data.html | 200/200 | GET /api/demo/mode -> 403 | GET /api/demo/mode -> 403 | none | PASS-STILL |
