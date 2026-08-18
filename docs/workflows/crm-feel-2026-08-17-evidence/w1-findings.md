# W1 — why the CRM flashes, loads and jumps

Measured 2026-08-17 / 18 against **https://fundhub.ai** (live). Never localhost.
Chrome via Playwright 1.62.1, window 1440×900.
Screens: pipeline, command-center, closer-dashboard, finance-os, messaging,
staff-teams. Roles: owner, plus closer on closer-dashboard.

Raw numbers and scripts: `/private/tmp/claude-501/.../scratchpad/w1-out/*/result.json`
(scratch, not in the repo). Pictures: `w1/`.

---

## READ THIS BEFORE YOU TRUST A NUMBER — how the measurement was taken

**Live sign-in was broken for the whole of this run.** The live site's own
sign-in answers with a server error:

```
POST https://fundhub.ai/api/auth/login  ->  500
  "cannot execute INSERT in a read-only transaction"
GET  https://fundhub.ai/api/auth/session (any token) -> 503 {"db":"down"}
GET  https://fundhub.ai/api/health -> 200 {"db":"up", "migrations":159}
```

Checked every 30 seconds from 03:37 to 03:58 UTC — never recovered. Two full
sign-in attempts failed the same way, 20 minutes apart. Cached sign-ins from
earlier sessions also came back 503, because looking a token up needs the same
database. So **no screen in this report was measured while really signed in.**

To get any measurement at all, the harness answered that one request,
`GET /api/auth/session`, itself — with a made-up staff record, delayed by 150 ms
to match the real speed of the other API calls the same page makes (measured
live at 150 / 153 / 163 ms). Nothing else was faked. Every other request went to
the real live site. No write of any kind left the browser (all non-GET API calls
were blocked by the harness).

What that means for the numbers:

* Everything about the **page shell** — the sidebar, the banners, the top bar,
  the fonts, the stylesheets, how long the screen is blank — is real and is
  what the owner sees.
* Everything about **data landing in a table or a tile** is **under-measured**.
  The data never arrived, because the reads answered 401. Real data would land
  later and would move more, not less. Treat every jump number below as a floor.
* Screens showed their error state where real rows would be. That state is also
  real (it is what people see whenever a read fails) but it is not the happy path.

Marked `UNVERIFIED (live login down, 500 read-only transaction)` wherever this got
in the way, with what I would have measured.

### Live files vs this working tree — hashed, 2026-08-18

Everything above was measured against the live files, so it describes live. But
the file:line references below come from the working tree, which W4 will edit,
so I checked whether the two are the same file. SHA-256, live vs
`public/app/`:

| file | result |
|---|---|
| `/app/crm-sidebar.css` | **MATCH** — `fd4fcf0616860fa5…`, 11,302 bytes both sides |
| `/app/fundhub-brand.css` | **MATCH** — `45e2309770a4b8a5…`, 15,756 bytes both sides |
| `/app/finance-os.css` | **MATCH** — `69600633db267b59…`, 7,169 bytes both sides |
| `/app/shell.js` | differs — live 95,213 B, tree 93,974 B |
| `/app/data.js` | differs — live 31,919 B, tree 32,252 B |
| all six screen HTMLs | differ — by 115 B each (closer-dashboard by 4,469 B) |

**The two shared stylesheets — the files W4 owns — are byte-identical live and
local.** Every CSS line number in this document is therefore exact for both.

**Why the other eight differ: other workflows are editing them right now.**
`git status` shows `public/app/shell.js`, `public/app/data.js` and every one of
the six screen HTMLs as modified-but-not-committed, alongside three other live
batches (`contracts-dedup-2026-08-17`, `subscriptions-removal-2026-08-17`,
`beta-banner-removal-2026-08-17`). Live is the last deployed build; the tree is
that build plus somebody else's in-flight work. So this is **not** "live is
ahead" — it is concurrent edits in the tree.

I diffed them anyway to be sure none of it touches a finding here. Every
difference is in the fallback sidebar nav list and its comments: two nav rows
moved between groups, one label renamed, `subscriptions.html` added to
`BETA_PAGES`. That markup is thrown away and rebuilt by `shell.js` at runtime.
No mechanism in this report is affected.

Two consequences W4 should hold on to:

* **`crm-sidebar.css` and `fundhub-brand.css` are not being touched by anyone
  else** — they are absent from `git status`, and they hash-match live. W4 has
  them to itself.
* **`shell.js` and the six screen HTMLs are contested.** Every fix here that
  needs one of those files has to be coordinated, not just written.

Line numbers cited for `shell.js` and `data.js` are the **working-tree** ones as
of this run, because that is the file W4 edits. Live is offset: `shell.js` live =
tree + 18 from line 600 onwards; `data.js` live = tree − 7. Both are given where
it matters. Because the tree is moving, re-grep the symbol name rather than
trusting a stale line number.

In the six screen HTMLs the four lines this report cites — the fonts `<link>`
(line 9), the `crm-sidebar.css` `<link>` (line 11), the `.app{display:flex}` rule
and the `<script defer src="shell.js">` tag — are at **identical line numbers
live and in the tree**, checked file by file.

---

## Cause 1 — The page is laid out twice. The second layout is the jump.

**(a) What the owner sees.** He clicks a tab. The page shows up. A split second
later the whole page re-arranges itself — on Staff & Teams the bottom of the
page leaps up by about a third of the screen. Nothing he did caused it. It
happens on every screen, every time.

**(b) The measurement.** Every screen's own `<style>` block says the page is a
side-by-side box (`display:flex`). The shared stylesheet `crm-sidebar.css` says
the same page is a stacked box (`display:block`). Both rules are equally strong,
so whichever stylesheet the browser reads **last** wins.

The page reads its own style last, so the page paints as `flex`. Then `shell.js`
adds a **second copy of `crm-sidebar.css`** to the end of the page, and now the
shared sheet is last, so `block` wins — and the browser re-does the whole layout.

Measured live, watching `.app`'s real display value and the number of copies of
`crm-sidebar.css` in the page:

| screen | first paint | `.app` flips flex→block | after first paint by | copies of crm-sidebar.css |
|---|---|---|---|---|
| staff-teams | 716 ms | 725 ms | **+9 ms** | 1 → 2 |
| messaging | 404 ms | 493 ms | **+89 ms** | 1 → 2 |
| closer-dashboard | 660 ms | 819 ms | **+159 ms** | 1 → 2 |
| pipeline | 296 ms | 825 ms | **+529 ms** | 1 → 2 |
| command-center | 1228 ms* | 946 ms* | (varies run to run) | 1 → 2 |

`*` command-center's paint time swung between 820 ms and 2944 ms across four
runs; the flip always happened, timing varied.

On staff-teams the flip is visible and large. The main column's height goes
**900 px → 538 px** at the same millisecond, and the browser's own layout-shift
recorder logged it:

```
staff-teams, 46 ms after first paint:
  div.app > div.main > div.foot   y 850 -> 488   (moved UP 362 px)   shift value 0.0235
```

Height trace over time (same run, sampled every 25 ms):

```
t=1696ms  .content height 793   .foot y850   stylesheets=4  crm-sidebar copies=1
t=1722ms  .content height 431   .foot y488   stylesheets=7  crm-sidebar copies=2
```

The height collapse and the second stylesheet land in the same 26 ms window.

The duplicate happens because the guard looks for the wrong thing: it checks for
an element with `id="fh-crm-sidebar-css"`, but the copy already in the page is a
plain `<link>` with no id, so the guard never matches and it adds another copy
every single time.

**(c) Where it lives.**
* `public/app/shell.js:599-603` — `ensureSidebarCss()`, the guard that never matches.
* `public/app/crm-sidebar.css:14-22` — `.app, .app-shell { display: block; … }`
* The page rules it fights, one per screen:
  `public/app/pipeline.html:57`, `command-center.html:67`, `closer-dashboard.html:51`,
  `messaging.html:43`, `staff-teams.html:24`, `finance-os.html:34` — all
  `.app{display:flex …}`
* The `<link>` that is already there and is being duplicated:
  line **11** of all six screens.

**(d) Fixable where.** **JS, one line.** The stylesheet cannot fix this — the
conflict is between the shared sheet and six page sheets, and the duplicate
injection is JavaScript. The smallest fix is to make the guard also accept the
`<link>` the page already has. Deciding whether `.app` should be flex or block
is a second, separate decision for W4.

---

## Cause 2 — The orange BETA bar drops in after the page has already drawn and shoves everything down 62 px.

**(a) What the owner sees.** Command Center, Finance OS, Galaxy, Ops & Admin and
eleven other screens draw normally, then a dark yellow warning bar appears at the
top and pushes the entire page down. If he had already started reading or
reaching for a button, it moved.

**(b) The measurement.** This is the single worst jump measured anywhere in the app.

```
command-center, cold load:   CLS = 0.3459
command-center, after a nav click: CLS = 0.3439   (measured twice, both runs)
  the one shift, 264 ms after first paint:
    div.app > div.shell > main.fh-maxw   moved DOWN 62 px, lost 62 px of height
    div.app > div.shell > header.topbar  moved DOWN 55 px, grew 14 px taller
```

Google's own "good" limit for this measurement is 0.1. Command Center is **3.5×
over it**, and one bar accounts for essentially all of it.

Timeline of when the bar arrives, watched every 20 ms:

```
command-center   first paint at 1228 ms — no bar
                 +150 ms  banner appears, 62 px tall
finance-os       first paint at 1636 ms — no bar
                 +168 ms  content and footer both move DOWN 84 px, page title down 11 px
```

It cannot be avoided by dismissing it either: the Dismiss button only removes the
element for that page view, and the bar is back on the next click
(`shell.js:1682-1684`, and confirmed by the code — nothing is stored).

**(c) Where it lives.**
* `public/app/shell.js:1685-1720` — `mountBetaBanner()`, builds and inserts the bar.
* `public/app/shell.js:1672-1680` — `mountFullWidthBar()`, the insert.
* `public/app/shell.js:22-28` — `BETA_PAGES`, the 15 screens that get it.
* `public/app/shell.js:1824` — it is called only after the sign-in check comes back,
  which is why it is always late.

**Owner-set, do not undo:** the owner keeps this banner. It was removed for every
other role on 2026-08-17 and deliberately kept for owner —
`docs/workflows/beta-banner-removal-2026-08-17.md`, "Owner keeps it". The finding
is not "delete the bar", it is "stop it landing late".

**(d) Fixable where.** **Needs JS or HTML.** A stylesheet cannot reserve room for
an element that does not exist yet. Two shapes of fix, neither of which removes
the bar: give it a fixed height the page always reserves (this part *can* live in
the shared stylesheet, as a `padding-top` on `.app` for the 15 beta screens), or
put the bar in the page markup and only reveal it.

---

## Cause 3 — The sidebar draws itself fully open, then snaps shut 8 ms later.

**(a) What the owner sees.** Every time he clicks a tab, the left menu appears
with every section open — about 20 rows — and then instantly collapses down to
9 headings. The little arrows spin. On the way, the menu labels blink out and
come back. Every click, every screen.

**(b) The measurement.** Watched every 20 ms, live:

```
command-center:
  first paint (1228 ms):  33 menu rows showing, 0 of 9 sections closed, labels visible
  +8 ms                :  3 menu rows showing, 8 of 9 sections closed, labels HIDDEN
  +150 ms              :  labels visible again
pipeline:
  first paint (228 ms) :  33 rows, 0 of 9 closed
  +10 ms               :  6 rows, 8 of 9 closed
```

So on every navigation the rail paints wrong first and corrects itself. The
correcting is animated: the section arrows have a 0.16 s spin
(`crm-sidebar.css:146`), so the collapse is something you watch happen rather
than something that is just true.

The label blink is a separate mechanism: `shell.js` adds a rule
`.navitem{visibility:hidden}` and only takes it away once the sign-in check
answers — measured at **142 ms of invisible menu labels** on command-center
(hidden at first-paint+8 ms, revealed at first-paint+150 ms).

For a non-owner role the rail also **shrinks** after the fact. As closer:

```
closer-dashboard as closer@fundhub.ai, 293 ms after first paint:
  aside#side > div.navgroup "Automation"  moved UP 74 px
  aside#side > div.navgroup "Funding"     moved UP 31 px
  aside#side > div.navgroup "Client ops"  moved UP 31 px
  a.navitem "Calendar"                    moved UP 31 px
```

That is `gateLinks()` removing the 20 tabs a closer may not use, after the menu
had already drawn all 33. The owner does not see this one (he keeps all 33 tabs),
but every other member of staff does.

**(c) Where it lives.**
* `public/app/shell.js:589-592` — `.navitem{visibility:hidden}` gate rule.
* `public/app/shell.js:594-596` — `revealNav()`, removes it after sign-in.
* `public/app/shell.js:726-737` — `setGroupDefault()`, closes 8 of 9 sections after mount.
* `public/app/shell.js:990` — `gateLinks()`, removes the rows the role cannot use.
* `public/app/crm-sidebar.css:146` — `.navhead .chev { transition: transform .16s }`
* `public/app/crm-sidebar.css:148` — `.navgroup.closed .navlist { display: none }`
* The reason it is all late: `<script defer src="shell.js">` —
  `pipeline.html:301`, `command-center.html:671`, `closer-dashboard.html:180`,
  `finance-os.html:19`, `messaging.html:342`, `staff-teams.html:156`. `defer`
  means the whole page is parsed and painted before this script runs, even though
  the file's own comment at `shell.js:6-12` says it "runs from `<head>`, before
  the screen paints". That comment is not true as shipped.

**(d) Fixable where.** **Mostly JS/HTML.** One piece is shared-stylesheet-only
and worth doing on its own: killing the 0.16 s arrow spin and the 0.12 s row
colour fade during the first moment of a page (`crm-sidebar.css:146`, `:176`)
stops the collapse from reading as an animation. Making the rail draw correct the
first time needs the closed/open state written into the markup or the script
moved before paint.

---

## Cause 4 — The top-right of every screen is rebuilt after the fact, and the whole top row shuffles.

**(a) What the owner sees.** The strip along the top — the date, ORG: FUNDHUB,
the LIVE dot, "+ Add person" — draws in one place, then a Search box and his name
chip appear beside them and everything slides sideways by roughly half the screen
and the row gets taller.

**(b) The measurement.** Same shape on all six screens. Example, pipeline, cold:

```
first paint 2852 ms
+0 ms    header .topbar-right   moved LEFT 227 px
+161 ms  header .topbar-right   moved LEFT 589 px, moved UP 9 px, grew 25 px TALLER
+2474 ms .topbar-right children moved LEFT 9-10 px
CLS contribution: 0.0185 of pipeline's 0.0186 total
```

Every screen measured:

| screen | top-row sideways move | row height change | that screen's total CLS |
|---|---|---|---|
| pipeline | 227 px then 589 px | +25 px | 0.0186 |
| messaging | 227 px then 573 px | +25 px | 0.0184 |
| staff-teams | 587 px | 0 | 0.0286 |
| closer-dashboard | 546 px | +23 px | 0.0214 |
| command-center | 9 px (fixed-width top bar) | 0 | (banner dominates) |
| finance-os | 9 px | 0 | 0.0576 |

Three separate things do this, in order: the Search button is inserted, the name
chip is inserted, then `layoutShellChrome()` measures how wide those two turned
out and writes a `padding-right` onto every `.topbar` on the page — which moves
everything again.

**(c) Where it lives.**
* `public/app/shell.js:1454-1456` — `mountChip()`, inserts `#fh-shell-chip`.
* `public/app/shell.js:1307-1312` — the Search button, `#fh-shell-search-btn`.
* `public/app/shell.js:1116-1183` — `layoutShellChrome()`; line 1164-1183 writes
  `.topbar,.top,.page-hd,.hdr-actions,.screen-actions{padding-right:max(16px,var(--fh-shell-top-clearance))}`
  into a `<style>` tag it creates at runtime.
* Selectors moved: `.topbar-right`, `.topbar`, `#fh-shell-chip`, `#fh-shell-search-btn`.

**(d) Fixable where.** **Shared stylesheet can fix most of it.** Reserve the room
up front: a fixed min-height on `.topbar` and a fixed-width slot on the right
(`--fh-shell-top-clearance` set to a constant in `fundhub-brand.css` instead of
measured at runtime) removes both the height change and the re-measure pass. The
insertion order itself is JS.

---

## Cause 5 — A coloured strip appears at the bottom late, and on four of six screens it covers the page instead of making room.

**(a) What the owner sees.** After everything else has settled, a coloured bar
appears glued to the bottom of the window, and the page becomes 29 px shorter to
make room for it.

**(b) The measurement.** Sampled every 25 ms, live:

```
staff-teams:
  t=116 ms   --fh-statusbar = 0px    body padding-bottom = 0px    strip absent
  t=291 ms   --fh-statusbar = 29px   body padding-bottom = 29px   strip 29 px tall
command-center:
  t=396 ms   --fh-statusbar = 0px    body padding-bottom = 0px    strip absent
  t=595 ms   --fh-statusbar = 29px   body padding-bottom = 0px    strip 29 px tall
                                     ^^^^^^^^^^^^^^^^^^^^^^^^^^
```

**And there is a second bug inside this one.** On command-center the shared rule
never fires — `body padding-bottom` stays `0px` while the strip is 29 px tall, so
the strip is not making room, it is **covering** the bottom 29 px of the page.
The reason: `fundhub-brand.css:170` says `body{padding-bottom:var(--fh-statusbar)}`,
but four of the six screens set `html,body{margin:0;padding:0;…}` in their own
`<style>`, which the browser reads later, so the shared rule loses:

| screen | its own body rule | shared padding rule works? |
|---|---|---|
| pipeline | `html,body{…padding:0…}` at line 35 | **no — strip covers content** |
| command-center | `html,body{…padding:0…}` at line 53-58 | **no — strip covers content** |
| closer-dashboard | `html,body{…padding:0…}` at line 43 | **no — strip covers content** |
| messaging | `html,body{…padding:0…}` at line 35 | **no — strip covers content** |
| finance-os | `*{…padding:0}` at line 25 (weaker selector) | yes — 29 px reserved |
| staff-teams | `*{…padding:0}` at line 14 (weaker selector) | yes — 29 px reserved |

So on two screens the page shortens by 29 px late; on four screens the strip sits
on top of whatever is at the bottom of the page. Both read as instability.

`UNVERIFIED (live login down, 500 read-only transaction):` with sign-in down every
data read failed, so this strip showed the red "we could not load this" wording.
On a healthy read it shows the green wording — same element, same 29 px, same
late arrival, but I could not confirm the timing on a successful read. I would
have measured: the millisecond the strip appears on a screen whose reads all
return 200, and whether the green strip is also 29 px.

**(c) Where it lives.**
* `public/app/data.js:475-505` (live 468-498) — `banner()`; tree line **504** /
  live line **497** sets `--fh-statusbar` from the measured bar height.
* `public/app/fundhub-brand.css:70` — `:root{ --fh-maxw:1280px; --fh-statusbar:0px; }`
* `public/app/fundhub-brand.css:170` — `body{padding-bottom:var(--fh-statusbar)}`
* The four rules that beat it: `pipeline.html:35`, `command-center.html:53`,
  `closer-dashboard.html:43`, `messaging.html:35`.

**(d) Fixable where.** **Shared stylesheet, but it needs two lines not one.**
Set `--fh-statusbar` to the strip's real height (29 px) at `fundhub-brand.css:70`
instead of `0px`, so the room is reserved from the first pixel — and move the
padding off `body` onto something the screens do not reset (e.g. `.app`), or give
it enough weight to win, so the four screens above stop being covered.

---

## Cause 6 — The text is drawn in one typeface, then re-drawn in another, and the lines move.

**(a) What the owner sees.** Words appear, and about a third of a second later
they subtly change shape and everything below them nudges down a few pixels. It
reads as the page "settling" rather than being finished.

**(b) The measurement.** Both fonts come from Google, and both are set to swap in
late:

```
https://fonts.googleapis.com/css2?...&display=swap
  26 @font-face blocks, every single one "font-display: swap"
  13 woff2 files; the 8 sampled weigh 215 KB
  the stylesheet itself: cache-control "private, max-age=86400"
```

`swap` means: draw the text in the fallback typeface now, then re-draw it in
Inter / JetBrains Mono when they arrive. The two typefaces are not the same
width. Measured live on the page, same 53-character string at 14 px:

```
Inter                365.42 px
system fallback      356.56 px      -> every line is 2.48 % (8.9 px) wider once Inter lands
JetBrains Mono       445.20 px
mono fallback        445.28 px      -> mono is a match, no reflow from that one
```

The re-draw is visible and was caught three separate times:

```
command-center, 234 ms after first paint (at the moment the fonts finished loading):
   main > section.pane      moved DOWN 6 px, lost 6 px of height
   .empty-rail              moved DOWN 5 px
   .feed-title.eyebrow      moved DOWN 4 px, grew 1 px

closer-dashboard, at font load:
   details#breakdown        moved DOWN 9 px, then 11 px
   .calc-panel .res-grid    moved DOWN 6 px, grew 5 px taller
   .calc-panel .big-tile    moved DOWN 8 px / 3 px, grew 5 px
   #calcGrid .inrow         moved DOWN 8-9 px, grew 3 px

login page (no sign-in needed, so this one is un-faked, fully real):
   5 blocks all moved DOWN 3 px, 44 ms after first paint
```

There is a second, larger cost. The Google stylesheet is a **render-blocking**
link in the `<head>` of all six screens: the browser will not paint one pixel
until Google answers. Measured 340 ms for that one request on a cold load. That
is time the owner spends looking at a white page, on a third-party server the
company does not control.

**(c) Where it lives.**
* Line **7, 8 and 9** of all six screens — the `preconnect` pair and the
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?…&display=swap">`.
* `public/app/fundhub-brand.css:11-12` — `--mono` and `--sans`. There is **no
  `@font-face` anywhere in this repo**; every font byte comes from Google.

**(d) Fixable where.** **Needs HTML (the `<link>` in 40 screens) plus the shared
stylesheet.** The shared-stylesheet half is real though: self-hosting the two
fonts as `@font-face` blocks inside `fundhub-brand.css` with
`font-display: optional` (or `swap` plus a size-matched fallback) both removes
the third-party blocking request and stops the re-flow. That is one edit to
`fundhub-brand.css` and one deleted `<link>` per screen.

---

## Cause 7 — Every tab click is a full page load, not a swap. Nothing is kept.

**(a) What the owner sees.** Clicking a tab does not update part of the screen —
it throws the whole screen away and builds a brand new one. That is why it always
feels like waiting, and why the menu, the banners and the top bar all rebuild
every time. It is also why collapsing the left menu never sticks.

**(b) The measurement.** There is no in-page routing anywhere in the app:

* Every menu row is a plain link — `<a class="navitem" href="pipeline.html">`
  (`shell.js:31`). No click handler navigates; the one handler that exists only
  *blocks* clicks (`shell.js:552-571`).
* `pushState` / `replaceState`: **0 uses** in the app shell. There is no service
  worker and no `rel=prefetch` / `rel=preload` anywhere.

Timed six real nav clicks, live, warm cache — click to the first pixel of the new
screen:

```
command-center -> pipeline          246 ms  and  361 ms
pipeline       -> messaging         398 ms
finance-os     -> staff-teams       425 ms
closer-dashboard -> command-center  441 ms
messaging      -> closer-dashboard  1026 ms
```

**What is on the screen during that gap:** the old screen, frozen, unchanged
(Chrome holds the last paint until the new page is ready). Then the new screen
appears with a big empty area and one line of text where the data will be — see
`w1/nav-gap-pipeline-loading.png`, the Pipeline board 42 ms into the gap: a full
grey rectangle with "Loading the board…" in the middle of it.

**And nothing is cached.** Checked the second page load in the same browser
session — every shared file came down the wire again:

```
after a nav click, second page load, same browser:
  /app/crm-sidebar.css     3867 bytes  RENDER-BLOCKING
  /app/fundhub-brand.css   7165 bytes  RENDER-BLOCKING
  fonts.googleapis.com css 1158 bytes  RENDER-BLOCKING (third party)
  /app/shell.js           28484 bytes (93,920 bytes unpacked)
  /app/data.js            10035 bytes (31,919 bytes unpacked)
  /app/chat-widget.js      4376 bytes
```

Live response headers on all of them: `public, max-age=0, must-revalidate` —
which tells the browser it must check with the server before reusing any of
them, every single time.

On top of that, none of the page's own code is shareable between screens,
because it is all pasted inside each HTML file:

| screen | file size | inline CSS | inline JS |
|---|---|---|---|
| pipeline | 82.4 KB | 19.8 KB | 47.0 KB |
| messaging | 66.9 KB | 22.1 KB | 32.5 KB |
| finance-os | 62.3 KB | 11.7 KB | 42.7 KB |
| closer-dashboard | 59.9 KB | 11.8 KB | 34.3 KB |
| staff-teams | 56.9 KB | 9.5 KB | 30.0 KB |
| command-center | 49.0 KB | 21.0 KB | 12.6 KB |

Time from "the HTML has fully arrived" to "the first pixel is drawn", across the
eight measured loads: **197, 198, 236, 341, 1035, 2056, 2474 ms**. That is the
white-screen window, and it is entirely stylesheet fetch + parse + script parse.

**(c) Where it lives.**
* `public/app/shell.js:31` — the sidebar markup, plain `<a href>` links.
* `public/_headers:39-47` — `/app/*.js` and `/app/*.html` set to
  `max-age=0, must-revalidate`. CSS has **no rule at all**, so it inherits
  Netlify's default, which is the same thing.
* `public/app/shell.js:831` — the menu-collapse toggle. Nothing writes it to
  storage and nothing reads it back, which is why collapsing the rail is undone
  by the next click.

**(d) Fixable where.** **Not a stylesheet problem at all.** This is the
architecture. Nothing here is in W4's scope; flag it for a separate decision.
The one cheap, contained piece: remember the collapsed/expanded rail in
`localStorage` (a few lines in `shell.js`).

---

## Cause 8 — Nothing holds space open for data that has not arrived yet.

**(a) What the owner sees.** A table or a tile is empty, then the rows land and
everything under them is shoved down (or, when the list comes back empty, sucked
up). There is no grey placeholder showing where the rows will be.

**(b) The measurement.**

* **Zero loading skeletons exist in the entire app.** Searched every `.css` and
  `.html` file under `public/app/` for `skeleton` or `shimmer`: **0 matches.**
  The DOM probe on every screen also reported `skeletons: 0`.
* The shared stylesheets reserve height for nothing. Every `min-height` in
  `fundhub-brand.css` and `crm-sidebar.css` is for something else:
  `fundhub-brand.css:114` and `:123` are the 40 px tap-target floor;
  `crm-sidebar.css:17` is `100vh` on the shell; `crm-sidebar.css:123` and
  `fundhub-brand.css:150` are `min-height:0`, which is the opposite of reserving.
  **Not one rule in either shared file holds space for content.**
* Containers that ship empty and get filled by script, with no height at all:
  `staff-teams.html:266` `<tbody id="rosterBody"></tbody>`,
  `:294` `#clockBody`, `:327` `#teleShifts`, `:331` `#teleEvents`;
  `pipeline.html:436` `<div class="board" id="board" hidden>`;
  `closer-dashboard.html:313` `#guardBody`, `:349` `#cliffBody`, `:309` `#oUtil`;
  `command-center.html:769` `#cc-system-meta`, `:929` `#cc-agents-meta`.
  Two of these were measured live at height **0 px** with `min-height: 0px`
  (`#guardBody`, `#cliffBody` on closer-dashboard).
* Loading states, where they exist at all, are one line of centred text inside a
  box of no fixed size: "Loading the board…" (pipeline), "Loading
  conversations…" (messaging), "Loading the agent registry…" (command-center).
  closer-dashboard and staff-teams have **no loading wording at all** — they just
  show nothing.

`UNVERIFIED (live login down, 500 read-only transaction):` how far each table,
tile and chart pushes the page when real rows land. I would have measured, per
screen: the layout-shift entry fired by each `innerHTML =` that fills a container,
with the container's height before and after and the pixel distance every block
below it travelled. That needs a working sign-in and real payloads. I am not
estimating it. The 362 px jump on staff-teams (Cause 1) is the same mechanism
firing for a different reason and shows the scale this can reach, but it is not
a substitute for the measurement.

**(c) Where it lives.** The absence is the finding: `public/app/fundhub-brand.css`
and `public/app/crm-sidebar.css` contain no skeleton class and no content
height reservation. The empty containers are the file:line list above.

**(d) Fixable where.** **Shared stylesheet, mostly.** A `min-height` on the
common data containers (`tbody`, `.kpi`, `.pane-body`, `.a-body`, `.board`) plus
one shared skeleton class in `fundhub-brand.css` covers most screens without
touching a single screen file. Wiring a screen to *use* the skeleton class is
per-screen JS.

---

## Cause 9 — Things the owner did not name, checked explicitly

**Scrollbar appearing and disappearing between screens — CHECKED, NOT A CAUSE
ON HIS MACHINE.** Nine screens lock page scrolling
(`html,body{overflow:hidden}` — pipeline, messaging, closer-dashboard,
command-center, calendar, automations, client-control-panel, inquiry-remover,
ops-admin) and the rest scroll normally, so the classic "scrollbar takes 15 px
and shoves the page sideways" was a live suspect.

`scrollbar-gutter` is set **nowhere** in `public/` (grepped: 0 matches), so
nothing reserves the space either way.

Measured the gap between `window.innerWidth` and `documentElement.clientWidth`,
including on pages forced to genuinely overflow by shrinking the window to
300 px tall:

```
staff-teams @900px tall : can scroll = false, gutter = 0px, content right edge 1440
staff-teams @300px tall : can scroll = TRUE (538 > 300), gutter = 0px, right edge 1440
finance-os  @300px tall : can scroll = TRUE (794 > 300), gutter = 0px, right edge 1440
pipeline    @300px tall : can scroll = false (overflow:hidden), gutter = 0px, right edge 1440
```

Also tried four different browser launch modes including a real windowed one:
**always exactly 0 px.** Chrome on macOS uses overlay scrollbars, which take no
layout space, so a page that scrolls and a page that does not are exactly the
same width. On Windows this would be a real 15-17 px sideways jump on every
click between a scrolling and a non-scrolling screen; on the owner's Mac it is
not happening.

**The rail slides but the page does not — CONFIRMED, and it is worse than it
sounds.** When the owner collapses the left menu with the `‹‹` button, the rail
narrows over 0.18 s but the page content jumps to its new position instantly, so
the rail sits on top of the content for the whole animation. Measured frame by
frame, live:

```
before the click: rail 228 px, .app padding-left 228px, content left edge x=228
                  html.fh-side-mini = false   (the rail never auto-collapses at load)
+7 ms   rail 228 px   .app padding-left 60px   content left edge x=60   <-- page already moved
+40 ms  rail 186 px   .app padding-left 60px   content left edge x=60
+91 ms  rail 100 px   .app padding-left 60px   content left edge x=60
+182 ms rail  60 px   .app padding-left 60px   content left edge x=60   <-- rail finally arrives
```

For 175 ms the rail covers the left 168 px of the page. `crm-sidebar.css:46` puts
a `transition: width .18s ease` on the rail; the `.app` padding-left it is
supposed to stay in step with (`crm-sidebar.css:19`, and the `!important` copy
`shell.js` injects at tree line 613) has no transition at all.

Two related negatives, both measured, both worth W4 knowing:
* `html.fh-side-mini` is **false before any click** on a fresh page load — the
  rail does not auto-collapse during start-up, so nothing animates on load from
  this.
* After collapsing, `localStorage` holds only `fh_role`. The collapsed state is
  never saved, so the next click puts the rail back (see Cause 7).

**Pictures and embeds with no size — CHECKED, CLEAN.** Every `<img>`, `<iframe>`
and `<video>` on all six screens: **0 without dimensions.** The logo is a CSS
background with a fixed `118×24` box (`crm-sidebar.css:96`).

**Animations firing on load — ONE FOUND, MINOR.** `crm-sidebar.css:36-37`
`.pulse::after { animation: pulse 2s ease-out infinite }` runs forever, on every
screen, in the sidebar foot. It never stops and never will. Not a layout jump —
it repaints a 16 px dot every frame — but it is a permanently animating element
on a page that is supposed to look still. The two that *do* contribute to the
felt jank are already covered in Cause 3 (`.chev` 0.16 s, `.navitem` 0.12 s).

**The sidebar's own scrollbar — CHECKED, NOT FIRING TODAY.** `.side-scroll` is
styled with `::-webkit-scrollbar` (`crm-sidebar.css:125-126`), which switches
that one element to a classic 6 px scrollbar that *does* take layout space. It
would shift the menu labels 6 px sideways whenever the menu got tall enough to
scroll. Measured on all six screens: menu content height 818 px inside an 818 px
box, gutter **0 px** — it does not overflow, because 8 of 9 sections ship closed.
Open several sections and it will. Worth W4 knowing about; not a live cause today.

**Sign-in is broken on the live site right now.** Not a UI-feel finding and not
mine to fix, but it stopped this measurement dead and someone should see it:
`POST /api/auth/login` → 500 "cannot execute INSERT in a read-only transaction",
and any `GET /api/auth/session` with a token → 503 `{"db":"down"}`, for at least
22 minutes, while `GET /api/health` cheerfully answered `{"db":"up"}`. Health is
reading; everything else needs to write and cannot.

---

## Ranked — worst first

| # | Cause (section above) | Worst measured number | Where | Shared stylesheet can fix it? |
|---|---|---|---|---|
| 1 | **Cause 2** — BETA bar drops in late and shoves the page down 62 px | **CLS 0.346** on command-center (3.5× Google's "bad" line), measured twice | `shell.js:1685-1720`, `:1672-1680`, `:22-28` | Partly — reserving the height can be CSS, the bar itself is JS |
| 2 | **Cause 1** — page laid out twice because `crm-sidebar.css` is loaded twice; `.app` flips flex→block after paint | **362 px** upward jump on staff-teams, +9 ms after paint; happens on all 6 screens, every load | `shell.js:599-603` + `crm-sidebar.css:14-22` vs `.app{display:flex}` at `pipeline.html:57`, `command-center.html:67`, `closer-dashboard.html:51`, `messaging.html:43`, `staff-teams.html:24`, `finance-os.html:34` | No — one-line JS guard fix, then a CSS decision |
| 3 | **Cause 7** — every click is a full page reload; nothing cached; 197-2474 ms of white screen | click→first pixel **246-1026 ms**; 6 files re-fetched per click, 3 render-blocking | `shell.js:31`, `public/_headers:39-47` | No — architecture, out of W4's scope |
| 4 | **Cause 3** — sidebar paints fully open then snaps shut; labels blink out | 33 rows → 3 rows **8 ms** after paint; labels invisible **142 ms**; closer's rail also jumps up 74 px | `shell.js:589-592`, `:594-596`, `:726-737`, `:990`; `crm-sidebar.css:146`, `:148` | Partly — killing the 0.16 s/0.12 s transitions is CSS-only and helps immediately |
| 5 | **Cause 4** — top-right chrome rebuilt after paint; whole top row shuffles | top row slides **589 px** sideways and grows **25 px** taller, 161 ms after paint, on 4 of 6 screens | `shell.js:1454-1456`, `:1307-1312`, `:1116-1183`; `.topbar`, `.topbar-right` | Yes, mostly — fix `.topbar` min-height and make `--fh-shell-top-clearance` a constant |
| 6 | **Cause 6** — web fonts arrive late and every line re-flows | Inter is **2.48 %** wider than the fallback; panels moved **4-11 px** on 3 screens; Google's stylesheet blocks first paint for **340 ms** | line 7-9 of all 6 screens; `fundhub-brand.css:11-12`; no `@font-face` in the repo | Yes — self-host `@font-face` in `fundhub-brand.css`, then delete one `<link>` per screen |
| 7 | **Cause 8** — nothing reserves height for data; zero skeletons in the whole app | **0** skeleton/shimmer rules found; **0** content `min-height` rules in either shared file | `fundhub-brand.css`, `crm-sidebar.css` (absence); empty containers listed in Cause 8 | Yes — `min-height` + one skeleton class covers most screens |
| 8 | **Cause 5** — bottom status strip lands late; shortens the page 29 px on 2 screens and **covers** the bottom 29 px on the other 4 | `--fh-statusbar` 0px→29px at **208 ms after first paint** (command-center); `body padding-bottom` stays 0px on 4 of 6 screens | `data.js:504` (live 497), `fundhub-brand.css:70`, `:170`; beaten by `pipeline.html:35`, `command-center.html:53`, `closer-dashboard.html:43`, `messaging.html:35` | Yes — two lines in `fundhub-brand.css` |
| 9 | **Cause 9** — collapsing the rail: it slides for 182 ms while the page has already moved, so the rail covers 168 px of content | rail 228→60 px over **182 ms**, content jumps in **7 ms** | `crm-sidebar.css:46` (rail transition) vs `:19` (padding, no transition) | Yes — remove the width transition, or transition both |
| 10 | **Cause 7 / 9** — collapsing the sidebar is forgotten on every click | `localStorage` holds only `fh_role`; no read or write of the rail state exists | `shell.js:831` (live 849) | No — small JS |
| 11 | **Cause 9** — a dot animates forever on every screen | `pulse 2s infinite`, never stops | `crm-sidebar.css:36-37` | Yes — one line |

**Not causes (checked, ruled out):** scrollbar width between screens — measured
0 px even on pages forced to overflow, in four browser modes, and
`scrollbar-gutter` is set nowhere in `public/`; would be 15-17 px on Windows.
Images or embeds without dimensions — none on any of the six screens. The
sidebar's own 6 px classic scrollbar — does not overflow while 8 of 9 sections
ship closed (content 818 px in an 818 px box, gutter 0 px), but it will once
several sections are opened. The rail auto-collapsing during start-up —
`html.fh-side-mini` is false before any click.

**UNVERIFIED (live login down, 500 read-only transaction).** Everything that
needs real data through a real session. Specifically, and I am not estimating any
of it:

1. **Layout shift caused by real API payloads** — per screen, the layout-shift
   entry fired by each container fill, with before/after heights and the pixel
   distance every block below it moved. Cause 8's list of empty containers is
   where I would have pointed the measurement.
2. **Click-to-paint against real endpoints** — the 246-1026 ms figures in Cause 3
   are real navigations, but the new screen never received data. The number that
   matters to the owner is click → *useful* screen, and that needs live reads.
3. **The green status strip's timing** — measured only in its red failure state.
4. **Whether a full table changes the picture on Causes 1, 4 and 5** — all three
   were measured on screens showing empty/error states. Real rows can only make
   the movement larger, never smaller, so every number above is a floor.

Live sign-in returned a server error for the entire run (checked every 30
seconds, 03:37 → 03:58 UTC) and never recovered. Retrying was stopped on the
coordinator's instruction; this is a production outage, not a W1 finding.
