# Screen-by-screen audit — 2026-08-16

**Companion to:** [`comprehensive-fix-report-2026-08-16.md`](./comprehensive-fix-report-2026-08-16.md)  
**Live:** https://fundhub.ai  
**Method:** agent browser clicks (open page, click, look) — **not** Playwright. Playwright only covers the 26-spec live shell/API gate.

**Legend:** **real** = live API · **partial** = works with gaps · **fake** = sample furniture · **off** = needs credential/switch

---

## Who can log in on live

| Role | Result |
|------|--------|
| Chris owner | Works |
| affiliate / partner | Works |
| sales@ / client@ | Works — seeded overnight 2026-08-16 |
| closer / advisor / inquiry / setter | Works — unsuspended overnight 2026-08-16 |

---

## All 40 screens

| Screen | BETA | Status | What's missing |
|--------|------|--------|----------------|
| pipeline | no | real | Side effects need Inngest |
| closer-dashboard | no | partial | Needs `?client_id=`. Deal math stays dashes (no deal-math endpoint). Honest empty — no sample markup. |
| closer-call | no | partial | Join off until meeting URL |
| my-numbers | no | partial | Honest empty until closer activity; no invented commission formula |
| sales-floor | no | partial | sales@ now logs in; empty until activity |
| calendar | no | partial | No-show/show rate dash. Furniture names scrubbed 2026-08-16. |
| present | no | partial | SMS queued; TU off |
| soft-pull-approve | no | partial | Public page |
| client-control-panel | no | real | Oxylabs/GHL gaps |
| messaging | no | partial | Outbound providers |
| documents | no | partial | Honest empty when library is empty — no sample rows |
| contracts | no | partial | Send on call cockpit |
| client-portal | no | partial | Needs `?client_id=`. Sample timeline/dollars scrubbed; activity stays empty until live rows |
| consent-capture | no | partial | No nav link |
| payment-success | no | partial | Commas unverified |
| lenders | no | partial | Empty until import |
| inquiry-remover | no | partial | Empty queue; phone on hold |
| finance-os | yes | partial | Plaid/bank |
| subscriptions | yes | partial | Billing gaps |
| index | no | real | Login |
| command-center | yes | partial | Ad metrics |
| galaxy | yes | partial | Live activity feed; no hardcoded standing workers |
| ops-admin | yes | partial | Comp dashes |
| partner-galaxy | no | partial | Partner only; money flares use live nodes only |
| automations | no | partial | Screen says engine on (42/51 fired). Owner gate still: do not flip INNGEST. |
| staff-teams | no | partial | Overnight roles seeded; roster is live |
| products-commissions | no | partial | Products + ledger live; rate edits stay in-browser only (honest note on screen) |
| template-editor | no | partial | Drafts blocked. Preview uses Preview Name, not Marcus Webb. |
| journeys | yes | partial | Mock tracking |
| agent-editor | yes | partial | Owner agent decisions |
| company-brain | yes | off | OpenAI + Drive |
| campaign-manager | yes | off | Meta token. Dana Reyes scrubbed from sample action log 2026-08-16. |
| social-studio | yes | off | Meta + LinkedIn |
| creative-factory | yes | off | Creative keys |
| content-admin | yes | partial | Video stub |
| hiring | yes | partial | Live applications (3 open). Jordan Blake scrubbed. |
| brand-studio | yes | partial | DNS for custom domain |
| affiliate | yes | partial | No funnel builder |
| sample-data | yes | fake | Demo only |
| sidebar.fragment | — | N/A | Not a screen |

**16 BETA pages:** finance-os, subscriptions, company-brain, command-center, galaxy, ops-admin, agent-editor, journeys, campaign-manager, social-studio, creative-factory, content-admin, hiring, sample-data, brand-studio, affiliate

---

## Big switches OFF

INNGEST (47–51 workflows dormant) · TransUnion live · Twilio SMS · Real mailboxes · Bland phone remover · Prescreen mail

## Credentials blocking features

Oxylabs · GHL contacts scope · Commas webhook · Meta/LinkedIn · OpenAI/Drive · Hubstaff · Creative keys · TWILIO · INNGEST

## Affiliate gap

`/start?ref=` redirects to wrong ClickFunnels page
