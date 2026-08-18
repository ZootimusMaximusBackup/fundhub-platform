# W3 — seams & surface at 1440 / 1920 / 2560

Batch: `docs/workflows/crm-feel-2026-08-17.md` · Task W3 · read-only audit · 2026-08-17

Screens measured as owner: `pipeline.html`, `command-center.html`, `closer-dashboard.html`,
`finance-os.html`, `messaging.html`, `staff-teams.html`.

Screenshots: `docs/workflows/crm-feel-2026-08-17-evidence/w3/<screen>-<width>-fold.png` and
`-full.png` for 1440, 1920 and 2560. The 2560 shots are the owner's real working view.

---

## 0. How this was measured, and what is BLOCKED

**Live sign-in was down the whole time this ran. Nobody could sign in, including the owner.**

Two attempts, 60 seconds apart, both failed the same way:

```
POST https://fundhub.ai/api/auth/login  -> 500
{"ok":false,"error":"internal_error","message":"cannot execute INSERT in a read-only transaction"}

GET  https://fundhub.ai/api/auth/session (any token, incl. one 6 minutes old) -> 503
{"ok":false,"error":"auth_unavailable","db":"down"}

GET  https://fundhub.ai/api/health -> 200 {"ok":true,"db":"up","migrations":159,"pending":0}
```

Health says the database is up because health only *reads*. Writes fail, so no session can be
created, so no signed-in live measurement was possible. This is a production outage, not a finding
of this audit, and nothing here touched it.

**What was done instead** (same method W2 used):

1. Every file was fetched from `https://fundhub.ai` and sha256-compared to this working tree.
   At the time of measurement (20:47–20:53) **all six screen files and all three stylesheets were
   byte-identical live vs tree**: `pipeline.html`, `command-center.html`, `closer-dashboard.html`,
   `finance-os.html`, `messaging.html`, `staff-teams.html`, `fundhub-brand.css`,
   `crm-sidebar.css`, `finance-os.css`. `shell.js` differed only in its nav list (live carries
   `subscriptions.html`; the tree does not). Every width, padding and lock rule in `shell.js` was
   diffed line by line and is **identical** live vs tree.
2. Those same files were then rendered from a plain static file server (no dev server, no
   database, no request to fundhub.ai) at 1440, 1920 and 2560 and measured in Chromium
   (Playwright 1.62.1). Colours quoted below are read two ways: from the browser's computed
   styles **and** by decoding the actual pixels out of the PNG screenshots.
3. **Re-checked at write-up time:** the six screen HTML files were edited by other sessions at
   21:00 (nav-list rows and a pipeline data-fetch change — no CSS touched). Every `file:line`
   cited below was re-verified against the current tree and still points at the rule quoted.
   The two shared stylesheets were untouched all day.

### UNVERIFIED (live login down — 500 read-only transaction)

| What | Why it could not be measured | What I would have measured |
|---|---|---|
| Card widths in data-driven rows (pipeline kanban cards, roster rows, message list rows) | No API, so those rows never render | Width of every sibling card in each row, to catch uneven rows with real content |
| Real table width vs its container | Only header rows render; body is empty | `table.width` vs container inner width on staff-teams roster, closer-dashboard deal tables |
| Pipeline board column count and total board width at 2560 | Board shows "Loading the board…" | Whether the kanban columns use the 1280px they are given, or overflow it |
| Whether any panel changes colour once populated | No data | Populated vs empty background of `.holds-panel`, `.empty-rail`, `.empty-box` |

Everything else below is measured, with numbers.

---

## 1. The layout stops growing at 1508px wide. Above that, the extra screen is empty paper.

**(a) What the owner sees.** When he makes the window bigger, the app does not get bigger. The work
sits in a strip down the middle and the rest of the screen is blank. On his 2560 screen, four out of
every ten pixels across are empty.

**(b) The measurement.** Content column width, measured at three widths:

| Screen | 1440 | 1920 | 2560 | Empty space at 2560 |
|---|---|---|---|---|
| pipeline | 1212 | 1280 | 1280 | 1052px (41.1% of the screen) |
| command-center | 1212 | 1280 | 1280 | 1052px (41.1%) |
| finance-os | 1164 | 1280 | 1280 | 1052px (41.1%) |
| messaging | 1212 | 1280 | 1280 | 1052px (41.1%) |
| staff-teams | 1212 | 1280 | 1280 | 1052px (41.1%) |
| closer-dashboard | 1212 | 1692 | 2332 | 0 — this one is full width (see §7) |

The rail is a fixed 228px. 228 + 1280 = **1508px**. That is the exact viewport width above which
nothing on five of the six screens ever grows again.

Dead space, measured as literal pixel colour across the screenshot (scan line y=400):

```
pipeline @2560   rail #0A0A0A 0–225 | EMPTY #FCFCFC 228–753 (526px) | board #EDECEE 754–2033 | EMPTY #FCFCFC 2034–2559 (526px)
command-center   rail          0–225 | EMPTY 228–767 (540px) | panel #FFFFFF 769–2018 | EMPTY 2020–2559 (540px)
staff-teams      rail          0–225 | EMPTY 228–777 (550px) | card  #FFFFFF 779–2008 | EMPTY 2010–2516 (507px)
messaging        rail          0–225 | EMPTY 228–753          | 3 columns 754–2034     | EMPTY 2034–2559
```

At 1440 the same scan shows **no empty gutters at all** — the content fills the width. The problem
appears only above 1508px, which is exactly where the owner works.

At 1920 it is already 412px empty (21.5%).

**(c) file:line.**

- `public/app/fundhub-brand.css:70` — `:root{ --fh-maxw:1280px; --fh-statusbar:0px; }`
- `public/app/fundhub-brand.css:72` — `.fh-maxw{max-width:var(--fh-maxw);margin-inline:auto}`
- Applied at: `public/app/pipeline.html:373`, `public/app/command-center.html:758`,
  `public/app/messaging.html:430`, `public/app/staff-teams.html:235`,
  `public/app/finance-os.html:82` and `:277`
- Rail width: `public/app/crm-sidebar.css:6` — `--fh-side-w: 228px`;
  `public/app/crm-sidebar.css:36` and `public/app/shell.js:611` / `:614` re-assert it `!important`
- There is **no breakpoint above 1201px anywhere in the app.** Every media query in the three shared
  stylesheets and all six screens is a `max-width` query (860, 900, 820, 640, 520, 480, 390…). The
  only `min-width` queries app-wide are four `@media (min-width:1201px)` rules on other screens
  (`agent-editor.html:48`, `journeys.html:78`, `ops-admin.html:62`,
  `products-commissions.html:48`) and they only add right padding for the header chip. So the app
  has no idea a screen can be wider than about 1200px.

**(d) Fixable in the shared stylesheet?** Yes — one token, `--fh-maxw`, at
`fundhub-brand.css:70`. Changing that one value changes five of the six screens at once.

> ### OPEN-QUESTION for the owner — the standard and the need disagree
>
> `docs/UI-STANDARDS.md` §1 says, word for word: **"Max content width 1280px, centered."**
> The code follows that rule exactly. So the 1052px of empty space at 2560 is not a bug — it is
> the written standard doing what it says.
>
> The owner works zoomed out on a wide screen and says the layout does not scale with him. Both
> things cannot be true at once. **This is a decision only the owner can make**, and W3 is not
> making it. The options, stated plainly, with no recommendation attached:
> 1. Keep 1280px. The wide screen stays mostly empty. Nothing changes.
> 2. Raise the number (e.g. 1600 or 1760). Less empty space; long text lines get longer.
> 3. Make it fluid with a ceiling (e.g. `min(96%, 1760px)`). Fills the screen, still has a limit.
> 4. Drop the cap entirely — which is what `closer-dashboard.html` already does today, and §7
>    shows what that looks like.
>
> Whatever is chosen, `docs/UI-STANDARDS.md` §1 has to be edited to match, or the next agent will
> put the 1280px back.

---

## 2. Header, footer and banners run the full width while the content stays in the middle strip

**(a) What the owner sees.** The dark bar at the top and the strip at the bottom stretch all the way
across, but the actual page sits in a narrow block in the middle. The sign-out button ends up about
a thousand pixels away from anything it belongs to. It looks like two different pages stacked.

**(b) The measurement.** Widths at 2560 (usable width beside the rail is 2332px):

| Screen | top bar | bottom bar / banner | content column | mismatch |
|---|---|---|---|---|
| pipeline | 1280 | 1280 | 1280 | none — this is the only consistent one |
| command-center | 1280 (inside the column) | statusbar 2332, beta banner 2332 | 1280 | 1052px |
| closer-dashboard | 2332 | 2332 | 2332 | none (all full width) |
| finance-os | 2332 | foot 2332, banner 2332 | 1280 | 1052px |
| messaging | 2332 | 2332 | 1280 | 1052px |
| staff-teams | 2332 | foot 2332 | 1280 | 1052px |

So on four screens the chrome is 1052px wider than the content it sits above.

**(c) file:line.**

- `public/app/staff-teams.html:42` `.topbar{height:57px;…padding:0 24px}` — outside `.fh-maxw`
- `public/app/staff-teams.html:235` `<div class="content fh-maxw">` — the content is capped, the bar is not
- `public/app/finance-os.html:55` `.topbar{min-height:57px;…padding:10px 24px}` vs `:82` `#fosWrap{max-width:var(--fh-maxw)}`
- `public/app/messaging.html:39` `header.topbar{…}` vs `:430` `<main class="fh-maxw">`
- `public/app/command-center.html:758` `<main class="fh-maxw">` with the status bar mounted outside it by `shell.js`

**(d) Fixable in the shared stylesheet?** Partly. The shared sheet can give the bars the same
centred column (one rule reusing `--fh-maxw`), but each screen's markup decides whether its bar is
inside or outside the capped element, so a few screens need a one-line markup change too.

---

## 3. Panels are pure white on a page that is *almost* white — the dirty seam

**(a) What the owner sees.** The boxes are a hair brighter than the page behind them. It is not
enough to read as a card, and it is too much to read as one surface, so the screen looks slightly
smudged — like tiles that do not quite line up.

**(b) The measurement.** Page background is `--paper` **#FCFCFC**. Panel background is
**#FFFFFF**. The difference is **9 points total across red, green and blue (3 points each)** and the
contrast ratio is **1.03:1**. For comparison, plain black on white is 21:1.

Count of panels doing this, at 2560, per screen:

| Screen | #FCFCFC → #FFFFFF panels |
|---|---|
| command-center | 19 |
| messaging | 8 |
| staff-teams | 7 |
| closer-dashboard | 4 (plus 4 more in the *opposite* direction, see below) |
| finance-os | 2 |
| pipeline | 1 |

On closer-dashboard it runs both ways on the same screen: `.calc-panel` is #FFFFFF on a #FCFCFC
page, and inside it `.big-tile` is #FCFCFC on that #FFFFFF panel. Same 9-point step, opposite
direction, one screen.

**(c) file:line.** There is **no `--surface` token in the shared brand file at all**. Thirteen
screens each declare their own:

- `public/app/pipeline.html:19` · `command-center.html:20` · `closer-dashboard.html:18` ·
  `messaging.html:19` — each `--surface:#FFFFFF;`
- `public/app/finance-os.css:43` — `:root{ --surface:#FFFFFF; … }`
- `public/app/staff-teams.html:48` and `:147` — hard-coded `background:#fff` (no token at all)
- Page colour: `public/app/fundhub-brand.css:7` — `--paper:#FCFCFC`
- The opposite-direction case: `public/app/closer-dashboard.html:97` `.calc-panel{background:var(--surface)…}`
  and `:106` `.big-tile{background:var(--paper)…}`

**(d) Fixable in the shared stylesheet?** Yes, and this is the single highest-value shared fix.
Define one surface token in `fundhub-brand.css` and either make panels genuinely different from the
page or genuinely the same — 9 points is the worst of both. The 13 local `--surface:#FFFFFF`
declarations would then need deleting screen by screen (that part is not shared-sheet work).

---

## 4. Some panels are separated by a 1px pure-black line

**(a) What the owner sees.** A hard black hairline runs across the page between blocks. On a light
page it reads like a crack, not a divider.

**(b) The measurement.** On command-center the content column is painted black underneath and the
panes sit on top with a 1px gap, so the black shows through as a line. Read straight out of the
2560 screenshot pixels:

```
command-center-2560-fold.png, column x=754–2034
  y=421  #FCFCFC   (pane)
  y=422  #0A0A0A   (the gap — 1px of pure black, full 1280px width)
  y=423  #FCFCFC   (next pane)
```

Contrast of that line against the page: **19.3:1** — the highest-contrast edge on the screen, used
to separate two blocks that are already separated by being blocks.

Messaging uses the same trick with a grey: `main` is painted `--line` #E4E4E7 with a 1px gap,
giving 1px grey seams at x=1042 and x=1733 (contrast 1.24:1 — nearly invisible, so the three
columns instead read as one undivided field).

**(c) file:line.**

- `public/app/command-center.html:165–173` — `main{…gap:1px;background:var(--ink);…}`
- `public/app/messaging.html:87` — `main{…grid-template-columns:288px 1fr 300px;background:var(--line);gap:1px;}`

**(d) Fixable in the shared stylesheet?** No — both rules live in the screens. Shared CSS cannot
reach them without an override.

---

## 5. Full seam list — every place two different background colours meet

Measured at 2560 across all six screens. "Delta" is the sum of the red+green+blue difference;
"contrast" is the WCAG ratio. A delta under about 40 is the "dirty seam" case — visible as a smudge,
not readable as a boundary.

| Outside colour | Inside colour | Delta | Contrast | Where (count) | Verdict |
|---|---|---|---|---|---|
| #FCFCFC paper | #FFFFFF | 9 | 1.03 | kpi-tile ×6, empty-rail ×3, stat ×4, card, calc-panel ×2, ctx-card, convo-head, thread-head, compose, filterbar, search button — **41 elements across all six screens** | dirty seam |
| #FFFFFF | #FCFCFC paper | 9 | 1.03 | 9 elements: `.big-tile` ×4 (closer-dashboard), pipeline `.search` + 2 drawer buttons, messaging `.search` + `.ctab` | dirty seam, and on closer-dashboard it is the reverse of the row above **on the same screen** |
| #FFFFFF | #FAFAFA | 15 | 1.04 | `span.fh-k` keyboard hint (all six screens) | dirty seam |
| #FCFCFC paper | #EDECEE board | 45 | 1.15 | pipeline `.board-wrap`, 1280×737 | weak seam — a large grey slab that neither joins nor separates |
| #FFFFFF | #F4F4F5 soft | 32 | 1.10 | staff-teams `th` ×6, messaging compose box, avatar | weak seam |
| #FCFCFC paper | #E4E4E7 line | 69 | 1.24 | messaging `main` (the 1px gap trick) | weak seam |
| #E4E4E7 line | #FCFCFC paper | 69 | 1.24 | messaging convo-col / thread-col / ctx-col | weak seam |
| #FFFFFF | #E4E4E7 line | 78 | 1.27 | staff-teams toggle switches ×2 | control, fine |
| #FCFCFC paper | #0A0A0A ink | 726 | 19.3 | topbar + statusbar (closer-dashboard, messaging), main (command-center), dark buttons, shell chip | hard edge — intended, but see §6 |
| #0A0A0A ink | #FCFCFC paper | 726 | 19.3 | `.app` under the rail, command-center `section.pane` ×3 | hard edge |
| #0A0A0A ink | #FFFFFF | 735 | 19.8 | shell search button, messaging active tab | hard edge |
| #0A0A0A ink | #EDECEE | 681 | 16.8 | pipeline active rail tab | hard edge |
| #0A0A0A ink | #111113 card | 23 | 1.05 | pipeline / messaging `.live-pill` | dirty seam, dark side |
| #FCFCFC paper | #3A2A0A | 646 | 13.5 | beta banner (command-center, finance-os) | hard edge |
| #FCFCFC paper | #F2A69B alert | 193 | 1.91 | staff-teams data banner, 2560×29 — runs over the rail | hard edge |
| #0A0A0A ink | #F5CE8F warn | 564 | 13.3 | source badge in the header (all six) | hard edge |
| #FFFFFF | #A8D8B0 ok | 205 | 1.60 | staff-teams "active" switch | control, fine |

Summary: **the CRM uses only two kinds of edge — an almost-invisible one (1.03–1.27) and a
maximum-contrast one (13–19.8). There is nothing in between.** That is what "separate tiles with
seams" and "not expensive" come from: expensive software separates surfaces with a *small but
deliberate* step plus elevation, not with either a 3-point smudge or a black line.

---

## 6. Every screen's header is a different colour, height and padding

**(a) What the owner sees.** Click from one screen to the next and the top of the app flips from
black to white and changes height. It feels like leaving one program and entering another.

**(b) The measurement.**

| Screen | header background | header height (rendered @2560) | side padding |
|---|---|---|---|
| pipeline | #0A0A0A black | 44px | 16px |
| closer-dashboard | #0A0A0A black | 44px | 16px |
| messaging | #0A0A0A black | 44px | 16px |
| command-center | #FCFCFC paper | 44px | 16px |
| staff-teams | #FCFCFC paper | 57px | 24px |
| finance-os | #FCFCFC paper | 79px (wraps — `min-height:57px` + `flex-wrap`) | 24px |

Bottom bars are just as split: 26px tall on pipeline/command-center/closer-dashboard/messaging,
50px on finance-os/staff-teams.

**(c) file:line.** `pipeline.html:42` · `closer-dashboard.html:47` · `messaging.html:39` (black,
44px, 16px) · `command-center.html:102–111` (paper, 44px, 16px) · `staff-teams.html:42` (paper,
57px, 24px) · `finance-os.html:55` (paper, min 57px, 24px).

**(d) Fixable in the shared stylesheet?** Yes — the header is the same component on all six
screens and is not defined in the shared sheet at all. One shared `.topbar` rule would replace six
private ones. That is a real change, not a token tweak, and it touches all six files.

---

## 7. One screen out of six ignores the cap entirely

**(a) What the owner sees.** closer-dashboard fills the whole screen while every other screen sits
in the middle strip. Going between them, the whole page jumps sideways by about 500 pixels. On that
screen a box for typing a 2-digit percentage is over 500 pixels wide.

**(b) The measurement.** closer-dashboard at 2560: `main` = 2332px (full width). No `.fh-maxw`
anywhere in the file. Its panels and inputs stretch with it:

| Element | width @1440 | width @2560 |
|---|---|---|
| `.calc-panel` ×2 | 576 | 1136 |
| `.big-tile` (full-width row) | 544 | 1104 |
| `input#iDraw` (requested draw) | 268 | 548 |
| `input#iFee` (success fee %) | 130 | 270 |

A 1104px-wide tile puts its label at the far left and its number at the far right, a metre apart.

**(c) file:line.** `public/app/closer-dashboard.html` — the string `fh-maxw` does not appear in the
file. `closer-dashboard.html:84` `main{flex:1;overflow-y:auto;padding:22px 24px 20px;…}`.

**(d) Fixable in the shared stylesheet?** No. It needs one class added to that screen's markup
(or the cap decision from §1 applied everywhere).

---

## 8. Borders per screen — how many, and how many are decoration

**(a) What the owner sees.** Everything has a box drawn around it, and the boxes have no depth. It
reads like a form, not like software.

**(b) The measurement.** Bordered elements per screen at 2560 (rail excluded; measured with no
data loaded, so table rules would multiply with real rows):

| Screen | bordered elements | full 4-side boxes | breakdown | load-bearing | decoration |
|---|---|---|---|---|---|
| pipeline | 13 | 10 | 3 section separators, 7 control outlines, 3 chips | 10 | 3 |
| command-center | 38 | 25 | 12 separators, 15 control outlines, 11 boxes | 27 | 11 (6 kpi-tile boxes, 3 empty-rail boxes, roster box, roster-body top rule) |
| closer-dashboard | 56 | 17 | **36 table cell rules**, 8 panel boxes, 10 control outlines, 2 separators | 20 | 36 (see below) |
| finance-os | 9 | 6 | 2 separators, 6 controls, 1 banner | 8 | 1 |
| messaging | 23 | 17 | 6 separators, 11 control outlines, 6 boxes | 17 | 6 (`.empty-box` ×3, `.ctx-card`, avatar, active-tab outline) |
| staff-teams | 25 | 14 | 10 separators, 9 control outlines, 5 boxes, 1 tab underline | 20 | 5 (4 `.stat` boxes; `.card`'s outline duplicates its own `.card-hd` rule) |

**Load-bearing** = separates things that are genuinely different (chrome from content, a table
header row from its body, the outline of a clickable control).
**Decoration** = a box drawn around something that is already separated by space or by its own fill
— exactly UI-STANDARDS §7 "no borders around everything" and the slop line "five borders where
spacing would do".

Worked example, command-center: the six `.kpi-tile` boxes sit in a grid with a 6px gap **and** a
different fill **and** a 1px border. Three separations for one job. Remove the border and nothing is
lost.

Worked example, closer-dashboard: 36 of its 56 borders are table cell rules — a 1px line under
every single cell (`#F4F4F5` ×19, `#E4E4E7` ×12, plus five 2px `#E4E4E7` top rules). §7 says
gridlines must not be heavier than the data.

**Nothing on any of these six screens has a resting shadow.** Every `box-shadow` in the six files
is a hover state, a focus ring, a fixed drawer, or a tooltip (`pipeline.html:214, 252, 267, 274`;
`staff-teams.html:96, 101, 136`; `crm-sidebar.css:273, 328`). So a panel is told apart from the page
by a 3-point colour step and a 1px #E4E4E7 line at **1.24:1** contrast, and by nothing else. That is
the whole reason the surface reads flat and cheap.

**(c) file:line.** `command-center.html:576–580` `.kpi-tile{…border:1px solid var(--line);border-radius:6px;padding:8px 10px}` ·
`closer-dashboard.html:112` and `:114` (table cell rules) · `staff-teams.html:147` `.stat{…border:1px solid var(--line)…}` ·
`messaging.html:265` `.ctx-card{…border:1px solid var(--line)…}`

**(d) Fixable in the shared stylesheet?** Partly. A shared "surface" rule (fill + shadow, no
border) can be defined once in `fundhub-brand.css`, but the per-screen border declarations above
would each need removing.

---

## 9. Corner radius: 14 different values, and a different one per screen for the same object

**(a) What the owner sees.** The corners are rounded by different amounts in different places. Not
consciously noticed, but it is why nothing looks like it came from one set.

**(b) The measurement.** Across the three shared stylesheets and six screens: **144
`border-radius` declarations using 14 distinct values** — 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14
and 20px.

The same object — "a panel" — has a different radius on every screen:

| Screen | main panel | radius |
|---|---|---|
| command-center | `.kpi-tile` | 6px |
| closer-dashboard | `.big-tile` / `.calc-panel` | 7px / 9px (two different radii, one nested inside the other) |
| messaging | `.ctx-card` | 8px |
| finance-os | `.fh-panel` | 8px |
| staff-teams | `.stat` / `.card` | 10px |
| pipeline | `.rail-tab` | 6px top only |

**(c) file:line.** `command-center.html:579` (6) · `closer-dashboard.html:106` (7) and `:97` (9) ·
`messaging.html:265` (8) · `finance-os.css:64` (8) · `staff-teams.html:48` and `:147` (10).

**(d) Fixable in the shared stylesheet?** Yes for the future — add a radius token to
`fundhub-brand.css`. The 144 existing literals still have to be replaced file by file.

---

## 10. Panel padding: six screens, six different values

**(a) What the owner sees.** The gap between a box's edge and its writing changes from screen to
screen, so the density keeps shifting.

**(b) The measurement.** Padding inside the main panel of each screen:

| Screen | panel | padding |
|---|---|---|
| command-center | `.kpi-tile` | 8px 10px |
| closer-dashboard | `.calc-panel` | 13px 15px 15px |
| closer-dashboard | `.big-tile` | 10px 12px |
| messaging | `.ctx-card` | 10px 12px |
| staff-teams | `.stat` | 14px 16px |
| staff-teams | `.card-hd` | 13px 16px 12px |
| finance-os | `.fh-row` | 15px 18px |
| pipeline | `.filterbar` | 7px 14px |

Page wrapper padding is closer but still not equal: closer-dashboard `22px 24px 20px`, finance-os
`22px 24px 44px`, staff-teams `22px 24px 40px`, command-center and messaging `0` (they use 1px
gaps instead), pipeline `0`.

**(c) file:line.** `command-center.html:580` · `closer-dashboard.html:97`, `:106`, `:84` ·
`messaging.html:265` · `staff-teams.html:147`, `:50`, `:46` · `finance-os.css:65` ·
`finance-os.html:59` · `pipeline.html:110`.

**(d) Fixable in the shared stylesheet?** Yes for new work (one padding token); existing values
are per-screen.

---

## 11. Full off-8px-scale spacing list

UI-STANDARDS §2 allows **only** 8 / 16 / 24 / 32 / 48 / 64.

Counted over `fundhub-brand.css`, `crm-sidebar.css`, `finance-os.css` and the six screens, every
`padding`, `margin`, `gap`, `row-gap` and `column-gap` literal, with comments stripped so nothing
inside a `/* … */` is counted:

- **on-scale declarations: 106** (8px ×60, 16px ×37, 24px ×8, 64px ×1 — **32px and 48px are never
  used anywhere**)
- **off-scale declarations: 598**, using **23 distinct forbidden values**
- **85.0% of all authored spacing in these files is off the required scale**
- A further **53 off-scale** and 11 on-scale values live in CSS strings that JavaScript injects at
  runtime; those are marked `(js)` below and are counted separately from the 598.

| Value | Uses (css) | Where (file:line) |
|---|---|---|
| 6px | 78 | fundhub-brand.css:40 · crm-sidebar.css:138,151,281 · finance-os.css:52 · pipeline.html:48,102,115,123,128,129,130,131,147,166,178,200,206,218,252,259,279,289 · command-center.html:127,252,259,297,301,301,306,351,367,374,421,439,498,508,518,545,573,613,624 · closer-dashboard.html:112,114,121,135,139,146,167,169 · finance-os.html:76,93,104 · (+14 js) |
| 10px | 66 | crm-sidebar.css:92,151,218,229,284 · finance-os.css:81,88 · pipeline.html:113,124,166,172,175,187,193,193,199 · command-center.html:210,221,222,263,288,410,438,476,477,495,503,574,580 · closer-dashboard.html:102,106,106,111,121,121,130,139,144,146,154,155 · finance-os.html:55,55,60,70,70,88,126,135,159,170,182 · messaging.html:158,182,182 · (+7 js) |
| 9px | 58 | fundhub-brand.css:37,41 · crm-sidebar.css:138,199,281 · finance-os.css:90 · pipeline.html:43,48,116,131,146,151,211,252,269 · command-center.html:85,114,133,205,221,254,328,356,374,414,476,484,485,507 · closer-dashboard.html:69,76,77,140 · finance-os.html:76,94,125,135,186,189 · messaging.html:72,77,113,124,162,187,224,235,242,250,251,254,289 · staff-teams.html:71,104,111,118,129,140 · (+4 js) |
| 12px | 54 | crm-sidebar.css:97,122 · finance-os.css:49,65 · pipeline.html:99,141,164,164,186,187,189,275,279,280,289 · command-center.html:205,221,221,414,476,476,485,495,495 · closer-dashboard.html:95,106,121,153,162,163 · finance-os.html:93,99,109,109,116,199 · messaging.html:112,124,157,170,182,224,256,263,265,283,308,327 · staff-teams.html:50,50,98,129,138,146 · (+7 js) |
| 7px | 48 | crm-sidebar.css:171,226,280 · finance-os.css:56 · pipeline.html:48,99,99,111,112,135,175,199,203,206,211,211,236,275,299 · command-center.html:133,190,197,279,288,329,359,507,634,636,669 · finance-os.html:102 · messaging.html:77,113,115,208,213,217,221,227,237,243,257,272,277,280,320,327,328 · (+3 js) |
| 4px | 50 | fundhub-brand.css:41 · finance-os.css:56,83 · pipeline.html:48,48,131,131,138,165,220,257,269,280,283,288 · command-center.html:50,133,133,263,263,565,587 · closer-dashboard.html:41,93,144,166 · finance-os.html:101,126,165,187,191 · messaging.html:77,77,115,140,141,142,147,150,151,162,194,196,198,205,205,213,214,238,244 |
| 14px | 41 | finance-os.css:90 · pipeline.html:96,111,135,147,168,193,193,293 · command-center.html:122,190,190,210,210,210,651 · closer-dashboard.html:88,155,162,162,173 · finance-os.html:60,70,71,83,84,111,186 · messaging.html:178,301,307,314,339 · staff-teams.html:42,49,55,80,81,140,147,152 · (+7 js) |
| 5px | 34 | crm-sidebar.css:206 · pipeline.html:113,116,124,227,236,236,280 · command-center.html:309,310,337 · closer-dashboard.html:112,114,164,167,169 · finance-os.html:107,118,127,181,181,181 · messaging.html:113,140,172,207,256,268,276,280,331 · staff-teams.html:59,92,118 · (+2 js) |
| 2px | 32 | finance-os.css:77 · pipeline.html:89,96,132,151,225,227,233,277 · command-center.html:247,281,301,316,316,383,447,545,632,634 · closer-dashboard.html:91,145 · finance-os.html:106,149,177 · messaging.html:138,217,272,277,289 · staff-teams.html:114,120,150 · (+1 js) |
| 3px | 28 | crm-sidebar.css:128 · finance-os.css:69 · pipeline.html:52,177,204,222,225,231,236,255,279 · command-center.html:155,205,558 · closer-dashboard.html:125,131 · finance-os.html:106,121 · messaging.html:81,116,118,191,208,210,225,329,329 · staff-teams.html:71 |
| 11px | 24 | crm-sidebar.css:170,304,304 · pipeline.html:187 · command-center.html:498 · finance-os.html:88,107,117,162,168 · messaging.html:187,200,220,221,238,244,251,260,296,307 · staff-teams.html:65,81,104,126 |
| 1px | 23 | crm-sidebar.css:206 · pipeline.html:84,102,128,203,265,287 · command-center.html:170,297,351,397,601 · closer-dashboard.html:82 · finance-os.html:116,172 · messaging.html:87,142,142,151,151,160,249,267 |
| 18px | 18 | crm-sidebar.css:138,171,280,281 · finance-os.css:59,66,82,97,104 · pipeline.html:182,184 · closer-dashboard.html:76,163 · finance-os.html:197,198 · staff-teams.html:138,139,140 · (+2 js) |
| 15px | 17 | finance-os.css:66,82 · closer-dashboard.html:97,97 · finance-os.html:88,135,154,162,168,181,183,186,190,190,197,198 · staff-teams.html:138 · (+2 js) |
| 13px | 9 | closer-dashboard.html:97 · finance-os.html:94,117,183 · messaging.html:235,260,307 · staff-teams.html:50,65 · (+2 js) |
| 20px | 6 | finance-os.css:48,58 · closer-dashboard.html:84 · finance-os.html:101,111 · messaging.html:254 |
| 22px | 4 | finance-os.css:104 · closer-dashboard.html:84 · finance-os.html:59 · staff-teams.html:46 |
| 28px | 2 | finance-os.css:48 · pipeline.html:168 · (+2 js) |
| 40px | 2 | pipeline.html:90 · staff-teams.html:46 |
| 17px | 1 | finance-os.html:154 |
| 44px | 1 | finance-os.html:59 |
| −1px | 1 | staff-teams.html:65 |
| −4px | 1 | closer-dashboard.html:140 |

Notes on what is **not** counted as a violation: computed `margin` values of 502–1667px seen at
runtime are the browser centring the capped column (`margin-inline:auto`), not authored spacing.
A `56px` value in `messaging.html:98` is inside a code comment and was excluded.

**(d) Fixable in the shared stylesheet?** No. 598 literals live in nine files. The shared sheet can
publish the scale as tokens; the replacement is per-file work.

---

## 12. Card widths within a row

**(a) What the owner sees.** Nothing wrong here, on the parts that could be measured.

**(b) The measurement.** Every row of sibling cards that renders without data is even:

| Screen | row | widths @1440 | widths @2560 |
|---|---|---|---|
| command-center | `.kpi-grid` | 292, 292, 292, 292 | 309, 309, 309, 309 |
| command-center | `.kpi-grid` row 2 | 292, 292 (+2 empty slots) | 309, 309 (+2 empty slots) |
| staff-teams | `.stats` | 282 ×4 | 299 ×4 |
| closer-dashboard | `.calc-grid` | 576, 576 | 1136, 1136 |
| closer-dashboard | `.res-grid` | 267, 267 | 547, 547 |

**No uneven card row was found** — slop signature #1 is clean on what rendered.

Two notes that are not card rows but are width behaviour worth recording:

- messaging's three panes are **288px / 690px / 300px** at 2560 (288 / 622 / 300 at 1440). The two
  outer panes are fixed px and never grow; all extra width goes to the middle pane
  (`messaging.html:87`).
- command-center's KPI tiles are authored as a 2-column grid (`command-center.html:570–574`,
  `grid-template-columns:1fr 1fr`) but the shared sheet forces 4 columns with `!important`
  (`fundhub-brand.css:129–131`). So the second row shows 2 tiles and 2 empty slots — a row that
  looks half-finished. The screen's own design and the shared override disagree.

**UNVERIFIED:** rows built from API data (kanban cards, roster rows, conversation rows) never
rendered. See §0.

---

## 13. Content is hidden while a third of the screen sits empty

**(a) What the owner sees.** On the pipeline, the row of pipeline tabs is cut off and has to be
scrolled sideways — while 1052 pixels of blank paper sit next to it.

**(b) The measurement.** pipeline `.railbar` at all three widths:

| Viewport | strip width available | width the 8 tabs need | hidden behind a scroll | empty paper on the page |
|---|---|---|---|---|
| 1440 | 1212 | 1840 | 628px | 0 |
| 1920 | 1280 | 1840 | 560px | 412px |
| 2560 | 1280 | 1840 | 560px | 1052px |

At 2560 the app hides 560px of navigation inside a scroll strip while leaving 1052px of the screen
blank. That is the clearest single proof that the cap is fighting the hardware.

**(c) file:line.** `public/app/pipeline.html:96–97` — `.railbar{…overflow-x:auto;}` inside
`pipeline.html:373` `<div class="shell fh-maxw">`.

**(d) Fixable in the shared stylesheet?** Only via the §1 decision.

---

## 14. Tables

Measured at 2560 with no data: no table stops short of its container.

| Screen | table | width | container inner width | short by |
|---|---|---|---|---|
| closer-dashboard | `table.deal` | 2254 | 2254 | 0 |
| closer-dashboard | `table.pm` ×3 | 1118 | 1118 | 0 |
| staff-teams | `table#rosterTbl.grid` | 1230 | 1230 | 0 |

**UNVERIFIED with real rows** — see §0. What would change with data is column widths, not the
table's outer width, since all of these are `width:100%`.

---

## Ranked list — worst first

| # | Cause | Why it ranks here | file:line | Shared-sheet fix? |
|---|---|---|---|---|
| 1 | Content capped at 1280px; nothing grows above a 1508px window. 1052px (41.1%) empty at 2560, 412px (21.5%) at 1920 | It is the owner's exact complaint, it affects five of six screens, and one token controls it | `fundhub-brand.css:70`, `:72`; applied at `pipeline.html:373`, `command-center.html:758`, `messaging.html:430`, `staff-teams.html:235`, `finance-os.html:82`,`:277` | **Yes** — but see the OPEN-QUESTION in §1; §1 of UI-STANDARDS mandates the 1280 |
| 2 | Panels are #FFFFFF on a #FCFCFC page — a 9-point, 1.03:1 step, on 41 elements, in both directions | This is the "dirty seam" that makes the surface look smudged rather than layered | `pipeline.html:19`, `command-center.html:20`, `closer-dashboard.html:18`, `messaging.html:19`, `finance-os.css:43`, `staff-teams.html:48`,`:147`; page colour `fundhub-brand.css:7` | **Yes** for the token; 13 local declarations must then be deleted |
| 3 | Chrome runs full width (2332) while content stays 1280 on four screens | Biggest single "two different pages stacked" cue at 2560 | `staff-teams.html:42` vs `:235`; `finance-os.html:55` vs `:82`; `messaging.html:39` vs `:430`; `command-center.html:758` | Partly |
| 4 | No resting shadow anywhere; a panel is defined only by a 1.24:1 hairline | Flat + faint = "not expensive software" | all six files (`box-shadow` only on hover/focus/drawer) | **Yes** — one shared surface rule |
| 5 | Header differs per screen: black 44px vs white 57px vs white 79px, 16px vs 24px padding | Every navigation makes the top of the app jump and change colour | `pipeline.html:42`, `closer-dashboard.html:47`, `messaging.html:39`, `command-center.html:102`, `staff-teams.html:42`, `finance-os.html:55` | **Yes** if the header moves into the shared sheet |
| 6 | closer-dashboard is full-bleed while the other five are capped; inputs stretch to 548px | Page jumps ~500px sideways between screens; stretched controls look broken | `closer-dashboard.html` (no `fh-maxw`), `:84` | No |
| 7 | Decorative borders: 11 of 38 on command-center, 36 of 56 on closer-dashboard are cell rules | §7 data-ink and the slop line "five borders where spacing would do" | `command-center.html:576`, `closer-dashboard.html:112`,`:114`, `staff-teams.html:147`, `messaging.html:265` | Partly |
| 8 | 598 off-8px spacing declarations vs 106 on-scale (85% off), 23 distinct bad values | Nothing lines up between screens; the cause of the "hand-placed" feel | full table in §11 | No (per-file) |
| 9 | 14 distinct corner radii; the same panel is 6/7/8/9/10px depending on screen | Reads as parts from different kits | `command-center.html:579`, `closer-dashboard.html:97`,`:106`, `messaging.html:265`, `finance-os.css:64`, `staff-teams.html:48`,`:147` | **Yes** for future work |
| 10 | 1px pure-black gap seams between panes (contrast 19.3:1) | Highest-contrast line on the screen, separating things already separated | `command-center.html:165–173`; grey variant `messaging.html:87` | No |
| 11 | 560px of pipeline tabs hidden in a scroll strip while 1052px of screen is blank | Content is being hidden for no reason at the owner's width | `pipeline.html:96–97` | Via #1 |
| 12 | Panel padding differs six ways across six screens (8/10 · 10/12 · 13/15 · 14/16 · 15/18 · 7/14) | Density shifts screen to screen | §10 table | Future only |
| 13 | Shared sheet forces 4 KPI columns over command-center's authored 2, leaving a half-empty row | A row that looks unfinished on the owner's main screen | `fundhub-brand.css:129–131` vs `command-center.html:570` | **Yes** |
| 14 | A third max content width exists: `finance-os.css:48` `.fh-wrap{max-width:960px}` | Finance sub-screens are narrower again — three different widths in one product | `finance-os.css:48` | **Yes** |

### Clean on what could be measured

- No uneven card rows (§12).
- No table stopping short of its container (§14).
- pipeline is the only screen whose header, footer and content all share one width.

---

## Evidence index

- Screenshots: `docs/workflows/crm-feel-2026-08-17-evidence/w3/` — 36 files,
  `<screen>-{1440,1920,2560}-{fold,full}.png` for all six screens.
- Colour readings are taken both from Chromium computed styles and by decoding the PNG pixels
  directly, so every colour pair above can be re-checked from the screenshots alone.
