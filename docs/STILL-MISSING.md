# Still missing

Updated 2026-08-06 — credential collection session
(`cursor/collect-remaining-creds-969a`).

**Credentials live in two places.** Production reads **Netlify** (site
`transcendent-wisp-888771`). Local reads **`.env`** (gitignored). When you
change one, change both. `.env.example` lists names with blank values and is
committed; `.env` is never committed.

## Collection result this session (browser)

The agent browser had **no logged-in vendor sessions**. Every Priority-1 and
Priority-2 dashboard showed a login page (or worse). Nothing was invented.
No new secrets were written to Netlify or `.env` this session.

| Vendor | Result | Why |
|---|---|---|
| Oxylabs | skipped | `dashboard.oxylabs.io` → login page |
| GoHighLevel | skipped | `app.gohighlevel.com` → login page (existing Netlify key still returns contacts 403 — needs a Private Integration with Contacts read/write when you can log in) |
| Commas / FanBasis | skipped | `commas.app` shows **Website Expired**; `app.commas.com` / `dashboard.commas.com` DNS NXDOMAIN; `commas.com` marketing + `/login` require auth. FanBasis URLs redirect to Commas. |
| Meta | skipped | developers / business Facebook → login |
| LinkedIn | skipped | developer portal → login |
| OpenAI | skipped | `platform.openai.com` → login |
| Google Cloud / Workspace | skipped | console → Google login; Workspace admin steps not reachable |
| Hubstaff | skipped | not authenticated to `app.hubstaff.com` |
| Twilio | not attempted | A2P brand conversation required first (owner rule) |
| `INNGEST_EVENT_KEY` | not touched | Owner gate — wakes 47 workflows |

## Already present on Netlify (by name only)

Confirmed present this session (values not printed):

| Env | Notes |
|---|---|
| `ANTHROPIC_API_KEY` | Present; agent runtime can call live when model id matches |
| `MAILGUN_SEND_API_KEY` / `MAILGUN_SEND_DOMAIN` / `MAILGUN_SEND_FROM` | Present |
| `GHL_API_KEY` / `GHL_RELAY_API_KEY` | Present — **contacts probe previously returned 403**; regenerate with Contacts read/write |
| `DATABASE_URL` / `MIGRATION_DATABASE_URL` / enc keys | Present (DB URL masked via CLI) |

Local `.env` currently holds the Mailgun + Anthropic + GHL names from an earlier
session. It does **not** hold Oxylabs / Commas / Meta / LinkedIn / OpenAI /
Drive / Hubstaff.

## Still missing — blocks these features

| Env / credential | Blocks | How to get it |
|---|---|---|
| `OXYLABS_USERNAME` / `OXYLABS_PASSWORD` | Residential Apply (`POST /api/proxy/launch` → 503). Username **without** `customer-` prefix. | Oxylabs → Residential Proxies → user credentials. Verify with adapter `verify()` → `ip.oxylabs.io/location`. |
| GHL contacts-scoped `GHL_API_KEY` | `ghl_contact_id` backfill / find-or-create (403 today) | GHL → Private Integration with **Contacts Read + Write**; replace Netlify + `.env` |
| `COMMAS_WEBHOOK_SECRET` | Payment webhook verify | Commas dashboard → webhook subscription `secret_key` (login at `commas.com/login` once account is live) |
| `COMMAS_CHECKOUT_BASE_URL` | Payment-link send (503 until set) | See Commas notes below — URL-query checkout is **unverified** against live Commas |
| `META_APP_ID` / `META_APP_SECRET` | Social OAuth + token refresh | Meta Developer app → Settings → Basic |
| Meta system-user token + `act_…` ad account | Campaign sync / pause / budget | Stored on `ad_platform_connections` (`encrypted_access_token`, `external_ad_account_id`) — **not** env vars. Business Manager → System Users (`ads_read`, `ads_management`) + Ad Accounts |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` / optional `LINKEDIN_ORG_ID` | Social Studio LinkedIn connect | LinkedIn Developers app; Community Management approval may take days |
| `OPENAI_API_KEY` | Company Brain embeddings / creative | platform.openai.com → key named e.g. `fundhub-company-brain` |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` / `GOOGLE_DRIVE_DELEGATE_EMAIL` | Company Brain Drive sync | GCP project + Drive API + service account JSON + Workspace domain-wide delegation for `drive.readonly` |
| `HUBSTAFF_TOKEN` / `HUBSTAFF_ORG_ID` | Deep-monitoring poll sweeper | Hubstaff → org API token + org id. Leave unset until cutover if you want ingest dark. |
| Creative provider keys (`CREATIVE_*`) | Creative job `run()` assets | Provider dashboards |
| Social channel page tokens | Live social publish | Channel OAuth / page token on `social_channels` |
| `INQUIRY_REMOVAL_WEBHOOK_SECRET` | IRA → platform webhook | Configure with IRA runtime at cutover |
| `TWILIO_*` | SMS via Twilio | A2P first — do not set yet |

## Deliberately unset (owner gates)

| Env | Why |
|---|---|
| `INNGEST_EVENT_KEY` | Wakes 47 workflow functions. Do not flip until other credentials are verified. (May already exist on Netlify from an earlier setup — this session did not change it.) |

## Commas / FanBasis — payment-link assumptions (2026-08-06)

Could **not** confirm against a live logged-in Commas account this session
(account/marketing surface issues above). Public Commas API docs (FanBasis →
Commas rebrand; `POST https://www.fanbasis.com/public-api/checkout-sessions`)
say:

1. **Variable amount in the checkout URL?**  
   **Likely no / not the supported path.** Amount is set as `amount_cents` when
   **creating a checkout session via API**, which returns a hosted
   `payment_link`. Our code (`buildCommasCheckoutUrl`) instead assumes a static
   `COMMAS_CHECKOUT_BASE_URL` that reads `amount`, `ref`, and `description` from
   the **query string**. That assumption is still **unverified** and may be
   wrong against current Commas — if so, fix is in `buildCommasCheckoutUrl` /
   payment-links to mint a session via API (outbound `fetch` must go through an
   allowed provider module per CLAUDE.md §12).

2. **Does the webhook echo a reference we set?**  
   **Unknown against live webhooks this session.** Public docs accept string
   `metadata` on checkout-session create; third-party integrations describe
   round-trip as `api_metadata` on payment events. Our
   `normalizeCommasEvent` already looks for `client_reference_id`,
   `metadata.link_ref` / `metadata.ref`, `reference`, `ref`. Until a real
   `payment.succeeded` payload is captured, treat echo as **unverified**.

**Owner action:** restore/log into the Commas account at `commas.com/login`,
create a webhook subscription pointed at
`https://<host>/api/webhooks/commas`, store `secret_key` as
`COMMAS_WEBHOOK_SECRET`, and either confirm URL-query checkout or switch the
builder to API session create.

## Lender + inquiry ops data (unchanged)

Tables from migrations `138`–`140` still ship empty on purpose. Import from
Airtable when ready — do not invent lender names or bureau paths.

## Closed earlier (platform wired; credentials separate)

Hosted partner funnels, social publish cron, creative job runner, campaign
write loop, agent runtime (shadow without Anthropic), Oxylabs Apply door
(503 without Oxylabs creds), Hubstaff consent gate (no-op without Hubstaff
creds) — see prior merge notes / journeys.
