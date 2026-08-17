# role-closer — live UI walk

Ran 2026-08-17T15:45:47.214Z against https://fundhub.ai as `closer@fundhub.ai`.

| Step | Result | Evidence |
|---|---|---|
| Login page | shown | docs/workflows/e2e-verify-run5-evidence/role-closer/fixed-callers/live/shots/00-login-page.png |
| Sign in | left login.html · role stored=closer · api fails=0 | docs/workflows/e2e-verify-run5-evidence/role-closer/fixed-callers/live/shots/01-landing.png |
| Landed at | /dashboard.html (FundHub — Closer Dashboard) | docs/workflows/e2e-verify-run5-evidence/role-closer/fixed-callers/live/shots/01-landing.png |
| App shell | /app/pipeline.html | docs/workflows/e2e-verify-run5-evidence/role-closer/fixed-callers/live/shots/02-app-shell.png |
| Sidebar | 6 visible / 34 total links | ui-walk.json |

## Sidebar links

| Label | Href | Visible |
|---|---|---|
|  | `command-center.html` | yes |
| ▤Pipeline | `pipeline.html` | yes |
| ★Closer Dashboard | `closer-dashboard.html` | yes |
| ☎Call cockpit | `closer-call.html` | yes |
| ＃My numbers | `my-numbers.html` | yes |
| ▣Sales floor | `sales-floor.html` | no |
| ▦Calendar | `calendar.html` | yes |
| ⬡Lenders | `lenders.html` | no |
| ▩Finance OSBETA | `finance-os.html` | no |
| ✒Contracts | `contracts.html` | no |
| ◍SubscriptionsBETA | `subscriptions.html` | no |
| ◎Client Control Panel | `client-control-panel.html` | no |
| ✉Messaging | `messaging.html` | no |
| ▧Documents | `documents.html` | no |
| ⊘Inquiry Remover | `inquiry-remover.html` | no |
| ◎Company BrainBETA | `company-brain.html` | no |
| ⌘Command CenterBETA | `command-center.html` | no |
| ✷GalaxyBETA | `galaxy.html` | no |
| ⚙Ops & AdminBETA | `ops-admin.html` | no |
| ◈Agent EditorBETA | `agent-editor.html` | no |
| ⇄Workflows | `automations.html` | no |
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

## Screens opened

| Screen | HTTP | Final URL | Bounced | API 4xx/5xx | Console errors | Shot |
|---|---|---|---|---|---|---|
|  (`command-center.html`) | 200 | /app/command-center.html | no | — | — | docs/workflows/e2e-verify-run5-evidence/role-closer/fixed-callers/live/shots/03-command-center.html.png |
| ▤Pipeline (`pipeline.html`) | 200 | /app/pipeline.html | no | — | — | docs/workflows/e2e-verify-run5-evidence/role-closer/fixed-callers/live/shots/04-pipeline.html.png |
| ★Closer Dashboard (`closer-dashboard.html`) | 200 | /app/closer-dashboard.html | no | — | — | docs/workflows/e2e-verify-run5-evidence/role-closer/fixed-callers/live/shots/05-closer-dashboard.html.png |
| ☎Call cockpit (`closer-call.html`) | 200 | /app/closer-call.html | no | — | — | docs/workflows/e2e-verify-run5-evidence/role-closer/fixed-callers/live/shots/06-closer-call.html.png |
| ＃My numbers (`my-numbers.html`) | 200 | /app/my-numbers.html | no | — | — | docs/workflows/e2e-verify-run5-evidence/role-closer/fixed-callers/live/shots/07-my-numbers.html.png |
| ▦Calendar (`calendar.html`) | 200 | /app/calendar.html | no | — | — | docs/workflows/e2e-verify-run5-evidence/role-closer/fixed-callers/live/shots/08-calendar.html.png |
