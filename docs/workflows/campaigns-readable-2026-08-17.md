# Campaigns — make it readable (2026-08-17)

**Owner ask:** Campaigns looks bad and reading it doesn't tell you what's going on.
Most of the screen is explanatory paragraphs about how the screen works. Database and
file references are in the body text — strip that, it's internal documentation, not
product. Refresh the layout so a person can look at it and understand what they're
seeing. Do not invent data. Empty states stay honest.

**Prove:** lint, relevant tests, live capture with a partner selected. Push and deploy.

**Screen:** `public/app/campaign-manager.html` (2,088 lines) — one file, one screen.
**Live:** https://fundhub.ai/app/campaign-manager.html

## Task list

| # | Task | Owner | Status |
|---|------|-------|--------|
| W1 | Copy strip + layout refresh in `campaign-manager.html` | Fixer (main thread) | claimed |
| W2 | Live capture rig + BEFORE shot, partner selected | agent | claimed |
| W3 | Copy brief — every doc paragraph and db/file reference, keep/cut/rewrite | agent | claimed |
| W4 | Baseline lint / types / tests on clean main | agent | done |

**File ownership:** W1 is the ONLY workflow that may edit `public/app/campaign-manager.html`.
W2 writes only under `docs/workflows/campaigns-readable-2026-08-17-evidence/`.
W3 and W4 write only to this board.

## Shared context brief (ground phase, already done)

The visible screen is `public/app/campaign-manager.html` lines ~313–616. Below that is
one big `<script>` block (lines ~618–2088) that renders every table and the detail drawer.

What makes it unreadable today:

* **16 grey `<div class="cap">` blocks** across 7 cards. Each is 2–4 sentences explaining
  how the screen works, what not to trust, and why a number is shaped the way it is.
  Examples on the page right now: "The row is written before the change is sent, then
  stamped when it comes back…", "A blocker is raised for one campaign but listed against
  the connection…", "The first four are added up over the days shown…"
* **A `SCOPE & SOURCES` card** (CM-01) holding a table titled **"Did each panel load?"**
  with Panel / Status / Rows columns. Repair-shop readout, not product.
* Panel status notes rendered from JS (`SOURCE_WORD`, `SRC[].note`) that surface loader
  state as body text.

Cards in order today: CM-00 summary stats · CM-01 scope & sources · CM-02 needs attention ·
CM-03 spend vs ceilings · CM-04 campaign list · CM-06 creative fatigue · CM-07 connections ·
CM-08 action log.

Binding law: `docs/UI-STANDARDS.md` (§6 = all four states required: loading, empty, error,
full — empty must say what will appear and never show fake sample data).

## Manifests

<!-- W2, W3, W4 append here -->

### W3 — copy brief for `public/app/campaign-manager.html`

**Owner: W3 (analysis only). W3 edited no source file. W1 executes this.**

I read all 2,088 lines: the visible HTML (313–616) and every user-visible string built
in JavaScript (618–2088), including the drawer, the panel messages, the source words,
the footer note and every `title=` tooltip.

**Count:** 93 pieces of user-visible text fall in scope. **14 CUT · 49 REWRITE · 30 KEEP AS IS.**
On top of that, about 15 places print a raw database word — one shared fix, listed in its
own short table after the main one.

Rules I used:
* **KEEP** — it stops a reader misreading a number that is on the screen.
* **CUT** — it explains plumbing: what gets written when, which endpoint answers, what
  the loader does, why a field is blank.
* **REWRITE** — a real warning buried in three sentences of mechanism. Replacements are
  under about 12 words.
* Empty states stay honest. Every empty state below still says it is empty. None was
  replaced with cheerful filler and none invents a number.

Text that only lives inside `<!-- -->` or `/* */` comments was left alone, as asked —
with one exception I flag as a finding, not a change.

#### The table

| line | where it shows | exact text (trimmed to 100 chars) | call | replacement if REWRITE |
|---|---|---|---|---|
| 320 | Top bar, currency chip tooltip | `title="Nothing here records which currency an ad account bills in, so no symbol is shown. Amount…` | **REWRITE** | `title="Amounts use the ad account's own currency."` |
| 347 (set 1763–65) | CM-01 scope, `scopeHow` | "Spend is this partner's ads today." / "Pick a partner from the list to see their ads." | **KEEP AS IS** | — |
| 348–351 | CM-01 scope | "This screen shows **one partner at a time**. Nothing on it adds several partners together, and t…" | **REWRITE** | "One partner at a time. These numbers never add partners together." |
| 354–361 | CM-01, the whole "Did each panel load?" table (Panel / Status / Rows) | "Did each panel load?" | **CUT** | — (see note A below) |
| 363–367 | CM-01 grey cap | "**Nothing on this screen is made up.** A panel that could not be loaded says so and stays empty…" | **CUT** | — |
| 375 | CM-02 header badge | "each tile is a real filter" | **CUT** | — (it is also untrue — finding F1) |
| 380–383 | CM-02 grey cap | "These are counts of real rows, not scores. Clicking a tile filters the panel it came from and ju…" | **REWRITE** | "Click a tile to jump to that panel." |
| 404–409 | CM-03 grey cap 1 | "**This is our own copy of today's spend, not the ad platform's.** A green row is not proof that…" | **REWRITE** | "Green means our own copy looks fine. Only breached checks the ad platform." |
| 410–414 | CM-03 grey cap 2 | "**Do not add these rows up.** A partner limit, a platform limit and a campaign limit can all cou…" | **REWRITE** | Keep as one short line: "Do not add these rows up — limits can count the same money." Move the headroom half under the Headroom column head: "Stops at zero. Overspend shows as over 100%." |
| 415 / 837–838 | CM-03 grey cap (when a panel failed) | "How many campaigns have no daily limit of their own is not known — one of the two panels behind…" | **REWRITE** | "This count needs two panels. One did not load." |
| 415 / 839–843 | CM-03 grey cap (normal) | "3 of 9 campaigns have no daily limit of their own and so appear nowhere above. They are still co…" | **REWRITE** | "3 of 9 campaigns have no limit of their own. Partner and platform limits still cover them." |
| 432 | CM-04 Sync Meta button tooltip | `title="Pull campaigns, ad sets, ads, and spend from Meta Marketing API"` | **REWRITE** | `title="Pull campaigns, ad sets, ads and spend from Meta."` |
| 449–453 | CM-04 grey cap 1 | "**Spend here is yesterday's, on purpose.** Today's is only part of a day, and a list judged on i…" | **REWRITE** | "Spend here is yesterday's. Today is only part of a day." |
| 454–458 | CM-04 grey cap 2 | "**Status** is the ad platform's own word for the campaign and **Synced** is when we last pulled…" | **REWRITE** | "Status and Synced stay blank until you press Sync Meta now." |
| 484–489 | CM-06 grey cap 1 | "**The recommendation is the optimiser's, not this screen's.** It sends back one word — refresh,…" | **REWRITE** | "Unconfigured means the rotation rules are switched off for this partner." |
| 490–494 | CM-06 grey cap 2 | "**An ad missing from this table is not a healthy ad.** Only ads with activity in the window are…" | **REWRITE** | "Only ads that ran in this window are listed." |
| 514–519 | CM-07 grey cap 1 | "**Whether a campaign may go live is decided by the system, not on this screen.** The connection…" | **REWRITE** | "Fix these in the platform's own Business Manager, not here." |
| 520–523 | CM-07 grey cap 2 | "**No password or access key is ever shown here** — only whether one is stored and when it runs o…" | **REWRITE** | "A blank expiry means we do not know, not forever." |
| 524–529 | CM-07 grey cap 3 | "**A blocker is raised for one campaign but listed against the connection**, so the same blocker…" | **REWRITE** | "The same blocker can show more than once." |
| 572–576 | CM-08 grey cap 1 | "**There are four outcomes and no others:** done, failed, undone, or written down but never carri…" | **REWRITE** | "Nothing here retries. Never carried out stays that way." |
| 577–581 | CM-08 grey cap 2 | "**Every kill switch row says "never carried out" — that is how it is written down, not what happ…** | **REWRITE** | "Kill switch rows say never carried out. The stop did happen." |
| 582–586 | CM-08 grey cap 3 | "**The row is written before the change is sent**, then stamped when it comes back. That is why "…" | **CUT** | — ("nothing here can be edited or deleted" already prints in the footer at line 1247) |
| 587–591 | CM-08 grey cap 4 | "**"Revertible" is a flag, not a button.** Nothing on this screen can undo an action. Rows from t…" | **REWRITE** | "Revertible is a label, not a button. Nothing here undoes anything." |
| 599 (set 1969, 2011) | Page footer | "nothing loaded yet" / "3 of 5 panels loaded" | **KEEP AS IS** | — |
| 809 | CM-03 breached badge tooltip | `title="The kill switch stopped spending when this limit was hit. It reads the ad platform direc…` | **REWRITE** | `title="Spending was stopped when this limit was hit."` |
| 813 | CM-03 % of ceiling cell | "no meter · limit is 0" | **REWRITE** | "limit is 0" |
| 826 | CM-03 empty state | "No daily limit matches this filter. That is not the same as "no limits": when a partner has no l…" | **REWRITE** | "No daily limit matches this filter." |
| 905, 913 | CM-00 tile sub-label | "no daily limit set for this partner" | **KEEP AS IS** | — |
| 906 | CM-00 tile sub-label | "the daily limit is 0, so there is no percentage" | **REWRITE** | "the daily limit is 0" |
| 914–915 | CM-00 tile sub-label | "left of a 5,000.00 daily limit · never goes below zero" | **REWRITE** | "left of a 5,000.00 daily limit" |
| 918, 921, 924 | CM-00 tile sub-labels | "yesterday, across 9 campaigns" / "running right now, out of every campaign" / "return on ad spen…" | **KEEP AS IS** | — |
| 997 | CM-04 Disclosure badge tooltip | `title="A credit repair campaign cannot go live until its disclosure is attached."` | **KEEP AS IS** | — real rule, short, compliance-adjacent. Do not touch. |
| 1001 | CM-04 campaign cell | "error from the ad platform · <the platform's own message>" | **KEEP AS IS** | — |
| 1004 | CM-04 platform cell | "cannot be changed here" + `title="Google campaigns can be read here but not changed from here."` | **KEEP AS IS** | — |
| 1018–1021 | CM-04 empty state | "No campaigns yet for this partner. One appears here after **Sync Meta now** pulls the partner's…" | **REWRITE** | "No campaigns yet. Press Sync Meta now to pull them in." |
| 1071–1075 | CM-06 empty state (unconfigured filter) | "Nothing can be marked "unconfigured" here. That only happens when *both* of the optimiser's crea…" | **REWRITE** | "Nothing is unconfigured. The rotation rules are on for this partner." |
| 1109 | CM-07 ad account cell | "no business id" | **KEEP AS IS** | — |
| 1110 | CM-07 ad account cell | "scopes ads_read · ads_management" (or "scopes []") | **CUT** | — raw permission keys, engineer-only |
| 1113 | CM-07 token cell | "expires —  (unknown, not "forever")" | **KEEP AS IS** | — |
| 1114 | CM-07 token cell | "renewal key stored" / "renewal key not stored" | **KEEP AS IS** | — |
| 1122–1125 | CM-07 empty state | "No ad platform is connected to this partner yet. Connecting one is done in the platform's own Bu…" | **REWRITE** | "No ad platform connected yet. Connect one in the platform's Business Manager." |
| 1191–1192 | CM-08 actor cell | "no name recorded" | **KEEP AS IS** | — |
| 1198, 1229 | CM-08 target cell / row detail | "nothing recorded" | **KEEP AS IS** | — |
| 1204 | CM-08 revert badge tooltip | `title="A flag only. Nothing on this screen can undo it."` | **KEEP AS IS** | — |
| 1207–1209 | CM-08 empty state (cost-per-sale filters) | "Nothing here, and there never will be until someone sets a target cost per sale. The rule is swi…" | **REWRITE** | "Nothing here until someone sets a target cost per sale." |
| 1210–1212 | CM-08 empty state (learning filter) | "Nothing here. This rule only ever decides to leave an ad set alone, and a decision to do nothing…" | **REWRITE** | "Nothing here. This rule only ever leaves ad sets alone." |
| 1213–1214 | CM-08 empty state (no actions) | "Nothing has been done to this partner's campaigns yet — by a person or by the optimiser. Entries…" | **REWRITE** | "Nothing has been done to these campaigns yet." |
| 1230 | CM-08 expanded row | label "the numbers at the time" over a raw JSON block | **KEEP AS IS** | — no plain-English version exists; do not invent one |
| 1231–1232 | CM-08 expanded row | label "before → after" over a raw JSON block | **CUT** | — the Change column on the same row already shows this in words |
| 1291 | Drawer chart, one metric empty | "Nothing was recorded for spend in this window." | **KEEP AS IS** | — |
| 1355 | Drawer subtitle | "last 30 days · showing the row from the list — the full record has not loaded" | **REWRITE** | "last 30 days · still loading" |
| 1357–1360 | Drawer, campaign not found | "This campaign could not be shown. Either there is no such campaign, or it belongs to a different…" | **REWRITE** | "This campaign could not be shown." |
| 1371 | Drawer Meta controls hint (on) | "These change this partner's real ad account on Meta. Each one asks you to confirm first, and thi…" | **REWRITE** | "These change the real ad account on Meta. You confirm first." |
| 1372 | Drawer Meta controls hint (off) | "These buttons are off because no partner is selected. Open this screen for one partner first — a…" | **REWRITE** | "Pick a partner first. These need one ad account." |
| 1388–1390 | Drawer header, Special ad category | "Meta only — empty on tiktok is correct, not missing" | **REWRITE** | "Meta only — blank is correct here." |
| 1392 | Drawer header, Daily budget | "a daily amount — there is no total budget and no start or end date" | **CUT** | — the label already says Daily budget |
| 1393 | Drawer header, Approved | "who approved it is not shown here" | **CUT** | — |
| 1398 | Drawer header, Strategy | "the raw name — there is no friendly one yet" | **CUT** | — |
| 1399 | Drawer header, Status | "fills in after Sync Meta now" | **KEEP AS IS** | — |
| 1413 | Drawer ad set badge tooltip | `title="The optimiser leaves an ad set alone while it is still learning."` | **KEEP AS IS** | — |
| 1417 | Drawer ad sets empty | "This campaign has no ad sets." | **KEEP AS IS** | — |
| 1416–1418 | Drawer ad sets, not loaded | "Ad sets have not loaded yet. They come with the full campaign record — the panel list at the top…" | **REWRITE** | "Ad sets have not loaded yet." (the pointer to the panel list dies with that table) |
| 1440–1442 | Drawer recent actions empty | "No action has ever touched this campaign or its ad sets." | **KEEP AS IS** | — |
| 1464 | Drawer error heading | "the ad platform's own words, most recent only" | **REWRITE** | "What the ad platform said" |
| 1466 | Drawer error note | "Only the latest one is kept here. Earlier ones are in the action list below." | **KEEP AS IS** | — |
| 1468 | Drawer targeting heading | "targeting, exactly as it was sent to the ad platform" | **REWRITE** | "Who this campaign targets" |
| 1475 | Drawer ad sets note | "While an ad set is still learning, the optimiser leaves it alone. Those skips are never written…" | **REWRITE** | "The optimiser leaves an ad set alone while it is learning." |
| 1483 | Drawer daily series | "today is only part of a day" | **KEEP AS IS** | — |
| 1490 | Drawer chart empty | "Nothing was recorded for this campaign in this window. That is an empty, not a zero." | **REWRITE** | "Nothing was recorded in this window." |
| 1502 | Drawer totals note | "The first four are added up over the days shown. The last four are averages of each day. These e…" | **CUT** | — the labels above it already say "· total" and "· average" |
| 1512 | Drawer table note | "The same last 14 days as a table — the chart is never the only way to read a number." | **CUT** | — |
| 1519 | Drawer recent actions note | "This is **not** everything that happened. It covers this campaign and its ad sets only — anythin…" | **REWRITE** | "This campaign and its ad sets only. Newest 50." |
| 1544 | Drawer Meta controls message | "Nothing was sent. No partner is selected, so there is no ad account to change." | **REWRITE** | "Nothing was sent. Pick a partner first." |
| 1548 | Drawer budget box | "Enter a daily budget of at least 100 cents." | **KEEP AS IS** | — |
| 1561–1571 | Drawer confirm boxes (stop / start / budget) | "Stop spending on "X" on Meta? Its ads stop being shown and it stops spending. It stays stopped u…" | **KEEP AS IS** | — these spend real money; UI-STANDARDS §5 wants them |
| 1723–1734 | CM-01 source table words (`SOURCE_WORD`) | "loaded" / "loading…" / "nothing loaded — demo session" / "the database could not be reached" / … | **CUT** | — dies with the table at 354–361; nothing else reads it |
| 1761 | CM-01 scope line | "your own partner, set by your sign-in" | **REWRITE** | "your own partner" |
| 1883 | Any panel, failure body | "This is a demo session, so nothing was read from the database." | **REWRITE** | "This is a demo session. Nothing was loaded." |
| 1884 | Any panel, failure body | "You are not signed in for this data, so nothing was read. Sign in and press Reload." | **KEEP AS IS** | — |
| 1885 | Any panel, failure body | "There is no matching record to read here." | **REWRITE** | "There is nothing here to show." |
| 1888 | Any panel, failure body | "The request was turned down, so nothing could be read here. Press Reload to try again." | **REWRITE** | "This could not load. Press Reload to try again." |
| 1889, 1954 | Any panel / staff with no partner picked | "Nothing can be shown until a partner is chosen — this screen reads one partner's book at a time." | **REWRITE** | "Pick a partner to see their ads." |
| 1891 | Any panel, failure body | "The database could not be reached, so nothing could be read here. Press Reload to try again." | **REWRITE** | "We could not reach the data. Press Reload to try again." |
| 1892 | Any panel, failure body | "This could not be read right now. Press Reload to try again." | **KEEP AS IS** | — |
| 1906 | CM-01 source table note | "loaded fine — there is nothing there yet" | **CUT** | — dies with the table |
| 1913 | CM-01 source table note | "render failed: " + the raw JavaScript error | **CUT** | — a programmer's error text on a customer screen |
| 1924 | Any panel, render failure | "This could not be shown. Press Reload to try again." | **KEEP AS IS** | — |
| 1974 | Top banner | "Campaigns — pick a partner to load their ads." | **KEEP AS IS** | — |
| 2005–2007 | Top banner | "Campaigns — nothing has been read yet" / "Campaigns — 3 of 5 panels loaded. <first reason>" | **KEEP AS IS** | — |
| 2008 | Top banner | "Campaigns — every panel loaded from the database" | **REWRITE** | "Campaigns — everything loaded" |
| 2035, 2037 | CM-04 sync hint | "Pick a partner first — this needs to know whose ad account to pull." | **KEEP AS IS** | — |
| 2044 | CM-04 sync hint | "Nothing was sent. No partner is selected, so there is no ad account to pull." | **REWRITE** | "Nothing was sent. Pick a partner first." |
| 2060–2064 | CM-04 sync hint | "Nothing was pulled from Meta. …" / "Pulled in 3 campaigns · 7 ad sets · 20 ads" | **KEEP AS IS** | — |

**Note A — the "Did each panel load?" table.** Cutting it does not cost the honesty
guarantee. Every panel already prints its own plain failure sentence in its own body
(`PANEL_MSG`, lines 1877–1892), and the page footer already counts what loaded
("3 of 5 panels loaded", line 2011). The table is the third copy of the same fact and
the only one written in repair-shop words. This answers **Q1** on this board: cut it,
keep the footer count, keep the per-panel sentences.

#### The raw code words — one shared fix, about 15 places

These are category (b): the database's own words printed straight onto the screen with
their underscores still in. The fix is one small label map used everywhere. The stored
value never changes — only what the reader sees.

| line | where | shown now | show instead |
|---|---|---|---|
| 424–425 | CM-04 Offer picker | `credit_cards`, `credit_repair` | credit cards, credit repair |
| 459–471, 1011, 1385 | CM-04 rail, Approval column, drawer | `awaiting_approval` | awaiting approval |
| 538–541, 1197 | CM-08 Target picker and column | `ad_set`, `creative_asset`, `social_post` | ad set, creative, social post |
| 547–555, 1199 | CM-08 Rule picker and column | `scale_winner`, `cpa_over_target`, `cpa_recovering`, `frequency_bands`, `ctr_below_floor`, `kill_no_conversions`, `kill_switch_ceiling`, `learning_phase` | scale winner, cost per sale too high, cost per sale recovering, shown too often, click rate too low, no sales, daily limit hit, still learning |
| 1013, 1398 | CM-04 Strategy column, drawer | the raw strategy key | same words, spaces not underscores |
| 1119–1120 | CM-07 Connection state / Verification | `needs_verification` | needs verification |
| 1129 | CM-07 Blockers | `connection_not_active`, `verify_business`, `link_croa_disclosure` | connection not active, verify business, attach the disclosure |

The blocker rows already print a plain title and detail next to the code word, so on
those three the code word can simply go.

#### The 5 things a person opening this screen actually wants to know

Every one of these is answerable from data the screen already reads. Nothing here needs
a new number.

1. **Am I about to blow today's limit?** Spend today, headroom left, and percent of the
   partner's daily limit. Plus one word at the top: clear, near, or breached.
   *(from `/spend`; already in CM-00 tiles, CM-03, and the top-bar chip)*
2. **Is anything stopped or blocked right now?** How many daily limits are already hit
   (the kill switch pauses those campaigns), and how many connections cannot launch.
   These two are the only things on the screen that stop money moving.
   *(CM-02 tiles 1 and 3, CM-07)*
3. **Which campaigns are running, and what did they do yesterday?** Name, live or not,
   daily budget, spend yesterday, return on ad spend over 7 days.
   *(CM-04 — this is the biggest table and should be the middle of the page)*
4. **Which ads are wearing out?** How often each ad is being shown to the same person,
   its click rate, and the one-word recommendation: refresh, queue, or ok.
   *(CM-06)*
5. **What changed, who changed it, and did it work?** Time, person or optimiser, what
   the change was, and one of four outcomes.
   *(CM-08)*

**What this means for layout.** Numbers 1 and 2 belong above the fold and should be the
only things there. Number 3 next. Numbers 4 and 5 below. The scope card is not on this
list — it is bookkeeping, and once its grey table is cut, what is left of it (the partner
name) belongs in the top bar next to the partner picker, not in a card of its own.

#### Findings — the screen says things the code does not do

Reporting only. W3 fixed none of these.

**F1 — Two of the four attention tiles do not filter anything.** The badge at line 375
says "each tile is a real filter" and the caption at 380–383 says clicking a tile
"filters the panel it came from". True for tile 1 (`spendState='breached'`) and tile 2
(`logState='failed'`). Not true for tile 3, "Connections that cannot go live", which sets
`connState='all'` (line 952), or tile 4, "Campaigns with an error on them", which sets
`campState='all'` (line 954). Both just scroll. There is no filter value for "cannot
launch" in `CONN_STATES` or for "has an error" in `CAMP_STATES` (lines 771–775), so the
filter does not exist to be set. Click "3 connections cannot go live" and you land on a
table of all connections with nothing narrowed.

**F2 — "Can launch" does not mean the business is verified.** CM-07's caption (514–519)
says a campaign may go live only when "the connection has to be active and the business
verified". In `api/campaigns/connections.mjs`, `can_launch` is `connection_state =
'active'` alone. Business verification only gates the separate `can_launch_credit_offer`
column. So the Can launch column can read **yes** on a connection whose business is
unverified, directly under a caption saying that is impossible.

**F3 — The action log prints money 100 times too big.** Everywhere else the screen divides
cents by 100. The Reason column (line 1200) prints the optimiser's own sentence raw. The
kill switch writes it in `src/optimize/ceilings.mjs` line 180 as
`actual platform spend 15000 exceeded the partner ceiling 10000` — those are cents. A
reader sees 15,000 next to a limit shown as 100.00 in the panel above. Same money, two
scales, no warning.

**F4 — Every kill switch row shows "nothing recorded" for what it touched.** CM-08's
caption at 577–581 explains kill switch rows carefully, but the row it explains has an
empty Target cell. `runKillSwitch` inserts `target_id = c.campaign_id`
(`src/optimize/ceilings.mjs` line 189), and that column is NULL for partner-scope and
platform-scope ceilings — which is most of them. `targetLabel` (1152–1165) then returns
null and the cell prints "nothing recorded".

**F5 — The file's own header comment is out of date.** Lines 230–244 say "READ-ONLY BY
CONSTRUCTION" and "There is no launch, pause, approve, budget-edit, connect-OAuth,
sync-now or revert route anywhere in api/". Both `api/campaigns/write.mjs` (pause, resume,
change budget) and `api/campaigns/sync.mjs` exist and are wired into
`netlify/functions/api.mjs` at lines 486–487. The screen has a Sync Meta now button and
three Meta buttons in the drawer. Not user-visible, so not a table row — but it is a false
statement sitting in the file W1 is about to edit.

**F6 — A small one.** CM-04's caption (449–453) says "there is no today's figure for a
single campaign". CM-03 has a Campaign column and shows spend today against any
campaign-scope limit. Narrowly the caption is right ("only per limit"), but the two
sentences sit two cards apart and read as a contradiction.


### W4 — baseline numbers before W1 touches the screen

**Owner: W4 (measurement only). W4 changed no source file, no test, no config. This board row
is the only thing W4 wrote.**

#### The one line to compare against later

> **BEFORE — no DATABASE_URL, local Mac, commit `7be91a0`, measured on a pristine copy of that
> commit: lint clean · type check does nothing in this repo · `npm test` = 5546 pass / 3 fail /
> 3 skipped, and it stops before it ever opens the 103 database test files.**

If W1's change leaves those numbers alone, W1 broke nothing. **The 3 failures were already there
and have nothing to do with Campaigns.**

#### Where I ran it

| | |
|---|---|
| Commit | `7be91a0` (main) |
| Machine | Chris's Mac, macOS arm64, Node v22.21.1, npm 10.9.4 |
| `DATABASE_URL` | **NOT set.** There is a `.env` file on disk, but nothing loads it — `src/db.mjs` reads the shell only. The database tests confirmed it themselves by printing "no DATABASE_URL". |
| Working folder | A clean unpacked copy of commit `7be91a0` in a scratch folder, **not** the live repo folder. See the warning at the end for why that mattered. |

#### 1. `npm run lint` — PASSES

```
lint: 1283 file(s) and inline script(s) parse clean
```

Exit code 0.

#### 2. `npx tsc --noEmit` — this check does not actually check anything here

Exit code **1**, and all it printed was the tool's own help text — 141 lines of "here are my
options". There is no `tsconfig.json` anywhere in this repo, so the tool is handed no files and
gives up.

There is exactly **one** TypeScript file in the whole repo: `src/lib/rbac.ts`. Pointed at
directly it checks clean (exit 0).

This is not new and it is not a surprise — `.github/workflows/tests.yml` says the same thing in
its own header and deliberately leaves the step out of the build. Recording it so nobody later
reads "tsc: exit 1" as damage W1 did.

#### 3. `npm test` — 3 failures, already there

```
# tests    5552
# suites    418
# pass     5546
# fail        3
# skipped     3
```

Exit code 1.

**Read that number carefully.** `npm test` runs in two halves. The first half is 375 ordinary test
files. The second half is 103 database files. The runner **stops after the first half if the first
half fails** — and it does fail. So the second half never ran at all. Every number above is the
first half only.

The three failures, in plain words:

| # | What the test is called | What it is actually complaining about | Anything to do with Campaigns? |
|---|---|---|---|
| 1 | "no route's gate is left unverified" (`scripts/journeys/generate.test.mjs`) | One route, `gifts/message-blaster`, has a lock on it that the drawing tool cannot recognise, so it cannot draw who is allowed in. | **No.** |
| 2 | "the expected list is exactly what db/ holds" (`src/http/health-migrations.test.mjs`) | The list of database changes in `db/expected-migrations.mjs` is out of date. Fix is `npm run migrations:manifest`. | **No.** |
| 3 | "an endpoint excused from the org filter still passes the session's org to its store" (`src/http/read-endpoints-org-scope.test.mjs`) | One file, `company-brain-affiliate.mjs`, stopped passing the caller's company through. The test says that means it is no longer locked to one company. | **No.** |

None of the three names Campaigns, `campaign-manager.html`, or anything under `api/campaigns/`.

#### 4. The three Campaigns tests, run one at a time

| File | Result | What it really means |
|---|---|---|
| `src/http/campaign-endpoints.pg.test.mjs` | exit 0 — **0 tests ran** | The whole block is switched off with the reason "no DATABASE_URL". It passed by not running. **It proves nothing today.** |
| `src/http/routes.test.mjs` | exit 0 — 15 pass, 0 fail | Green. All 8 Campaigns handlers are properly wired into the routing map. |
| `src/http/auth-gate.test.mjs` | exit 0 — 3 pass, 0 fail | Green. |

#### 5. What I could measure about the 103 database files

Run on their own (they are never reached by `npm test` today):

```
# tests 639 · # pass 50 · # fail 0 · # skipped 589
```

So without a database they are **589 skipped, 50 pass, 0 fail** — not the "442 skip" figure written
in `CLAUDE.md §12`. That figure is stale. Do not quote it.

**What this does prove:** every pure module and every handler tested against a fake database is
sound at this commit.
**What this does not prove:** anything that needs a real database. That includes every Campaigns
endpoint.

#### 6. The same commit, in GitHub's own test run

Run `32093422949`, on `7be91a0`, 2026-08-18 02:52 UTC. It agrees with my numbers exactly
(5552 tests · 5546 pass · 3 fail · 3 skipped · same three failures). That is a good cross-check.

| Job / step | Result | Note |
|---|---|---|
| Lint | green | |
| Run the suite | **red** | The same 3 failures. |
| Named guards | **red** | 67 pass, 2 fail — the same migrations-list and company-scope failures. `routes.test.mjs` and `auth-gate.test.mjs` are **green** inside it. |
| Screens (real browser) | **red** | 103 failed, 114 passed, 18 did not run. **But both Campaigns checks passed:** `/app/campaign-manager.html loads without a JavaScript error` ✓ and `/app/campaign-manager.html is interactive without throwing` ✓. Those two are W1's safety net and they work today. |
| Real-Postgres job | **red** | See below. |

#### 7. "Partner isolation, as the unprivileged app role" — the answer is: still not measured

`CLAUDE.md §12` says to read this step before quoting any failure count. I read it. Here is what it
is and what it says.

**What the step does:** it runs five database test files — `src/compliance/rls-bypass.pg.test.mjs`,
`src/compliance/invariants.pg.test.mjs`, `src/http/creative-endpoints.pg.test.mjs`,
`src/creative/generate.pg.test.mjs`, `src/social/social.pg.test.mjs` — while signed in as the
locked-down `fundhub_app` user instead of the all-powerful database owner. If it goes green, the
old "24 pre-existing failures" were caused by the wrong login and the fix worked.

**Is the result available? No.** The step is red, but for a reason that has nothing to do with
what it is trying to measure. The step **before** it, "Apply every migration to an empty database",
failed first:

```
✗ FAILED migrations/130_company_brain.sql: extension "vector" is not available
FATAL: extension "vector" is not available
```

The test database therefore had **no tables in it**. The isolation step then ran against an empty
database and everything fell over with `test did not finish before its parent and was cancelled`.
That is an empty-database error, not an isolation result.

**So the measurement `CLAUDE.md §12` is waiting for still has not happened.** The `continue-on-error`
line in that job cannot be removed yet. Nobody should quote 24, 29 or 45 — and nobody should quote
this run either.

One thing in that job *did* pass honestly: "The app role holds no superuser-level privilege"
(`npm run guard:db`) is green. The locked-down user really is locked down. Whether that makes the
isolation tests pass is still unknown.

#### 8. The `api/` blind spot — does it matter for Campaigns? Yes, a lot

`npm test` only walks `src/` and `scripts/`. All 8 Campaigns handlers live in `api/campaigns/`:
`list`, `detail`, `spend`, `fatigue`, `connections`, `action-log`, `sync`, `write`.

They are reached only through two test files, and **both are database files**:

* `src/http/campaign-endpoints.pg.test.mjs` — imports 6 of the 8 (all but `sync` and `write`)
* `src/http/creative-endpoints.pg.test.mjs` — imports 6 of the 8 (all but `sync` and `write`)

`api/campaigns/sync.mjs` and `api/campaigns/write.mjs` are imported by **no test anywhere** —
not a unit test, not a database test, not a browser test.

**Net effect right now:** with no database, **zero tests exercise any Campaigns endpoint.** The only
automated thing standing behind this screen today is the two browser checks in item 6. If W1 changes
only the page's words and layout and leaves the JavaScript that calls these endpoints alone, that is
fine. If W1 touches the calls, nothing will catch a mistake.

#### 9. Warning for W1, W2 and W3 — the shared folder is moving under us

At 20:29 the repo folder was clean. By 20:48 it held staged and unstaged edits to roughly
60 files — `api/`, `src/`, `netlify/functions/api.mjs`, `e2e/`, and about 35 files under
`public/app/` including `campaign-manager.html`. Other batches are working in the same folder at
the same time.

My first `npm test` run in that folder reported **4** failures. The same command on a clean copy of
the commit reported **3**, matching GitHub exactly. The extra failure came from another batch's
half-finished edits, not from this commit.

**So: do not read a test result out of the live repo folder right now and call it a baseline.** Use
the numbers above.

#### Change manifest

* Files touched: **`docs/workflows/campaigns-readable-2026-08-17.md` only** (this section).
* Exports added / props changed / routes affected: **none.**
* Journeys impacted: **none.** No `-actual.md` regenerated, no changelog line — nothing changed.
* Tests weakened, skipped or deleted: **none.**


## Blockers and open questions

* **Q1 — ANSWERED by owner 2026-08-17: "Shrink to a quiet line."**
  The `SCOPE & SOURCES` card is cut. In its place, one line under the page title that stays
  silent when every panel loads and speaks up only when one fails. W3 argued for a full cut
  on the grounds that the footer count and the per-panel sentences already carry the fact;
  the owner's call keeps a single visible line so a failure is noticed without reading each
  panel. Owner's call stands. W1 implements: cut the card and its Panel/Status/Rows table,
  keep the footer count, keep every per-panel sentence, add the one quiet line.
