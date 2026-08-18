# W4 static notes — read of the shared CSS + shell (main thread)

Static code reading only. Live measurement is W1/W2/W3. Numbers here come from
the files, not from a browser.

## Confirmed in code

1. **`--fh-statusbar` changes after the page loads.**
   `public/app/fundhub-brand.css:70` sets it to `0px`.
   `public/app/fundhub-brand.css:170` does `body{padding-bottom:var(--fh-statusbar)}`.
   `public/app/data.js:497` overwrites it at runtime with the real bar height
   (`el.offsetHeight || 32`). The page grows ~32px taller after load, every load.

2. **No `scrollbar-gutter` anywhere in `public/`.** Grepped the whole tree: zero hits.
   A screen taller than the window gets a scrollbar; a shorter one does not. The
   scrollbar takes ~15px of width. With `.fh-maxw{margin-inline:auto}` (centered),
   losing 15px of viewport moves the whole content column ~7px sideways. Clicking
   between a tall screen and a short screen therefore shifts everything
   horizontally. Likeliest single cause of BOTH "panels jump" and "zooms in and
   out slightly" — one root cause, two symptoms.

3. **No loading skeletons exist.** Grepped `public/app/` for "skeleton": zero files.
   UI-STANDARDS §6 requires skeletons in the real layout. Nothing reserves height
   before data lands, so content pops in and pushes the rest down.

4. **The sidebar animates its width on load.**
   `crm-sidebar.css:46` — `.side{transition: width .18s ease}`.
   `shell.js:811` toggles `html.fh-side-mini` during init (`syncMini()` via `onMq()`).
   The rail animates 228px -> 60px, but `.app{padding-left}` has no matching
   transition, so the content snaps while the rail slides.

5. **Two stylesheets are injected at runtime**, after the linked ones:
   `shell.js:586` (`#fh-gate-style`, hides nav rows) and `shell.js:604`
   (`#fh-side-lock`, re-declares rail geometry with `!important`). Both land after
   first paint.

6. **`--fh-maxw:1280px`** (`fundhub-brand.css:70`) with a fixed **228px** sidebar
   (`crm-sidebar.css:6`). At 2560 wide that leaves ~1052px unused — roughly 45%
   of the screen empty. UI-STANDARDS §1 mandates the 1280 cap, so this is a
   standards-vs-owner conflict, not a bug. Owner decides.

7. **No breakpoint above 860px anywhere.** `crm-sidebar.css` has 860 / 640;
   `fundhub-brand.css` has 390. Nothing adapts for wide screens at all.

8. **Type is four hard px tokens** (`fundhub-brand.css:62-67`):
   metric 28px, title 18px, body 14px, caption 11px. All px, none rem.
   The caption token (11px) is force-applied by `fundhub-brand.css:96-105` to a
   long list including `label`, `th`, `.badge`, `.tag`, `.note`, `.hint`, `.sub`,
   `.card-title`, `.stat-label`. Every table header and most labels render at 11px.

## Hypothesis I got WRONG — corrected by W2's live measurement

**"Some screens miss the type-snap wrapper, so their text is a different size."**

I first recorded this as disproven. That was wrong, and the error was in my own
grep. I matched wrapper classes with `\bapp\b`, and in a regex the hyphen counts
as a word boundary, so `class="app-shell"` matched as if it were `.app`. In CSS
it does not: the selector `.app` does **not** match `class="app-shell"`.

`.app-shell` is genuinely missing from the selector list at
`fundhub-brand.css:81-83`. `my-numbers.html:122` roots at `.app-shell`, so that
screen gets no type snap at all. W2 measured the result live: nav text renders
14px on six screens but **11px on my-numbers**, nav rows 30.8px vs 27.19px, and
the whole nav block 119px shorter. The sidebar is on every screen, so it is the
ruler the eye uses — that is a real cause of the "zooms in and out" complaint.

The four screens outside the CRM shell — `index.html`, `payment-success.html`,
`present.html`, `soft-pull-approve.html` — are excluded on purpose
(`fundhub-brand.css:74-77`) and are not part of this.

Fix: add `.app-shell` to the selector list. One selector, shared sheet.

## Not yet measured (W1/W2/W3 own these)

- Actual layout-shift values and which node moves. (W1)
- Real rendered font sizes and root font-size per screen. (W2)
- Panel background/border seam pairs and off-8px spacing. (W3)

## Working-tree note

At the time of this batch the repo already had uncommitted changes that are NOT
part of this work: `api/lender-observations.mjs`, `api/lenders.mjs`,
`api/read/lender-observations.mjs`, `api/read/lenders.mjs`, `src/http/read-api.mjs`.
Stage only this batch's files when committing.
