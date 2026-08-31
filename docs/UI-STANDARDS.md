# UI-STANDARDS.md — FUNDHUB LAYOUT LAW

Read before building ANY screen. Brand (colors, fonts, spectrum) lives in fundhub-brand.css — this file is layout, hierarchy, and behavior. If a rule here conflicts with a request, flag it, don't silently pick.

---

## 1. THE PAGE

- **One job per screen.** Every screen answers one question or enables one task. If you can't say the job in one sentence, it's two screens.
- **One primary action per screen.** Exactly one filled/prominent button. Everything else is secondary (outline) or tertiary (text link). Two primary buttons = a decision the designer refused to make.
- **Top-left is the most important thing.** Eyes land there first (F-pattern). The number or status the role cares about most goes top-left, largest. Never a logo, never a filter.
- **Content fills the window. No max width.** CRM content grows with the browser at any zoom level; the only reserved space is the fixed 228px left rail. Tables keep their own scroll container. Where a block of prose genuinely needs a reading measure, cap that block — never the page. *(Owner-set 2026-08-27, superseding the 1800px cap. Raising the cap did not fix the complaint it was raised for: the owner zooms out on a 2560px monitor to get more room and gets none, because content stops growing and every extra pixel becomes empty side margin — 532px dead at 2560, 1412px at 3440. Earlier history, kept so nobody re-litigates it: the cap was 1280px until 2026-08-17, when it was raised to 1800px rather than removed, on the reasoning that a cap stops lines of text growing too long to read. 1280 was abandoned because with the 228px rail it left 1052px — 41% of the owner's monitor — empty, and no breakpoint above 1201px existed anywhere in the app. Do not reinstate 1280, and do not reinstate 1800. The `--fh-maxw` token still exists in `public/app/fundhub-brand.css` but is no longer an app-wide cap — `client-portal.html` reads it to bound its 780px reading column, so the token must not be deleted.)* **Enforced by `src/ui/shell-is-fluid.test.mjs`** — it fails if any screen re-caps its own page column, if the shell rule stops uncapping, or if the `--fh-maxw` token or the phone pin are deleted. Every tab must look the same as every other tab; that is the actual requirement here, not width for its own sake.
- **The fold matters.** The screen's job must be doable without scrolling on a 13" laptop (900px viewport height). Below the fold is for detail, never for the primary action.

## 2. LAYOUT GRID

- **8px spacing scale only:** 8 / 16 / 24 / 32 / 48 / 64. No 10px, no 14px, no eyeballing. Related items 8-16 apart, groups 24-32 apart, sections 48-64 apart.
- **Proximity is meaning (Gestalt).** Things close together read as related. If two cards aren't related, they need more space or a divider — not a border on everything.
- **12-column grid.** Cards span 3, 4, 6, or 12. Never 5, never 7. Uneven card widths in one row = slop signature #1.
- **Align to edges, not centers.** Left-align text and numbers in cards. Centered body text is for marketing pages only.

## 3. HIERARCHY & TYPE

- **Three text sizes per screen, max four.** Big number / section title / body / caption. More sizes = no hierarchy.
- **Numbers are the heroes on dashboards.** Metric value 2-3x the size of its label. Label above or below in muted color, never beside it fighting for attention.
- **Tabular numerals for all metrics and tables** so columns of numbers align.
- **No ALL-CAPS body text.** Caps for small labels/eyebrows only, with letter-spacing.

## 4. NAVIGATION

- **Max 7 top-level nav items per role (Miller).** More than 7 = group or cut.
- **Role-scoped nav.** A user never sees a nav item they cannot use. No disabled nav, no 403-on-click. If the role can't act on the screen, the item does not render. (This is finding-class UI-12 from the Aug 16 audit — 12 rows of it.)
- **Current location always visible.** Active nav state + page title match. User answers "where am I" in zero seconds.
- **Two levels deep, max.** If it needs a third level, the IA is wrong.

## 5. ACTIONS & CONTROLS

- **Big targets (Fitts):** minimum 40px hit area, primary actions 44px+. Destructive actions physically separated from safe ones — never adjacent.
- **Every visible control works.** No buttons wired to nothing, no controls the role lacks permission for, no "coming soon" UI in production. If it doesn't do anything today, it does not render today.
- **Buttons say what happens:** "Send letters," "Add closer," "Run soft pull" — never "Submit," "OK," "Go."
- **Destructive = confirm with consequence named.** "Delete 14 contacts? This can't be undone." Never a bare "Are you sure?"
- **Every action answers back.** Click → immediate state change: spinner in the button (not page takeover), then success/failure where the user is looking. Silent success is a bug.

## 6. STATES (every screen ships all four or it isn't done)

1. **Loading** — skeletons in the real layout. Never a blank screen, never a full-page spinner.
2. **Empty** — says what will appear here + one action to make it appear. "No clients yet. Add your first client." NEVER fake sample data presented as real. (Audit finding: sample furniture with a false excuse = trust destroyed.)
3. **Error** — says what failed, in the user's words, and what to do next. Never a raw status code, never a lie ("not signed in" when they are signed in).
4. **Full** — the happy path, designed against realistic volume: 27 clients, not 3. Long names truncate with tooltips, tables paginate at 25.

## 7. DATA DISPLAY

- **Data-ink (Tufte):** no gridlines heavier than the data, no borders around everything, no gradients or 3D on charts, no decorative icons beside every metric. If deleting a pixel loses no information, delete it.
- **Right chart for the job:** trend = line, comparison = bar, composition = stacked bar (pie only with ≤3 slices), single status = big number. Default is the big number, not a chart.
- **Every metric has a comparison.** A number alone means nothing: vs yesterday, vs target, vs last week — small, muted, beside or under the value.
- **Tables:** left-align text, right-align numbers, one-line rows, sort on the column the role cares about by default. Row click opens detail; actions live in the row's far right.
- **Timestamps:** relative under 24h ("2h ago"), absolute after ("Aug 14, 3:02 PM"). Always tooltip the exact time.

## 8. FAMILIARITY (Jakob's Law)

- Settings gear top-right. Profile top-right corner. Search top. Notifications bell. Filters above the table, left. Save bottom-right of forms.
- Don't invent novel patterns for solved problems. Novelty budget is zero on internal tools.

## 9. PROGRESSIVE DISCLOSURE

- **Default view = the 20% used daily.** Everything else one click deeper (tabs, "View details," drawers).
- Advanced filters collapsed by default. Bulk actions appear on selection, not before.
- A new employee should understand any screen's default state in 10 seconds without training.

## 10. ROLE LENS (Fundhub-specific)

Every dashboard is built for its role's first question of the day:
- **Closer:** "Who am I calling next?" — today's calls, top-left. Not company metrics.
- **Funding advisor:** "Which files need me?" — action queue first.
- **Sales manager:** "Is the floor on pace?" — held/booked/closed today vs target.
- **Owner:** "Is the machine healthy?" — cash, CAC, close rate, pipeline. The ONLY role that sees company-wide metrics by default.
- **Client:** "Where is my money/file?" — status of their thing, next step, one contact action.
If a screen serves the wrong question first, it fails this doc regardless of how clean it looks.

## 11. PHONE (390px)

The CRM must work on a phone. Design and test at **390px** wide.

- **One column.** KPI rows, two-pane screens, Present, and card grids stack vertically. Never two columns squeezed to one letter per line.
- **No sideways page scroll.** A table that must stay a table may scroll inside its own box. Everything else stacks.
- **Hit targets stay 40px+.** Text stays at least 11px.
- **The name chip lives in the header**, not over the page.
- **The menu opens the rail.** The rail does not sit on the page as a strip of icons.

## 12. THE SCREEN FRAME (owner-set 2026-08-30)

**`public/app/pipeline.html` is the reference for what good looks like.** When this section and a screen disagree, the screen is wrong. When this section and pipeline.html disagree, pipeline.html is right and this section is out of date — fix it here.

Why this section exists: on 2026-08-19 two screens were reworked on the same day with opposite instructions, and both agents cited this document. Neither was wrong, because nothing here said what a container looks like at rest. The frame was folklore. It is written down now. **Enforced by `src/ui/screen-standard.test.mjs`.**

### 12.1 The resting container

A panel at rest is exactly four declarations:

```css
background:#fff;
border:1px solid var(--line);
border-radius:10px;
box-shadow:var(--panel-shadow);
```

That is `.card` in pipeline.html:239-240, and it is the whole look. Radius is 10px for a card, 8px for a bigger block — pick one and use it for every container on the screen, never both for the same kind of thing.

### 12.2 The shadow is never written on a screen

`fundhub-brand.css:130-137` already applies `--panel-shadow` app-wide to these names:

`.card` · `.stat` · `.panel` · `.tabs` · `.editor` · `.fos-panel` · `.kpi-tile` · `.big-tile` · `.calc-panel` · `.compose` · `.ctx-card`

**A new container takes one of those class names, or gets added to that list. It never hand-rolls a shadow value.** Two screens carrying two slightly different shadows is the drift this whole section exists to stop, and it is invisible in review — nobody compares `0 2px 8px rgba(10,10,10,.06)` against `0 2px 6px rgba(0,0,0,.08)` across two files. The token is the only way they stay equal.

The list is deliberately conservative and was measured, not guessed. Buttons, inputs, avatars, chat bubbles and table rows are white too and are excluded on purpose — a resting shadow on those reads as broken, not expensive.

### 12.3 Shadow beyond the token means something is happening

Every other `box-shadow` in pipeline.html is an interaction state, never decoration:

| Where | Line | What it means |
|---|---|---|
| `.card:hover` | 242 | you are pointing at this |
| `.col.drop-target` | 225 | let go here |
| `.drag-card` | 308-309 | this is in your hand |
| `.route-menu` | 315-316 | this floats above the page |

**Resting elevation is the token. Anything stronger is an event.** A stack of resting panels each with its own drop shadow reads as four things happening at once and none of them are.

### 12.4 `border:0` on a shadow-list class is forbidden

Removing the border from a class on the 12.2 list does not simplify it — it paints **a floating shadow with no edge**, a soft grey smudge around nothing. The border is what the shadow is a shadow *of*.

Offenders today, kept here as the example rather than as a scold: `closer-dashboard.html:102` (`.calc-panel`) and `:111` (`.big-tile`) both set `border:0` while the brand file is still giving them a shadow.

The one legal way to take the border off is to take the shadow off in the same rule — `border:0;box-shadow:none` turns a panel into a plain block, which is a real and useful thing to do. Half of it is not.

### 12.5 Group containers take a tint, not a shadow

A box that holds other boxes is not itself a panel. It gets a flat tint and a hairline:

```css
.col{background:var(--paper-dim);border:1px solid var(--line);border-radius:8px}
```

That is pipeline.html:215. The cards inside it carry the shadow; the column does not. Nesting a shadow inside a shadow is §7's "no borders around everything" wearing a different coat.

### 12.6 Status is never colour alone

`paintBrand()` in `public/app/shell.js:2277-2286` overwrites `--alert`, `--warn`, `--ok` and `--info` from the tenant's own six-stop colour ramp. **A white-label company with one hue in its brand therefore paints every status the same colour.** A red row and a green row become two identical blue rows, and the screen still looks fine to the person who built it on the default brand.

So every status carries a second signal — a word, a shape, or a position:

- pipeline.html:216-225 — the headline counters say **"on a bank" / "on the client" / "nothing recorded"** in words, and the chosen one is a solid ink **fill**, not a tint. A word survives any ramp; a fill still reads as chosen when every hue in the ramp is the same.
- pipeline.html:343-353 — `.c-needs-amount` is deliberately **literal amber** (`#FEF3C7` / `#92400E` / `#FCD34D`), not a brand variable, with the reason written above the rule, *and* it says "Amount needed" in words. That is the escape valve when a warning must stay amber on every tenant. Use it sparingly and write the reason down, exactly as that rule does.

Never ship a legend whose only key is colour, and never write "the red ones need attention" in copy.

**Two examples this section used to give have never once painted (corrected 2026-08-30).** They were `.card.held` (a left stripe plus a tint) and `.hold-badge` (the word HELD in a pill), and both are real CSS sitting in pipeline.html to this day — `.card.held` at :323-324, `.hold-badge` at :358-363. Nothing ever puts either class on an element. `cardEl()` does not add `held`, so the "Held only" filter matches nothing and the `— held` figure has been a dash since the day it shipped. The hold data exists (`clients.custom_fields.round_hold_reason`, written by seven workflows) and the board has never read it.

They are named here rather than deleted because the shape of the stripe is still the right answer and somebody will want it back. **But do not cite dead CSS as the model.** An example that has never run cannot show you that it works, and the next person copies it believing it has been proven. Before this section points at a rule, open the screen and check the class is actually applied to something.

**The class being applied is still not proof that anything paints.** The same commit that corrected the two examples above shipped a third dead rule eleven lines from `.card.held`, and its class *was* applied:

```css
.card.fh-spot{box-shadow:0 0 0 3px var(--spectrum);}   /* painted nothing */
```

`--spectrum` is a `linear-gradient` — `fundhub-brand.css` defines it, and `rampToSpectrum()` in `shell.js` rebuilds it from the six-stop brand ramp for every white-label tenant. **The colour component of `box-shadow` must be a `<color>`.** A gradient there makes the whole declaration invalid at computed-value time, so `box-shadow` fell back to its initial value, `none`. `background:var(--spectrum)` on the same screen (`.drop-line`) is correct, because a background *does* take a gradient — so the token looks proven right next to the rule it breaks.

Worse than a missing nicety: `.card.fh-spot` is (0,2,0), which outranks the resting `:is(.app,.app-shell) :is(.card,…)` shadow at 12.2. Killing it took the card's own elevation with it, so the card the user had just been jumped to was **the only flat card on the board** — the feedback was inverted, not absent. Measured 2026-08-30: spotted card `none`, every neighbour `rgba(10,10,10,.04) 0 1px 2px, rgba(10,10,10,.06) 0 2px 8px`.

Two rules follow, and they are cheap:

- **A shadow, outline, border-colour or text-shadow takes a colour token. Never `--spectrum`.** Use `--ink` for a ring you need on every tenant — a ramp stop such as `--accent` is `ramp[5]`, which a one-hue tenant can wash out to the board behind it. Add the resting token back where you are overriding it: `box-shadow:var(--panel-shadow),0 0 0 3px var(--ink)`.
- **Assert the computed style, never the class.** `toHaveClass(/fh-spot/)` passed green the entire time the rule was inert, which is why nobody caught it. `e2e/pipeline-waiting-on.spec.mjs` now reads `getComputedStyle().boxShadow` and compares it to an untouched card beside it, because "looks exactly like its neighbours" is the failure being tested for.

### 12.7 The type trap, and its one escape hatch

**This is the rule that costs the most time when it is not known.**

`fundhub-brand.css:184-186` says:

```css
:is(.app,.app-shell,.shell,.main,.fh-maxw) * { font-size:inherit !important; }
```

Every element inside a shell is force-fed its parent's size. **So a `font-size:12px` written inside a screen's own `<style>` paints nothing.** It lints clean, it reviews clean, it is in the file, and the browser throws it away. The screen renders at 16px body and looks flat, and the next agent "fixes" the flatness by writing more px sizes that also do nothing. That loop is most of Fundhub's screen drift.

Sizes are handed back only to a whitelist:

| Token | Size | Who gets it |
|---|---|---|
| `--fs-title` | 20px | `h1`, `h2` |
| `--fs-metric` | 32px | `.sv` `.vl` `.big`; and under `.app`/`.app-shell` also `.big-tile .val`, `.kpi .vl`, `.band .bv`, `.un-mins`, `.fh-num`, `.fos-value`, `.rf-value` |
| `--fs-caption` | 13px | `.chip` `.eyebrow`; and under `.app`/`.app-shell` also `.badge` `.tag` `.av` `.stat-label` `.kpi .lb` `.kpi .sb` `.band .bl` `.sd` `.cmp` `.note` `.hint` `.statusline` `.statusbar` `.mono` `label` `th` `.caption` `.sub` `.card-title` `.rail-code` |
| `--fs-body` | 16px | everything else, by inheritance |

**Reach for the whitelist first.** If a label needs to be small, give it `.caption` or `.eyebrow` and the brand file sizes it for free. That is what client-control-panel.html did with its titles and its next-action label before it wrote any CSS of its own.

**One escape hatch per screen, and only one.** When a screen genuinely has its own class names that must be captions, it writes **one** rule, with `!important`, with the reason written above it. The two sanctioned examples — copy their shape, do not invent a third:

- `client-control-panel.html:100-106`
- `closer-dashboard.html:223-228`

One rule per screen. Never two. A second one is how a screen ends up with six sizes and no hierarchy (§3).

Three things the trap also eats, which surprise people:

- **The `font:` shorthand.** `font:600 11px var(--sans)` sets a font-size and dies the same way.
- **Inline `style="font-size:12px"` in the markup.** An `!important` author rule beats a normal inline style — the attribute loses too.
- **Section headings are 13px caps-mono, not 16px.** An `h3` is not on the title whitelist, so it inherits body size. Give it `.eyebrow`, or size it in the screen's one escape hatch — that is exactly what `closer-dashboard.html:223-228` does for `.cockpit-main h3` and `.rail h4`.

### 12.8 The topbar contract

Read `client-control-panel.html:64-84`. A topbar carries, left to right:

1. **Identity** — the wordmark from `--logo` (`.brand .logo`, `.inv` to flip it on the dark bar), then a separator, then this screen's name in `.brand .sub`.
2. **A spacer** — `justify-content:space-between` does it; nothing is centred in a topbar.
3. **The right cluster** — `.topbar-right`: org pill, LIVE pill, clock, and whatever `shell.js` injects (Search, the role chip, Sign out). That is eight things once the shell has run, which is why the rules below exist rather than being tidied away.

The five declarations that make it survive a real window:

- `.brand{min-width:0;flex:0 1 auto}` — the left side is allowed to shrink.
- `.brand .sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}` — the screen name truncates instead of wrapping onto three lines. Measured on the live page at 1440px, 2026-08-27.
- `.topbar-right{flex:0 0 auto}` — the controls never shrink; they are targets.
- `.clock{white-space:nowrap}` plus `@media (max-width:1560px){.clock{display:none}}` — **the clock is the first thing to go.** It is the least useful of the eight and dropping it is what buys the room.
- At 480px the bar is allowed to become two rows: `header.topbar{height:auto;min-height:44px;flex-wrap:wrap}` and `.topbar-right{width:100%}`.

**The height must be released before the bar is allowed to wrap.** `height:44px` plus `flex-wrap:wrap` is a second row painted underneath a fixed-height box — it exists in the layout and you cannot see it. Use `min-height` with `height:auto` whenever wrapping is on.

**Do not copy `partner-galaxy.html:79-85`.** It sets `flex-wrap:wrap` and `overflow:hidden` on the same bar. The wrap is real and the clip throws the wrapped row away, so the controls that moved to row two are simply gone — no scrollbar, no overflow, no clue anything is missing. It is the one shape in the app that hides its own failure.

---

*Slop signatures (instant fail): uneven card rows · five borders where spacing would do · buttons that 403 · sample data as real · full-page spinner · centered paragraphs · "Submit" · six font sizes · metrics with no comparison · nav items a role can't use.*
