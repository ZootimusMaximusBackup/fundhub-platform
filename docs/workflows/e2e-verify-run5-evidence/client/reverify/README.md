# client — re-verify pass (Auditor, read-only)

**Model:** claude-fable-5 (reverify) · **Login:** client@fundhub.ai · **Target:** LIVE https://fundhub.ai (no localhost, no local HTML, no proxy) · **Ran:** 2026-08-17T05:37Z – 05:42Z (UTC)

Live build check before the first run (05:37:29Z):

```
curl -s "https://fundhub.ai/app/shell.js?nc=$RANDOM" | grep -c 'role !== "owner" && role !== "admin"'   → 1
curl -s "https://fundhub.ai/login.html?nc=$RANDOM"   | grep -c 'localStorage.setItem("fh_account"'       → 1
git rev-parse --short HEAD                                                                             → 2b1eed0
```

Password came from the gitignored `.env` (`STAFF_E2E_PASSWORD`) via the same loader the `_tools/` scripts use. It was never printed. No token was written to any file. Nothing under `client/fixed/` was reused — every file here comes from this run.

## Commands (run from repo root, in this order)

| # | Command | Login used | Output |
|---|---|---|---|
| 1 | `node docs/workflows/e2e-verify-run5-evidence/client/reverify/capture-live.mjs` | 05:38:37Z | `capture.json`, `portal-network.json`, `portal-summary.json`, `01-landing.png` |
| 2 | `node docs/workflows/e2e-verify-run5-evidence/client/reverify/probe-role.mjs client client@fundhub.ai` | 05:38:58Z | `route-probe.json`, `route-probe.md` |
| 3 | `node docs/workflows/e2e-verify-run5-evidence/client/reverify/ui-walk.mjs client client@fundhub.ai` | 05:39:57Z | `ui-walk.json`, `ui-walk.md`, `shots/00-login-page.png`, `shots/01-landing.png`, `shots/02-app-shell.png` |
| 4 | `node docs/workflows/e2e-verify-run5-evidence/client/reverify/screen-detail.mjs` | 05:41:43Z | `screen-detail.json`, `02-landing-full.png` |

`probe-role.mjs` and `ui-walk.mjs` here are byte-for-byte copies of `_tools/` with ONE line changed (`OUT_DIR` → this `reverify/` dir) so they still read `docs/journeys/client-actual.md` by the real journey name. `_tools/` was not touched (`git status` clean there).

Login budget: 4 client logins in ~3 minutes, 0 rate-limit (429) responses. Each account login records one failed staff attempt (limit 5 per email per 15 min) — do not add more within the window.

## What each file proves

- `capture.json` — the S4 landing check on LIVE: final URL, `fh_account` presence/keys/clientId, greeting/who-name/banner text, "Open this from a client file" absent, verdict.
- `portal-network.json` — every `/api/` call the live portal made after sign-in (12), with the 3 that answered 4xx.
- `portal-summary.json` — status + top-level shape of `GET /api/read/portal-summary?client_id=…` (200, ok:true).
- `route-probe.*` — 26 reach routes / 130 blocked routes as the client token (S1, S1c, S2, S3 spot-checks).
- `ui-walk.*` — real Chromium sign-in, landing, shell fallback loop, sidebar count (S1, S1b, S5 spot-checks).
- `screen-detail.json` — visible text for the three 401 reads (documents banner, dispute-authorization wording), chat FAB present, whether each failed request carried a Bearer header.
- `BOARD-UPDATE.md` — proposed board row replacements (parent applies; the board was not edited).
