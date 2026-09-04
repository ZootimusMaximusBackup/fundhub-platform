# Final usability pass

Updated 2026-08-04. Status of every screen under `public/app/*.html` after the
integration-gaps + usability session.

Legend:

- **fully usable** — primary jobs work against live APIs; empty states are honest
- **usable with gaps** — core path works; named controls need a credential or owner call
- **demo / deferred** — surface exists; deliberately not the live path yet

Anything that still needs a **credential** or an **owner decision** is listed under
that screen and also in `docs/STILL-MISSING.md`.

| Screen | Status | Notes / left for you |
|---|---|---|
| `index.html` | fully usable | Login / role pick |
| `command-center.html` | fully usable | KPIs from `/api/dashboard/kpis`; agent badges from registry. Cost/funded shows — until ad metrics sync |
| `pipeline.html` | fully usable | Live board from `/api/dashboard/pipeline` |
| `calendar.html` | usable with gaps | Join Call + His file from `tasks.meeting_url` / `client_id`. Coverage from `/api/shifts?roster=1`. Week strip still decorative. **Cutover:** CF Appointments vs Cal.com — see STILL-MISSING |
| `messaging.html` | fully usable | Inbox + compose; outbound needs provider keys |
| `documents.html` | fully usable | Live document library |
| `contracts.html` | usable with gaps | Send/sign work; esign vendor credentials if used in prod |
| `client-control-panel.html` | usable with gaps | Live client; Oxylabs Apply disabled until `OXYLABS_*` set; the CRM link disabled until `ghl_contact_id` |
| `closer-dashboard.html` | usable with gaps | Tradelines/lender matches live with `?client_id=`. Day stats + pipeline empty until closer-day endpoint. Deal-math panel marked SAMPLE (no endpoint) |
| `social-studio.html` | usable with gaps | OAuth + schedule/publish wired; list panes empty until list API. Needs `META_APP_*` / `LINKEDIN_*` (+ LinkedIn org URN) |
| `inquiry-remover.html` | usable with gaps | Cases live after import; empty until spreadsheet/CSV load |
| `lenders.html` | usable with gaps | CRUD + AI bureau config wired; tables ship empty on purpose (owner imports) |
| `finance-os.html` | fully usable | Simulated client loader for demos |
| `subscriptions.html` | fully usable | Finance OS sibling |
| `products-commissions.html` | usable with gaps | Product ladder live; rails column has no source; commission-rule writes still local-only (STILL-MISSING §9) |
| `staff-teams.html` | usable with gaps | Directory + clock-in live; permission matrix columns for roles without schema stay blank on purpose |
| `ops-admin.html` | usable with gaps | KPIs live; AR from invoices; compliance blocks from messages; DLQ live. Affiliates/hiring summaries empty until those surfaces are used |
| `agent-editor.html` | usable with gaps | Registry live; promote/runtime needs owner agent decisions |
| `template-editor.html` | fully usable | Templates CRUD |
| `automations.html` | usable with gaps | Workflow list; Inngest live only when `INNGEST_EVENT_KEY` set (owner switch) |
| `journeys.html` | fully usable | Journey docs + runner views |
| `campaign-manager.html` | usable with gaps | Needs Meta Marketing token on `ad_platform_connections` |
| `creative-factory.html` | usable with gaps | Needs creative provider keys to produce assets |
| `social-studio.html` | usable with gaps | OAuth + schedule/publish wired; list panes empty until list API. Needs `META_APP_*` / `LINKEDIN_*` (+ LinkedIn org URN) |
| `content-admin.html` | usable with gaps | Entitlements live; video upload still local stub |
| `hiring.html` | usable with gaps | Pipeline exists; sample interview rows remain in demonstration zone |
| `brand-studio.html` | usable with gaps | Partner brand + publish; custom domain SSL is operator DNS |
| `galaxy.html` / `partner-galaxy.html` | fully usable | Navigation maps |
| `affiliate.html` | usable with gaps | Partial live; license sign still local |
| `sample-data.html` | demo / deferred | Explicit sample/dev tools — not a live ops path |
| `consent-capture.html` | usable with gaps | Built; inbound nav link still an owner product decision |
| `client-portal.html` | usable with gaps | Client session surfaces |

## Credentials still required (do not invent)

| Credential | Why |
|---|---|
| `OXYLABS_USERNAME` / `OXYLABS_PASSWORD` | Residential Apply door |
| `META_APP_ID` / `META_APP_SECRET` | Social OAuth + campaign token refresh |
| Meta Marketing user token on `ad_platform_connections` | Campaign sync/write |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` (+ org URN) | LinkedIn social connect + org posts |
| `GHL_API_KEY` (or `GHL_RELAY_API_KEY`) | Contact backfill + SMS relay addressing |
| `AD_TOKEN_ENC_KEY` | Encrypt social/ad tokens (must already exist for ad platforms) |
| Creative provider keys | Asset generation |
| `INNGEST_EVENT_KEY` | Turns on the 47 workflow functions — **owner switch only** |

## Owner decisions still open

1. Booking cutover: CF Appointments adapter (~2–3d) vs Cal.com embed swap (~1d eng + funnel rebuild).
2. Where `consent-capture.html` links from in the shell.
3. Whether commission-rule writes land as `POST /api/commission-rules` (draft exists off-branch).
4. Whether to schedule `autoCloseStale` for shifts (telemetry coverage still partial for non-inquiry roles).

## What this pass fixed

- UnderwriteIQ e2e Postgres test (sim client → CRS emit → decision stamp → engine report)
- ClickFunnels `CF_CAPTURE_MODE=1` → `webhook_captures`
- Booking lifecycle: `booking.rescheduled` / `cancelled` / `noshow` + Cal.com + S-05a
- Calendar Join Call / His file / coverage roster
- The CRM contact id on create + `scripts/backfill-ghl-contact-ids.mjs`
- Meta + LinkedIn social OAuth + LinkedIn publish adapter
- Command Center + Ops Admin KPIs from money chain / events / ad metrics
- Playwright coverage for the new round + mobile smoke
