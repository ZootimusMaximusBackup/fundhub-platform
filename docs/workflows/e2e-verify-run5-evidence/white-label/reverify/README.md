# white-label — reverify pass (auditor, read-only)

Purpose: fix-induced-regression spot-check for the partner (white-label) role after
ship commit `2b1eed0`. This journey had no FIXED-UNCLICKED rows; the job was to
re-run the same evidence tools as `partner@fundhub.ai` on the live site and compare
against the batch-1 board rows (docs/workflows/fable-audit-2026-08-16.md L539-573
findings, L744-814 section).

Target: https://fundhub.ai (live). No local server, no BASE_URL override.
Model: claude-fable-5 (reverify). Nothing outside this directory was written.

## Live build check (before first run)

```
date -u   → 2026-08-17T05:48:30Z
curl -s "https://fundhub.ai/app/shell.js?nc=$RANDOM"  | grep -c 'role !== "owner" && role !== "admin"'   → 1
curl -s "https://fundhub.ai/login.html?nc=$RANDOM"    | grep -c 'fh_account'                             → 3
```

Both fingerprints match commit 2b1eed0 (shell.js mountDemoBanner owner/admin-only
guard; login.html writes fh_account).

## What ran (UTC), exact commands, from repo root

| # | When | Command | Output |
|---|---|---|---|
| 1 | 2026-08-17T05:48:54Z | `node docs/workflows/e2e-verify-run5-evidence/white-label/reverify/probe-role.mjs white-label partner@fundhub.ai` | route-probe.json, route-probe.md |
| 2 | 2026-08-17T05:49:47Z | `node docs/workflows/e2e-verify-run5-evidence/white-label/reverify/ui-walk.mjs white-label partner@fundhub.ai` | ui-walk.json, ui-walk.md, shots/00-04*.png |
| 3 | 2026-08-17T05:51:44Z | `node docs/workflows/e2e-verify-run5-evidence/white-label/reverify/spot-check.mjs` | spot-check.json, spot-check.md, shots/sc-*.png |

`probe-role.mjs` and `ui-walk.mjs` here are byte-for-byte copies of
`_tools/probe-role.mjs` / `_tools/ui-walk.mjs` with ONLY the `OUT_DIR` line changed
to point at this `reverify/` directory (the tools derive the `docs/journeys/<journey>-actual.md`
path from the journey argument, so the arg had to stay `white-label`). `_tools/` was
not modified. `spot-check.mjs` is new: one browser login, full API-call log per
screen (every status), localStorage shape (keys only), then three GET / empty-POST
calls with the partner token. No form other than login was submitted; nothing was
clicked except sidebar links; no production writes.

Logins used: 3 (probe, ui-walk, spot-check). No 429 seen. Password came from the
gitignored `.env` via the tools; never printed. Token never printed or written.

## Headline

- Route probe: identical to the original run in every cell but one —
  `POST {} /api/read/company-brain-affiliate` now answers **400 question_required**
  (was 401 unauthorized). That is the intended effect of the ship (handler moved to
  requirePrincipal affiliate/partner). Reach 17/18 probed OK, 21 UNVERIFIED, 1 "FAIL"
  (contracts/sign 404 by design) — same as before. Blocked: 15 → 403, 91 → 401,
  1 → 400 (was 15 / 92 / 0). Not-signed-in 6/6 → 401.
- UI walk: same shape — landed on /app/partner-galaxy.html, 2 visible / 34 sidebar
  links, 2 screens opened, 0 bounced, 0 API 4xx/5xx, 0 console errors.
  One difference: Brand Studio final URL is now `/app/brand-studio.html` (no
  `?partner_id=` reload) because login.html now stores `fh_account` and Brand Studio
  reads `partnerId` from it directly (public/app/brand-studio.html L500-501). Page is
  still in partner mode (footer "partner brand · TEST — White-Label Partner Role · draft",
  brand name filled) — CHANGED-NOT-REGRESSION.
- /api/demo/mode: not called on landing, Brand Studio, or a direct ops-admin.html visit
  (which the shell bounces to partner-galaxy). Direct GET with the partner token → 401
  (unchanged).
- /api/read/messages?status=blocked with the partner token → 401 unauthorized
  (staff-only readHandler; the ops-admin screen is not offered to this role and bounces).
- localStorage after login: `fh_account` present with keys
  accountId, affiliateId, clientId, email, kind, name, orgId, partnerId; kind=partner;
  partnerId present. New since the ship (was never written before). `fh_role=partner`,
  `fh_token` present.

No regression found for this role.
