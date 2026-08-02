# Still missing

Captured 2026-08-02 in the `feat/session-six-items` session. Things previously
described as requirements that were not finished here (or need an external
credential the session does not have).

## Credentials needed (do not invent)

| Env / credential | Where used | How to get it |
|---|---|---|
| `META_APP_ID` | Meta token refresh / Marketing API app context (`api/campaigns/sync.mjs`) | Meta Developer app → Settings → Basic |
| `META_APP_SECRET` | Same | Same panel; store as Netlify secret |
| Meta user / system user Marketing API token | `ad_platform_connections.encrypted_access_token` for platform=`meta` | Meta Business Manager → System Users → Generate token with `ads_read`, `ads_management` |
| Meta ad account id | `ad_platform_connections.external_ad_account_id` (`act_…`) | Business Manager → Ad accounts |
| Creative provider keys (`CREATIVE_*` — see `src/creative/providers/`) | `enqueue` works without them; `run()` needs them to produce assets | Provider dashboards (depends which provider is configured) |

Without a Meta connection row + token, **Sync Meta now** returns a clear
`no_meta_connection` / `credential_missing` error. The route is wired; the
credential is not fabricated.

## Large / deferred

1. **Hosted partner funnels at custom domains** — Brand Studio now creates
   `partner_pages` drafts from funnel templates (`apply` / `diag` / `edu` /
   `aff` / `book`). Serving them on a verified custom domain (DNS, SSL, live
   HTML) is still deferred. Spec: `docs/BRAND-THEMING-SPEC.md`,
   `HANDOFF.md`.

2. **Social `publishDue` cron** — `POST /api/social/schedule` queues
   `social_posts`. Nothing in this repo yet runs `publishDue` on a schedule to
   push to Instagram/TikTok/etc. Adapters register via
   `src/social/scheduler.mjs` `registerAdapter`.

3. **Creative job runner / Inngest worker** — `POST /api/creative/generate`
   enqueues. No worker claims/runs jobs in production yet. Approve / reject /
   archive asset UI still missing on Creative Factory.

4. **Campaign write UI beyond pause/resume/budget** — `POST /api/campaigns/write`
   supports pause, resume, update_budget through the existing Meta adapter +
   guardedWrite. Full create-campaign / create-ad-set from the Campaigns screen
   UI is not built; use Meta (or a later form) then Sync.

5. **Chat widget: agent-sent messages** — data model ready
   (`messages.sender_kind` includes `agent`). Application send path stays off
   (spec §8).

6. **Chat widget for affiliates / white-label** — owner call C-3 for this
   session: internal staff + client portal only. Affiliates keep
   `/api/read/company-brain-affiliate` without the widget chrome.

7. **Platform how-to corpus expansion** — v1 is a curated FAQ in
   `src/chat/platform-help.mjs` (C-1: separate from Company Brain). Indexing
   full `docs/` into a searchable store is a follow-up.

8. **UNFINISHED-AUDIT.md** — referenced from CONTROLS-AUDIT but was never
   committed on this tree. Soft-pull bureau fulfilment path still queues only
   (historical note).

9. **Closer sales assets / call recording / recruiting pipeline** — still in
   `PRODUCT-BACKLOG.md`, not started.

10. **Message dispatcher sweeper registration** — `message-dispatch-sweeper`
    defined and deliberately not registered (CLAUDE.md §12). Staff compose
    dispatches immediately; templated queue still needs the sweeper for full
    outbound.

## Built in this session (so this file is not silent about wins)

- CRM + portal chat widget (Ask / Knowledge / Message)
- Finance OS simulated client loader + teardown (`/api/demo/simulate`)
- Global search overlap fix (chip vs Search positioning)
- Campaigns Meta sync + write routes; Social schedule route; Creative generate route
- Brand Studio → `partner_pages` funnel page drafts
