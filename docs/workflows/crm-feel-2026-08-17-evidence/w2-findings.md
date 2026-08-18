# W2 — Why the CRM "zooms in and out" and why the font reads small

Measured 2026-08-17. Read-only audit. No repo file was changed except this one and
the screenshots under `crm-feel-2026-08-17-evidence/w2/`.

**Short answer, in one line:** nothing on any screen is actually zooming. Seven
screens each pick their own text size, their own line spacing and their own page
width, and the shared stylesheet accidentally re-sizes the left menu on some
screens but not others. Clicking between screens changes all three at once, and
your eye reads that as a zoom.

---

## 0. What I could and could not measure — read this first

### BLOCKED: nobody can log in to fundhub.ai right now

I could not open a single signed-in screen on the live site. This is a live
outage, not a test-account problem.

* `POST https://fundhub.ai/api/auth/login` answers **500**:
  `{"ok":false,"error":"internal_error","message":"cannot execute INSERT in a read-only transaction"}`
* The login page shows the owner:
  *"Server error, not a wrong password — cannot execute INSERT in a read-only transaction."*
* `GET /api/auth/session` with a saved token answers **503** `{"ok":false,"error":"auth_unavailable","db":"down"}`.
* Seven saved owner sessions from earlier audits (0.1h to 21.5h old) were all
  re-tested. All seven got the same 503.
* Tried twice, ~25 minutes apart, per the two-failure rule. Between the two
  tries the database part-recovered (reads started answering 401 instead of 503)
  but writes stayed blocked, so a new login still could not be created.

Plain English: the live database will let the site read but not write. Signing in
has to write one row, so signing in fails. **W1 and W3 will hit this same wall.**

### What I measured instead, and why it is still trustworthy

The page files, the two shared stylesheets and `data.js` are public files — no
login needed to fetch them. I downloaded them straight from `https://fundhub.ai`
and checked them byte for byte against this working tree:

| File | live vs working tree |
|---|---|
| `public/app/fundhub-brand.css` | **identical** |
| `public/app/crm-sidebar.css` | **identical** |
| `public/app/finance-os.css` | **identical** |
| `public/app/data.js` | **identical** |
| `pipeline.html` `command-center.html` `closer-dashboard.html` `finance-os.html` `messaging.html` `staff-teams.html` | **identical** (6 of 7) |
| `public/app/shell.js` | **differs** — the only difference is which roles see the "Lenders" menu row. It contains no font-size, line-height, zoom or scale change. |
| `public/app/my-numbers.html` | **differs** — the working tree adds an "Offer stack" block that is not live yet. It adds 7 more font-size declarations (13px, 12.5px, 11.5px, 11px, 9.5px), all at sizes the file already uses, so the *distinct* size set is the same 13 values in both. I measured the **live** file; nothing in this finding changes either way. |

I then served those exact live files from a plain local file server (not
`netlify dev`, which is banned here) and measured them in Chromium 1.62.1 at
1440, 1920 and 2560 wide, and again at 80% and 67% browser zoom.

**The one limit:** the page's own `<script>` blocks were removed, because with
no working API they only redirect to the login page. So the numbers below cover
the whole left menu, the top bar, every heading, label, table header, empty-state
line and tile — but **not** rows that JavaScript builds from live data.

That limit is smaller than it sounds, and here is the proof: on six of the seven
screens the shared stylesheet forces **every** element inside the shell to one of
exactly four sizes with `!important` (see Cause 5), and no page anywhere uses an
inline `!important` font-size that could escape it (checked: 0 occurrences in all
seven files). So on those six screens, data rows *cannot* introduce a size I did
not already see. On My Numbers there is no such lock, so its real count is a
**floor**, not a ceiling.

### Warning for W4: two of these files are being edited right now

While I was measuring, other workflows in this batch changed
`public/app/pipeline.html`, `public/app/closer-dashboard.html` and
`public/app/data.js` in the working tree. My numbers all come from the **live**
files, so they are not affected — but line numbers in those two pages move.

Re-checked after those edits: `pipeline.html` — `html,body` still line 35, the
`shell fh-maxw` div moved 372 → **373**. `closer-dashboard.html` — `html,body`
still line 43, still **zero** `fh-maxw` in the file, hard-pixel font-size
declarations went from 41 to **35** but the **same 15 distinct values** remain.
`fundhub-brand.css`, `crm-sidebar.css` and the other four pages are untouched, and
every citation against them is exact.

Anything I could not measure is listed again at the bottom.

---

## Cause 1 — The left menu changes size when you change screens

**(a) What you see.** The menu on the left is supposed to be the one thing that
never moves. It does move. On six screens the menu words are bigger. On My
Numbers they are smaller, the rows are tighter, and two more rows fit before you
scroll. Because the menu is on screen the whole time, your eye uses it as the
ruler — so when it shrinks, the *whole app* looks like it zoomed out.

**(b) The measurement.** Same menu markup, same 33 rows, on all seven screens:

| Screen | menu text | menu line height | one menu row | whole menu block |
|---|---|---|---|---|
| pipeline | **14px** | 16.8px | 30.8px | 1423px |
| command-center | **14px** | 16.8px | 30.8px | 1423px |
| closer-dashboard | **14px** | 16.8px | 30.8px | 1423px |
| finance-os | **14px** | 16.8px | 30.8px | 1423px |
| messaging | **14px** | 16.8px | 30.8px | 1423px |
| staff-teams | **14px** | 16.8px | 30.8px | 1423px |
| **my-numbers** | **11px** | **13.2px** | **27.19px** | **1304px** |

That is a 27% jump in text size and a **119px** change in how tall the menu is —
on a rail that is meant to be identical everywhere.

The same thing happens to the sign-out chip in the top-right corner. I injected
the exact chip `shell.js` builds (`shell.js:1491`, inline `font:500 11px/1`) into
each page and measured it:

| Screen | sign-out chip renders at |
|---|---|
| pipeline, command-center, closer-dashboard, finance-os, messaging, staff-teams | **14px** |
| my-numbers | **11px** |

Its own inline 11px loses, because an `!important` rule in the shared stylesheet
beats a plain inline style.

**(c) Where it comes from.**

* `public/app/crm-sidebar.css:172` — `.navitem{ font-size: var(--fs-caption, 11px) }`.
  This is what the menu is *meant* to be: 11px.
* `public/app/fundhub-brand.css:81-83` — `.app *, .shell *, .main *, .fh-maxw * { font-size: inherit !important; }`
  This forces every element inside those containers to take its parent's size. It
  has `!important`, so it beats line 172. The menu sits inside `.app`, so on six
  screens the menu is dragged up to 14px.
* `public/app/my-numbers.html:122` — the outer container is `<div class="app-shell">`,
  and `.app-shell` is **not** in the list on `fundhub-brand.css:81`. So on My
  Numbers the rule never fires and the menu keeps its intended 11px.

So the six screens are the ones that are wrong, measured against the sidebar's
own stylesheet.

**(d) Fixable in the shared stylesheet?** **Yes, entirely.** One selector change
in `fundhub-brand.css:81` — exclude the rail (`:not(.side):not(.side *)` or add
`.side` back with `!important`) and add `.app-shell` so the two shells behave the
same. Nothing in `public/app/*.html` has to change.

**Evidence:** `w2/pipeline-1440at100.png` vs `w2/my-numbers-1440at100.png` — the
same menu, side by side, visibly different sizes.

---

## Cause 2 — The page width jumps by up to 1092px between screens

**(a) What you see.** On Pipeline the whole page sits in a column about 1280px
wide with grey space each side. Click Command Center and the top bar suddenly
stretches the full width of the monitor. Click My Numbers and it snaps back in,
narrower than Pipeline was. Same text size the whole time — but the box around
it keeps changing, so it looks like the zoom changed.

**(b) The measurement.** Width of the top bar and of the main content column:

| Screen | at 1440 | at 1920 | at 2560 | capped? |
|---|---|---|---|---|
| pipeline | 1212 | **1280** | **1280** | yes, 1280px |
| command-center | 1212 | 1692 top bar / 1280 body | **2332 top bar** / 1280 body | body only |
| closer-dashboard | 1212 | **1692** | **2332** | **no cap at all** |
| finance-os | 1164 | 1692 / 1280 toolbar | **2332** / 1280 toolbar | toolbar only |
| messaging | 1212 | 1692 / 1280 body | **2332 top bar** / 1280 body | body only |
| staff-teams | 1212 | 1692 / 1280 body | **2332 top bar** / 1280 body | body only |
| my-numbers | 1212 | **1240** | **1240** | yes, but **1240px, not 1280** |

At 2560 the top bar is 1280px on Pipeline, 2332px on five screens and 1240px on
My Numbers. That is a **1092px** swing in the width of the bar across the top of
the screen, screen to screen. This gets worse the more zoomed out you work, which
is exactly what you reported.

**(c) Where it comes from.**

* `public/app/fundhub-brand.css:70,72` — the shared cap: `--fh-maxw:1280px` and
  `.fh-maxw{max-width:var(--fh-maxw);margin-inline:auto}`. Correct, and it works.
* `public/app/pipeline.html:373` — `<div class="shell fh-maxw">` — the cap is on
  the whole shell, so the top bar is capped too. This is the only screen that does that.
* `public/app/command-center.html:757`, `messaging.html:429`,
  `staff-teams.html:234`, `finance-os.html:276` — the cap is only on an inner
  block, so the top bar runs full width.
* `public/app/closer-dashboard.html` — **no `fh-maxw` anywhere in the file.** Nothing is capped.
* `public/app/my-numbers.html:40` — `.shell{padding:24px 22px;max-width:1240px}` —
  its own cap, 40px narrower than the shared one.

**(d) Fixable in the shared stylesheet?** **Partly.** The 1240px override
(`my-numbers.html:40`) can be beaten from the shared sheet. Closer Dashboard's
total lack of a cap cannot — nothing in the markup carries the class, so either
the shared sheet has to cap `.shell`/`.main` directly, or that one file gets the
class added. This overlaps W3's remit; flagging, not claiming.

---

## Cause 3 — Line spacing changes between screens, so blocks of text look bigger or smaller

**(a) What you see.** On some screens the lines sit further apart. Same size
letters, looser rows, so the block of text looks larger. Switch screens and it
tightens up again.

**(b) The measurement.** Line height on `body` and on the shell container:

| Screen | body line-height | `.app` line-height | an 11px label renders with |
|---|---|---|---|
| pipeline | `normal` | `normal` | `normal` (≈13.2px) |
| command-center | `normal` | `normal` | `normal` |
| closer-dashboard | `normal` | `normal` | `normal` |
| messaging | `normal` | `normal` | `normal` |
| **finance-os** | **21px (1.5)** | **21px** | — |
| **staff-teams** | **21px (1.5)** | **21px** | **16.5px** |
| **my-numbers** | **21px (1.5)** | **21px** | — |

At the same 14px text, rows are **16.8px tall on four screens and 21px on three**
— 25% taller. On an 11px label it is 13.2px vs 16.5px.

**(c) Where it comes from.**

* `public/app/finance-os.html:29` and `public/app/staff-teams.html:17` —
  `body{ … font-size:var(--fs-body); line-height:1.5; … }`
* `public/app/my-numbers.html:26` — `body{ … font-size:14px; line-height:1.5; … }`
* `public/app/pipeline.html:35`, `closer-dashboard.html:43`, `messaging.html:35`,
  `command-center.html:53` — `html,body{…}` with **no** `line-height` at all, so
  the browser default `normal` is used.
* Neither shared stylesheet sets a body line-height. `crm-sidebar.css:78-85` sets
  `1.2` for the rail only — and that one *is* consistent everywhere (measured
  16.8px on all seven screens, 13.2px on My Numbers only because the size is
  smaller there).

**Fixed-px line-height is NOT a real problem here.** I checked every rule on
every screen: 57 line-height declarations counted per screen, **36 unique** across
the seven screens and both shared sheets. Exactly **one** is a fixed pixel value:
`.pcell{line-height:38px}` in `staff-teams.html`. Everything else is unitless or
`normal`. So this hypothesis was worth testing and came back mostly clean — the
problem is `1.5` vs `normal`, not px vs unitless.

**(d) Fixable in the shared stylesheet?** **Yes.** Set one body line-height in
`fundhub-brand.css` and the three page rules become harmless duplicates (and the
four screens that set nothing get the same value).

---

## Cause 4 — The base text size is 14px on three screens and 16px on four

**(a) What you see.** Less than you would think — but it is real, and it is the
reason two screens' headings do not match.

**(b) The measurement.** Root (`html`) font size and `body` font size:

| Screen | `html` (root) | `body` | page title | title element |
|---|---|---|---|---|
| pipeline | 16px | **16px** | 14px | `div.name` |
| command-center | 16px | **16px** | 14px | `div.name` |
| closer-dashboard | 16px | **16px** | 14px | `div.name` |
| messaging | 16px | **16px** | 14px | `div.name` |
| finance-os | 16px | **14px** | **18px** | `h1` |
| staff-teams | 16px | **14px** | **18px** | `h1` |
| my-numbers | 16px | **14px** | 14px | `span.t` |

**The root font size is 16px on every screen at every width — 1440, 1920 and
2560.** It never varies. That rules out the most obvious "it zooms" mechanism.

`body` does vary: 16px on four screens (they never set it, so the browser default
wins) and 14px on three (they set it). Inside the shell this is masked, because
`.app{font-size:var(--fs-body)}` forces 14px anyway — I found no text actually
rendering at 16px on any screen. It leaks only to elements attached outside the
shell.

The page title is the visible half of this: **14px on four screens, 18px on two**
— a 29% jump in the biggest word at the top of the page.

**(c) Where it comes from.**

* `public/app/pipeline.html:35`, `closer-dashboard.html:43`, `messaging.html:35`,
  `command-center.html:53` — `html,body{…}` with no `font-size`.
* `public/app/finance-os.html:29`, `staff-teams.html:17` — `body{font-size:var(--fs-body)}` (14px).
* `public/app/my-numbers.html:26` — `body{font-size:14px}` — a hard number, not the token.
* `public/app/fundhub-brand.css:78-80` — `.app,.shell,.main,.fh-maxw{font-size:var(--fs-body)}`.
* Title: `fundhub-brand.css:84-87` gives `h1`/`h2` 18px, but four screens use a
  `div.name`, not an `h1`, so their title falls through to 14px.

**(d) Fixable in the shared stylesheet?** **Yes for `body`** (one rule). The title
needs the four screens to use an `h1`, or the shared sheet to also style
`.topbar .name` — a per-screen decision for W4.

---

## Cause 5 — Everything is one flat size, which is *why* it reads small

**(a) What you see.** The font does not just look small — it looks *samey*.
There is nothing big for your eye to land on, so everything reads as small print.
On Pipeline, 123 of the 130 pieces of text on the screen are exactly the same size.

**(b) The measurement.** How many of each screen's visible text elements are the
one dominant size:

| Screen | dominant size | elements at that size | of total | distinct sizes on screen |
|---|---|---|---|---|
| pipeline | 14px | 123 | 130 | **2** |
| command-center | 14px | 132 | 145 | **2** |
| closer-dashboard | 14px | 134 | 170 | **3** |
| finance-os | 14px | 89 | 90 | **2** |
| messaging | 14px | 110 | 117 | **2** |
| staff-teams | 14px | 98 | 147 | **4** |
| my-numbers | 11px | 90 | 140 | **5** |

Four screens run on **two** text sizes. `docs/UI-STANDARDS.md` §3 asks for
three, four at most — but it also asks for a metric value **2–3× the size of its
label**. Pipeline, Command Center, Messaging and Finance OS have **no metric size
at all**: nothing bigger than 14px (Finance OS tops out at an 18px `h1`).

The cause is the flattening rule. Closer Dashboard's own stylesheet authors **41
font-size declarations across 15 distinct values** (7.5, 8, 8.5, 9, 9.5, 10,
10.5, 11, 11.5, 12, 12.5, 13, 14, 16, 22px). Every single one is thrown away:
134 of its 170 text elements resolve to 14px, and the winning declaration for
each of them is literally `fundhub-brand.css | .app *, .shell *, .main *, .fh-maxw * | inherit !important`.

**(c) Where it comes from.**
`public/app/fundhub-brand.css:81-83` — the same `font-size:inherit !important`
rule as Cause 1. Because no page uses an inline `!important` size (0 in all seven
files), on a `.app` screen the only sizes that can ever appear are:

| Size | Set by |
|---|---|
| 28px | `fundhub-brand.css:88-95` (`.sv .vl .big .val .fh-num …`) |
| 18px | `fundhub-brand.css:84-87` (`h1`, `h2`) |
| 14px | `fundhub-brand.css:78-80` (`--fs-body`) — the default for everything else |
| 11px | `fundhub-brand.css:96-105` (`.chip .eyebrow th label .sub .note .hint …`) |
| 0px | `crm-sidebar.css:152` (collapsed rail heading only) |

Screens only reach 3 or 4 of those, because their markup does not use the class
names on the 28px and 11px lists. That is the whole hierarchy problem in one
sentence: **the type scale exists, but most screens never opt in to it.**

**(d) Fixable in the shared stylesheet?** **The size values, yes.** Getting a
metric on Pipeline/Command Center/Messaging needs those screens to use the class
names the shared sheet already recognises — that is a per-screen change.

---

## Cause 6 — My Numbers has text down to 9px, and no lock to stop it

**(a) What you see.** The two small pill labels at the top of My Numbers are
tiny. At the zoom level you work at, they are about the size of this dot.

**(b) The measurement.** Smallest text actually rendered on each screen:

| Screen | smallest | what it is | what it looks like at your zoom |
|---|---|---|---|
| pipeline | 11px | `div.sub` (the sub-title under the page name) | 8.8 real px at 80%, **7.4 at 67%** |
| command-center | 11px | `.eyebrow` section labels ("Money", "Holds") | 8.8 / **7.4** |
| closer-dashboard | 11px | table column headers (`th`), `.av` initials | 8.8 / **7.4** |
| finance-os | 14px | breadcrumb, "Loading…" | 11.2 / 9.4 |
| messaging | 11px | `div.sub`, avatar initials | 8.8 / **7.4** |
| staff-teams | 11px | `.eyebrow`, `.sd`, `+ Add person` button, `th` | 8.8 / **7.4** |
| **my-numbers** | **9px** | `span#shiftChip.chip`, `span#staffChip.chip` | 7.2 / **6.0** |

A 6.0-pixel-tall letter is not comfortably readable at a normal desk distance by
anyone. 7.4px is borderline. This is the "font is small" complaint, in numbers.

Body/base text you read all day is **14px** on every screen. The main table text
is **14px** for cells and **11px** for column headers (measured on
`closer-dashboard` `table.pm`: `td` 14px, `th` 11px; `staff-teams` `#rosterTbl`
`th` 11px).

**(c) Where it comes from.**
`public/app/my-numbers.html:30` — `.chip{ … font-size:9px … }`. On the six `.app`
screens `fundhub-brand.css:96` would force `.chip` to 11px, but My Numbers has no
`.app` (see Cause 1), so the 9px stands. My Numbers authors **24 hard-pixel
font-sizes across 12 distinct values**: 9, 9.5, 10.5, 11, 11.5, 12, 12.5, 13, 14,
23, 25, 44px — live `my-numbers.html` lines 26, 28, 30, 43, 49, 50, 51, 54, 59,
60, 61, 65, 68, 70, 75, 82, 84, 88, 91, 92, 97, 98, 99, 102, plus one inline
`style="font-size:20px"` at line 203. (Line numbers 26–99 are the same in this
working tree; the two files only diverge from line 100 on.) The working-tree copy
adds **seven more** declarations at lines 103, 105, 108, 110, 111, 114, 115 — the
last two inside a phone-only media query — which are not live yet.

**(d) Fixable in the shared stylesheet?** **Yes** — the same one-line fix as
Cause 1 (add `.app-shell` to `fundhub-brand.css:81`) brings My Numbers under the
same lock and snaps 9px → 11px, 11.5px → 11px, 44px → 28px automatically.

---

## Cause 7 — Nothing in the app scales. Not one measurement is relative.

**(a) What you see.** Making the browser text bigger does nothing. The only tool
you have is browser zoom, and zoom shrinks *everything* — including the 11px
labels that were already at the limit.

**(b) The measurement.** Every font-size declaration on all seven screens, by unit:

| Sheet | declarations | px | **rem** | **em** | **%** | `var()` | `inherit` |
|---|---|---|---|---|---|---|---|
| `fundhub-brand.css` | 7 | 0 | **0** | **0** | **0** | 6 | 1 |
| `crm-sidebar.css` | 10 | 1 (`font-size:0`) | **0** | **0** | **0** | 9 | 0 |
| `finance-os.css` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| pipeline own CSS | 60 | 0 | **0** | **0** | **0** | 60 | 0 |
| command-center own CSS | 54 | 0 | **0** | **0** | **0** | 53 | 1 |
| closer-dashboard own CSS | 41 | **41** | **0** | **0** | **0** | 0 | 0 |
| finance-os own CSS | 40 | 0 | **0** | **0** | **0** | 39 | 1 |
| messaging own CSS | 62 | 0 | **0** | **0** | **0** | 62 | 0 |
| staff-teams own CSS | 31 | 0 | **0** | **0** | **0** | 30 | 1 |
| my-numbers own CSS | 24 | **24** | **0** | **0** | **0** | 0 | 0 |

**Zero rem. Zero em. Zero percent. Zero `clamp()`. Zero `vw`.** Every `var()`
resolves to a hard pixel token (`fundhub-brand.css:63-66`: `--fs-metric:28px`,
`--fs-title:18px`, `--fs-body:14px`, `--fs-caption:11px`).

So the "shared stylesheet mixes px and rem" theory is **wrong** — it is 100%
absolute pixels. That is worse than mixed: the app cannot respond to the browser's
own text-size setting at all, and the root 16px is decorative.

Confirmed by rendering: the set of distinct sizes on each screen is **byte-for-byte
identical at 1440, 1920 and 2560**. Nothing on any screen is width-responsive.

**(c) Where it comes from.** `public/app/fundhub-brand.css:63-66`.

**(d) Fixable in the shared stylesheet?** **Yes — this is the single highest-leverage
change.** Restating the four tokens in `rem` moves the whole app from one place.

---

## Cause 8 — Browser zoom is what actually makes it unreadable

**(a) What you see.** You work zoomed out so you can see more. Every step out
shrinks the type, and it was already at the floor.

**(b) The measurement.** Real screen pixels at each zoom level (measured with a
matching device pixel ratio, 1920px physical window):

| Screen | base text 100% / 80% / 67% | menu 100% / 80% / 67% | smallest text 100% / 80% / 67% |
|---|---|---|---|
| pipeline | 14 / 11.2 / 9.4 | 14 / 11.2 / 9.4 | 11 / 8.8 / **7.4** |
| command-center | 14 / 11.2 / 9.4 | 14 / 11.2 / 9.4 | 11 / 8.8 / **7.4** |
| closer-dashboard | 14 / 11.2 / 9.4 | 14 / 11.2 / 9.4 | 11 / 8.8 / **7.4** |
| finance-os | 14 / 11.2 / 9.4 | 14 / 11.2 / 9.4 | 14 / 11.2 / 9.4 |
| messaging | 14 / 11.2 / 9.4 | 14 / 11.2 / 9.4 | 11 / 8.8 / **7.4** |
| staff-teams | 14 / 11.2 / 9.4 | 14 / 11.2 / 9.4 | 11 / 8.8 / **7.4** |
| **my-numbers** | 14 / 11.2 / 9.4 | **11 / 8.8 / 7.4** | 9 / 7.2 / **6.0** |

At 67% zoom the body text you read all day paints at **9.4 real pixels** and
table column headers at **7.4**.

**(d) Fixable in the shared stylesheet?** **Yes for the sizes.** But the honest
fix is Cause 2 — if the content used the width of the monitor, you would not
need to zoom out, and 100% zoom would do the job.

---

## Ruled out — measured, and not the problem

These were on the list to check. All came back clean. Recording them so nobody
re-checks them.

| Suspect | Result |
|---|---|
| CSS `zoom` property | **0 elements** with a `zoom` other than 1, on all 7 screens at all 3 widths. The string `zoom:` appears nowhere in `public/app/`. |
| `transform: scale(...)` | **0 elements** with a scale other than 1 at rest, on all 7 screens. The only `scale()` in the whole app is `@keyframes pulse{to{transform:scale(1.9)}}` (`fundhub-brand.css:53`, mirrored in `finance-os.html:79` and `my-numbers.html:35`) — an 8px "systems nominal" dot ring. Harmless. |
| `-webkit-text-size-adjust` / `text-size-adjust` | Never set. Computed value is `auto` on `html` and `body` on all 7 screens — identical everywhere. |
| `<meta name="viewport">` | Exactly one per page, on all 7. Three different spellings: `width=device-width, initial-scale=1.0` (pipeline, command-center, closer-dashboard, messaging, staff-teams), `width=device-width, initial-scale=1` (finance-os), `width=device-width,initial-scale=1` (my-numbers). `1.0` and `1` are the same number and the spacing is ignored, so **all three behave identically**. Worth tidying, but it is not causing anything. |
| Root (`html`) font size | **16px on every screen at every width.** Never varies. |
| `clamp()` / `vw` / `vh` sizing | **Zero occurrences** in all 10 stylesheets. Confirmed by render: identical size sets at 1440, 1920 and 2560. |
| Fixed-px `line-height` | 1 rule out of 45 (`.pcell{line-height:38px}`, staff-teams). Not a driver. |
| `shell.js` / `data.js` | `data.js` sets no font-size and no line-height at all. `shell.js` sets two, both from tokens (`shell.js:1121` under 480px only, `shell.js:1720` beta banner `var(--fs-body,14px)`). Neither is a cross-screen size difference. |

---

## Every distinct font size rendered, per screen

Measured at 1440 — **identical at 1920 and 2560**. Authored unit is `px` in every
case (`var()` tokens all resolve to px; see Cause 7).

| Screen | 44 | 28 | 25 | 23 | 18 | 14 | 11.5 | 11 | 9 | distinct | §3 limit (4) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pipeline | | | | | | ● 123 | | ● 7 | | **2** | pass |
| command-center | | | | | | ● 132 | | ● 13 | | **2** | pass |
| closer-dashboard | | ● 4 | | | | ● 134 | | ● 32 | | **3** | pass |
| finance-os | | | | | ● 1 | ● 89 | | | | **2** | pass |
| messaging | | | | | | ● 110 | | ● 7 | | **2** | pass |
| staff-teams | | ● 4 | | | ● 2 | ● 98 | | ● 43 | | **4** | at the limit |
| **my-numbers** | | ● 14 | | | | ● 33 | ● 1 | ● 90 | ● 2 | **5** | **FAIL** |

● = rendered, number = how many visible text elements.

Sizes each screen *declares* but the `!important` rule throws away:

| Screen | hard-px declarations in its own CSS | distinct values declared | how many survive |
|---|---|---|---|
| pipeline | 0 (60 via tokens) | 0 | n/a |
| command-center | 0 (54 via tokens) | 0 | n/a |
| **closer-dashboard** | **41** | **15** — 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 16, 22px | **0** |
| finance-os | 0 (40 via tokens) | 0 | n/a |
| messaging | 0 (62 via tokens) | 0 | n/a |
| staff-teams | 0 (31 via tokens) | 0 | n/a |
| **my-numbers** | **24** (+1 inline) | **12** — 9, 9.5, 10.5, 11, 11.5, 12, 12.5, 13, 14, 23, 25, 44px (+20px inline) | **all of them** |

The working-tree (not yet live) copy of `my-numbers.html` adds 7 more
declarations at lines 103, 105, 108, 110, 111, 114, 115.

---

## Ranked — worst first

| # | Cause | Why it ranks here | file:line | Shared-sheet fix? |
|---|---|---|---|---|
| **1** | **Left menu re-sizes between screens** (14px vs 11px, rows 30.8 vs 27.19, block 119px shorter) | It is the only element on screen at all times, so it is the ruler your eye uses. This IS the "zooms in and out". | `fundhub-brand.css:81-83` + `crm-sidebar.css:172` + `my-numbers.html:122` | **Yes** |
| **2** | **Page width jumps up to 1092px screen to screen** (1280 / 2332 / 1240 at 2560) | Second-biggest visual jump, and it gets worse the more you zoom out — matching your report exactly. | `fundhub-brand.css:70,72`; `pipeline.html:372`; `my-numbers.html:40`; `closer-dashboard.html` (no cap anywhere) | **Partly** |
| **3** | **Everything is hard pixels — 0 rem, 0 em, 0 %, 0 clamp** | Root cause behind "the font is small" and "it doesn't scale". Nothing can be adjusted from one place today. | `fundhub-brand.css:63-66` | **Yes** |
| **4** | **Base size 14px, smallest text 11px, and 9px on My Numbers** | At your 67% zoom that paints 9.4 / 7.4 / 6.0 real pixels. | `fundhub-brand.css:65-66`; `my-numbers.html:30` | **Yes** |
| **5** | **Line spacing 1.5 on three screens, `normal` on four** (21px vs 16.8px rows) | 25% taller rows on half the screens reads as a size change. | `finance-os.html:29`; `staff-teams.html:17`; `my-numbers.html:26`; four files set nothing | **Yes** |
| **6** | **`.app *{font-size:inherit!important}` flattens everything to one size** | 123 of 130 elements on Pipeline are the same size. Four screens have no metric text at all. No hierarchy = reads as small print. | `fundhub-brand.css:81-83` | **Yes for values** |
| **7** | **Page title 14px on four screens, 18px on two** | The biggest word on the page changes by 29% when you switch screens. | `fundhub-brand.css:84-87`; `div.name` in pipeline / command-center / closer-dashboard / messaging | **Partly** |
| **8** | **`body` 16px on four screens, 14px on three** | Real, but almost entirely masked by `.app`. Ranked last on purpose — it is a tidiness issue, not what you are seeing. | `finance-os.html:29`; `staff-teams.html:17`; `my-numbers.html:26` | **Yes** |

---

## Recommendation — what the base font size should be

### The numbers

`--fs-body` is **14px** today. Every screen's main text and every table cell is
14px. The smallest text is 11px (9px on My Numbers). At the zoom you work at
those paint 9.4 and 7.4 (and 6.0) real pixels.

### Recommended

```
--fs-metric : 2rem      /* 32px — was 28px */
--fs-title  : 1.25rem   /* 20px — was 18px */
--fs-body   : 1rem      /* 16px — was 14px */   <-- the base
--fs-caption: 0.8125rem /* 13px — was 11px */
```

with `html{font-size:16px}` stated explicitly in `fundhub-brand.css` so there is
one dial for the whole app.

### Why 16px

1. **It is the browser's own default**, and the size the rest of the web is tuned
   for. Nothing about this product justifies going smaller — it is a screen you
   read all day, not a dense spreadsheet.
2. **It survives your zoom.** At 80% it paints 12.8 real pixels — still
   comfortable. 14px paints 11.2 at 80% and 9.4 at 67%, which is where "the font
   is small" comes from.
3. **It costs nothing in hierarchy.** Nothing on any screen today is larger than
   28px, so raising the body from 14 to 16 does not collide with anything above it.
4. **13px is the right floor, not 11px.** 11px was already at the limit at 100%
   zoom; at 80% it is 8.8 real pixels. 13px paints 10.4 at 80% — readable.
   `fundhub-brand.css:66` calls 11px "the floor, never smaller", and My Numbers
   breaks it anyway at 9px. Raising the floor makes the rule enforceable.
5. **`rem`, not `px`, is the point.** Today the root 16px does nothing because not
   one measurement in the app is relative to it. Stating the four tokens in `rem`
   means one line changes the whole app — including if you later want 17px or 18px.

### Two risks W4 must plan for

* Raising `--fs-body` from 14 to 16 moves **more than 120 elements per screen at
  once** (the `!important` rule at `fundhub-brand.css:81` makes almost everything
  inherit it). Tables will get wider. Check `closer-dashboard` and `staff-teams`
  tables at 1440 first.
* Raising `--fs-caption` from 11 to 13 moves every table column header, every
  `.eyebrow`, every `.chip` and every `label`. Those sit in tight boxes with
  `padding:4px 9px`.

Neither is a reason not to do it. Both are a reason to do it once, in the shared
stylesheet, and look at all three widths after.

---

## Could not measure — stated plainly

1. **Any signed-in live screen.** `fundhub.ai` login returns HTTP 500 "cannot
   execute INSERT in a read-only transaction"; `/api/auth/session` returns 503
   `db:down`. Tried twice, ~25 minutes apart. Seven cached owner sessions
   (0.1h–21.5h old) all rejected. **This blocks W1 and W3 too.**
2. **Rows that JavaScript builds from live data.** The page scripts were removed
   because with no API they only redirect to login. On the six `.app` screens this
   changes nothing — the `!important` lock at `fundhub-brand.css:81-83` allows
   only 11/14/18/28px and no page uses an inline `!important` size that could
   escape it (verified: 0 in all 7 files). On **my-numbers** there is no lock, so
   its 5 rendered sizes are a **floor** — the real number could be up to the 12
   its stylesheet declares.
3. **The live sign-out chip and beta banner in place.** `shell.js` builds them at
   runtime and it did not run. I measured the chip by injecting the exact element
   `shell.js:1491` creates, with its exact inline style, into each page — that is
   a reproduction of the real element against the real cascade, not an
   observation of the live page. Treat the 14px-vs-11px chip result as
   **cascade-proven, not live-observed**.
4. **Real browser zoom.** Emulated by setting the CSS viewport to
   `1920 ÷ zoom` with a matching device pixel ratio (2400px @ 0.8, 2866px @ 0.67).
   This is how Chromium implements page zoom, and since nothing in the app is
   viewport-responsive (Cause 7) the result is exact — but it was not a human
   pressing Ctrl+Minus.
5. **`shell.js` role filtering of the menu.** Live `shell.js` differs from this
   tree in which roles see the "Lenders" row. It changes the **number** of menu
   rows, never their size. The 33-row count above is the unfiltered markup.

## Screenshots

`docs/workflows/crm-feel-2026-08-17-evidence/w2/` — 21 files,
`<screen>-1440at100.png`, `<screen>-2560at100.png`, `<screen>-1920at67.png`.

The clearest single piece of evidence is `pipeline-1440at100.png` next to
`my-numbers-1440at100.png`: the same left menu, same 33 rows, visibly different
size.
