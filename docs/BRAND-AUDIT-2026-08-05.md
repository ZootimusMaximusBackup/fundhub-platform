# Brand audit — 2026-08-05

Method: every file under `public/` checked against `fundhub-brand.css` and
`docs/BRAND-THEMING-SPEC.md`. Read-only. No app was run — this is a code-truth
audit of colors, fonts and tokens, not a visual design review.

Scope: 52 HTML pages, 4 stylesheets, `shell.js`.

Verdict: **the brand is mostly right. Fonts are perfect. Two whole pages are on
a different brand, and the legal pages are on a warm off-palette.**

Owner decision 2026-08-05: **Fundhub is not rebranding.** Findings that only
bite under a rebrand are closed or downgraded below — see 3 and 6.

---

## Status

| # | Finding | State |
|---|---|---|
| 1 | `crm.html` — old CRM still published | **HELD** — needs owner answer |
| 2 | `dashboard.html` — foreign dark theme | **HELD** — needs owner answer |
| 3 | Five invented color tokens | **CLOSED** — owner set, no rebrand |
| 4 | Legal pages on warm off-palette | **FIXED** |
| 5 | Marketing pages missing status colors | **RETRACTED — the finding was wrong** |
| 6 | Brand defined in 23 places | **LOW** — drift risk only, no rebrand |
| 7 | Faux-bold from missing font weight | **FIXED** |
| 8 | `sidebar.fragment.html` dead | **HELD** — deletion, needs owner answer |
| 9 | `contract.html` signature overlay colors | **FIXED** — fields themselves still unseen |
| 10 | `lenders.html` button font reset (specificity) | **FIXED** — found by rendering |
| 11 | Warm palette surviving as `rgba()` on 5 headers | **FIXED** — found by rendering |

---

## What is clean

| Check | Result |
|---|---|
| Fonts | **Pass.** Only Inter and JetBrains Mono anywhere. Zero foreign fonts. |
| `shell.js` rebrand logic | **Pass.** Applies `/api/org-brand` and maps ramp stops 0→`--alert`, 1→`--warn`, 3→`--ok`, 4→`--info`, 5→`--accent` — exactly as the spec table says. |
| `public/fh.css` | **Pass.** Faithful copy of the tokens, status colors included. The sign-in pages that use it are on-brand. |
| Named CSS colors (`red`, `blue`…) | **Pass.** None found. |

---

## Findings

### 1. `public/dashboard.html` is a different product — HIGH

485 lines. Dark navy theme. Not one Fundhub color in it.

```
--bg:#0d0f14   --surface:#161a22   --accent:#4f7ef8   (blue)
--accent2:#34d399 (emerald)   --warn:#f59e0b   --danger:#ef4444
```

Brand says paper `#FCFCFC`, ink `#0A0A0A`, status colors from the pastel ramp.
This page shares none of it. It is a generic dark admin template.

Nothing links to it. But `publish = "public"` in `netlify.toml` means it is
live at `/dashboard.html` for anyone who types the URL.

### 2. `public/crm.html` is the whole old CRM, still published — HIGH

20,596 lines. **21 `<title>` tags, 20 `<!doctype>` declarations, 21 `<body>`
tags.** It is twenty-one complete HTML pages concatenated into one file — a
stale copy of every CRM screen that now lives properly in `public/app/`.

Titles inside it include Command Center, Pipeline, Closer Dashboard, Brand
Studio, Client Portal, Ops & Admin, Galaxy, Messaging, Documents.

It carries 78 off-palette gray references plus Tailwind default colors. It is
live at `/crm.html`. It was last edited **2026-08-02** — three days ago — so it
is still being maintained in parallel with the real app and drifting from it.

### 3. Rebrand bug: five colors will not change — CLOSED, owner decision 2026-08-05

**Owner-set: Fundhub is not rebranding.** This finding is closed. The tokens
below only diverge when the brand changes, and it is not changing. They are
doing a real job — readable dark text on the pastel chips — and their values
look correct against the ramp. No action.

Recorded for the record only:

Six live app pages invent their own color tokens:

```
--red:#6E2A22   --green:#2C5138   --amber:#6B4A12
--purple:#3F2F63   --blue:#22415F
```

Files: `automations.html`, `client-control-panel.html`, `client-portal.html`,
`consent-capture.html`, `inquiry-remover.html`, `ops-admin.html`
(plus `crm.html`).

`shell.js` never sets these — zero `setProperty` calls for any of them. Under a
rebrand those five would stay Fundhub's originals while everything else moved.
Not a live problem: no rebrand is planned.

They fill a real gap the spec does not cover — dark text that stays readable on
the pastel chips (used 209 times as `color:`). Worth naming in the spec if
anyone documents it, but nothing is broken today.

### 4. Legal pages use a warm off-palette — FIXED 2026-08-05

**Correction to the first draft of this audit: it is five pages, not two.** The
three education legal pages carry the identical block.

- `public/terms/index.html`
- `public/privacy/index.html`
- `public/education/terms/index.html`
- `public/education/privacy/index.html`
- `public/education/refund/index.html`

All five declared the same values:

| Token | These pages | Brand | Difference |
|---|---|---|---|
| background | `#FBFAF7` | `#FCFCFC` | warm cream vs neutral |
| ink | `#15181D` | `#0A0A0A` | lighter, blue-tinted |
| line | `#E6E3DC` | `#E4E4E7` | warm vs cool |
| muted | `#565C66` | `#52525B` | different gray |

**Fix applied:** all five now use the brand values. `--surface:#FFFFFF` was left
alone — it is declared but never referenced on any of the five (`var(--surface)`
count: 0). `--accent:#0A0A0A` was also left alone: the value is already exactly
brand ink, and these pages do not load `fundhub-brand.css`, so there is no live
collision with brand `--accent` (lavender `#C4B3E5`). The name is still
misleading and worth renaming if anyone touches these pages again.

`public/contract.html` had `--paper:#FAFAF9` instead of `#FCFCFC`. **Fixed.**

These were the "little things" — close enough to look intentional, wrong enough
to read as a slightly different site next to the real one.

### 5. Marketing pages have no status colors — RETRACTED, the finding was wrong

The first draft of this audit claimed the chips on `index.html`,
`affiliates/index.html`, `education/index.html` and `404.html` fall back to
browser defaults. **They do not.** Those pages style the chip dots with the
correct brand hexes written out directly:

```css
.chip.on  .cd{background:#A8D8B0}   /* sage  — correct */
.chip.wip .cd{background:#F5CE8F}   /* peach — correct */
```

`education/index.html` and `404.html` have no chips at all. Nothing renders
wrong. The only nit is that the hex is written out rather than referenced as a
token, and on a page with no token to reference that is the reasonable choice.
No action.

### 6. The brand is defined in 23 places — LOW (downgraded, no rebrand planned)

Nothing is broken today: the three `fundhub-brand.css` copies are byte-identical
and `fh.css` matches them. With no rebrand coming, this is a slow drift risk
rather than a bug — it bites only when someone edits one copy and not the rest.

Files that declare `--spectrum` themselves:

- `fundhub-brand.css`, `public/app/fundhub-brand.css`, `wireframes/fundhub-brand.css` — **byte-identical today** (same MD5). They will not stay that way.
- `public/fh.css`
- Inlined in: `public/index.html`, `affiliates/index.html`, `education/index.html`, `education/privacy`, `education/refund`, `education/terms`, `privacy/index.html`, `terms/index.html`, `404.html`, `crm.html`
- Inside `public/app/`: `closer-call.html`, `journeys.html`, `my-numbers.html`, `sales-floor.html` — these are overridden by `shell.js` at runtime, so they are dead weight rather than broken
- Also `dist/fundhub-frontend.html`, `scripts/artifact-shell.html`, 3 files in `docs/designs/sales-dashboards/`

There is no single source of truth for the brand.

### 7. Faux-bold from a missing font weight — FIXED 2026-08-05

Four different Inter weight sets were requested across pages. Rather than assume
that was a problem, every page was checked for weights it *uses* but does not
*load*. Exactly three pages were actually affected — each styles text at
`font-weight:800` while loading only up to 700:

- `public/index.html`
- `public/affiliates/index.html`
- `public/education/index.html`

On those three the browser fakes the extra weight by smearing the 700 face,
which reads heavier and blurrier than real Inter ExtraBold. **Fixed** by adding
`800` to the Inter request on those three pages only.

No page was found requesting too little for a 700 weight, and JetBrains Mono had
no gap despite having 5 request variants. The remaining variation in weight sets
is harmless — a page that loads fewer weights than the maximum is fine as long
as it does not use them, and none do.

### 8. `public/app/sidebar.fragment.html` is dead — LOW

68 lines. Nothing references it at runtime; `shell.js` carries the sidebar
markup inline in its `SIDEBAR_HTML` constant. It is a second copy of the
navigation that will drift.

### 9. `contract.html` signature overlay uses five foreign colors — HELD

Not fixed, deliberately. These colour the signature fields on the contract:

| Hex | Line | Role |
|---|---|---|
| `#6C7DD6` | 56 | field border (periwinkle) |
| `#4E8B5F` | 59, 95 | completed field border + signed dot (green) |
| `#4A57A8` | 64 | field label text |
| `#0D1C6B` | 68 | field value text (navy) |
| `#D9A441` | 96 | "signing now" dot (gold) |

Periwinkle and gold are not in the Fundhub ramp. But these are 2px borders and
6px dots that must stay visible against pastel fills — the ramp's own colors are
probably too light to read at that size, which is likely why someone reached
outside the palette.

Replacing them is a judgement call about legibility on a legally significant
screen, and it cannot be made without looking at the rendered page. Changing a
signature-field border blind is not worth the risk. Flagged for a visual pass.

---

## Off-palette color counts

Ranked, across all of `public/`:

| Hex | Uses | What it is |
|---|---|---|
| `#161619` | 100 | dark surface, near-miss on `--card:#111113` |
| `#71717A` | 85 | Tailwind zinc-500 |
| `#6E2A22` | 80 | dark coral (see finding 3) |
| `#3F3F46` | 66 | Tailwind zinc-700 |
| `#6B4A12` | 57 | dark amber (see finding 3) |
| `#27272A` | 51 | Tailwind zinc-800 |
| `#2C5138` | 49 | dark sage (see finding 3) |
| `#3F2F63` | 42 | dark lavender (see finding 3) |
| `#22415F` | 39 | dark blue (see finding 3) |
| `#D4D4D8` | 24 | Tailwind zinc-300 |

The Tailwind zinc family (`71717A`, `3F3F46`, `27272A`, `D4D4D8`, `EFEFF1`) is
a second gray scale living alongside the brand's own (`52525B`, `A1A1AA`,
`E4E4E7`, `F4F4F5`). Heaviest in `crm.html` (78 uses).

---

One `#FBFAF7` remains in the tree, at `public/app/creative-factory.html:1119`:

```js
palette:{primary:'#1F3A5F', accent:'#C9A227', surface:'#FBFAF7'}
```

That is ad-creative data, not Fundhub chrome. `BRAND-THEMING-SPEC.md` says
Creative Factory `brand_kits` are a separate system for ads. Correctly out of
scope — left alone.

---

## Round 2 — UI consistency and load speed

Owner note 2026-08-05: parts of the interface were built by another tool and
some controls drifted. Scope for this round: **no layout changes, no new
features.** Corner radius only where it does not move or resize anything, plus
speed wins with no behaviour change.

### Controls brought back to the house standard

Every one of these was the same class doing the same job with a drifted number.

**Buttons** — standard `border-radius:7px`, `padding:8px 14px`, `font-weight:500`:

| File | Was | Now |
|---|---|---|
| `app/finance-os.html:93` | `padding:7px 13px` | `8px 14px` |
| `app/lenders.html:35` | `padding:8px 12px`, no `font-weight` | `8px 14px`, `font-weight:500` |
| `app/consent-capture.html:129` | `radius:6px` | `7px` |
| `app/client-portal.html:174` | `radius:8px` | `7px` |
| `app/client-portal.html:193` | `radius:9px` | `7px` |

`lenders.html` was the visible one — its buttons had no `font-weight` at all, so
they rendered lighter than the same button on every other screen.
`client-portal.html` had two sibling buttons at 8px and 9px.

Result: all 19 button radii are now 7px.

**Cards and panels** — standard `border-radius:10px`:

| File | Was | Now |
|---|---|---|
| `app/ops-admin.html:142` `.card` | `8px` | `10px` |
| `app/pipeline.html:219` `.card` | `7px` | `10px` |
| `app/client-portal.html:64` `.card` | `14px` | `10px` |
| `app/client-portal.html:165` `.tile` | `12px` | `10px` |
| `app/hiring.html:237` `.panel` | `9px` | `10px` |
| `app/pipeline.html:160` `.select` | `6px` | `7px` (matches inputs) |

The three `.card` rules were byte-identical apart from the radius.

Result: 24 card radii at 10px; both input radii at 7px.

**Left alone deliberately:** the three `border-radius:3px` rules are 14×14px
checkboxes (`agent-editor`, `template-editor`) and the signature-field overlay
(`contracts.html`) — 3px is right at that size. `.btn-book` and `.btn-unlock`
keep their larger padding and weight; that is a deliberate size hierarchy on the
client portal, and changing it would resize the control.

### Load speed

**Fixed — font preconnect.** 4 pages requested Google Fonts with no
`preconnect`, so the browser waited until it parsed the stylesheet link before
starting DNS and TLS to the font hosts: `login.html`, `portal-login.html`,
`reset-password.html`, `contract.html`. Sign-in is the first page every user
loads. Added the two preconnect hints already used on the other 42 pages.

`crm.html` also lacks it and was left alone per owner direction.

**Checked and correct, no change made:**

- `display=swap` — present on all 47 pages that load fonts. No invisible-text
  flash anywhere.
- **Caching** — `public/_headers` already forces revalidation on `/app/*.js`,
  `/app/*.html`, `login.html` and `contract.html`. That is deliberate: a stale
  `shell.js` broke every screen on 2026-07-31. Adding long-lived cache here
  would reintroduce that bug, and adding it to the CSS would mean a brand fix
  takes a year to appear. Correct as written.
- **Render-blocking `shell.js`** — 72KB, in `<head>`, no `defer`, on every app
  page. It is the auth gate; it decides whether you may see the screen and
  redirects if not. Deferring it would paint the page before the gate runs.
  Blocking is the right call. Not changed.
- **No image files exist** in the project at all. The logo is an inline base64
  SVG, so it costs no extra request.

**Noted, not actioned** (would need restructuring, which is out of scope):
`creative-factory.html` 196KB, `hiring.html` 180KB, `campaign-manager.html`
164KB. All inline CSS/JS, no images.

---

## Round 3 — rendered the pages, found two more

The first two rounds were source inspection only. This round actually started
Chromium against a static server on `public/` and asserted computed styles.
**That found two real bugs the source sweep had missed**, one of which was a
"fix" from round 2 that had silently not taken effect.

### 10. `lenders.html` buttons — the round-2 fix did not apply

Round 2 added `font-weight:500` to `.btn` in `lenders.html`. The rendered page
still computed `font-weight: 400`.

Cause, at `lenders.html:33`:

```css
.filters select,.filters input,textarea,button.btn{font:inherit}
```

`button.btn` is specificity (0,1,1). The `.btn` rule at line 35 is (0,1,0). The
more specific selector wins, and `font:inherit` is a shorthand — it was
resetting `font-weight` **and `font-size`** back to the inherited values. So the
buttons on this page were both lighter and the wrong size, and had been the
whole time.

This is the button drift that was actually visible.

**Fix:** dropped `button.btn` from the reset (the other three selectors keep
`font:inherit` unchanged) and added `font-family:inherit` to `.btn`, which is
what including the button there was reaching for. Now verified in-browser:
`border-radius 7px`, `padding 8px 14px`, `font-weight 500`, `font-size 12.5px`.

Checked every other page for the same shape. `lenders.html` is the only one.
The common `button,input,select,textarea{font:inherit}` pattern on ~20 other
pages is specificity (0,0,1) — **lower** than `.btn`, so those are fine.

### 11. The warm palette survived in `rgba()` form — 5 pages

Round 2 swept for hex codes and reported the legal pages clean. Looking at the
rendered Terms page showed a header still tinted warm against a corrected body.

```css
header{position:sticky;top:0;background:rgba(251,250,247,.9);backdrop-filter:blur(8px)}
```

`rgb(251,250,247)` is `#FBFAF7` — the same warm cream, written in a form the hex
grep could not see. Present on all five legal pages. **Fixed** to
`rgba(252,252,252,.9)`.

Verified in-browser: header now computes `rgba(252, 252, 252, 0.9)`.

### 9 (revisited). Contract signature colors — fixed

Held in round 2 for lack of a visual check. Resolved on evidence instead:
`contract.html` **already defines** the house dark pairs a few lines above, and
its own badge rules show the intended pattern —

```css
.b-info{background:rgba(169,198,232,.26);border-color:var(--info);color:#22415F}
```

The signature-field rules use the **same** `rgba(169,198,232)` and
`rgba(168,216,176)` fills as those badges, then reach outside the palette for
the border and text. That is drift, not a design decision.

| Was | Now | Why |
|---|---|---|
| `#6C7DD6` field border | `#22415F` | house dark blue, pairs the `--info` fill already there |
| `#4E8B5F` done border | `#2C5138` | house dark sage, pairs the `--ok` fill already there |
| `#4A57A8` field label | `#22415F` | same value `.b-info` uses for text |
| `#0D1C6B` signature text | `#22415F` | same |
| `#4E8B5F` signed dot | `#2C5138` | same |
| `#D9A441` "now" dot | `#6B4A12` | house dark amber |

Every replacement is **darker** than what it replaced, so legibility can only
improve — that is what made this safe without eyes on it. Same two colors fixed
in `app/contracts.html`, which carries the same overlay.

**Still not visually confirmed:** `/contract.html` needs a real document token,
so the signature fields do not render without one. The page chrome and error
state were checked and are correct. The fields themselves are reasoned, not
seen.

### What rendering confirmed

Chromium, 1280×900, static server on `public/`, auth gate stubbed so app screens
paint. 13 computed-style assertions, all passing:

- `terms`, `privacy`, `education/terms` — body `rgb(252,252,252)`, header
  `rgba(252,252,252,0.9)`
- `lenders` — `.btn` radius 7px, padding 8px 14px, weight 500, size 12.5px
- `pipeline`, `ops-admin`, `client-portal` — `.card` radius 10px
- `finance-os` — `.btn` padding 8px 14px
- `consent-capture` — `.btn` radius 7px

Two skipped: `pipeline .btn` and `hiring .panel` are rendered by script after
data loads and are not in the initial DOM. Their CSS is correct at source but
unconfirmed in-browser.

Caveat: the font CDN is unreachable from this environment, so screenshots render
in fallback faces. Colors, radii, spacing and weights are real; the typeface in
the images is not.

---

## Verification of the fixes

- `npm run lint` — pass, 982 files parse clean
- `npm test` — 4536 pass, 2 fail, 4 skipped. **Identical to the pre-change
  baseline**, so nothing here broke anything. The two failures are pre-existing
  and unrelated to color: `src/http/read-endpoints-org-scope.test.mjs` (audit
  finding C1, multi-tenant scoping) and `src/workflows/task-routing.test.mjs`.
- `npx tsc --noEmit` — not applicable, there is no `tsconfig.json`; this is a
  JavaScript repo.
- **No Playwright check was run.** The app was not started. These are CSS value
  changes with no logic, but they are unverified visually.
- No journey changed. These edits touch color values only — no flow, route,
  step or decision point is affected, so no `-actual.md` needed updating.

## Not covered

- **No visual review.** The app was not run. Spacing, layout, hierarchy and
  whether a screen *looks* right are untested. This audit only proves which
  colors and fonts are declared, not how they render.
- **Dark-mode behaviour** was not assessed.
- **Accessibility contrast ratios** were not measured.
