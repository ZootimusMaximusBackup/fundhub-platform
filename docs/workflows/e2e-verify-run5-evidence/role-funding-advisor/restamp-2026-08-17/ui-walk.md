# role-funding-advisor — restamp UI walk 2026-08-17

Ran 2026-08-17T20:31:08.928Z against https://fundhub.ai as `advisor@fundhub.ai`.

| Login | left login.html · role=funding_advisor · api fails=0 |
| Landed | /app/command-center.html |
| Sidebar | 4 visible / 34 total |

## Sidebar

| Label | Href | Visible |
|---|---|---|
|  | `command-center.html` | yes |
| ▤Pipeline | `pipeline.html` | no |
| ★Closer Dashboard | `closer-dashboard.html` | no |
| ☎Call cockpit | `closer-call.html` | no |
| ＃My numbers | `my-numbers.html` | no |
| ▣Sales floor | `sales-floor.html` | no |
| ▦Calendar | `calendar.html` | no |
| ⬡Lenders | `lenders.html` | no |
| ▩Finance OSBETA | `finance-os.html` | no |
| ✒Contracts | `contracts.html` | no |
| ◍SubscriptionsBETA | `subscriptions.html` | no |
| ◎Client Control Panel | `client-control-panel.html` | no |
| ✉Messaging | `messaging.html` | no |
| ▧Documents | `documents.html` | no |
| ⊘Inquiry Remover | `inquiry-remover.html` | no |
| ◎Company BrainBETA | `company-brain.html` | no |
| ⌘Command CenterBETA | `command-center.html` | yes |
| ✷GalaxyBETA | `galaxy.html` | yes |
| ⚙Ops & AdminBETA | `ops-admin.html` | yes |
| ◈Agent EditorBETA | `agent-editor.html` | no |
| ⇄Automations | `automations.html` | no |
| ⇝JourneysBETA | `journeys.html` | no |
| ✎Message Copy | `template-editor.html` | no |
| ◇CampaignsBETA | `campaign-manager.html` | no |
| ◉Social StudioBETA | `social-studio.html` | no |
| ✳Creative FactoryBETA | `creative-factory.html` | no |
| ▶ContentBETA | `content-admin.html` | no |
| ⚇Staff & Teams | `staff-teams.html` | no |
| ⊕HiringBETA | `hiring.html` | no |
| ⛁Products & Commissions | `products-commissions.html` | no |
| ⌗Demo ModeBETA | `sample-data.html` | no |
| ◆Brand StudioBETA | `brand-studio.html` | no |
| ◐Client Portal | `client-portal.html` | no |
| ⇗AffiliateBETA | `affiliate.html` | no |

## Screens opened (visible rail)

| Screen | HTTP | Final | Bounced | API 4xx/5xx | Console |
|---|---|---|---|---|---|
|  (`command-center.html`) | 200 | /app/command-center.html | no | — | — |
| ✷GalaxyBETA (`galaxy.html`) | 200 | /app/galaxy.html | no | — | — |
| ⚙Ops & AdminBETA (`ops-admin.html`) | 200 | /app/ops-admin.html | no | GET /api/read/failed-events?status=pending&limit=200 → 403<br>GET /api/read/invoices?status=open&limit=50 → 403<br>GET /api/read/staff?limit=200 → 403 | Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 403 () |

## Direct URL of previously-open screens

| Href | Final | Bounced | API 4xx/5xx | Console |
|---|---|---|---|---|
| `/app/ops-admin.html` | /app/ops-admin.html | no | GET /api/read/failed-events?status=pending&limit=200 → 403<br>GET /api/read/invoices?status=open&limit=50 → 403<br>GET /api/read/staff?limit=200 → 403 | Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 403 () |
| `/app/staff-teams.html` | /app/staff-teams.html | no | GET /api/read/staff?limit=200 → 403 | Failed to load resource: the server responded with a status of 403 () |
| `/app/agent-editor.html` | /app/agent-editor.html | no | GET /api/read/staff?limit=200 → 403 | Failed to load resource: the server responded with a status of 403 () |
| `/app/products-commissions.html` | /app/products-commissions.html | no | GET /api/read/commissions?limit=200 → 403 | Failed to load resource: the server responded with a status of 403 () |
| `/app/campaign-manager.html` | /app/command-center.html | YES | — | — |
| `/app/sample-data.html` | /app/command-center.html | YES | — | — |
| `/app/hiring.html` | /app/command-center.html | YES | — | — |
| `/app/inquiry-remover.html` | /app/inquiry-remover.html | no | — | — |
| `/dashboard.html` | /dashboard.html | no | — | Failed to load resource: the server responded with a status of 404 () |
