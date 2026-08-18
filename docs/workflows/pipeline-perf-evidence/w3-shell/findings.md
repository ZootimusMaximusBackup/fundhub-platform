# W3 — pipeline.html front-end script: fetch chain and render cost

Read-only pass. No application code was changed.

Files read in full: `public/app/pipeline.html` (1790 lines), `public/app/shell.js`
(1835 lines), `public/app/data.js` (the `get`/`pipeline` path), `public/app/proxy-apply.js`,
`public/app/chat-widget.js` (mount path only).

---

## Headline

**The board is not slow. It never loads.**

`public/app/pipeline.html:1772` throws `ReferenceError: FHData is not defined`
before the line that fetches the board (`:1773`) ever runs. Zero
`/api/dashboard/pipeline` requests leave the browser on page load. The board sits
on "Loading the board…" until the person clicks a rail tab, which is a second code
path that does work.

Reproduced in real Chromium against a stub API — see "Evidence" below. Confirmed
present on live: `curl https://fundhub.ai/app/pipeline.html` returns the same
`<script defer src="data.js">` at line 980 and the same `loadRailCounts("R-01")` at
line 1772.

### How it broke

Commit `f23ced1` ("Speed up CRM screens: defer shell scripts, cut fonts, hold card
space", 2026-08-17) changed:

```
-<script src="data.js"></script>
+<script defer src="data.js"></script>
```

at `public/app/pipeline.html:980`.

A `defer` script does not execute until the whole document has been parsed. The
inline script immediately below it (`:982`-`:1774`) is not deferred — it executes
the moment the parser reaches it. Its last two statements are:

```
1772	  loadRailCounts("R-01");
1773	  load("R-01", "Sales");
```

`loadRailCounts` calls `FHData.pipeline(key)` at `:1752`. `FHData` is defined in
`data.js`, which has not run yet. The throw escapes the `forEach`, escapes the
IIFE, and `load("R-01", "Sales")` on the next line is never reached.

`window.FHPipelineBoard` was already assigned at `:1763`-`:1770`, before the throw,
which is why a rail-tab click (`:945`-`:955` -> `:953`) still works: by then
`data.js` has run.

Verified in Chromium that `defer` really does run after an inline script and before
`DOMContentLoaded`.

---

## 1. The startup fetch chain

### What fires today (as shipped on `main` and on live)

| # | Fetch | Fired from | Awaited before the next? |
|---|---|---|---|
| 1 | `/api/auth/session` | `shell.js:886` (kicked at `shell.js:912`) | no — fire and forget |
| 2 | `/api/health` | `shell.js:920`, called from `mountChip` at `shell.js:1507` | waits on #1 only |
| 3 | `/api/org-brand` | `shell.js:1605` (`applyBrand`, `shell.js:1826`) | waits on #1 only |
| 4 | `/api/demo/mode` | `shell.js:1732` (`mountDemoBanner`, `shell.js:1828`) — **owner/admin only** | waits on #1 only |

Measured order, local Chromium, stub API (ms after navigation start):

```
   71  /api/auth/session
  196  /api/health
  196  /api/org-brand
  196  /api/demo/mode
PAGEERROR: FHData is not defined
board: 0 cards, "Loading the board…", every rail count "—"
```

**Round trips to first card today: infinite. The card fetch is never made.**

### What fires once the ordering fault is fixed

Measured with `defer` removed from `:980` (everything else untouched):

```
   44  /api/dashboard/pipeline?key=funding_card_stacking
   44  /api/dashboard/pipeline?key=funding_altfin
   45  /api/dashboard/pipeline?key=optimization
   45  /api/dashboard/pipeline?key=inquiry_removal
   45  /api/dashboard/pipeline?key=ar_collections
   45  /api/dashboard/pipeline?key=affiliates_white_label
   45  /api/dashboard/pipeline?key=hiring
   45  /api/dashboard/pipeline?key=sales      <-- the only one on screen, requested LAST
   74  /api/auth/session
  554  /api/health
  554  /api/org-brand
  554  /api/demo/mode
  839  first card in the DOM
```

Sources: `loadRailCounts` at `:1748`-`:1759` (fires seven, one per non-active rail,
from the `Object.keys(PIPELINE_KEYS)` loop at `:1749`); `load` at `:1718`-`:1740`
(fires the eighth, the one actually drawn, via `FHData.pipeline(key)` at `:1731`).

### The serial chain

**There is no serial chain.** Nothing on this page waits for a previous response
before asking for the next.

```
first card = 1 round trip:   GET /api/dashboard/pipeline?key=sales   -> paint
```

`FHData.pipeline` (`data.js:182`) is a single `get()` (`data.js:91`). `get()` reads
the token straight out of `localStorage` synchronously (`data.js:53`-`:55`) — no
session call, no `/me`, no config fetch, no partner id lookup. The board fetch and
the session fetch are independent and fire within 30ms of each other.

The four shell fetches form a two-deep chain — `session` then
`health` / `org-brand` / `demo-mode` in parallel — but **none of them are on the
critical path to a card**. They paint chrome, not cards.

---

## 2. What could be parallel, what genuinely depends on something

| Fetch | Depends on a previous response? | Verdict |
|---|---|---|
| `/api/dashboard/pipeline?key=sales` | **no** | already first-class parallel; keep |
| `/api/auth/session` | no | already parallel |
| `/api/health` (`shell.js:920`) | reads only the `demo` flag from the session (`shell.js:1512`) | **could be parallel** with session; saves one hop of chrome, not of cards |
| `/api/org-brand` (`shell.js:1605`) | **no real dependency** — `applyBrand` takes a `staff` argument it never reads (`shell.js:1599` signature is `applyBrand(/* staff */)`) and re-reads the token from `localStorage` at `:1601` | **could be parallel** with session |
| `/api/demo/mode` (`shell.js:1732`) | **yes, genuinely** — gated on `staff.org_id` and `role` (`shell.js:1725`-`:1727`) | must wait for session |
| 7x `/api/dashboard/pipeline` for other rails | no | **should not run at all on load** |

Nothing on this page needs a partner id, org id, or role from a previous response
before it can ask for cards. The board endpoint takes only `key` and derives the org
from the session server-side (`api/dashboard/pipeline.mjs:76`-`:84`).

---

## 3. Once, or per column?

**Once per rail.** `/api/dashboard/pipeline?key=<pipeline>` returns every stage with
its cards nested inside (`api/dashboard/pipeline.mjs` `STAGES_SQL` + `CARDS_SQL`,
joined in JS at `:88`-`:129`). There is no per-stage loop and no per-column fetch.
`load()` at `:1731` makes exactly one call and `paint()` at `:1657` builds every
column from that one response.

**But eight rails are fetched when one is shown.** `loadRailCounts` (`:1748`) pulls
the *full board* — every stage, every card, up to the 500-row default
(`api/dashboard/pipeline.mjs:76`) — for all seven rails the user is not looking at,
purely to write one integer into a tab badge at `:1755`. Each response is discarded
except for its `count`, and the card arrays are held in `cache` at `:1754`.

At the 500-card default that is roughly 4,000 card records parsed and retained on
every page load to render 8 numbers.

---

## 4. Render cost

**Not the problem. Measured 27ms for 2,000 cards.**

How cards reach the DOM:

* `paint()` `:1657`-`:1666` — full teardown of the board
  (`while (board.firstChild) board.removeChild(board.firstChild)` at `:1658`), then
  one `board.appendChild(buildColumn(...))` per stage at `:1661`.
* `buildColumn()` `:1624`-`:1653` — builds the column **detached**, appends every
  card into `body` at `:1643` before the column is attached. Correct pattern: one
  attach per column, so at most 6-8 layout invalidations for the whole board, not
  one per card.
* `cardEl()` `:1051`-`:1115` — `createElement` + `textContent` throughout. No
  `innerHTML` anywhere on the card path.
* Two listeners per card: DEL at `:1071`, card body at `:1109`. At 2,000 cards that
  is 4,000 listeners. Measured harmless.

Complexity on the load path is **O(n)** in cards. There is no `.find()` or
`.filter()` over all cards inside a loop over all cards, and no sort on load.

Small waste, all trivial:

* `applyBoard` `:1684` and `:1685` call `fhPipelineSummary(stages)` twice on the
  same array — O(stages), negligible, but it is the same work done twice.
* `rebuildOwnerOptions()` `:1686` -> `:803` re-queries the whole board
  (`cards()` at `:560`) and does a `querySelector('.c-act b')` per card. O(n), runs
  once per paint.
* `rebuildOwnerOptions()` also runs once at `:818` against a board that is still
  empty. Harmless, but it is a full DOM sweep for nothing.

O(n^2) work that exists but is **not** on the load path (user-triggered only):
`applyFilters` `:829` (O(n) per keystroke), `applySort` `:842` (O(n log n) per
column, on `change`), `colUnder` `:669` (O(columns) per `pointermove` during a drag),
`runArchive`'s cache rewrite `:1520`-`:1528` (O(rails x cards), on archive).

Measured, local Chromium, stub API at 400ms, rail prefetch off:

| Cards | Response arrives | First card in DOM | Delta |
|---|---|---|---|
| 498 | 472ms | 479ms | **7ms** |
| 1,998 | 426ms | 453ms | **27ms** |

Every card lands in a single mutation batch — the whole board is built in one
synchronous pass.

---

## 5. Wasted work

1. **Seven full boards fetched and thrown away** — `:1748`-`:1759`. Biggest item by
   far. See section 3.
2. **`proxy-apply.js` is dead on this page and it blocks the parser.**
   `:981` loads it with no `defer` and no `async`, so the HTML parser stops until
   14KB has downloaded and executed — immediately before the board script. Its only
   consumer on this page is `window.FHProxyApply.applyToLender` at `:1188`, inside
   `showLenderMatches` (`:1118`), **which is never called** — no reference to
   `showLenderMatches` exists anywhere else in the file. The
   `/api/read/lender-matches` fetch at `:1151` is likewise unreachable.
3. **The static sidebar is built and then discarded.** `pipeline.html:307`-`:373`
   ships ~66 lines of hand-written nav markup; `shell.js:701` replaces the whole
   `<aside>` with `SIDEBAR_HTML` (`shell.js:31`).
4. **`crm-sidebar.css` is requested twice.** `pipeline.html:11` links it with no
   `id`; `shell.js:597` guards on `getElementById("fh-crm-sidebar-css")`, misses,
   and injects a second `<link>` to the same file at `:598`-`:603`.
5. **A 1Hz timer starts before first paint.** `:1786` runs `tickClock` immediately
   and `:1787` sets a 1-second `setInterval`. Each tick does an
   `Intl`-backed `toLocaleString` with a timezone (`:1780`-`:1784`). Small, but it
   is the only polling on the page and it starts during load.
6. **`chat-widget.js` (15KB) is injected after the session resolves**
   (`shell.js:1638`-`:1644`). It makes no fetch on mount — `/api/chat/peers`
   (`chat-widget.js:196`) only fires when the user opens internal-message mode. It
   is download and parse cost only.
7. Nothing is fetched twice. The four shell endpoints fire once each.

---

## 6. Blocking work in `<head>`

* `:9` — `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?...">`.
  Render-blocking, cross-origin. `preconnect` at `:7`-`:8` softens the handshake but
  the page still cannot paint until a third-party stylesheet returns. This is the
  only genuinely render-blocking resource in `<head>`.
* `:10`, `:11` — two local stylesheets, render-blocking but same-origin and small
  (16KB + 11KB).
* `:12`-`:300` — 288 lines of inline `<style>` (~14KB). Parsed inline, no request.
* `:301` — `<script defer src="shell.js">` (95KB). Correctly deferred by `f23ced1`;
  it no longer blocks the parser. It does inject a `.navitem{visibility:hidden}`
  style at `shell.js:586`-`:589`, which hides nav rows until the role is known —
  deliberate, owner-set 2026-08-05 (`shell.js:580`-`:585`).

The `<head>` is not the problem.

---

## 7. Does the page gate rendering on the slowest call?

**No.** There is no `Promise.all` anywhere in `pipeline.html`, and none on the
critical path in `shell.js`. `load()` at `:1731` paints as soon as its own response
lands — `applyBoard` at `:1735` runs inside that one `.then`. The board does not
wait for the session, health, brand, or demo-mode calls.

The one real gate is accidental, not architectural: on HTTP/1.1 the sales fetch is
request **#8 of 8** (issued at `:1773`, after the seven at `:1772`), so the browser's
six-connection-per-origin limit parks it behind the rail prefetch. Measured locally:
first card at **839ms** with the prefetch on versus **479ms** with it off — a
**360ms penalty on a 400ms API**, entirely from queueing.

**Caveat, stated plainly:** live is HTTP/2 (`curl` reports `protocol=2`), where the
six-connection limit does not apply. That specific 360ms is a local-repro artifact.
What survives on production is eight identical heavy reads hitting one function and
one Postgres pool at the same instant, with the one the user is waiting on given no
priority. Quantifying that is W2's server-side measurement, not mine.

---

## 8. Owner-specific branches

**In `pipeline.html`: none.** The page does byte-for-byte identical work for every
role. `PIPELINE_KEYS` (`:1668`-`:1677`) is fixed, `load()` and `loadRailCounts()`
take no role, there is no partner list, no staff list, and the Owner filter dropdown
is built from the cards already on screen (`:803`-`:816`), never from a table read.

**In `shell.js`, two owner branches:**

* `mountDemoBanner` (`shell.js:1724`-`:1732`) — returns early unless the role is
  `owner` or `admin` (`:1727`). **Owners pay one extra fetch, `/api/demo/mode`,**
  that other roles do not. Confirmed in the measured waterfall.
* `mountBetaBanner` (`shell.js:1682`-`:1684`) — owner-only, but `pipeline.html` is
  not in `BETA_PAGES` (`shell.js:22`-`:28`), so it returns at `:1684`. No cost.

`allowedFor("owner")` returns every screen, so `gateLinks` (`shell.js:987`) hides
nothing for an owner — same anchor sweep as any other role.

**The owner's real difference is server-side:** the same `key=sales` request returns
every card in the org rather than one closer's. That is `api/dashboard/pipeline.mjs`
and belongs to W2.

---

## Critical path to first card

### As shipped today

```
1. HTML parse reaches pipeline.html:982, inline board script runs
2. it calls loadRailCounts("R-01")            :1772
3. loadRailCounts calls FHData.pipeline(key)  :1752
4. FHData is undefined — data.js is deferred  :980
5. ReferenceError escapes the IIFE
6. load("R-01","Sales") never runs            :1773
7. no /api/dashboard/pipeline request is ever made
```

**Round trips to first card: none possible. The board never fills.**
The user sees "Loading the board…" (`:436`) with every rail count at "—" until they
click a rail tab (`:945`-`:955`), which calls the same loader through
`window.FHPipelineBoard` (`:1763`) after `data.js` has finally run.

### With the ordering fault fixed, as the code otherwise stands

```
1. HTML parse -> data.js runs -> inline board script runs
2. seven /api/dashboard/pipeline requests fire for rails nobody is looking at   :1772
3. one /api/dashboard/pipeline?key=sales request fires, eighth in line          :1773
4. response arrives
5. paint() tears down the board and builds 6 columns / N cards in one pass      :1657
6. first card visible
```

**Round trips on the critical path: 1.** (Eight are issued; only one is needed.)
Measured 839ms with the prefetch, 479ms without, on a 400ms API over HTTP/1.1.

---

## Recommendations, biggest win first

### R1 — Make the board fetch actually run. `pipeline.html:1772`-`:1773`.

Smallest correct diff, keeps the `defer` win from `f23ced1`:

```js
  function boot() { loadRailCounts("R-01"); load("R-01", "Sales"); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
```

Deferred scripts are guaranteed to have executed before `DOMContentLoaded` fires —
verified in Chromium, not assumed.

One-character alternative: delete `defer` from `:980`. Restores exactly the
pre-`f23ced1` behaviour and starts the fetch a few ms earlier, at the cost of making
`data.js` (31KB) parser-blocking again.

**Lines changed:** `pipeline.html:1772`-`:1773` (or `:980`).
**Risk:** low. Nothing else in the file reads `FHData` at parse time — the drawer
path already guards with `typeof FHData !== "undefined"` at `:1453`.
**Note for W4:** the same `defer`-plus-parse-time-call shape may exist on the other
~30 screens `f23ced1` touched. Worth one grep before shipping.

### R2 — Stop fetching seven boards nobody asked for. `pipeline.html:1748`-`:1759`, `:1772`.

Three options, smallest first:

* **Swap `:1772` and `:1773`** so the visible board is requested first. One-line
  move. Fixes the ordering penalty on HTTP/1.1, leaves the 8x server load.
* **Chain it.** Have `load()` return its promise (`:1731` already has one) and run
  `loadRailCounts` from that `.then`. The visible board gets the connection and the
  database to itself; counts fill a moment later.
* **Delete `loadRailCounts` and its call.** Tab counts stay "—" until clicked, which
  is the honest-unknown rule the file already follows for `sumHeld` (`:411`) and
  `setSummary` (`:1014`). Biggest win, but it changes what the owner sees — his call.

**Lines changed:** `:1772`, and `:1748`-`:1759` for options 2/3.
**Risk:** low for options 1 and 2; option 3 is a visible product change.
**Better still, and W2's to size:** a counts-only shape for this endpoint. Eight
`SELECT count(*)` are not eight 500-row card payloads.

### R3 — Drop the parser-blocking dead script. `pipeline.html:981`.

`proxy-apply.js` is only reachable through `showLenderMatches` (`:1118`), which
nothing calls. Either delete the tag, or add `defer` to it. Deleting removes 14KB and
one parser stall from the critical path.

**Lines changed:** `pipeline.html:981`.
**Risk:** low, but confirm the dead-code reading first — if `showLenderMatches` is
meant to be wired up and simply never was, that is a separate bug, and the honest
move is to report the gap rather than delete the loader. `client-control-panel.html:611`
and `lenders.html:58` load the same script and are out of scope here.

### R4 — Small change, small win: the duplicate stylesheet. `pipeline.html:11`.

Add `id="fh-crm-sidebar-css"` so `shell.js:597` finds it and skips injecting a
second `<link>` to the same file.

**Lines changed:** `pipeline.html:11`.
**Risk:** none.

### R5 — Not worth touching unless W1 says otherwise.

The Google Fonts stylesheet at `:9`, the 1Hz clock at `:1787`, the discarded static
sidebar at `:307`-`:373`, and the double `fhPipelineSummary` call at `:1684`-`:1685`
are all real but small. `f23ced1` already cut the font request from nine weights to
four. Leave them.

---

## Evidence

Harnesses saved under `_tools/`. Both serve `public/` from disk and stub `/api/*` —
they touch nothing live and need no credentials.

* `_tools/local-waterfall.mjs` — loads `public/app/pipeline.html` in headless
  Chromium, records the API waterfall and in-page mutation marks. Env flags:
  `FIX=1` removes `defer` from `:980` **in the served bytes only, never on disk**;
  `NORAIL=1` comments out the `loadRailCounts("R-01")` call the same way;
  `CARDS=<n>` sets cards per stage; `API_DELAY=<ms>`.
* `_tools/rail-click-recovery.mjs` — shows 0 cards after load, then 9 cards after a
  rail-tab click.

Measured runs, all local Chromium, stub API at 400ms, six stages:

```
A  as shipped                     0 cards ever      PAGEERROR: FHData is not defined
B  ordering fixed, prefetch on    first card 839ms  8 pipeline requests, sales last
C  ordering fixed, prefetch off   first card 479ms  1 pipeline request
D  as C with 1,998 cards          first card 453ms  response 426ms -> paint 27ms
```

Live confirmation (read-only `curl`, no login): `https://fundhub.ai/app/pipeline.html`
serves `<script defer src="data.js">` at line 980 and `loadRailCounts("R-01")` at
line 1772 — the same bytes as `main`. Protocol is HTTP/2.

## Repo rules

No violations found and none introduced. This page makes no outbound transmission —
every `fetch` targets the app's own `/api/*`, which is outside the
`src/messaging/providers/*` rule. All recommendations are edits to existing lines in
files already under `public/`; no framework, no build step, no new dependency.

## Not verified

* Whether the same `defer`-plus-parse-time-`FHData` shape exists on the other screens
  `f23ced1` touched. Not checked — out of W3's scope, flagged for W4.
* The production cost of eight concurrent board queries against one Postgres pool.
  Local repro cannot measure it; W2 owns it.
* Whether `showLenderMatches` (`:1118`) was meant to be wired to something and the
  call site was lost. It is unreachable as the file stands; why it is unreachable is
  UNVERIFIED.

---

## Addendum — this is not one screen. It is fifteen.

Added after the main pass. Cheap to check once the harness existed, so it was
checked rather than left as a guess.

Thirty screens under `public/app/` carry `<script defer src="data.js">`. Loaded in
headless Chromium against a stub API that answers `{ok:true}` to everything,
**fifteen of them throw `ReferenceError: FHData is not defined` on load**:

```
affiliate.html            documents.html            partner-galaxy.html
agent-editor.html         hiring.html               pipeline.html
client-control-panel.html messaging.html            products-commissions.html
client-portal.html        ops-admin.html            template-editor.html
command-center.html
content-admin.html
contracts.html
```

The other fifteen are clean — they wrap their startup in a `DOMContentLoaded` or
`onReady` guard, so `data.js` has run by the time they touch `FHData`:

```
brand-studio.html   closer-call.html       finance-os.html      present.html      social-studio.html
calendar.html       closer-dashboard.html  inquiry-remover.html sales-floor.html  staff-teams.html
campaign-manager.html company-brain.html   my-numbers.html      subscriptions.html
creative-factory.html
```

`client-portal.html` is on the broken list. That is a **client-facing** screen.

Harness: `_tools/defer-regression-sweep.mjs`. It serves `public/` from disk, stubs
every `/api/*` with a success body, seeds a fake token in `localStorage`, and
collects page errors. It needs no credentials and never touches live.

**Caveat, stated plainly:** a stub API is not production, and this sweep proves only
that the reference throws — it does not measure what each screen loses as a result.
On `pipeline.html` the consequence was traced all the way through (the board never
fetches). On the other fourteen it is UNVERIFIED which feature dies. Each needs its
own look. What is certain is that all fifteen hit the same fault at the same point
in load, from the same commit.

The fix shape is identical everywhere — wrap the startup call in a
`DOMContentLoaded` guard, or drop `defer` from that page's `data.js` tag. Fifteen
screens is a batch, not a one-line patch, and it is bigger than the pipeline task
this workflow was opened for.
