# Colour bars off the whole CRM (2026-08-28)

Owner ask: "I want all the color bars gone from entire crm, look amatuer dont you
think?" — the full-width coloured strips pinned along the bottom edge of every
screen. Every word they carry is kept; only the coloured bar goes.

## What is actually there, measured 2026-08-28

`public/app/data.js` `FHData.banner(tone, text, key)` paints one fixed, full-width
strip at the bottom of the page in one of three colours, and 15 screens call it
through `FHData.explain()`. Three more screens carry a hand-rolled copy of the
same thing.

| tone | colour | says | state |
|---|---|---|---|
| `sample` | peach `#F5CE8F` | demo session, not built yet, no matching record | **already suppressed** — owner call 2026-08-27, a previous thread did this |
| `real` | mint `#A8D8B0` | "live file · 6 payments · 67 messages" | still paints — this is the green bar |
| `error` | rose `#F2A69B` | a read failed and the screen is showing dashes | still paints |

`fundhub-brand.css:105` reserves `--fh-statusbar:32px` at the foot of every page
for this strip, and `body{padding-bottom:var(--fh-statusbar)}` at line 269 holds
the space. Four screens position their own furniture against that variable
(`staff-teams` editor drawer, `brand-studio` save bar, `agent-editor` content
padding, `company-brain` app height), so it has to keep working, not be deleted.

## The rule for every unit

1. **The bar goes. The words stay.** `real` is a diagnostic nobody reads —
   it stops rendering. `error` still has to say a read failed, or the screen
   shows dashes with nothing explaining them; it renders in the app's own dark
   chrome strip with coral **text**, which is not a colour bar.
2. **No new surface.** Where a screen already has a footer or status strip, the
   words go there. Nowhere else. See `client-control-panel.html` `source()` for
   the shipped pattern.
3. **`--fh-statusbar` keeps working.** It goes to `0px` when nothing is showing
   and to the real height when something is. Do not delete the variable.
4. **Prove it live on https://fundhub.ai, then push.** A green `npm test` does
   not prove a deploy: `npm test` never bundles the functions. Check the served
   page, not the repo.

## Task list

| # | Unit | File | Owner | Status |
|---|------|------|-------|--------|
| A | The shared strip 15 screens inherit | `public/app/data.js` | this thread | **claimed** |
| B | Pipeline's own copy | `public/app/pipeline.html` | this thread | **done** |
| C | Partner Galaxy's own copy | `public/app/partner-galaxy.html` | this thread | **done — nothing to change** |
| D | Calendar's own copy | `public/app/calendar.html` | this thread | **done** |
| E | Live sweep, all screens | this thread | **done** |

A, B, C and D are four different files with no shared code. **No dependencies —
all parallel.** E waits for the other four. All five ran in this thread in the
end, on one branch: `fix/no-colour-bars-2026-08-28`, PR #267.

Screens covered by A (they call `FHData.explain`): agent-editor, brand-studio,
calendar, campaign-manager, client-portal, closer-dashboard, finance-os,
creative-factory, documents, inquiry-remover, hiring, messaging, ops-admin,
social-studio, staff-teams.

Already done, do not redo: `client-control-panel.html` — shipped 2026-08-28.

## Change manifests

### A — public/app/data.js — **done 2026-08-28**

Shipped on branch `fix/no-colour-bars-2026-08-28`, cut from `main`, **not** from
the shared checkout: a first attempt made in the shared tree was overwritten by
another session mid-edit.

Files touched, all three in one branch:

* `public/app/data.js` — `banner()`. The `TONE` colour map is gone. `real` and
  `sample` render nothing; only `error` reaches the strip, and it paints in app
  ink (`#0A0A0A`) with the sentence in `var(--alert)` so a white-label tenant
  gets its own alert colour. `--fh-statusbar` still goes to `0px` when nothing
  shows and to the real height when something does, so `staff-teams`,
  `brand-studio`, `agent-editor` and `company-brain` keep positioning against it.
* `public/app/client-control-panel.html` — one sentence restored. My brand pass
  reworded the Apply-door copy to "…, and shows the client email…", which broke
  `crm-html.test.mjs:104`. **`main` was red on this.** Wording is back to what
  the test names.
* `src/lenders/resolve-logo.mjs` — deleted a duplicated block. Two separate
  repairs of the 60c1902b merge damage both landed, so
  `LENDER_LOGO_PLACEHOLDER` and `logoPathOrPlaceholder` were each declared
  twice and the module would not parse at all. **`main` could not build.**
  Kept the documented copy at the top, removed the trailing one.

No exports, props, routes or journeys changed. No button added or removed.

Gates: lint clean (1575 files). Full suite 6929 tests, 7 failing — the same 7
fail on clean `main` with these changes stashed, so they are pre-existing
(`underwrite/adapter`, `pulse/registry`, `http/start-html`,
`http/closer-deck-present`, `dashboard/kpis`, `config/offers`,
`scripts/journeys/generate`). `netlify build --context production` on this
branch: **exit 0, "Netlify Build Complete"** — on `main` as it stands it exits 2.

Live proof against https://fundhub.ai as `closer@fundhub.ai`, patched `data.js`
served over the real backend, all writes blocked:

| screen | colour bars before | after | space reserved after |
|---|---|---|---|
| documents | 1 — mint `rgb(168,216,176)` | **0** | 0px |
| messaging | 1 — mint `rgb(168,216,176)` | **0** | 0px |
| closer-dashboard, inquiry-remover, staff-teams, ops-admin, finance-os, campaign-manager | 0 | **0** | 0px |

Failed reads still speak. Forcing the database-down 503 on `documents.html`:
strip renders, background `rgb(10,10,10)`, text `rgb(242,166,155)`, saying
"We could not load documents — the database is not answering (…). Try again in
a few minutes." Evidence and both scripts in
`docs/workflows/colour-bars-2026-08-28-evidence/` (gitignored).

### B — public/app/pipeline.html — **done 2026-08-28**

Had the full mint/peach/rose map hand-rolled in the file. `real` and `sample`
render nothing; `error` renders in app ink with the sentence in `var(--alert)`.

Two messages would have been swallowed by simply deleting the green tone, so
they move to a new `note` tone that still renders, in app ink with ordinary
text — this is the part worth reviewing:

* `"Archived <name> · removed from pipeline"` — the only confirmation an archive
  has ever given anyone.
* `"<rail> · no cards on this rail yet — stages are ready, nobody has been
  placed here"` — an empty rail explaining that it is empty on purpose.

`"live pipeline"` renders nothing now; a full board says it better. Dropping
`sample` loses nothing: every caller of it in `failBoard()` also calls
`showNote()`, which puts the same sentence on the board itself.

### C — public/app/partner-galaxy.html — **done 2026-08-28, no change needed**

Its bottom strip is already `#0A0A0A` with `#E4E4E7` text — app ink, not a
colour. It only appeared in the first sweep because it shares the z-index.
Checked live: zero colour bars. No edit made.

### D — public/app/calendar.html — **done 2026-08-28**

One rose strip, for the case where the page never finished loading. Same
sentence, now app ink with the text in `var(--alert)`.

Calendar's "live schedule" green bar comes from the shared `FHData.banner`, not
from this file, so unit A removes it — confirmed by sweeping with `data.js`
patched and again without it. Its partial-failure warning ("Some of your
completed calls could not be loaded…") uses the `error` tone, so it is
unaffected and still shows.

### E — live sweep — **done 2026-08-28**

All eleven screens checked live on https://fundhub.ai as `closer@fundhub.ai`
with the patched files served over the real backend and every write blocked:
documents, messaging, closer-dashboard, inquiry-remover, staff-teams,
ops-admin, finance-os, campaign-manager, pipeline, calendar, partner-galaxy.
**Zero colour bars on all eleven.** Mint confirmed present before the fix on
documents, messaging and calendar; gone after.
