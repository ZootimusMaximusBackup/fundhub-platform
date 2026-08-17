# Perf audit 2026-08-17 — shared board

READ-ONLY audit. Findings only — no fixes, no commits, no branches. Ground truth: `docs/PERF-STANDARDS.md`.
Same discipline as fundhub-perf-auditor (audit-vs-fix-router applies).

## Task list

| Group | Pages | Owner | Status |
|---|---|---|---|
| Ground | build + verify the harness | main | done — verified |
| Funnel | apply.fundhub.ai: /watch, /apply, /book, /thank-you (4 pages) | workflow agent Funnel | done |
| A · sales desk | pipeline, closer-dashboard, closer-call, my-numbers, present, contracts (closer) · sales-floor, calendar (sales_manager) — 8 | workflow agent A | done |
| B · client ops | client-control-panel, messaging, documents, lenders, finance-os, company-brain (funding_advisor) · inquiry-remover (inquiry_specialist) — 7 | workflow agent B | done |
| C · owner watch/admin | command-center, galaxy, ops-admin, staff-teams, products-commissions, subscriptions, hiring, sample-data, agent-editor — 9 | workflow agent C | done |
| D · owner automation/marketing | automations, journeys, template-editor, campaign-manager, social-studio, creative-factory, content-admin — 7 | workflow agent D | done |
| E · portals + public | brand-studio, partner-galaxy (partner) · affiliate (affiliate) · client-portal, consent-capture, payment-success, soft-pull-approve (client) · index (no login) — 8 | workflow agent E | done — 1 page unmeasurable, see note below table |
| Synthesis | merge all groups, rank by seconds saved | main | done |

39 CRM screens + 4 funnel pages audited. 3 Lighthouse runs each, medians reported. Mobile 390×844, Slow 4G + 4x CPU throttle (Lighthouse `devtools` throttling method — literal, not simulated).

**consent-capture.html could not be measured.** Logged in as client@fundhub.ai, the shell's own role table (`public/app/shell.js` `ROLE_TABS.client = ["client-portal.html"]`) client-side-redirects the client role to `client-portal.html` before the page finishes painting — Lighthouse's own trace errored 3/3 runs (`LanternError: missing metric scores`) because the page navigated away mid-measurement. This reads as intended access control, not a bug (consent-capture's own back-links point at staff screens, and shell.js's comment notes the client role has no real session system yet). Flagging per the "absence is the finding" rule rather than reporting numbers that don't describe a real page load.

## Ground — the harness (verified working, both auth and public paths)

Script: `docs/workflows/perf-audit-evidence/_tools/lighthouse-audit.mjs`
Installed locally via `npm install --no-save lighthouse chrome-launcher` (not added to package.json/lockfile). Uses the repo's existing `playwright` for the login step.

```
export LH_AUDIT_STATE_DIR=/private/tmp/claude-501/-Users-zootimusmaximus-fundhub-platform/72f011d4-9636-4851-b7ef-ad11eb42f41f/scratchpad/perf-audit-state
node docs/workflows/perf-audit-evidence/_tools/lighthouse-audit.mjs <url> [--role email] [--slug name] [--runs 3]
```

Real bug caught during Ground verification: reusing one Chrome profile across 3 runs (needed to keep the login token alive) also kept the HTTP cache warm — a CRM screen briefly measured 5KB total instead of ~161KB. Fixed by clearing only the HTTP cache (`Network.clearBrowserCache` via CDP) between runs, leaving `localStorage`'s `fh_token` alone. All numbers below are post-fix.

Evidence per page: `docs/workflows/perf-audit-evidence/<slug>/summary.md` + `summary.json` + `run-1..3.report.json/html`.

## Budgets (docs/PERF-STANDARDS.md)

| Surface | LCP | INP(TBT proxy) | CLS | TTFB | Total JS | Total page |
|---|---|---|---|---|---|---|
| Funnel (VSL, apply, book) | <2.0s | <200ms | <0.1 | <600ms | <300KB | <1.5MB |
| CRM screens | <2.5s | <200ms | <0.1 | <600ms | <500KB | <2MB |
| Login/portal entry | <1.5s | <200ms | <0.1 | <400ms | <200KB | <1MB |

Severity: **CRITICAL** = funnel page over budget (direct ad-spend leak) · **HIGH** = CRM page 2x over budget, or a render-blocking resource in `<head>` · **MEDIUM** = single budget miss with a clear cause · **LOW** = polish under budget.

---

## Findings, ranked by estimated impact

Rows 1–2 aren't "seconds saved" — they're total loss of the traffic that hits them, ranked above every time-based finding for that reason, per PERF-STANDARDS' own framing that the funnel budget exists because "every 1s of load costs ~7-10% of conversions... you already paid for those clicks." A dead page or a video nobody sees is a worse version of that same leak.

| # | Page(s) | Metric | Budget | Measured | Cause | Evidence | Severity |
|---|---|---|---|---|---|---|---|
| 1 | funnel-book (`apply.fundhub.ai/book`) | Page loads at all | 200 OK | **404 Not Found**, 3/3 Lighthouse runs errored, confirmed with `curl -I` (`/book` and `/book/` both 404) | Dead route on live. Owner 2026-08-17: **WONTFIX** — ClickFunnels allows one slug per step, nothing links to `/book`, canonical booking URL is `apply.fundhub.ai/funding-book-call`. Do not rename that slug. | `docs/workflows/perf-audit-evidence/funnel-book/summary.md`, `run-1.report.json` (`runtimeError.code=ERRORED_DOCUMENT_REQUEST`) | **WONTFIX** |
| 2 | funnel-watch VSL | Mobile autoplay | Video autoplays muted on load | Video starts, **self-pauses ~1.4s into a 207s clip**, reproduced 2x. `muted`/`playsinline`/`autoplay` attributes are all correctly present the whole time — this is not an attribute bug. | Root cause: the video is served `Content-Type: video/quicktime` (raw `.mov`, S3 even sets `Content-Disposition: attachment`) instead of `video/mp4`. `video.canPlayType('video/quicktime')` returns `""` — Chrome reports the format unsupported, so autoplay silently halts after a grace period even though the codec itself decodes fine (`.play()` called manually resumes instantly). Breaks the VSL for all Android/Chrome mobile — the largest mobile segment. | `docs/workflows/perf-audit-evidence/funnel-watch/summary.json` (`extra.video`); live repro: `canPlayType` empty, `paused===true` at `currentTime≈1.4s` (2x); S3 response headers `content-type=video%2Fquicktime`, `content-disposition=attachment` | **CRITICAL** |
| 3 | funnel-apply (`apply.fundhub.ai/apply`) | LCP, Total JS | <2.0s LCP, <300KB JS | **INVALID — measurement artifact, not a defect.** A real visitor (incognito, headed browser) sees the survey form, step 1 of 2, and does not redirect. The recorded **LCP 3.77s / Total JS 649KB belong to `/funding-book-call`**, not `/apply`. | ClickFunnels bot-stamps headless visitors (`cfhoy_visitor=bot-481896`, fake “Test User” cookies) as already completed and follows the real survey-done link (`survey_end_href` → next funnel step `/funding-book-call`). Speed-test / headless runs hit that path; people do not. See row 24 if we want the book-call page measured on its own URL. | `docs/workflows/perf-audit-evidence/funnel-apply/summary.json` (`extra.finalUrl` = `/funding-book-call`); owner confirmed incognito 2026-08-17 | **INVALID** |
| 4 | 27 CRM/portal screens *(pattern — see list below)* | Render-blocking `<head>` script | 0 render-blocking JS in `<head>` | `shell.js` (~26KB, sometimes + `data.js`) loaded as plain `<script src>` in `<head>`, no async/defer, on **27 of 39 CRM screens** — one shared file, one shared root cause | `shell.js` is the app-wide sidebar/nav chrome, loaded synchronously before the browser can keep building any of these pages. Fixing this one file (add `defer`) benefits all 27+ screens at once — likely the single best effort-to-impact fix in this whole audit. **Pages:** client-control-panel, messaging, documents, lenders, finance-os, company-brain, inquiry-remover (B) · command-center, galaxy, ops-admin, staff-teams, products-commissions, subscriptions, hiring, sample-data, agent-editor (C) · automations, journeys, template-editor, campaign-manager, social-studio, creative-factory, content-admin (D) · brand-studio, partner-galaxy, affiliate, client-portal (E) | each page's `summary.json` → `extra.headBlockingScripts`; confirmed by reading live `<head>` markup on all 27 URLs | **HIGH** |
| 5 | pipeline, closer-dashboard, closer-call, my-numbers, present, contracts, sales-floor, calendar (group A, 8 pages) | LCP + render-blocking `<head>` chain | <2.5s LCP; 0 render-blocking resources | **pipeline LCP 2.54s median** (2 of 3 runs over 2.5s) · sales-floor 2.11s · Lighthouse's `render-blocking-insight` flags **1,020–1,240ms estimated savings on every one of the 8 pages** | Same root pattern as #4, but here the chain is worse and fully quantified: `fonts.googleapis.com` Inter+JetBrains Mono stylesheet (~1,300ms blocking, identical URL every page) **plus** un-deferred `shell.js` (25.6KB), `data.js` (9.3KB), `fundhub-brand.css`, `crm-sidebar.css` — none async/defer/preload. Top render-blocking item on all 8. | `docs/workflows/perf-audit-evidence/pipeline/summary.md`; `run-1.report.json` → `audits['render-blocking-insight']` in each of the 8 folders | **HIGH** |
| 6 | funnel-watch | Total page weight, LCP | <1.5MB total, <2.0s LCP | **3,229KB total** (2.15x over) · LCP 2.25s (12% over) | The hero VSL alone transfers **~2.6MB** as a full-resolution `.mov` streamed straight off S3 — no web-optimized mp4 transcode, no mobile bitrate variant. One asset bigger than the entire funnel page budget. Fixing the same codec issue as #2 (transcode to mp4) very likely fixes this too. | `docs/workflows/perf-audit-evidence/funnel-watch/summary.json` (`median.totalBytes`=3,229,263; `byTypeMedianRun.media`=2,645,810B / 3 requests) | **CRITICAL** |
| 7 | client-portal (group E) | LCP | <2.5s | **4.04s median** (4,038–4,157ms across 3 runs) — largest single-page LCP miss in the whole CRM audit | The LCP element is the chat widget's first message bubble, not real page content. `chat-widget.js` finishes loading at ~2.6s under throttle, then a **hardcoded `setTimeout(..., 1400)`** in `chat-widget.js` (~line 333) deliberately delays auto-opening the chat panel "so it feels like an alert." That 1.4s design delay is ~all of the LCP overage — Lighthouse's `lcp-breakdown-insight` attributes 3,577–4,157ms of the total to `elementRenderDelay` (TTFB is only 42–464ms). Trivial fix, large number. | `docs/workflows/perf-audit-evidence/client-portal/run-1..3.report.json` (`audits['lcp-breakdown-insight']`); `public/app/chat-widget.js` ~line 333 (`popMs` default 1400) | **MEDIUM** *(1.62x over budget — under the 2x HIGH threshold, but the largest raw-second miss found)* |
| 8 | funnel-watch, funnel-apply(redirect target), funnel-thankyou | Render-blocking `<head>` scripts | 0 render-blocking JS in `<head>` | 3 plain blocking `<script src>` (jQuery 3.5.1 ~28KB, jQuery-Cookie, lazysizes ~3KB) on every loadable funnel page; redirect target adds a 4th (intl-tel-input) | Shared ClickFunnels header template loads these from cdnjs with neither `async` nor `defer` — confirmed in raw page source on all 3 loadable pages, a template-wide issue. | live `curl -L` `<head>` source on all 3 URLs | **HIGH** |
| 9 | agent-editor (0.914), hiring (0.805), subscriptions (0.662), command-center (0.385), ops-admin (0.212) *(group C pattern, 5 of 9 pages ≥2x over)* | CLS | <0.1 | 0.914 / 0.805 / 0.662 / 0.385 / 0.212 — up to **9.1x over budget** | Dashboard cards/tables paint before their API data returns, then resize once JSON arrives — no reserved space for final content. Same mechanism on every page (`<main>`/`.content`/`.card`). | `docs/workflows/perf-audit-evidence/<slug>/summary.md` CLS row + `run-*.report.json` → `audits['layout-shifts']` | **HIGH** |
| 10 | my-numbers (group A) | CLS | <0.1 | **0.457** (4.6x over) | Single shift, score 0.473, on the entire 3,247px main content container — dashboard numbers load async into unreserved space. | `docs/workflows/perf-audit-evidence/my-numbers/summary.md`; `run-1.report.json` | **HIGH** |
| 11 | finance-os (group B) | CLS | <0.1 | **0.436** | Client detail panel shifts 0.431 of the total as the client list finishes loading — no reserved width/height or skeleton. | `docs/workflows/perf-audit-evidence/finance-os/summary.md`; `run-1.report.json` | **HIGH** |
| 12 | messaging (group B) | CLS | <0.1 | **0.241** | Thread panel (`section.thread-col`) shifts 0.239 of the total as the conversation list populates — no reserved height. | `docs/workflows/perf-audit-evidence/messaging/summary.md`; `run-1.report.json` | **HIGH** |
| 13 | sample-data (0.124), galaxy (0.122) (group C) | CLS | <0.1 | 0.124 / 0.122 (1.2x over) | Same unreserved-space-before-data pattern as row 9, smaller magnitude. | `docs/workflows/perf-audit-evidence/<slug>/summary.md` | **MEDIUM** *(grouped with row 9's cause, split out for the lower multiplier)* |
| 14 | journeys, campaign-manager, social-studio, creative-factory, content-admin (group D, identical shift) | CLS | <0.1 | **0.1252 on all five**, byte-identical shift score | Lighthouse's `layout-shifts` points to the same shared main-content container (`div.app > div.main`) on every page, shifting down by the exact same amount right after first paint — one shared layout component, one fix. | `docs/workflows/perf-audit-evidence/campaign-manager/run-1.report.json` → `audits['layout-shifts']` (and equivalents for the other 4) | **MEDIUM** |
| 15 | brand-studio, affiliate (group E, identical shift) | CLS | <0.1 | **0.1252 on both** (identical to 16 decimals) | The CRM sidebar-lock script injects `crm-sidebar.css` + a `position:fixed` sidebar style *after* content has already laid out, reflowing `div.main`. partner-galaxy is unaffected — shell.js explicitly excludes it from the standard sidebar. | `docs/workflows/perf-audit-evidence/brand-studio/run-1.report.json`, `affiliate/run-1.report.json` | **MEDIUM** |
| 16 | client-portal (group E) | CLS | <0.1 | **0.145** | Different mechanism from row 15 (no CRM sidebar here). Largest shift (0.131) is the "Before your call" card appearing without reserved space, plus the header brand text and the "sample data" demo banner settling in late. | `docs/workflows/perf-audit-evidence/client-portal/run-1.report.json` | **MEDIUM** |
| 17 | inquiry-remover (group B) | CLS | <0.1 | **0.149** | 6 shift events; largest (0.131) is the "QUEUE BY BUREAU" panel filling in as bureau counts populate. | `docs/workflows/perf-audit-evidence/inquiry-remover/summary.md` | **MEDIUM** |
| 18 | closer-dashboard (group A) | CLS | <0.1 | **0.149** | Two shifts: the Deal Funding Calculator panel toggling visible (0.078) and the pipeline list rendering late (0.061). | `docs/workflows/perf-audit-evidence/closer-dashboard/summary.md` | **MEDIUM** |
| 19 | funnel-thankyou | LCP | <2.0s | **2.29s** (14% over) | Same 3 render-blocking head scripts as row 8. Page weight (576KB) is fine — isolated, modest miss. Lower business stakes: this page only loads after the visitor already applied/booked. | `docs/workflows/perf-audit-evidence/funnel-thankyou/summary.md` | **MEDIUM** |
| 20 | galaxy (group C) | TBT (INP proxy) | <200ms | **253ms** | Several 57–113ms main-thread long tasks from the inline script that builds/positions the node visualization stack past budget under 4x CPU throttle. | `docs/workflows/perf-audit-evidence/galaxy/summary.md`; `run-1.report.json` → `audits['long-tasks']` | **MEDIUM** |
| 21 | 27 CRM/portal screens *(pattern — B+C+D+E, same page list as row 4 minus none)* | Inline `style="..."` attribute count | 0 — shared stylesheet only | **10–241 per page** (heaviest: template-editor 241, campaign-manager 195, products-commissions 56, staff-teams 48, documents 48; lightest: journeys 10) | Markup sets `style="..."` directly on elements instead of shared classes/tokens — can't be cached, forces per-element style recalc on every load. Same rule violation everywhere, different volume per screen. | each page's `summary.json` → `extra.inlineStyleCount` | **LOW** |
| 22 | index, brand-studio, partner-galaxy, affiliate, client-portal, payment-success, soft-pull-approve, client-control-panel, messaging, documents, lenders, finance-os, company-brain, inquiry-remover, command-center, galaxy, ops-admin, staff-teams, products-commissions, subscriptions, hiring, sample-data, agent-editor, automations, journeys, template-editor, campaign-manager, social-studio, creative-factory, content-admin *(pattern — 30 pages, every group except A)* | Font weight count | ≤2 families, ≤4 weights total | **9 weights** (Inter 400/500/600/700/800 + JetBrains Mono 400/500/600/700) from one shared Google Fonts `<link>`, **~78–80KB every page**. `font-display:swap` + preconnect are already correctly set, so this is a rule violation, not a budget breach — page weight stays well under 2MB everywhere it was checked. | live `<head>` markup; each page's `summary.json` → `byTypeMedianRun.font` | **LOW** |
| 23 | funnel-watch, funnel-apply, funnel-thankyou | Font loading (FontAwesome) | Preconnect to font host; subset to what's used | **~80KB FontAwesome 5.15.0** (2 files) via blocking `<link rel=stylesheet>`, **zero preconnect** to `use.fontawesome.com` | Full icon library pulled for what looks like a couple of glyphs — funnel-watch's own "tap for sound" icon is already inline SVG, not even using this library. No preconnect costs a full extra DNS+TLS round trip on cold mobile. Distinct from row 22 — different font stack, and unlike row 22 this one is missing preconnect. | live `<head>` source, all 3 pages | **LOW** |
| 24 | funnel-book-call (`apply.fundhub.ai/funding-book-call`) | LCP, Total JS | <2.0s LCP, <300KB JS | **Not yet measured on this URL.** Row 3's 3.77s LCP / 649KB JS were captured after a bot skip onto this page — do not treat those as `/apply` numbers. Re-run Lighthouse against `/funding-book-call` directly (headed / non-bot) if we want a real score. | Opened when row 3 was marked INVALID. Calendar widget + pixels live here; that weight is this page's, not the survey's. | none yet — do not reuse `funnel-apply/` evidence | **UNMEASURED** |

### Not ranked — access gap, not a perf finding

**consent-capture.html** — could not be measured under the client role; see note above the findings table.

---

## Total footprint of the two pattern fixes

Rows 4 + 5 together mean **35 of 39 CRM/portal screens** (all but command-center's sibling set... — precisely: the 27 in row 4, plus A's 8) carry the same root defect: `shell.js` (and on some screens `data.js`) blocking `<head>` with no `async`/`defer`. One shared file, one line-level fix, benefits nearly the entire staff-facing app on every load, every day. This is the highest-leverage fix in the audit regardless of the "rank by seconds, not ease" rule — the seconds saved are real and they multiply by every screen and every login.

---

## Fixer stamps — 2026-08-17

Code is in this repo. Live speed numbers land after deploy. Funnel rows live in ClickFunnels — this repo cannot paste into that editor.

| # | Stamp | What happened |
|---|---|---|
| 1 | **WONTFIX** | Left alone. Owner already closed it. Booking URL stays `apply.fundhub.ai/funding-book-call`. |
| 2 | **SHIPPED-FILE / CF-SRC-OPEN** | `https://fundhub.ai/funnel/vsl.mp4` is live and served as `video/mp4`. The watch page in ClickFunnels still plays the old `.mov` from ClickFunnels storage. Change the video `src` in the ClickFunnels watch fragment to `https://fundhub.ai/funnel/vsl.mp4`. Do not touch the booking slug. The mp4 on disk is 22MB — bigger than the 1.5MB page budget, so row 6 stays open even after the src swap unless a smaller mobile file is made. |
| 3 | **INVALID** | Left alone. Real people see the survey. Speed tests get sent to the book-call page. |
| 4 | **FIXED** | Every CRM `shell.js` / `data.js` tag is now `defer`. One pattern, 35 screens. Lint clean. Screen tests 175/175. Live check after deploy: page source must show `defer` on `shell.js`. |
| 5 | **RECHECK-AFTER-DEPLOY** | Pipeline was 2.54s (just over). Same font + script chain as rows 4 and 22. Recheck live LCP after those land. |
| 6 | **CF / ASSET** | Same as row 2. The live watch page still pulls the `.mov`. The mp4 we host is `video/mp4` but 22MB. Needs a smaller mobile mp4 in ClickFunnels, not a code change here. |
| 7 | **OPEN** | Client portal chat still waits 1.4s on purpose before it pops. Not part of the three named patterns. Left alone. |
| 8 | **CF** | Watch / apply / thank-you still load jQuery, jQuery-Cookie, and lazysizes in the ClickFunnels header with no `defer`. This repo does not own that header. In ClickFunnels: page settings → header scripts → add `defer` (or drop the ones the page does not use). |
| 9 | **FIXED** | Agent Editor, Hiring, Subscriptions, Command Center, Ops Admin: cards now hold their height before the numbers arrive. Hiring also paints the five summary cards on first draw instead of an empty row. |
| 10 | **FIXED** | My numbers: big number and team panels keep their height before the API fills them. |
| 11 | **FIXED** | Finance OS: the client file area is held at 480px so the page does not jump when the file lands. |
| 12 | **FIXED** | Messaging: the thread column is held at 60% of the screen height. |
| 13 | **FIXED** | Sample data content area held at 640px. Galaxy left as-is (the leftover 0.122 is the same small shared shift as row 14). |
| 14 | **OPEN** | Journeys / Campaigns / Social / Creative / Content all shift by the same 0.1252. That is the yellow beta bar inserting after first paint. Not the empty-card pattern. Left for a later pass. |
| 15 | **OPEN** | Brand Studio and Affiliate — same 0.1252 beta-bar shift as row 14. |
| 16 | **OPEN** | Client portal "Before your call" card starts hidden, then appears. Different from the empty-card pattern. Left alone. |
| 17 | **FIXED** | Inquiry Remover bureau chips now keep a 72px height so the counts do not shove the page. |
| 18 | **OPEN** | Closer Dashboard shift is the deal calculator turning on, not an empty card. Left alone. |
| 19 | **CF** | Thank-you LCP 2.29s. Same three ClickFunnels header scripts as row 8. Fix there. |
| 20 | **RECHECK-AFTER-DEPLOY** | Galaxy main-thread work. Recheck after the font + script cut. Not a separate rewrite this pass. |
| 21 | **OPEN** | Inline `style=` on 30 pages. That is a rewrite, not a one-line pattern. Left alone. |
| 22 | **FIXED** | CRM Google Fonts cut to four weights: Inter 400/600 and JetBrains Mono 400/500. Brand paint in `shell.js` uses the same four. |
| 23 | **CF** | FontAwesome 5.15 still loads from `use.fontawesome.com` on watch / apply / thank-you with no preconnect. ClickFunnels header. Add a preconnect there, or drop the library — the tap-for-sound icon is already an inline picture. |
| 24 | **UNMEASURED** | Book-call page still needs its own headed speed run. Headless hits get stamped as bots and skipped. Not run this pass. |
