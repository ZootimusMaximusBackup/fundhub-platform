# Still missing

Updated 2026-08-04 in the `feat/finish-4-and-5` session after closing the
Campaigns / Social / Creative / Brand Studio gaps from the prior scorecard.

## Credentials needed (do not invent)

| Env / credential | Where used | How to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Agent runtime model calls (`src/agents/model.mjs`) | Anthropic Console → API keys. Leave unset for shadow mode (logs would-be replies, sends nothing). |
| `OXYLABS_USERNAME` | Residential Apply proxy (`src/adapters/oxylabs.mjs`, `POST /api/proxy/launch`) | Oxylabs dashboard → proxy user (no `customer-` prefix; adapter adds it) |
| `OXYLABS_PASSWORD` | Same | Same panel; store as Netlify secret |
| `META_APP_ID` | Meta token refresh / Marketing API app context (`api/campaigns/sync.mjs`) | Meta Developer app → Settings → Basic |
| `META_APP_SECRET` | Same | Same panel; store as Netlify secret |
| Meta user / system user Marketing API token | `ad_platform_connections.encrypted_access_token` for platform=`meta` | Meta Business Manager → System Users → Generate token with `ads_read`, `ads_management` |
| Meta ad account id | `ad_platform_connections.external_ad_account_id` (`act_…`) | Business Manager → Ad accounts |
| Creative provider keys (`CREATIVE_*` — see `src/creative/providers/`) | `enqueue` + runner; `run()` needs them to produce assets | Provider dashboards |
| Social channel page token | `social_channels.encrypted_access_token` | Channel OAuth / Meta page token |
| Optional `SOCIAL_PUBLISH_DRY_RUN=1` | Marks due posts posted with `dryrun:…` ids without Graph | Netlify env — tests / staging only |
| `HUBSTAFF_TOKEN` | Hubstaff org access token (or ready bearer) for deep-monitoring poll (`src/adapters/hubstaff.mjs`, `hubstaff-poll-sweeper`) | Hubstaff → Settings → Organization → API tokens. Store as Netlify secret. **Leave unset until cutover.** |
| `HUBSTAFF_ORG_ID` | Hubstaff organization id for `/v2/organizations/{id}/activities` | Same Hubstaff org settings |
| Optional `HUBSTAFF_API_BASE` | Override API host (default `https://api.hubstaff.com`) | Only if Hubstaff documents a different base |

Without Hubstaff credentials the poll sweeper no-ops (`not_configured`). Consent
gate, routes, and Staff & Teams telemetry UI are wired; credentials are not
fabricated.

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

Updated 2026-08-04. Schema lives in migrations `138_lenders.sql`, `139_funding_ops.sql`, `140_inquiry_ops.sql`.

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

## Oxylabs Apply door (platform wired; credentials unset)

Updated 2026-08-04. Adapter + `proxy_sessions` (`141_proxy_sessions.sql`) + `POST /api/proxy/launch` / `POST /api/proxy/end` / `GET /api/read/proxy-sessions` + Chrome extension under `extension/` + Apply controls on client-scoped Lenders, pipeline Card Stacking matches, and client control panel funding section.

**Left unset on purpose:** `OXYLABS_USERNAME` / `OXYLABS_PASSWORD`. Set both as Netlify secrets, then `netlify deploy --build --prod`. Until they are set, launch returns a clear 503 — it does not invent credentials or silently skip geo checks.

## Agent runtime (built 2026-08-04; key unset)

The platform agent runtime is wired (`src/agents/runtime.mjs` on
`message.inbound`). With `ANTHROPIC_API_KEY` unset it runs in **shadow mode**:
builds context, would call the model, logs the would-be reply to
`agent_shadow_log` (AE-08), sends nothing, fails nothing. Set the key as a
Netlify secret and deploy when you want live replies. Promote GHL agents from
`draft` → `shadow` → `live` in the agent editor; assign
`conversations.agent_code` (or leave a single channel-matching agent) so
selection is unambiguous. `runtime='bland'` agents stay on the external Bland
path and are skipped here. Migration: `144_agent_runtime.sql`.

## Deliberately unset (owner — do not set in this merge)

These stay off until a separate cutover. Routes fail clean / no-op without them.
**This merge sets none of these.** Credentials stay unset by design.

| Env | Why it stays unset |
|---|---|
| `INNGEST_EVENT_KEY` | Turns on the live workflow engine (47 functions). Owner gate. |
| `ANTHROPIC_API_KEY` | Agent runtime model calls — shadow mode without it. |
| `OPENAI_API_KEY` | Company Brain / creative — stays off with Drive. |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` | Company Brain Drive sync. |
| `GOOGLE_DRIVE_DELEGATE_EMAIL` | Same. |
| `META_APP_ID` / `META_APP_SECRET` / Meta tokens | Campaign sync + social OAuth — wired, credentials not fabricated. |
| `HUBSTAFF_TOKEN` / `HUBSTAFF_ORG_ID` | Deep monitoring poll — consent gate is live; ingest stays dark. |
| `OXYLABS_USERNAME` / `OXYLABS_PASSWORD` | Residential Apply door — launch returns 503 until set. |
| `TWILIO_*` | SMS provider — A2P / routing still gated. |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` / `LINKEDIN_ORG_ID` | Social Studio LinkedIn connect + org publish. |
| `GHL_API_KEY` / `GHL_RELAY_API_KEY` | GHL contact create/lookup + backfill script. |
| `INQUIRY_REMOVAL_WEBHOOK_SECRET` | IRA → platform webhook — configure with the IRA runtime at cutover. |
| `CF_CAPTURE_MODE` | Optional ClickFunnels raw webhook capture into `webhook_captures`. |


## Still deferred / out of scope

1. **Full create-campaign / create-ad-set UI** — use Meta (or a later form) then
   Sync. Pause / resume / budget writes are live.

2. **Chat widget: agent-sent messages** — data model ready; application send
   path stays off for the *widget* UI (spec §8). The messaging agent runtime
   above does send via `composeAgentReply` when an agent is live and the key
   is set.

3. **Chat widget for affiliates / white-label** — owner call C-3: internal staff
   + client portal only.

4. **Platform how-to corpus expansion** — v1 FAQ in `src/chat/platform-help.mjs`.

5. **Closer sales assets / call recording / recruiting pipeline** — backlog.

6. **Message dispatcher sweeper registration** — deliberately unregistered
   (CLAUDE.md §12). Staff compose dispatches immediately.

7. **Social OAuth connect flow** — wired at `/api/social/oauth` + Social Studio
   Connect buttons. Still needs app credentials (below).

8. **Instagram / TikTok live media publish** — facebook Graph caption path is
   live when tokenized; LinkedIn org UGC adapter is wired; Instagram still needs
   a media container. Use `SOCIAL_PUBLISH_DRY_RUN=1` to exercise the cron.

### Booking calendar cutover (ClickFunnels Appointments vs Cal.com)

Funnels currently use ClickFunnels' native Appointments app, not Cal.com. The
platform Cal.com adapter now emits `booking.created` / `booking.rescheduled` /
`booking.cancelled` / `booking.noshow`. At cutover pick one:

- **Option A — CF Appointments adapter** (~2–3 days): new adapter normalizing CF
  appointment webhooks → `booking.*` events. `CF_CAPTURE_MODE=1` already logs
  raw payloads into `webhook_captures` so one real test lead can correct field
  paths afterward.
- **Option B — Swap embeds to Cal.com** (~1 day engineering + funnel rebuild):
  point booking buttons at Cal.com; existing adapter + handlers already cover
  the lifecycle including S-05a no-show recovery.

### LinkedIn app setup (required for social connect)

- Create a LinkedIn Developer app; enable Community Management / Share on LinkedIn.
- Auth redirect URL: `{APP_BASE_URL}/api/social/oauth?action=callback&channel=linkedin`
- Set `LINKEDIN_CLIENT_ID` + `LINKEDIN_CLIENT_SECRET` as Netlify secrets (leave unset until ready).
- Organization posts need Marketing Developer Platform access + org admin grant of
  `w_organization_social`. Pass the organization URN as `external_account_id` on connect start
  (or set `LINKEDIN_ORG_ID`).

### Meta social connect

- `META_APP_ID` + `META_APP_SECRET` (same app as Marketing API is fine).
- Facebook Login scopes: `pages_show_list`, `pages_manage_posts`, `instagram_basic`,
  `instagram_content_publish`.
- Redirect: `{APP_BASE_URL}/api/social/oauth?action=callback&channel=facebook`
  (and `channel=instagram`).

### GHL contact backfill

- New clients attempt GHL contact create/lookup when SMS routing is `ghl_relay`.
- Set `GHL_API_KEY` (preferred) or `GHL_RELAY_API_KEY`. Leave unset until ready.
- One-shot existing clients: `node scripts/backfill-ghl-contact-ids.mjs` (dry-run)
  then `--write`.

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

## Inquiry Removal AI bridge (platform side shipped; IRA outbound still open)

Updated 2026-08-04 on `feat/inquiry-removal-bridge`.

The platform now has:

| Piece | Where |
|---|---|
| `inquiry_removal_cases` + bridged `inquiry_log` | migrations `140_inquiry_ops`, `143_inquiry_removal_bridge` |
| Signed inbound webhook | `POST /api/webhooks/inquiry-removal` |
| Case queue + Mark Cleared / Close Case | `GET /api/read/inquiry-cases`, `GET/POST /api/inquiry-cases`, Inquiry Remover screen |
| Client file status | `inquiry_removal_case` on `GET /api/dashboard/client` |

**Env (platform):** `INQUIRY_REMOVAL_WEBHOOK_SECRET` — HMAC-SHA256 of the raw body; header `x-inquiry-removal-signature` (raw hex or `sha256=<hex>`).

### Darwin — inquiry-removal-ai repo changes (not this platform)

The IRA runtime still writes only to Airtable. It needs outbound POSTs to the platform after each of these moments:

1. **Case created** (AX23 / schedule-call path) → `type: "case.created"`
2. **Call state changes** (Bland progress / call-webhook) → `type: "call_state.changed"`
3. **Inquiry cleared** → `type: "inquiry.cleared"`
4. **Case closed** → `type: "case.closed"`

Suggested payload fields (snake_case):

```json
{
  "type": "case.created",
  "id": "stable-event-id-for-idempotency",
  "client_id": "<platform clients.id uuid>",
  "external_case_id": "recAirtableCaseId",
  "case_status": "Scheduled",
  "selected_bureaus_raw": "EX,TU",
  "requested_at": "2026-08-04T18:00:00Z",
  "master_call_state": "queued",
  "inquiries": [
    {
      "external_inquiry_id": "recAirtableInquiryId",
      "bureau": "EX",
      "inquiry_name": "Capital One",
      "status": "Open",
      "call_state": "queued"
    }
  ]
}
```

For `call_state.changed`, send `external_case_id` (or platform `case_id`) plus `master_call_state` one of:
`queued | dialing | ivr | holding | live_agent_reached | transferred_to_rep | completed | failed | idle`.
When state is `holding`, include `hold_started_at`.

For `inquiry.cleared` / `case.closed` with clears, the platform emits canonical `inquiry.removed` (C-03 listens). Set `as_cleared: true` on `case.closed` when the file is clean.

**Mapping gap:** IRA today keys cases by Airtable client links. Darwin must resolve and send the platform `client_id` (uuid). Until that mapping exists, case.created will 400 with `client_id_required`.

**URL:** `https://<platform-host>/api/webhooks/inquiry-removal`

**Do not** point Bland's own webhook at the platform — Bland still hits IRA `/api/call-webhook`; IRA then forwards normalized events here.
