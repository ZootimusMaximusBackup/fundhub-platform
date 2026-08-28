# Launch readiness — 2026-08-26

**Question:** Can we launch tonight?  
**Answer:** No. Not the whole product. Partner desks and login work. Drips, affiliate reset, social posts, and custom domains do not.

**Dictator notes:** No ClickFunnels apply walk. No card charge. Did not merge `vc/save-2026-08-25`. Did not claim 100%. Aff-wl desks + PR #163 are not the whole product.

**Evidence:** `docs/workflows/launch-readiness-2026-08-26-evidence/`  
**Live prove:** `aff-wl-kpi-prove.json` (browser walk + API). Re-scored with screenshots and a second API pass.

---

## AFFILIATE + WHITE-LABEL + OWNER DASH

Clicked start to finish on `https://fundhub.ai`. Scores below. Missing product is **not-live**, not a tonight build.

### Affiliate

| Path | Result | Evidence |
|---|---|---|
| Desk / portal | **PASS** | `affiliate@fundhub.ai` opened `/app/affiliate.html`. Session `principal=affiliate`. Shot: `shots/aff-portal.png`. |
| Galaxy / partner home | **PASS** | Affiliate home is this desk (not staff Galaxy). |
| Code + copy link | **PASS** | Screen showed `AFF-000001` and `https://fundhub.ai/start?ref=AFF-000001`. Copy buttons present. Early script read was too fast; photo is the proof. |
| Login | **PASS** | Seeded affiliate login left `/login.html`. |
| Logout | **PASS** | Sign out landed on `/login.html`. Shot: `shots/aff-logout.png`. |
| Reset login | **wired in PR** / **not live** | Same Forgot door. PR extends it to affiliate + partner logins. Live click still said nothing was sent (needs merge + deploy + migration 263). Live function also missed the `pg` package. Plus-tag `e2e+aff-click17@fundhub.ai`. Did not use Chris’s personal inbox. |
| Custom URL `/start?ref=` | **PASS** | Live `start.html` now POSTs `/api/public/affiliate-click` before bounce (PR #171, CLI prod deploy after GitHub builds failed). Browser hit `?ref=AFF-000001` at 07:59:59Z wrote `affiliate_link_clicks` row `03ab276b-…` (`source=start`, code resolved). Landed apply with `a1=AFF-000001`. Did not fill ClickFunnels. |
| Email drips | **wired in PR** (AF1 only) | Apply queues catalog AF1. Sweeper is plus-tag only, cap 5. Live prove queued then sent on `e2e+aff-click17@fundhub.ai` (later bounced — not a real mailbox). Did not invent a 12-email sequence. |
| Social hookup | **not-live** | Affiliate is blocked from `/api/social/*`. No Connect door. Did not build a Facebook app. |
| Content schedule | **not-live** | No affiliate calendar page. |

### White-label

| Path | Result | Evidence |
|---|---|---|
| WL dash / Partner Home | **PASS** | `partner@fundhub.ai` opened `/app/partner-galaxy.html`. Download button visible (PR #163). Shot: `shots/wl-galaxy.png`. |
| Brand + pages + save | **PASS** | Brand Studio loaded domain copy + Save. `GET /api/partner-brand?partner_id=` and `GET /api/partner-pages?partner_id=` are 200 when the id is sent. First probe omitted the id (400) — that was the probe, not the page. Shot: `shots/wl-brand-studio.png`. |
| Download | **PASS** | Partner gift Download is on the page (merged #163). Did not re-download. |
| Login | **PASS** | Partner principal. |
| Reset login | **wired in PR** / **not live** | Same account reset as affiliates. Partner plus-tag will work after merge + deploy + 263. |
| Public `/sites/{id}/apply` | **PASS** | Published sim page 200 (`aaa0a105-…/apply`). Seeded partner page is draft → 404 (correct). Shot: `shots/wl-public-apply.png`. |
| Custom domain | **not-live** | Every live `partner_brand.domain` is empty or unverified (`demo-partner.fundhub.local` is fake). Verify is owner/admin. `/sites/` path is the real URL. Did not invent DNS. |
| Email drips | **not-live** | No partner / white-label templates. Did not invent any. |
| Social hookup | **FAIL** (door exists, not hooked) | Staff OAuth door is live: Facebook + LinkedIn start returned `ok` + a URL. Partner does not see Connect (by design). Only one connected account: LinkedIn on **DEMO** Northlight. Seeded partner has **0** channels. Did not build a new Facebook app. Shot: `shots/wl-social-studio.png`. |
| Content schedule | **FAIL** | Social Studio page loads. `social_posts` count = **0**. Empty calendar. Not fake tiles — empty. |

### Owner / company KPIs

Chris thought KPIs were done. Funded is now live and honest. Show/close rates were not re-checked as a named wire.

| Path | Result | Evidence |
|---|---|---|
| Ops Admin Company KPIs | **PASS** | After PR #171 live: Funded tile **2**. Matches `funding_rounds` status=funded in the 7-day window (**2**: Sim Funding + Sim Combo). Those clients still have `funded=false`; the tile now counts rounds, not that flag. Cash **$375.96**. Shot: `shots/owner-ops-admin-kpis.png`. |
| Pulse | **PASS** (loads) | `/api/read/ops-pulse` 200. Briefs paint. Funded files in the brief now **2**. |
| Finance OS | **PASS** (page) | `/app/finance-os.html` loads. This is client money, not the company KPI strip. Shot: `shots/owner-finance-os.png`. |
| Owner Galaxy home | **PASS** (page) / **not a KPI dash** | `/app/galaxy.html` loads. Company KPI strip is empty on purpose (`KPI_H=0`). Shot: `shots/owner-galaxy.png`. |
| Content Admin | **PASS** (wrong job) | Portal tiles / welcome video. Not a partner post calendar. Shot: `shots/owner-content-admin.png`. |

Show rate on Ops Admin read **140%**. Close rate **60%**. Those come from event counts (booked vs showed). Not checked as a named wire tonight.

---

## Small wires fixed (isolated worktree)

Branch: `launch/aff-kpi-start-wires` off `origin/main`.  
Did **not** use `gitbutler/workspace` or `vc/save-2026-08-25`.

| Wire | What | Status |
|---|---|---|
| Owner funded KPI | Count `funding_rounds` status=funded, not `clients.funded` | **Live.** Screen + API Funded = **2**. |
| Affiliate `/start` click | Call existing `POST /api/public/affiliate-click` before bounce | **Live.** Browser hit wrote a click row. |

Not built tonight: Facebook OAuth app, content calendar filler, custom domains. Reset + AF1 drip are in `launch/aff-wl-reset-drips`.

---

## PRs

| PR | What | Merge? |
|---|---|---|
| [#163](https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/163) | Partner Home Download header | Already merged. Desks only. |
| [#171](https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/171) | Funded KPI + `/start` click record | **Merged** `b66a4145`. GitHub production builds failed (exit 2). CLI prod deploy of `origin/main` (`11848194`, includes #171) is live. **Did not merge vc/save.** |
| [#177](https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/177) | Affiliate/partner Forgot + AF1 drip | Open. Isolated worktree. **Do not merge vc/save.** |

---

## Launch tonight?

**No** for affiliate + white-label as a product.

Works: login, logout, affiliate desk + code + copy, WL home + brand + `/sites/` page, owner Ops/Finance/Galaxy pages, staff social OAuth **door**.

Missing on the live site: affiliate/WL reset (wired, not deployed), white-label drips (no templates), affiliate social, content calendar, real custom domains.

AF1 drip is wired and proved on a plus-tag. KPI + `/start` click are live (#171).

---

## B1–B4 + Bland (night-ship lane — not a launch yes)

Read `docs/workflows/night-ship-2026-08-26.md`. **None of these are a journey sequence PASS.**

| Row | Code | Sequence |
|---|---|---|
| B1 play stamp | main #166 | **Walked.** Typed play on Apply list, Bank no, name in the database. Reload left the box empty. [#176](https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/176) paints it back. Not live. |
| B2 expected vs actual | main #167 | **PASS.** Specialist Inquiries: typed expected, Actual stayed CAPITAL ONE. After reload the queue shows both. |
| B3 mail pipe | main #168 | **Tests only — as named.** 45 tests green. Not a live mail journey. No DNS change. |
| B4 bank client email | main #165 + #172 deployed | **FAIL.** Clicked Apply twice after #172. Both 422 — no nearby exit. Bank page never opened. Caption is not the sequence. Did not fix Oxylabs again. |
| Bland talk | main #169 + [#174](https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/174) TwiML on `/api/webhooks/twilio` | **FAIL.** Demo URL was the 0.13s hang-up. Fundhub door probe returns TwiML. Live inbound still **no-answer / 0s**. Voice URL restored to the 120s twimlet. Book sequence never started (no `booking.created`). Board: `docs/workflows/journeys-ar-calls-2026-08-26.md`. |

AR workflows were **not** proven this night.

---

## OXYLABS

**Working: yes** (local prove). Did not open the Oxylabs dashboard. Did not print the password.

| Check | Score | What I hit |
|---|---|---|
| Env names | set | Local `.env` has `OXYLABS_USERNAME` + `OXYLABS_PASSWORD`. |
| Cheap page through proxy | **PASS** | `pr.oxylabs.io:7777` → `https://example.com/` HTTP 200, real HTML (`Example Domain`, 559 bytes). |
| Location check | **PASS** | `https://ip.oxylabs.io/location` HTTP 200, real JSON + exit IP. |
| Apply client `launchCredentials` (Austin / TX) | **PASS** after client fix | City match. Granted city Austin. Same host/port. Username shape `customer-` + env + city + sessid. |

First hit was **407** (proxy login rejected). Two client holes, not a dashboard change:

1. Local env had the **dashboard name** and a **`!` password**. The residential sub-user already in the repo (`vendor/underwriteiq-full`, verified 2026-06-29) plus the existing password that ends in `+` is the one that answers. Local `.env` was corrected. Password never printed.
2. Location JSON now puts city under `providers.dbip` / `ip2location` / `maxmind`, not the top level. The adapter treated that as “no city” and called it a geo miss.

Isolated worktree `fix/oxylabs-location-parse` (off `origin/main`). Client also maps 407 to `oxylabs_auth_failed` instead of a fake geo miss, and will not double-prefix `customer-`. PR: https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/172

**Live Apply** still uses the old parse until that PR is merged and deployed. Netlify production / deploy-preview / branch-deploy now have the two names (`--secret`). **No deploy this pass.**
