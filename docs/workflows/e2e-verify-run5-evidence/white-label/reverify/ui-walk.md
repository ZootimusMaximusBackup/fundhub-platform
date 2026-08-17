# white-label — live UI walk

Ran 2026-08-17T05:49:47.230Z against https://fundhub.ai as `partner@fundhub.ai`.

| Step | Result | Evidence |
|---|---|---|
| Login page | shown | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/00-login-page.png |
| Sign in | left login.html · role stored=partner · api fails=0 | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/01-landing.png |
| Landed at | /app/partner-galaxy.html (Your Galaxy — Partner View) | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/01-landing.png |
| App shell | /app/partner-galaxy.html | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/02-app-shell.png |
| Sidebar | 2 visible / 34 total links | ui-walk.json |

## Sidebar links

| Label | Href | Visible |
|---|---|---|
|  | `/app/partner-galaxy.html` | yes |
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
| ◆Brand StudioBETA | `brand-studio.html` | yes |
| ◐Client Portal | `client-portal.html` | no |
| ⇗AffiliateBETA | `affiliate.html` | no |

## Screens opened

| Screen | HTTP | Final URL | Bounced | API 4xx/5xx | Console errors | Shot |
|---|---|---|---|---|---|---|
|  (`/app/partner-galaxy.html`) | 200 | /app/partner-galaxy.html | no | — | — | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/03-_app_partner-galaxy.html.png |
| ◆Brand StudioBETA (`brand-studio.html`) | 200 | /app/brand-studio.html | no | — | — | docs/workflows/e2e-verify-run5-evidence/white-label/reverify/shots/04-brand-studio.html.png |
