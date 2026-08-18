# U19 — Live Playwright 100/100

Date: 2026-08-18  
Command: `npm run test:e2e:live`  
Did not edit the app, spec, baseline, or hook. Did not tell Chris to click.

## Ground truth

Required ids: `docs/workflows/live-playwright-100.md`.

## Chris’s claim

The live suite against fundhub.ai (and apply.fundhub.ai) scores 100/100.

## Score

**100/100** on required ids.

`score = (passed_required / required) * 100`

- Required ids on the board: **29 unique** (staff session is 3 tests, 1 id). All passed.
- Required tests with a `req` tag: **26/26** passed.
- Failed required ids: **none**.

Full command was **26/29**. Three extra tests failed. They are **not** on the required list. I did not fix them.

## Extra red (not required)

1. Company Brain — wide chat — `ERR_ABORTED` on `/app/company-brain.html`
2. Company Brain — upload — **502** `embed_failed`
3. Company Brain — conversation reload — **502**

## Evidence

- `live-run.txt`
- `score.json`
- `last-run.json` (copy of the Playwright json reporter)

Human-click was not done. This unit stops at the script score.
