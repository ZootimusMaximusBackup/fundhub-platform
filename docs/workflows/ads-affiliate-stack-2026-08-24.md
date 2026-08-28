# Ads + partner APIs stack — 2026-08-24

**Owner go:** proceed on APIs today. Jeremy AI = later (Chris will say when).  
**Shared board** for Meta / Google / YouTube / LinkedIn / partner ad accounts / affiliate→WL later.

## Goal (ordered) — owner clarified 2026-08-24

1. **Meta API access for partner / client ad accounts** (`client_ad_accounts` / agency managed accounts). Unlock the app capability Meta blocks today (error `#3`).
2. Prove connections (no live spend until Chris says GO).
3. Later: Jeremy coach, dashboard polish, free-affiliate links → WL → offer packs → ship live.

**Do NOT deploy** the partner CRM form / agency UI to **fundhub.ai** right now (owner 2026-08-24). Zero deploy this lane until Chris asks.

## Task list

| Unit | Owner | Status |
|------|-------|--------|
| Meta API truth | this chat | claimed |
| Google / YouTube ads API | parallel (Chris launch) | pending |
| Jeremy AI coach | — | later — do not build |
| Four-client / partner ads routing | after Meta+Google | pending |
| Affiliate → WL → offers + dashboard live | last | pending |

Protocol: claim before start. Write manifest when done. Never invent secrets.

---

## Runtime probe (2026-08-24, session `7ffc77`)

Evidence: `.cursor/debug-7ffc77.log` (probe1 / probe2 / **post-assign**).

| Check | Result |
|-------|--------|
| `META_APP_ID` / `META_APP_SECRET` | **set** (local `.env` + Netlify production / deploy-preview / branch-deploy; secret flagged `--secret`). App: Fundhub API. App ID name-only confirmed. |
| `META_ACCESS_TOKEN` | **set** — valid `SYSTEM_USER` named **Conversions API System User** |
| Token app id | `1512828066718833` (matches screenshot) |
| Token scopes | includes `ads_management`, `ads_read`, `business_management` (and many page/IG scopes) |
| `me/adaccounts` | **1** — `act_982103620742368` **Fundhub.ai** (post-assign PROVEN) |
| Direct GET `act_982103620742368` | **OK** — name Fundhub.ai, currency USD, `account_status` 9 (in grace period per Meta codes) |
| Business `owned_ad_accounts` | **1** — same Fundhub.ai account |
| `me/businesses` | **0** businesses (unchanged; owned path works via assign) |
| Pixel `2403674420141513` | API **#200** — still not granted on this token (separate from ad-account assign) |
| LinkedIn client + org | **set** locally |
| Google Ads / YouTube env | **all unset**; **no** `GOOGLE_ADS_*` adapter in repo yet |
| `AD_TOKEN_ENC_KEY` | **set** (needed to store partner tokens) |
| `META_BUSINESS_ID` | **set** — `1475597360226485` (Fundhub Portfolio; Chris screenshot) |
| `META_AD_ACCOUNT_ID` | **set** — `act_982103620742368` (Fundhub.ai; Chris screenshot) |

### Hypotheses (Meta)

| Id | Hypothesis | Verdict |
|----|------------|---------|
| A | Connect Facebook fails because `META_APP_ID`/`SECRET` missing | **RESOLVED** — keys set local + Netlify (2026-08-24) |
| B | Token lacks ads scopes | **REJECTED** — scopes include ads_* |
| C | Token cannot see any ad accounts | **RESOLVED (post-assign)** — count **1** Fundhub.ai |
| D | Token not tied to a Business Portfolio | **CONFIRMED** — businesses count 0 (owned assign still works) |
| E | Pixel / Fundhub Portfolio not assigned to this system user | **PARTIAL** — **ad account assign PROVEN**; pixel still #200 |

---

## What “approval” means (plain English)

These are **three different things**. Do not mix them up.

### 1. Meta (Facebook / Instagram ads) — partner / white-label accounts

**A. Asset access (day-one, per client)**  
Each client’s ad account (and usually Page / pixel) must be shared with **your** Meta Business Portfolio as a **Partner** (agency), **or** their ad account must be **assigned to your system user**.

- You request partner access, **or** they invite your Business ID.
- They click **Approve** in Meta Business Settings → Requests.
- Tasks you want: advertise + analyze (at least).

This is **not** App Review. It is **they trust your business with their ads**.

**B. App keys (for Connect button / OAuth)**  
Social Studio Connect needs `META_APP_ID` + `META_APP_SECRET` from [developers.facebook.com](https://developers.facebook.com) → your app → Settings → Basic.  
App id on the current token: **`1512828066718833`**.

**C. App Review / Advanced Access (only if strangers log in with Facebook)**  
If **partners** click “Connect Facebook” on Fundhub and authorize **your** app, Meta may require **App Review** for ads / pages permissions in Live mode.  
If **you** only use a **system user** inside your own Business Manager and partners never do Facebook Login, you can often stay on Business / system-user tokens **without** full public App Review — still need assets assigned.

**D. Special Ad Categories**  
Funding / credit offers need Meta’s **special ad category** (credit / financial). Repo already blocks Meta campaign create until `ad_platform_category_map` is filled (migration 046). That is product compliance, not “API key approval.”

**Repo home for partner tokens:** `ad_platform_connections` (one row per partner + platform + ad account). Tokens encrypted with `AD_TOKEN_ENC_KEY`, bound to `partner_id`.

### 2. Google Ads + YouTube ads

YouTube ads run through **Google Ads**, not a separate “YouTube Ads API” for most spend.

| Piece | What it is |
|-------|------------|
| Google Cloud OAuth client | Client ID + secret |
| Google Ads **developer token** | From Google Ads API Center |
| **Basic** access | Default — limited; enough to start testing |
| **Standard** access | Google reviews your use case — needed for serious multi-client volume |
| Manager account (MCC) | Your umbrella; **link** each client Google Ads account; they accept the link |

No Google Ads adapter / env in this repo yet → Workflow 2 builds that after Chris launches it.

### 3. LinkedIn

| Piece | Status |
|-------|--------|
| App `LINKEDIN_CLIENT_*` + org | Set locally — Social Studio org posts path |
| **Hiring / job posts** | Ops pulse path (separate from paid ads) |
| **LinkedIn Marketing / Campaign Manager ads** | Different product + often Marketing Developer Platform approval — **not** the same as Connect LinkedIn for posts |

---

## Manifest — Meta API truth (in progress)

**Claimed:** this chat  
**Done so far:** runtime probe; board; oauth start instrumentation (debug session kept); **post-assign Graph prove**; **CRM own-account wire**; **partner agency API (minimum)**.  
**Chris confirmed (screenshot):** Meta app **Fundhub API**, App ID set, status **Published**. App Secret arrived from App settings → Basic.  
**Keys (name-only, 2026-08-24):** `META_APP_ID` + `META_APP_SECRET` now **set** in local `.env` and Netlify (production / deploy-preview / branch-deploy; secret with `--secret`). `META_ACCESS_TOKEN` still set. Did **not** store any Facebook *login* password from Chrome save-password dialog.  
**Own-account API access:** **PROVEN** (2026-08-24 post-assign) — system user sees **Fundhub.ai** `act_982103620742368` via `me/adaccounts`, direct act GET, and business `owned_ad_accounts`. No new token generate needed.  

### CRM wire — Fundhub own account (2026-08-24)

| Field | Value |
|-------|--------|
| Partner | **Fundhub Direct** (slug `fundhub-direct`) — home partner for Fundhub-owned ads, **not** demo |
| Partner id | `c889dd9a-6b19-421b-a4b3-43feaf9e89a7` |
| Connection id | `fa77c0ab-e4b2-427d-869a-413891725c51` |
| Account | `act_982103620742368` |
| Business | `1475597360226485` |
| `connection_state` | **active** (token encrypted with `AD_TOKEN_ENC_KEY`, partner-bound) |
| Campaign Manager | https://fundhub.ai/app/campaign-manager.html?partner_id=c889dd9a-6b19-421b-a4b3-43feaf9e89a7 |
| Safe sync read | **OK** — campaigns GET works (e.g. “oSched: VSL: Funding”); stamp `last_synced_at`; full upsert script `_sync-own-meta.mjs` |
| Pixel `2403674420141513` | **OK** (re-probe 2026-08-24 — no longer #200) |

Evidence: `docs/workflows/ads-affiliate-stack-2026-08-24-evidence/wire-meta-crm.jsonl`

### Partner / agency API (Path 2) — code exists; **not** live on fundhub.ai

| Piece | Status |
|-------|--------|
| CRM stores partner Meta Business ID | Coded — `POST /api/campaigns/meta-agency` → `ad_platform_connections` (pending until real `act_` known) |
| Campaign Manager form | Coded in tree — **do not deploy to fundhub.ai** (owner 2026-08-24) |
| Graph `GET …/client_ad_accounts` | **Works** (probe 2026-08-24) — returns empty list today (no client accounts shared yet) |
| Graph `POST …/client_ad_accounts` | **BLOCKED** — Meta `#3` “Application does not have the capability to make this API call.” |
| Graph `managed_businesses` | Field missing on this Business node (`#100`) — not the path |
| Meta Approve (client side) | Still required once by the *client’s* Meta admin after a valid partner request exists |
| Social OAuth | Unchanged. **Not** the partner ads path. |

**Still open:** Meta UI App Review for partner-account capability (below); Google Ads env; pending→active when a client Approves.  
**Not doing:** fundhub.ai deploy of partner form; Jeremy AI; buying ads; dashboard polish; Facebook login passwords.

---

## Meta `client_ad_accounts` capability (2026-08-24, session `7ffc77`)

**Verdict: blocked** — Graph cannot turn this on. Chris must approve in Meta’s App Dashboard UI. **Zero deploy.**

### Probe (names-only → `.cursor/debug-7ffc77.log`)

| Check | Result |
|-------|--------|
| Token scopes | Has `ads_management`, `ads_read`, `business_management` (+ more) |
| Own ad account | Still OK (`me/adaccounts` count 1) |
| `ads_api_access_tier` header | **`development_access`** (= Marketing API Access Tier **Limited**) |
| `GET /{biz}/client_ad_accounts` | **OK**, count **0** |
| `GET /{biz}/pending_client_ad_accounts` | **OK**, count **0** |
| `GET /{biz}/client_pages` / `client_pixels` | **OK**, empty |
| `POST /{biz}/client_ad_accounts` | **FAIL `#3`** capability (probe used dummy `act_000…` — never a real third-party) |
| Graph request App Review / Advanced Access | **Impossible** — no API; UI only |

Docs Meta names this as **Business-to-Business / client ad accounts** (not “Business Asset User Profile Access” — that feature is unrelated user-profile fields). Creating on the edge is **temporarily limited**; Meta says only apps that successfully called it in the last 30 days keep write access ([reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/business/client_ad_accounts)). New apps hit `#3` until App Review unlocks Advanced Access on the ads/business permissions (community + Meta authorization docs).

### Exact URLs (App ID filled)

1. **Primary — request Advanced Access / check Marketing API Access Tier**  
   https://developers.facebook.com/apps/1512828066718833/app-review/permissions/

2. **App home (Fundhub API)**  
   https://developers.facebook.com/apps/1512828066718833/dashboard/

3. **Business verification (needed before Advanced Access)**  
   https://business.facebook.com/settings/security?business_id=1475597360226485  
   (If that screen doesn’t show verification, use Business Settings → Security Center for portfolio `1475597360226485`.)

4. **B2B docs (what the API does after unlock)**  
   https://developers.facebook.com/docs/marketing-api/business-asset-management/guides/business-to-business/

5. **Auth / Advanced Access explanation**  
   https://developers.facebook.com/docs/marketing-api/get-started/authorization/

### What Meta requires (plain English)

| Need | Why | Status |
|------|-----|--------|
| **Business Verification** | Required before Meta will grant Advanced Access. | **DONE** (FUNDHUB ENTERPRISES LLC) |
| **App Review → Advanced Access** on **`ads_management`** (+ **`ads_read`**) | Doc: managing *other people’s* ad accounts needs Advanced Access, not Standard. This is the `#3` unlock. | **OPEN — do this next** |
| **App Review → Advanced Access** on **`business_management`** | Partner / B2B Business Manager calls. | Request with ads perms if still Standard |
| **Marketing API Access Tier → Full access** (when eligible) | Header = `development_access` (Limited). **Separate** dial from permission Advanced Access. Doc: Limited = **no** BM access to **manage ad accounts** — so Full also matters for `client_ad_accounts` write once call metrics allow Upgrade. | Open when **500** calls / 15d met; don’t block permission Advanced Access on it |
| **Client Approve** (later, per partner) | Even after the app can POST, each client’s Meta admin must Accept the partner request. | After Advanced Access |

**Not required for this hole:** Business Asset User Profile Access.  
**Cannot do via Graph:** submit App Review, flip Advanced Access, or lift `#3`.

### Workaround until App Review lands (no fundhub.ai deploy)

Client invites **Fundhub Portfolio** (`Business ID 1475597360226485`) as a **Partner** on their ad account in Meta Business Settings. After they Accept, `GET client_ad_accounts` should list it (read already works). We still cannot *send* the request via API until `#3` clears.

### Doc map — Meta Authorization (2026-08-24)

Source: [Marketing API → Authorization](https://developers.facebook.com/docs/marketing-api/get-started/authorization/) (same content as ads-commerce path Chris sent).

| Doc says | Fundhub today |
|----------|----------------|
| Own ad accounts → **standard** access on `ads_read` / `ads_management` is enough | **DONE** — `act_982103620742368` works |
| **Other people’s** ad accounts → need **Advanced Access** on `ads_read` and/or `ads_management` | **NOT YET** — `POST client_ad_accounts` → Meta `#3` |
| Advanced Access = App Review UI only (`App Review → Permissions and Features → Request advanced access`) | Graph cannot flip this |
| **Marketing API Access Tier** (Limited = `development_access` vs Full) is a *different* dial | Header still `development_access`. Separate from permission Advanced Access; Full also unlocks full BM “manage ad accounts” APIs (see Authorization table). Eligible only after **500** calls |
| Business Verification before Advanced Access | **DONE** — FUNDHUB ENTERPRISES LLC (owner 2026-08-24) |

**Not the path:** partner CRM form on fundhub.ai (owner: do not deploy). Client-side “invite Fundhub as Partner” can still work for read listing after share; API *send* of partner request stays blocked until Advanced Access.

### Next single human action

Open https://developers.facebook.com/apps/1512828066718833/app-review/permissions/ → find **`ads_management`** → click **Request advanced access** (also request **`ads_read`** + **`business_management`** if those still show Standard only).


---

## Threads Meta credentials (2026-08-24)

| Key | Local `.env` | Netlify (prod / deploy-preview / branch-deploy) |
|-----|--------------|--------------------------------------------------|
| `THREADS_APP_ID` | set | set |
| `THREADS_APP_SECRET` | set | set (`--secret`) |

No deploy in this step. Names only — values not recorded on this board.

---

## Fundhub Meta Business + ad account (confirmed 2026-08-24)

Chris confirmed from Business Manager screenshots. These are **IDs, not secrets**.

| Key / field | Value |
|-------------|--------|
| Portfolio name | Fundhub Portfolio |
| `META_BUSINESS_ID` | `1475597360226485` |
| Ad account name | Fundhub.ai |
| Numeric ad account | `982103620742368` |
| `META_AD_ACCOUNT_ID` | `act_982103620742368` (repo `src/adplatforms/meta.mjs` adds `act_` if missing) |

**Stored:** local `.env` (merge; `META_APP_*` / `THREADS_*` kept) + Netlify production / deploy-preview / branch-deploy. **No deploy** this step.

### Partner already on Fundhub.ai

- **Direct ROAS** has **full control** on this ad account — separate from our system user. Do not confuse that partner with **Conversions API System User**.

### Two-path model (owned vs other people's accounts)

Goal: run Fundhub ads **and** other people's ad accounts through our API.

| Path | When | What Chris / client does | Then we store |
|------|------|--------------------------|---------------|
| **1. Owned assign people** | Ad accounts we own (e.g. Fundhub.ai under Fundhub Portfolio) | Business Manager → Ad account → **Assign people** → **Conversions API System User** (advertise + analyze) | Env IDs above; API `me/adaccounts` should list them after assign |
| **2. Partner / agency access** | Client / other people's ad accounts | **Assign partner** (their Business invites ours) **or** we send a partner request; they approve | Per-partner rows in `ad_platform_connections` (encrypted token + `external_ad_account_id`) |

Path 1 for Fundhub.ai: **PROVEN** — system-user token lists the account (post-assign run `7ffc77`).

## Next single human action

Open https://developers.facebook.com/apps/1512828066718833/app-review/permissions/ → **Request advanced access** on `ads_management` (plus `ads_read` + `business_management` if still Standard). Business Verification already done. **No fundhub.ai deploy** of the partner form.

---

## Marketing API use cases doc (2026-08-24)

Source: [Marketing API Use Cases](https://developers.facebook.com/documentation/development/create-an-app/marketing-api-use-cases) (classic `/docs/…` URL redirects to same page; both **200**).

Meta’s three Marketing API use cases (pick/customize on the app):

| Use case (Meta name) | Plain English |
|----------------------|---------------|
| **Create & manage ads with Marketing API** | Build / edit / pause paid campaigns via API |
| **Measure ad performance data with Marketing API** | Pull ad insights / reports via API |
| **Capture & manage ad leads with Marketing API** | Pull lead-ad form submissions (only if you run lead ads) |

All three attach required: `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `public_profile`, plus feature **Ads Management Standard Access**. Doc also auto-adds Facebook Login for Business + Webhooks products.

**Fundhub map**

| Goal | Marketing API use case? |
|------|-------------------------|
| Own ads | **Create & manage ads** |
| Partner / client ads | Same + **Advanced Access** on ads/business perms (use cases alone do not unlock `#3`) |
| Ad analytics | **Measure ad performance data** |
| Organic FB/IG posting | **Not** these use cases — Pages / Instagram products (`pages_manage_posts`, `instagram_content_publish` already in Social OAuth) |
| Lead-ad CRM ingest | Only if needed → **Capture & manage ad leads** |

**App Review after picking use cases:** Still required for data you don’t own/manage (partner accounts). Picking use cases ≠ Advanced Access. Business Verification already done. No Facebook Login path for this lane (owner). No fundhub.ai deploy.

**Dashboard:** https://developers.facebook.com/apps/1512828066718833/use_cases/ → open each needed use case → **Customize** / **Add** if missing → then App Review Advanced Access on ads perms (not the “Required actions” wizard he rejected).

---

## App Review “Next” stuck — research (2026-08-24)

**Sources (official):**
- [Marketing API Authorization](https://developers.facebook.com/docs/marketing-api/get-started/authorization/) — Standard vs Advanced Access **vs** Marketing API Access Tier (Limited/Full); Full needs **500** successful Marketing API calls / 15 days + **&lt;15%** error rate on last 500; Limited = **no** Business Manager access to **manage ad accounts**
- [Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels/) — Advanced Access needs Business Verification; Standard = role users only
- [Permissions reference — `ads_management`](https://developers.facebook.com/docs/permissions) — screencast + use-case text for Advanced Access
- [Access Verification / Tech Provider](https://developers.facebook.com/docs/development/release/access-verification/) — **separate** from App Review; required when other businesses use the app with `ads_management` / `ads_read` / `business_management` / many `pages_*`
- [Data handling questions](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/data-handling-questions/) — often before / as part of Advanced Access
- [App Review tutorial](https://developers.facebook.com/docs/resp-plat-initiatives/appreview/tutorial/) + [common mistakes](https://developers.facebook.com/docs/app-review/submission-guide/common-mistakes/) — screencast per permission; complete Settings; app must be testable
- [Error handling — code 3](https://developers.facebook.com/docs/graph-api/guides/error-handling/) — capability / permissions issue
- [Rate limiting / Access Tier labels](https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/) — `development_access` = Limited; Full = higher quota

### Why blue **Next** won’t go (most likely)

Meta’s App Review → **Requests** / “Not submitted · New requests” **Next** stays dead when the **submission package isn’t ready to open**, not because permissions must be deleted.

**Most likely for Fundhub right now:** **Marketing API Access Tier** is sitting in the same **New requests** bag while the app is still on Limited (`development_access`) and **has not hit the Full-access metrics** (500 successful Marketing API calls in 15 days, &lt;15% errors). Meta documents Full upgrade as a **separate** App Review feature with those gates. Mixing an **ineligible** tier upgrade with ready permission Advanced Access requests is a known way the continue/Next path refuses to move.

**Second most likely:** **Settings → Basic** incomplete (Privacy Policy URL, app icon, category). Meta’s own App Review flows say app settings must be complete before you can continue.

**Also check:** prior open submission / incomplete **data handling** answers; grey “How will your app use…” rows that never load (Meta UI bug — community threads).

### Exact URLs (app `1512828066718833`)

| Step | URL |
|------|-----|
| Permissions & Features (request Advanced Access) | https://developers.facebook.com/apps/1512828066718833/app-review/permissions/ |
| App Review Requests (Next lives here) | https://developers.facebook.com/apps/1512828066718833/app-review/ |
| Settings → Basic (unblock Next) | https://developers.facebook.com/apps/1512828066718833/settings/basic/ |
| Access Verification (Tech Provider — after / beside review) | App Dashboard → **Settings → Basic** → Access Verification row |

### Two different dials (do not mix)

| Dial | What it unlocks | Fundhub |
|------|-----------------|--------|
| **Permission Advanced Access** (`ads_management`, `ads_read`, `business_management`) | Non-role / other people’s accounts can grant scopes; partner tooling | **Required for partner path**; own ads already work on Standard |
| **Marketing API Access Tier** Limited → Full | Rate limits + **full Business Manager APIs** (doc: Limited has **no** BM access to **manage ad accounts**) | Header still `development_access`; Full needs **500** calls — **separate** from permission Advanced Access |

`#3` on `POST …/client_ad_accounts` = capability gap. Fix path = Advanced Access on ads/business perms **and** (per Authorization table) Full Marketing API Access Tier when eligible — client invite-as-Partner still works for listing after Accept.

### After Next works — what the form asks

1. Confirm **App settings** + **Verification** green  
2. **Data handling** questions (purpose, sharing, deletion, security)  
3. Per permission: written use case + **screencast** (`ads_management`: Facebook Login grant → show Impressions / Conversions / Spend / Clicks / Reach on your product)  
4. Reviewer test instructions / credentials if needed  
5. **Submit for Review**

### Next 3 clicks for Chris (no trash)

1. Open https://developers.facebook.com/apps/1512828066718833/settings/basic/ → confirm Privacy Policy URL + icon + category are saved.  
2. Open https://developers.facebook.com/apps/1512828066718833/app-review/permissions/ → **Request advanced access** on **`ads_management`** (and `ads_read` / `business_management` if still Standard). For **Marketing API Access Tier**, only click **Upgrade** after the dashboard shows you meet the **500-call** gate — leave that upgrade for a later submission if the metric isn’t green yet.  
3. Open https://developers.facebook.com/apps/1512828066718833/app-review/ → **Next** → fill data handling + screencasts → Submit.

**No fundhub.ai deploy. No Facebook password login by agents.**

---

## App Review Allowed-usage agent pass — BLOCKED (2026-08-24 ~16:51 PT)

**Verdict:** Agent **cannot drive Chris’s real Chrome session** right now.

| Check | Result |
|-------|--------|
| `user-chrome-devtools` `list_pages` | FAIL — no `DevToolsActivePort` on Default Chrome profile |
| `cursor-ide-browser` tabs | empty |
| CDP `127.0.0.1:9222` | down |
| Prior debug Chrome (`/tmp/chrome-meta-mcp`) | gone |

**Earlier (same day, before Chrome died):** Confirmed app **Fundhub API** `1512828066718833`. Opened submission Allowed usage list (all REMOVE + KEEP cards visible with **Get started**). Did **not** finish removals or paste Allowed usage text. Did **not** submit.

### Still needs Chris (paste yourself)

1. Open submission → Allowed usage → **edit your submission** → remove: Marketing API Access Tier, Live Video API, `manage_fundraisers`, `whatsapp_business_messaging`, `whatsapp_business_management`, `ads_mcp_management`, `catalog_management`, `publish_video`, `pages_messaging`, `leads_retrieval`.
2. KEEP + paste blurbs (Get started each; leave screencasts empty — none on disk):
   - `ads_management`: Fundhub is an agency platform. Staff connect Meta ad accounts (ours and client accounts shared with our Business) and create/edit/pause campaigns, ad sets, and ads for funding/credit offers, then sync results into our CRM Campaign Manager.
   - `ads_read`: We pull spend, impressions, clicks, and conversions from connected ad accounts into Fundhub dashboards so owners and partners can see performance without leaving the CRM.
   - `pages_show_list` / `pages_read_engagement` / `pages_manage_metadata` / `pages_manage_posts` / `pages_manage_ads`: Partners connect Facebook Pages so we can list their Pages, read engagement for analytics, update Page metadata needed for publishing, schedule/publish posts from Social Studio, and manage Page-linked ads.
   - `instagram_basic`: Partners connect Instagram business accounts linked to their Page so we can identify the account and support content/analytics workflows in Fundhub.
3. Screencasts: still needed for KEEP perms that require upload — **no video files; leave empty**.
4. **Do not Submit** until Chris says submit.

**To re-enable agent clicks later:** Chrome remote-debug on a logged-in profile the MCP can attach to (Default profile blocks remote debugging on Chrome 151).


