# T4-X1 / T4-08 / T4-11 — reproduced on the LIVE site, without pressing Send

Captured 2026-08-18 from `https://fundhub.ai/app/inquiry-remover.html` (HTTP 200, 112030 bytes).
Saved verbatim as `live-inquiry-remover.html` in this folder.

## Why this is proof and not an inference

Pressing Send would have mailed a real credit bureau. So instead of clicking, the deployed
JavaScript itself was read. The defect is decidable from the source alone: a name is used
that is never created.

## What the live page actually contains

`window.VIEW` is **read twice** and **assigned zero times**:

```
1840:    if (window.VIEW && VIEW.caseUiStatus) return VIEW.caseUiStatus(C);
1844:    if (window.VIEW && VIEW.caseCallState) return VIEW.caseCallState(C);
```

```
$ grep -cE "window\.VIEW\s*=" live-inquiry-remover.html
0
```

And the Send handler calls it with no guard at all:

```
1982:            req = VIEW.buildCaseSendRequest({
```

## What that means, in plain words

The page builds its toolbox and puts it on a shelf labelled **FHInquiryView**. Three places
later in the same page reach for a shelf labelled **VIEW**. That shelf was never put up.

- Lines 1840 and 1844 check first, find nothing, and quietly give up. That is why the
  **Status** and **Call** columns on every case row show a dash.
- Line 1982 does **not** check. It reaches for the missing shelf and the page throws
  `ReferenceError: VIEW is not defined`. The error is caught a few lines below and printed
  into the button's own label — which is why the button's text turns into
  **"VIEW IS NOT DEFINED"**.

Nothing is mailed, because the crash happens while building the request, before any network
call is made.

## Confirms

- **T4-X1** — exact lines confirmed (1840, 1844, 1982 as deployed).
- **T4-08** — inquiry Send is dead for this reason. STILL BROKEN on live.
- **T4-11** — the Repair Send button reported with the same message; see the Unit A grounding
  note for whether it shares this line or has its own.

## Cross-check against the source under fix

The worktree at `origin/main` (`c860b8c`) is identical in these three lines, so the fix
target and the deployed artefact agree. The toolbox object itself **does** contain
`caseUiStatus`, `caseCallState` and `buildCaseSendRequest` — so putting the shelf up is
sufficient; nothing needs to be written from scratch.
