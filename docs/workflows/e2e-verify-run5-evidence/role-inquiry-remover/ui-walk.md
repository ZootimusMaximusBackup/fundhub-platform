# role-inquiry-remover — live UI walk

Ran 2026-08-17T03:37:44.194Z against https://fundhub.ai as `inquiry@fundhub.ai`.

| Step | Result | Evidence |
|---|---|---|
| Login page | shown | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/00-login-page.png |
| Sign in | left login.html · role stored=inquiry_specialist · api fails=1 | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/01-landing.png |
| Landed at | /app/inquiry-remover.html (Fundhub — Inquiry Remover) | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/01-landing.png |
| App shell | /app/inquiry-remover.html | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/02-app-shell.png |
| Sidebar | 25 visible / 34 total links | ui-walk.json |

## Sidebar links

| Label | Href | Visible |
|---|---|---|
|  | `command-center.html` | yes |
| ▤Pipeline | `pipeline.html` | yes |
| ★Closer Dashboard | `closer-dashboard.html` | yes |
| ☎Call cockpit | `closer-call.html` | no |
| ＃My numbers | `my-numbers.html` | no |
| ▣Sales floor | `sales-floor.html` | no |
| ▦Calendar | `calendar.html` | yes |
| ⬡Lenders | `lenders.html` | yes |
| ▩Finance OSBETA | `finance-os.html` | yes |
| ✒Contracts | `contracts.html` | yes |
| ◍SubscriptionsBETA | `subscriptions.html` | no |
| ◎Client Control Panel | `client-control-panel.html` | yes |
| ✉Messaging | `messaging.html` | yes |
| ▧Documents | `documents.html` | yes |
| ⊘Inquiry Remover | `inquiry-remover.html` | yes |
| ◎Company BrainBETA | `company-brain.html` | yes |
| ⌘Command CenterBETA | `command-center.html` | yes |
| ✷GalaxyBETA | `galaxy.html` | yes |
| ⚙Ops & AdminBETA | `ops-admin.html` | yes |
| ◈Agent EditorBETA | `agent-editor.html` | yes |
| ⇄Workflows | `automations.html` | yes |
| ⇝JourneysBETA | `journeys.html` | no |
| ✎Message Copy | `template-editor.html` | yes |
| ◇CampaignsBETA | `campaign-manager.html` | yes |
| ◉Social StudioBETA | `social-studio.html` | yes |
| ✳Creative FactoryBETA | `creative-factory.html` | yes |
| ▶ContentBETA | `content-admin.html` | yes |
| ⚇Staff & Teams | `staff-teams.html` | yes |
| ⊕HiringBETA | `hiring.html` | no |
| ⛁Products & Commissions | `products-commissions.html` | yes |
| ⌗Demo ModeBETA | `sample-data.html` | yes |
| ◆Brand StudioBETA | `brand-studio.html` | no |
| ◐Client Portal | `client-portal.html` | no |
| ⇗AffiliateBETA | `affiliate.html` | no |

## Screens opened

| Screen | HTTP | Final URL | Bounced | API 4xx/5xx | Console errors | Shot |
|---|---|---|---|---|---|---|
|  (`command-center.html`) | 200 | /app/command-center.html | no | GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/03-command-center.html.png |
| ▤Pipeline (`pipeline.html`) | 200 | /app/pipeline.html | no | GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/04-pipeline.html.png |
| ★Closer Dashboard (`closer-dashboard.html`) | 200 | /app/closer-dashboard.html | no | GET /api/demo/mode → 403<br>GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/05-closer-dashboard.html.png |
| ▦Calendar (`calendar.html`) | 200 | /app/calendar.html | no | GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/06-calendar.html.png |
| ⬡Lenders (`lenders.html`) | 200 | /app/lenders.html | no | GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/07-lenders.html.png |
| ▩Finance OSBETA (`finance-os.html`) | 200 | /app/finance-os.html | no | GET /api/demo/mode → 403<br>GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/08-finance-os.html.png |
| ✒Contracts (`contracts.html`) | 200 | /app/contracts.html | no | GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/09-contracts.html.png |
| ◎Client Control Panel (`client-control-panel.html`) | 200 | /app/client-control-panel.html | no | GET /api/demo/mode → 403<br>GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/10-client-control-panel.html.png |
| ✉Messaging (`messaging.html`) | 200 | /app/messaging.html | no | GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/11-messaging.html.png |
| ▧Documents (`documents.html`) | 200 | /app/documents.html | no | GET /api/demo/mode → 403<br>GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/12-documents.html.png |
| ⊘Inquiry Remover (`inquiry-remover.html`) | 200 | /app/inquiry-remover.html | no | GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/13-inquiry-remover.html.png |
| ◎Company BrainBETA (`company-brain.html`) | 200 | /app/company-brain.html | no | GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/14-company-brain.html.png |
| ✷GalaxyBETA (`galaxy.html`) | 200 | /app/galaxy.html | no | GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/15-galaxy.html.png |
| ⚙Ops & AdminBETA (`ops-admin.html`) | 200 | /app/ops-admin.html | no | GET /api/read/failed-events?status=pending&limit=200 → 403<br>GET /api/read/invoices?status=open&limit=50 → 403<br>GET /api/read/staff?limit=200 → 403<br>GET /api/demo/mode → 403<br>GET /api/demo/mode → 403<br>GET /api/read/messages?status=blocked&limit=30 → 400 | Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 400 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/16-ops-admin.html.png |
| ◈Agent EditorBETA (`agent-editor.html`) | 200 | /app/agent-editor.html | no | GET /api/read/staff?limit=200 → 403<br>GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/17-agent-editor.html.png |
| ⇄Workflows (`automations.html`) | 200 | /app/automations.html | no | GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/18-automations.html.png |
| ✎Message Copy (`template-editor.html`) | 200 | /app/template-editor.html | no | GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/19-template-editor.html.png |
| ◇CampaignsBETA (`campaign-manager.html`) | 200 | /app/campaign-manager.html | no | GET /api/campaigns/fatigue?state=all&days=7 → 400<br>GET /api/campaigns/list?state=all&limit=200 → 400<br>GET /api/campaigns/connections?state=all → 400<br>GET /api/campaigns/action-log?state=all&limit=200 → 400<br>GET /api/campaigns/spend?state=all → 400<br>GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 400 ()<br>Failed to load resource: the server responded with a status of 400 ()<br>Failed to load resource: the server responded with a status of 400 ()<br>Failed to load resource: the server responded with a status of 400 ()<br>Failed to load resource: the server responded with a status of 400 ()<br>Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/20-campaign-manager.html.png |
| ◉Social StudioBETA (`social-studio.html`) | 200 | /app/social-studio.html | no | GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/21-social-studio.html.png |
| ✳Creative FactoryBETA (`creative-factory.html`) | 200 | /app/creative-factory.html | no | GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/22-creative-factory.html.png |
| ▶ContentBETA (`content-admin.html`) | 200 | /app/content-admin.html | no | GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/23-content-admin.html.png |
| ⚇Staff & Teams (`staff-teams.html`) | 200 | /app/staff-teams.html | no | GET /api/demo/mode → 403<br>GET /api/read/staff?limit=200 → 403 | Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/24-staff-teams.html.png |
| ⛁Products & Commissions (`products-commissions.html`) | 200 | /app/products-commissions.html | no | GET /api/read/commissions?limit=200 → 403<br>GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/25-products-commissions.html.png |
| ⌗Demo ModeBETA (`sample-data.html`) | 200 | /app/sample-data.html | no | GET /api/demo/mode → 403<br>GET /api/demo/mode → 403 | Failed to load resource: the server responded with a status of 403 ()<br>Failed to load resource: the server responded with a status of 403 () | docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/shots/26-sample-data.html.png |
