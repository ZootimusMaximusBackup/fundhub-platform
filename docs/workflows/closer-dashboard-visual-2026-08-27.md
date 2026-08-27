# Closer Dashboard — visual pass, 2026-08-27

One screen: `public/app/closer-dashboard.html`. Looks only. The page stays light.
Nothing was removed. Owner-set brief: five named problems, each tied to a rule in
`docs/UI-STANDARDS.md`.

Evidence: `docs/workflows/closer-dashboard-visual-2026-08-27-evidence/`
Shot tool: `_tools/shots.mjs` (read-only; every non-GET `/api` call is refused
with a synthetic 599, so a shot run can never write anything).

---

## What the numbers say

Measured on the deployed page as `closer@fundhub.ai`, before and after.

| | before | after |
|---|---|---|
| Bordered containers on screen | **8** | **0** (one rail divider, which is a single edge, not a box) |
| Distinct rendered text sizes | 4 (13 / 16 / 20 / 32) | **3** (13 / 16 / 32) |
| Largest thing on the page | three em-dashes, 32px | **the person being called**, 32px, top-left |
| Text under 11px | 0 | 0 |
| Sideways scroll at 390px | none | none |
| Console errors | 0 | 0 |
| Controls / labels / headings | — | **identical, both states** (see parity table) |

---

## The five, and what each one turned into

**1. Too many borders (§2 proximity, §7 data-ink).**
Eight bordered containers became zero. The three forecast cards, WHERE THEY
STAND, THE DEAL, PRE-CALL CONTEXT, the Payment Calculator strip and the right
rail all kept every one of their contents; only the outline went. Grouping is
now done with spacing on the 8px scale — 8 inside a group, 16–24 between rows,
32 between columns, 48 between sections.

One border survives, on purpose: the rail's left edge. §2 allows a divider where
two unrelated things butt together, and a checklist of things to say is not part
of the call cockpit. It becomes a top edge when the rail stacks under the
cockpit below 1080px.

Two more hairlines survive as *control affordances*, not as boxes: the top rule
above "Payment Calculator" and above "Show breakdown". A disclosure has to look
pressable (§5).

The two real alerts inside the calculator — the guardrail hard-stop and the
negative-amortisation cliff — kept their status tint but lost the 1px outline
around it. They are alerts; they are not captions.

**2. Eight competing caps labels (§3 hierarchy).**
The root cause was not this file's CSS. `fundhub-brand.css` snaps every
descendant of `.app` to four tokens with `* {font-size:inherit !important}`, so
the 7.5–24px values written in this page painted **nothing**. Every `h3`/`h4`
section heading fell through to 16px — the same size as body text — which is
why eight caps labels all shouted at once.

Fixed by assigning each element one of the four brand tokens deliberately, and
deleting the dead px values so the next reader is not misled. Caps-mono is now
one size (`--fs-caption`, 13px), one weight, one colour, used for eyebrows only.
**Every label's wording is unchanged.**

**3. No top-left anchor (§1, §10 closer lens).**
The h1 was pinned at 20px by the brand's `h1,h2` rule while three em-dashes sat
above it at 32px. The person and the call now carry `--fs-metric` and sit
top-left, with the "Live call" eyebrow 8px above them so the two read as one
block. No new data — this is the same `#ccp-who-name` / `#ccp-who-meta` the page
already loaded.

**4. The field of em-dashes (§6 empty state).**
Every row still exists and no sample value was invented. What changed:

* One empty-state sentence at the anchor says what will appear and points at
  what is next, instead of the screen saying "unknown" twelve times in dashes.
* In the no-client state only, the value column, the four context values and the
  three forecast numbers mute to `--text-faint`, so they read as *not yet* rather
  than as a broken form. Live figures are never muted.
* The gate is `.cockpit-main:not(:has(#fh-send-contract))`. `closer-call.js`
  **removes** that button in `setEmpty()` and merely hides it while a call is
  loading or live, so the empty-state styling appears exactly when there is no
  client and can never paint over real numbers.

**5. Filled blue strips used as captions (§7 data-ink).**
"Credit facts load from the live file." and "No sample story. Live survey + pull
only." are now quiet captions. Wording untouched. The `.cliff` carried its fill
as an **inline** style attribute, which would have outranked any stylesheet
rule, so those two declarations came out of the markup with it.

## Also checked

* **390px (§11).** One column, no sideways page scroll. `.res-grid` and
  `.bd-cols` were missing from the stacking list, so the two result tiles and the
  two breakdown tables stayed side by side on a phone and the money overflowed
  its own tile. Both stack now.
* **Hit targets (§5).** The five "Before you close" checkboxes were 20×20. The
  box is sized by the brand file and its label is a sibling rather than a
  wrapper, so the **label** now carries a 40px target; clicking it still toggles
  the box through `for=`. Number-inputs in the calculators are 40px too.
* **The compliance line.** "Never: guaranteed · won't affect credit · we have
  relationships · 0% forever" wrapped to five lines: mono, at body size, with
  .06em tracking, in a 280px column. Sans at the caption token with no tracking
  reads in two. The status colour moved off the text onto a keyline so the words
  are legible. Wording unchanged.
* **§1 max width.** `.cockpit-wrap` now honours `--fh-maxw`. Without it the
  cockpit sprawled to roughly 2200px on the owner's 2560px screen.

## Found, not fixed — nothing removed

Each of these is real and none is in the five. Left exactly as found.

1. **`--alert`, `--warn` and `--info` are all blue on this tenant.** Not a bug in
   this page. `shell.js` `paintBrand()` overwrites the status tokens from the
   company's white-label brand ramp, and the test company's ramp is
   blue-on-blue. So the guardrail's hard-stop, warning and clear states paint as
   three shades of the same blue and carry no status meaning. App-wide.
2. **"No crs_results row for this client yet"** is shown to a closer in the
   WHERE THEY STAND panel. That is a database table name in a sentence meant for
   a salesperson (§6 error states, §10 plain language). Comes from the API's
   `credit.reason`.
3. **"Credit facts load from the live file."** is never rewritten once a real
   file loads, so it still says "will load" beside figures that already have.
   `closer-call.js` rewrites the sibling `.flag` but not this one.
4. **`#ccp-who-meta` defaults to `Open with ?client_id=<uuid>`** — developer
   syntax in the closer's field of view for the moment before the JS replaces it.
5. **`#fh-contract-panel`** still carries its box and its dead inline font sizes
   in the markup. It is hidden until "Send contract" is pressed and was not one
   of the nine.

## Journeys

`docs/journeys/role-closer-actual.md` describes no step that changed — no flow,
route, field or decision moved, and the file does not document this screen's
empty state at all. So no `-actual.md` edit and no `CHANGELOG.md` line. Saying so
here rather than inventing a journey change.

## Gates

* `npm run lint` — clean, 1532 files.
* `npx tsc --noEmit` — **no-op in this repo.** There is no `tsconfig.json`
  anywhere in the tree and no TypeScript sources to check; `tsc` prints its help
  text and exits. Recorded as run, not as passed.
* `npm test` — exit 0. Unit phase 6865 tests, 6862 pass, 0 fail, 3 skipped. The
  Postgres phase reports 675 / 57 pass / 0 fail / 618 skipped because
  `DATABASE_URL` is unset, which is the documented behaviour in `CLAUDE.md §12`
  and proves nothing about anything needing a database. No test was skipped,
  deleted or weakened — one file changed, and it is not a test.
