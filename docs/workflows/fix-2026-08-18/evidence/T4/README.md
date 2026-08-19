# T4 — Inquiry desk & dispute letters · evidence

Read this first. Every claim T4 makes points at a file in here.

## What is in this folder

| Path | What it proves |
|---|---|
| `BASELINE.md` | The test numbers T4 measured **before** touching anything, and where it ran. |
| `before/live-inquiry-remover.html` | The page as it was actually being served by `https://fundhub.ai` on 2026-08-18. |
| `before/PROOF-view-not-defined.md` | The Send button crash, proven on the live page **without pressing Send**. |
| `before/inquiry-remover-HEAD.html` | The same page from `origin/main`, used as the "before" in the browser test. |
| `before/walk.json`, `before/inquiry-desk.png` | Browser run of the **unfixed** page. 8 checks fail. |
| `after/walk.json`, `after/inquiry-desk.png` | Browser run of the **fixed** page. All 10 checks pass. |
| `proof-inquiry-desk.mjs` | The browser test itself. Re-runnable by anyone. |
| `unitB-emit-arity.json` | The event bus's own answer to the two-argument call: `event name required`. |
| `GROUND-raw.json` | The full read-only trace of every claimed defect against current source. |

## How to re-run the browser proof

```bash
node docs/workflows/fix-2026-08-18/evidence/T4/proof-inquiry-desk.mjs public/app/inquiry-remover.html after
```

To see it fail on the old page:

```bash
git show origin/main:public/app/inquiry-remover.html > /tmp/before.html
node docs/workflows/fix-2026-08-18/evidence/T4/proof-inquiry-desk.mjs /tmp/before.html before
```

## Is this test honest?

The two things that could make it a fake pass were checked on purpose:

1. **The timing is real.** `data.js` is replaced with a stub, but the stub is still
   loaded through the page's own `<script defer …>` tag. So the helper it defines still
   arrives only *after* the page is parsed — which is the exact timing that caused the
   bug. If the fix were removed, the test goes red again, and it does.
2. **The Send check reads the page's own source.** It pulls whichever name the Send
   button actually uses out of the HTML and runs that. On the old page that name is
   `VIEW` and it fails with the literal words **"VIEW is not defined"** — the same words
   the audit saw on screen. On the fixed page it is `window.FHInquiryView` and it builds
   a real request.

Nothing here contacts a credit bureau, sends mail, places a call, or charges a card.
No real client file is opened. The live site was only ever **read**.
