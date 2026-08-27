# LinkedIn connect — 2026-08-24

**Connected: no** (Chris allowed the app; save then died on RLS. Fix is in `api/social/oauth.mjs` — writes now go through `withPartnerScope`.)

## Wall (this pass)

**Account lock risk + no LinkedIn password found.**

Live Connect still asks only `openid profile email w_member_social`. Scope error is still gone.

LinkedIn still shows **Welcome Back** for `stanbridgejchris@gmail.com` even when the feed and the developer portal are already signed in. The grant screen will not use that session.

Password search this pass (nothing printed):

- `.env` — no LinkedIn password
- `credentials/provider-logins.md` — two Gmail passwords for other sites (Go High Level, Mailgun). Both typed once on Welcome Back. Both came back **Wrong email or password**. Stopped. No third guess.
- Mac keychain — no LinkedIn item
- Chrome saved passwords — LinkedIn row has no password
- Google Password Manager — **0** sites for `linkedin`
- Safari / 1Password / Bitwarden — not present

Email code path: Forgot password sent a 6-digit code to the Gmail already open. The code worked. LinkedIn then asked to **Choose a new password** and had **Require all devices to sign in with new password** already checked. I did **not** set a new password. That would kick Chris off every device and he would wake up locked out.

`GET /api/social/channels` still has **zero** LinkedIn rows.

## What I changed

Nothing this pass. Scopes stayed as shipped. No new app.

## What I clicked

- Live Social Studio staff login
- Connect LinkedIn in the already-signed-in Chrome
- Two stored Gmail passwords on Welcome Back (wrong)
- Token generator with the live developer session — same Welcome Back
- Forgot password → email code → stopped on “Choose a new password”

## Still true

- Scheduler products: Share on LinkedIn + Sign In with LinkedIn (OpenID). Scopes: openid, profile, email, w_member_social.
- Org id **109283054**
- Do not make a third app.
- Do not guess another password.
- Do not finish the open reset unless Chris types a password he wants to keep.

## Email path — still readable

`chris@fundhub.ai` still forwards through Cloudflare to the Fundhub Gmail. The reset code was readable. None were printed.

## Evidence

Local only: `docs/workflows/linkedin-connect-2026-08-24-evidence/` (`connect5.json`, `otp-enter.json`, `final-channels.json`)

## Not connected

Chris types the real LinkedIn password on Welcome Back (or finishes Allow after a password he chooses), then Social Studio will show the LinkedIn row.
