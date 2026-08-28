# Pipeline design polish — 2026-08-27

Six named removals. Nothing else was touched. Branched from `origin/main` at `7813e0cc`.

## Tasks

| # | Item | File | Owner | Status |
|---|------|------|-------|--------|
| 1 | Empty-column note removed | `public/app/pipeline.html` | this session | done |
| 2 | `live board · ` prefix dropped from both banner calls | `public/app/pipeline.html` | this session | done |
| 3 | `Org: Fundhub` pill + its CSS removed | `public/app/pipeline.html` | this session | done |
| 4 | Tab count removed from the name chip | `public/app/shell.js` | this session | done |
| 5 | Chip made hideable, state remembered | `public/app/shell.js` | this session | done |
| 6 | Yellow proxy bar deleted | `public/app/proxy-apply.js` | this session | done |

Item 6 was re-scoped by the owner mid-run: the first instruction was to gate the bar on
`[data-fh-apply]`; that could not work, because those buttons are built after page load and only
when a client is scoped, so the gate would have removed the bar everywhere. The owner replaced it
with "delete the bar entirely."

## Change manifest

**`public/app/pipeline.html`**
- Removed the `if (!(stage.cards || []).length)` block in `buildColumn()` that appended
  `.empty-rail-note` reading "No cards in this stage". The empty `.col-body` element is kept, so
  column widths do not collapse.
- `applyBoard()`: both `banner("real", …)` calls lose the `"live board · "` prefix. The
  "no cards on this rail yet" wording is unchanged.
- Removed `<div class="org-pill">Org: Fundhub</div>` from `.topbar-right`, and the now-unused
  `.org-pill` rule. The footer statusbar's separate `org: fundhub` span is untouched.
- No exports, props, routes or journeys changed.

**`public/app/shell.js`** (shared — renders on every screen, intended)
- `mountChip()`: `roleText` is now just the role. Visible chip reads `<name> · <role>`. The tab
  count survives in the hover tooltip (`roleTitle`). The unknown-role `?` and its amber colour are
  unchanged.
- New `CHIP_HIDDEN_KEY = "fh_chip_hidden"` with `readChipHidden()` / `writeChipHidden()`, same
  shape as `CLIENT_KEY` / `ENTITY_KEY` / `ROLE_KEY`, both wrapped in try/catch.
- New `#fh-shell-chip-hide` (`×`) inside the chip and `#fh-shell-chip-show` (`account`) beside it.
  Both set `pointer-events:auto`, the same way `#fh-shell-out` already does, because the chip body
  is deliberately click-through.
- New `CHIP_CONTROL_CSS`, always injected. The `×` gets a 40×40 hit area from a transparent
  `::before` so the chip does not grow taller; 16px separates it from Sign out (UI-STANDARDS §5).
  `#fh-shell-chip-show` is 40px tall, in-flow beside the chip when the chip is in a header and
  fixed on the chip's own corner and breakpoints when it is not.
- `html.fh-drawer-open` now hides `#fh-shell-chip-show` alongside the chip and Search.
- `layoutShellChrome()`: a hidden chip measures 0, and `|| 337` would have silently restored the
  old reservation — every topbar padded for a bar that is not on screen, and Search parked a
  chip-width from the edge. It now measures the restore pill instead.
- No nav, role or `ROLE_TABS` change.

**`public/app/proxy-apply.js`** (shared — 3 screens)
- `showExtensionHint()` deleted; its call inside `detectExtension()` removed. Detection itself is
  unchanged and `FHProxyApply` still exports the same five functions.
- The warning is not lost: `openManualUi()` states it in the modal, same words and same yellow, the
  moment Apply is clicked without the add-on, and `NOT_ROUTED_WARNING` still covers both failure
  paths. Verified on the live site — `window.FHProxyApply` is still true on Lenders.

**`e2e/proxy-apply.spec.mjs`**
- The two `#fh-proxy-ext-hint` assertions now assert `toHaveCount(0)`. No test deleted, skipped or
  weakened; the modal-warning assertions beneath them are untouched and still pass.

## Verification

| Gate | Result |
|---|---|
| `npm run lint` | pass — 1532 files parse clean |
| `npx tsc --noEmit` | no `tsconfig.json` in the repo, so tsc has no project; identical on `origin/main`. None of the four changed files are TypeScript. |
| `npm test` | 675 tests, 57 pass, 0 fail, 618 skipped (no `DATABASE_URL`) — **byte-identical to a clean `origin/main` worktree run**, so the suite did not move. |
| `npx playwright test e2e/proxy-apply.spec.mjs` | 2 passed |
| Live proof | 3 passed against `https://fundhub.ai` |

Live proof harness: `docs/workflows/pipeline-polish-2026-08-27-evidence/live-polish-proof.spec.mjs`.
It logs in as the real owner on the deployed site and serves this branch's four changed files by
route interception, so the page under test is the live page, live backend, live data, this branch's
markup. Annotated shots in `…-evidence/shots/`, raw in `shots/_raw/`, element boxes in `marks.json`.

Measured on the live board:

- 10 columns, **5 of them empty**, zero per-column notes, widths intact.
- Status bar text: `sales pipeline`.
- `.org-pill` count 0; `footer.statusbar` still contains `org: fundhub`.
- Chip text: `Chris Stanbridge · owner` — no tab count.
- `×` hit area **40×40**; `account` pill **104×40**. Both clear UI-STANDARDS §5's 40px minimum.
- Hide → full reload → still hidden. Restore → chip back, Sign out visible and enabled.
- `#fh-proxy-ext-hint` count 0 on Pipeline **and** Lenders; `window.FHProxyApply` still true.

## Notes for the owner

- `.empty-rail-note` is a shared class. `#boardStatus` — the page-level "Loading the board…" /
  status line — also uses it and was left alone. Only the per-column note was removed.
- Not fixed, not in scope: `#fh-shell-out` (Sign out) is about 19px tall, under the 40px minimum in
  UI-STANDARDS §5. It predates this work. The two controls added here both meet it.
