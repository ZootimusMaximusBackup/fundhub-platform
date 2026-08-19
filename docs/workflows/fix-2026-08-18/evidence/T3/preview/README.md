# Deploy-preview proof — real infrastructure, read-only

Preview: `https://deploy-preview-103--transcendent-wisp-888771.netlify.app`, built from commit
`09abe8d`. Walked as `owner@fundhub.ai` on the TEST client `8556bedc-…`.

**The preview shares the PRODUCTION database.** So this walk is GETs only — no button was pressed,
nothing was seeded, nothing was written. Proof of that is in `preview.json`: the only two non-GET
requests in the whole run are Netlify's own deploy-preview analytics beacon to `app.netlify.com`.
**Zero writes reached the Fundhub API.** The live credit file `9af65808-…` was never opened.

## What it proves

**The closer's calculator now asks for its data.** This is the whole of finding T3-16.

| | live fundhub.ai (today, unfixed) | this preview (fixed) |
|---|---|---|
| `/api/read/deal-math` | not called | **called** |
| `/api/read/closer-call` | not called | **called** |
| `/api/read/tradelines` | not called | **called** |
| `/api/read/lender-matches` | not called | **called** |
| total API calls | 4 (`session`×2, `health`, `org-brand`) | 9 |

**The Client Control Panel now checks whether a pull can succeed before offering the button.** It
fires `GET /api/consent/capture?client_id=…&kind=soft_pull_consent`, which the live screen never
calls. That is finding T3-12.

**The dead GHL button is gone**, and there is no Social Security field anywhere on the staff screen
— asserted directly in the walk (`ssnFieldOnStaffScreen: false`), which is the owner's 2026-08-19
decision holding.

## Honest limit on this walk

The five money boxes still read empty in the captured DOM, and the screenshots show a signed-out
shell. The session cookie did not survive on the preview's own domain, so the shell bounced to
`/api/auth/login` a few seconds after load. That is a limitation of walking a preview domain, not a
product fault — and it does not weaken the proof, because **the four data calls fired before the
bounce.** A screen that quits during page parse, which is what the bug was, cannot fire them at all.
The filled-in boxes are the thing for Chris to confirm by eye after merge.
