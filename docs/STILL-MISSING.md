# Still missing

Updated 2026-08-02 in the `feat/finish-4-and-5` session after closing the
Campaigns / Social / Creative / Brand Studio gaps from the prior scorecard.

## Credentials needed (do not invent)

| Env / credential | Where used | How to get it |
|---|---|---|
| `META_APP_ID` | Meta token refresh / Marketing API app context (`api/campaigns/sync.mjs`) | Meta Developer app → Settings → Basic |
| `META_APP_SECRET` | Same | Same panel; store as Netlify secret |
| Meta user / system user Marketing API token | `ad_platform_connections.encrypted_access_token` for platform=`meta` | Meta Business Manager → System Users → Generate token with `ads_read`, `ads_management` |
| Meta ad account id | `ad_platform_connections.external_ad_account_id` (`act_…`) | Business Manager → Ad accounts |
| Creative provider keys (`CREATIVE_*` — see `src/creative/providers/`) | `enqueue` + runner; `run()` needs them to produce assets | Provider dashboards |
| Social channel page token | `social_channels.encrypted_access_token` | Channel OAuth / Meta page token |
| Optional `SOCIAL_PUBLISH_DRY_RUN=1` | Marks due posts posted with `dryrun:…` ids without Graph | Netlify env — tests / staging only |

Without a Meta connection row + token, **Sync Meta now** / pause / resume /
budget return a clear credential error. Routes are wired; credentials are not
fabricated.

## Closed in finish-4-and-5 (was deferred)

1. **Hosted partner funnels** — `partner_pages` publish sets `published_at`;
   live HTML at `/sites/:partner_id/:slug` via `netlify/functions/partner-site.mjs`.
   Custom domain: TXT verify at `_fundhub.<domain>` =
   `fundhub-site-verify=<partner_id>` via `POST /api/partner-brand/verify-domain`.
   Adding the hostname in the Netlify UI (SSL) is still an operator DNS step on
   a real domain you own — the app cannot invent that certificate.

2. **Social `publishDue` cron** — `netlify/functions/social-publish-sweeper.mjs`
   every 5 minutes + `POST /api/social/publish`. Adapters in
   `src/social/adapters.mjs`.

3. **Creative job runner + approve/reject/archive** —
   `netlify/functions/creative-job-runner.mjs` every 2 minutes,
   `POST /api/creative/run`, `POST /api/creative/actions`. Creative Factory UI
   wired.

4. **Campaign write loop** — successful Meta pause/resume/budget updates the
   local `campaigns` row; Campaign Manager drawer has the controls.

## Lender + inquiry ops data (owner / funding advisor action)

Updated 2026-08-04. Schema lives in temporary migrations `t138_lenders.sql`,
`t139_funding_ops.sql`, `t140_inquiry_ops.sql` — **renumber at merge** if peers
landed 138+.

**Tables ship empty on purpose.** Do not invent lender names, bureau phone
numbers, IVR paths, or approval criteria in code or seed.

### Export from Airtable and import

| Airtable source | Platform table / screen | How to load |
|---|---|---|
| ONLINEBIZCC, INBRANCHBIZCC, BIZLOC_STATED, BIZLOC_DOCUMENTED, PERSONALCC, PERSONALLOANS, PERSONALLOC | `lenders` via Lenders screen CSV | Map primary name → `name`, table name → `lender_table` (APPLICATIONS single-select spelling: OnlineBizCC, …). |
| AI_BUREAU_CONFIG (EX/EQ/TU) | `ai_bureau_config` via Lenders → AI bureau config tab | Type real service numbers / menu paths — never invent. |
| INQUIRY_REMOVAL_CASES (open cases) | `inquiry_removal_cases` | No CSV yet — recreate active cases in CRM or a follow-up import. |
| INQUIRY_PREP | `inquiry_prep` | Staging; promote when `Ready for Cleanup`. |
| LENDER_BUREAU_OBSERVATIONS | `lender_bureau_observations` | Filled by live application observations; optional historical import later. |
| BUSINESS_TRADELINES | `business_tradelines` | Filled from CRS extract; no seed. |

Until lender CSV import runs, closer-dashboard lender match count and Card
Stacking round-planning fits correctly show **0**.

### Wiring notes

- `round.funded` (money-chain `onRoundFundedMoney`) creates `funding_closeout` +
  items from Approved applications (10% success fee).
- Application status changes write `application_decisions` (no silent updates).
- Case close / inquiry confirm emit `inquiry.removed` for workflow C-03.

## Still deferred / out of scope

1. **Full create-campaign / create-ad-set UI** — use Meta (or a later form) then
   Sync. Pause / resume / budget writes are live.

2. **Chat widget: agent-sent messages** — data model ready; application send
   path stays off (spec §8).

3. **Chat widget for affiliates / white-label** — owner call C-3: internal staff
   + client portal only.

4. **Platform how-to corpus expansion** — v1 FAQ in `src/chat/platform-help.mjs`.

5. **Closer sales assets / call recording / recruiting pipeline** — backlog.

6. **Message dispatcher sweeper registration** — deliberately unregistered
   (CLAUDE.md §12). Staff compose dispatches immediately.

7. **Social OAuth connect flow** — channels still need an INSERT + token; no
   OAuth screen yet.

8. **Instagram / TikTok live media publish** — facebook Graph caption path is
   live when tokenized; other channels need provider wiring or
   `SOCIAL_PUBLISH_DRY_RUN=1`.

9. **Commission-rule writes** — `products-commissions.html` saves rate changes
   locally only; there is no `POST /api/commission-rules`. A 168-line draft was
   written on the old `fix/controls-dead-stub` branch and never landed. That
   branch is gone; the draft is kept at
   `~/fundhub-branch-backup/unlanded-drafts/commission-rules.mjs` and needs a
   rebase onto current `api/products.mjs` conventions before use.

## Built earlier (session-six) and kept

- CRM + portal chat widget
- Finance OS simulated client loader + teardown
- Global search overlap fix
- Brand Studio → `partner_pages` drafts (now also publishable/live)
