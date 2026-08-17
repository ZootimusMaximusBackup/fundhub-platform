# affiliate — re-verify pass (auditor, read-only)

**Who:** claude-fable-5 (auditor, reverify)  ·  **Login:** affiliate@fundhub.ai  ·  **Target:** LIVE https://fundhub.ai (never localhost)
**When (UTC):** 2026-08-17T05:37:36Z live-build check · 05:38:30Z Ask API check · 05:38:32Z Chromium landing · 05:38:46Z route probe · 05:39:40Z UI walk

## Live build check (done first)

```
curl -s "https://fundhub.ai/app/shell.js?nc=$RANDOM" | grep -c 'role !== "owner" && role !== "admin"'   → 1
curl -s "https://fundhub.ai/app/shell.js?nc=$RANDOM" | md5                                             → 6783efb97b099f8694ce6d3fc1c95b88
git show 2b1eed0:public/app/shell.js | md5                                                             → 6783efb97b099f8694ce6d3fc1c95b88
```
Live shell.js is byte-identical to commit 2b1eed0.

## What ran (exact commands, from repo root)

1. `node docs/workflows/e2e-verify-run5-evidence/affiliate/reverify/ask-live.mjs`
   Own script (not copied from ../fixed/). One API login → POST `/api/read/company-brain-affiliate` `{}` with token, then `{}` with no token → then real Chromium: /login.html → sign in → /app/affiliate.html; records every /api call, checks `#brainBtn` / "Ask approved partner docs" visible, screenshots. No question sent, nothing clicked but the login submit.
   → `ask-network.json`, `landing-network.json`, `ask-shot.png`, `landing-full.png`
2. `node docs/workflows/e2e-verify-run5-evidence/affiliate/reverify/probe-role.mjs affiliate affiliate@fundhub.ai`
   Copy of `_tools/probe-role.mjs`; the ONLY change is the `OUT_DIR` line (writes to this dir; still reads `docs/journeys/affiliate-actual.md`). GET on reach routes, GET / empty `{}` POST on blocked routes.
   → `route-probe.json`, `route-probe.md`
3. `node docs/workflows/e2e-verify-run5-evidence/_tools/ui-walk.mjs affiliate/reverify affiliate@fundhub.ai`
   Unmodified tool; journey arg `affiliate/reverify` only redirects output. Login → landing → every visible sidebar link.
   → `ui-walk.json`, `ui-walk.md`, `shots/00-04*.png`

Logins used: 3 (all successful; only failures count toward the 5-per-15-min limit). Password read from gitignored `.env` by the scripts; never printed. No tokens or PII in any file here.

## Results in one line each

- **Company Brain Ask (FIXED-UNCLICKED row):** live POST `{}` with affiliate token → **400 `question_required`**; without token → **401 `unauthorized`**. Ask control visible on /app/affiliate.html (`#brainBtn` text "Ask", card "Ask approved partner docs"). Landing fired 7 /api calls, all 200, 0 console errors. → **CONFIRMED-FIXED**.
- Route probe: identical to the original batch-1 run except one route — `/api/read/company-brain-affiliate` POST `{}` moved 401 → 400 question_required. Blocked split now 34 → 403, 91 → 401, 1 → 400 (was 92 → 401). Reach 5/6 OK (contracts/sign 404 without a link, as before).
- UI walk: 2 visible / 34 links, 1 distinct screen, HTTP 200, 0 bounced, 0 API 4xx/5xx, 0 console errors — same as before.
- Footer strip still says "no code for this session" while AFF-000001 shows (recorded LOW, unchanged — not a regression).
