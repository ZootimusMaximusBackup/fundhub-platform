# Homepage “any negatives?” — fixer 2026-08-25

**Status:** done — live  
**Owner:** fundhub-fixer  
**PR:** https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/141 (merged `6b856e1d`)  
**Named row:** homepage survey 750+ + business still MANUAL_REVIEW / thank-you because negatives was missing.

**Live prove (agent click, 2026-08-25):** `https://fundhub.ai/#apply` showed “Any negatives on your credit report?”. 750+ / No / has business landed on `https://apply.fundhub.ai/funding-book-call` (“You Are Qualified.”). Live API same path: qualification PASS. No card charge. No live CRS.

## What we control

- **Ours:** `https://fundhub.ai/` `#apply` → `public/js/homepage-survey.js` → `POST /api/public/survey-submit`
- **Not ours:** ClickFunnels `https://apply.fundhub.ai/apply` — still no negatives question. Do not invent a CF login.

## Change manifest

| File | Change |
|---|---|
| `public/js/homepage-survey.js` | Add Yes/No “Any negatives on your credit report?” after Current Score; payload `cf_svy_has_negatives` |
| `public/index.html` | Cache-bust survey script |
| `docs/clickfunnels/cf-survey-ground-truth.md` | Record homepage extra; CF still has no question |
| `src/config/homepage-survey-js-sync.test.mjs` | Assert the new step exists and is mapped |
| `src/http/survey-submit.test.mjs` | Keep missing-answer MANUAL_REVIEW; prove homepage key is kept |
| `docs/journeys/CHANGELOG.md` | Client path note; no intended edit; `-actual.md` byte-identical (no new route) |

Classifier unchanged: PASS = 700-749 or 750+ **and** negatives = No → `apply.fundhub.ai/funding-book-call`.
