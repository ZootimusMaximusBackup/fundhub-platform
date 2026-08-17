# role-inquiry-remover — reverify pass (fix-induced-regression spot-check)

Auditor: claude-fable-5 (reverify). Read-only. Login `inquiry@fundhub.ai` (password read from gitignored `.env` by the scripts; never printed).

Target: **https://fundhub.ai** (live). Live build re-confirmed before the first check:

```
curl -s "https://fundhub.ai/app/shell.js?nc=$RANDOM" | grep -c 'role !== "owner" && role !== "admin"'   → 1   (2026-08-17T05:47:51Z)
```

That string is the `mountDemoBanner` early-return added in ship commit 2b1eed0, so live shell.js is the shipped build.

## What ran (UTC, 2026-08-17)

| When | Command (run from repo root) | Output |
|---|---|---|
| 05:48:24Z | `node docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/probe-role.mjs role-inquiry-remover inquiry@fundhub.ai` | `route-probe.json`, `route-probe.md` |
| 05:49:06Z | `node docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/ui-walk.mjs role-inquiry-remover inquiry@fundhub.ai` | `ui-walk.json`, `ui-walk.md`, `shots/00-…26-*.png` |
| 05:51:58Z | `node docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/spot-check.mjs` | `spot-check.json`, `shots/spot-ops-admin.png`, `shots/spot-inquiry-remover-landing.png` |
| 05:53:50Z | `node docs/workflows/e2e-verify-run5-evidence/role-inquiry-remover/reverify/inquiry-route-check.mjs` | `inquiry-route-check.json` |

`probe-role.mjs` and `ui-walk.mjs` here are byte-for-byte copies of `_tools/` with exactly one line changed (`OUT_DIR` now ends in `/reverify`; the `docs/journeys/role-inquiry-remover-actual.md` input path is untouched). `_tools/` itself was not edited. `spot-check.mjs` and `inquiry-route-check.mjs` are new one-offs written for this pass: GET only, no clicks except the login form, status + shape only.

## Headline

- Route probe: **identical to the original run** apart from the timestamp (`diff` of route-probe.md minus the `Ran` line = empty). Login 200 role=inquiry_specialist token+cookie; session 200; not-signed-in 6/6 → 401; should-reach 54/57 probed OK, 49 unverified, same 3 fails (contracts/sign 404, read/my-numbers 403, repair/exceptions 403); should-stay-blocked 50/50 → 403.
- UI walk: same 25 visible / 34 total sidebar links, same 24 screens, 0 bounced, **0 new failing endpoints**. `/api/demo/mode` 4xx count fell 32 → 6 (gone from login, landing and 18 screens; still 403 on 6 screens whose own page scripts call it). `ops-admin` `GET /api/read/messages?status=blocked&limit=30` is now **200** (was 400); panel shows "No messages stopped by the compliance gate". Screens with ≥1 API 4xx: 24 → 10. Console errors: 42 → 17.
- localStorage after login (staff role): keys `fh_role`, `fh_token` only; **`fh_account` absent** (login.html stores it only when the login reply carries `account`; staff replies do not).
- `/api/inquiry?action=cases` still 503 not_configured (owner-set hold; unchanged).

No REGRESSION found for this role.
