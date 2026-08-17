# role-funding-advisor — reverify pass (fix-induced-regression spot-check)

Read-only re-run against the LIVE site after ship commit `2b1eed0`. This journey had no
FIXED-UNCLICKED rows; the goal was to see whether the six Fable Fixer changes (shell.js
demo banner gate, login.html fh_account, hiring/ops-admin/staff-teams/command-center pages,
`api/read/messages` status=blocked, `api/read/company-brain-affiliate` requirePrincipal)
changed anything for a `funding_advisor`.

**Target:** https://fundhub.ai (BASE_URL not set; tools default to it)
**Login:** advisor@fundhub.ai (password read by the tools from gitignored `.env`; never printed)
**Model:** claude-fable-5 (reverify)

## Live build check

```
curl -s "https://fundhub.ai/app/shell.js?nc=$RANDOM" | grep -c 'role !== "owner" && role !== "admin"'
# -> 1   (2026-08-17T05:47:51Z)
```

## What ran (UTC), exact commands, from repo root

| When | Command | Output |
|---|---|---|
| 2026-08-17T05:48:28Z | `node docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/reverify/probe-role.mjs role-funding-advisor advisor@fundhub.ai` | `reverify/route-probe.json`, `reverify/route-probe.md` |
| 2026-08-17T05:49:06Z | `node docs/workflows/e2e-verify-run5-evidence/_tools/ui-walk.mjs role-funding-advisor/reverify advisor@fundhub.ai` | `reverify/ui-walk.json`, `reverify/ui-walk.md`, `reverify/shots/00..26-*.png` |
| 2026-08-17T05:51:47Z | `node docs/workflows/e2e-verify-run5-evidence/role-funding-advisor/reverify/spot-check.mjs` | `reverify/spot-check.json`, `reverify/spot-check.md`, `reverify/shots/spot-0[1-4]-*.png` |
| after | inline node one-liner comparing `ui-walk.json` (original) vs `reverify/ui-walk.json` | `reverify/ui-walk-compare.md` |

`reverify/probe-role.mjs` is a byte-for-byte copy of `_tools/probe-role.mjs` with ONE line changed
(`OUT_DIR` now ends in `/reverify`) because the tool derives the `docs/journeys/<journey>-actual.md`
path from the journey argument. `_tools/ui-walk.mjs` does not read journey docs, so it was run
unmodified with the argument `role-funding-advisor/reverify`.

No production writes: GET only on reach routes; empty `{}` POST only on the routes the original
batch probed as "should stay blocked" (all answered 403). Nothing clicked except sidebar links and
the login button. No form submitted except login.

## Headline

- Route probe identical to the original: login 200 role=funding_advisor; session 200; 6/6 unauth 401;
  reach 57/60 probed OK, 3 FAIL (the same three: contracts/sign 404, read/my-numbers 403,
  repair/exceptions 403); blocked 44/44 → 403. `diff` of the "Every probe" table = empty.
- UI walk: 25/34 sidebar links visible, 24 screens opened, all HTTP 200, 0 bounced, 0 5xx.
  **0 new failing endpoints on any screen.** Screens with any API 4xx: 24 → 10.
  `/api/demo/mode` 403: 24 screens + login/landing → 6 screens (page-level scripts, not shell.js).
  ops-admin `GET /api/read/messages?status=blocked&limit=30`: 400 → 200 (`ok:true`, `items` len 0).
- Landing still `/app/command-center.html`; its stage counters now show live numbers instead of dashes.
- localStorage after staff login: keys `fh_role`, `fh_token` only; `fh_account` absent (expected for staff).

See `BOARD-UPDATE.md` for the proposed board rows.
