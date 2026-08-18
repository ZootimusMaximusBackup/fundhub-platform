# G3 findings — payment, sign, inquiry, bureau, mail, pipeline

**COMPLIANCE REVIEW REQUIRED** — dispute-letter sign, bureau pull, and inquiry complete.

Walked 2026-08-18 on `https://fundhub.ai`. Owner `chris@fundhub.ai`. Writes only on test client `8556bedc-…` (`client@fundhub.ai`). Never opened the live credit file.

Ground truth for these steps is **MISSING**. There is no intended journey for “paid unlocks the file,” “sign unlocks letters,” “inquiry complete starts the next round,” bureau pull, mail/SMS landing, or pipeline MOVE. Scored against the gap board only. Do not invent.

Evidence: `docs/workflows/audit-gaps-2026-08-18-evidence/g3/`. Logs: `walk.json` `portal.json` `db.json`.

No PASS without a shot, HTTP status, or database row.

## What I did

- Signed in as owner. Opened the test client file.
- Asked the live site for a $32 diagnostic pay link. Did not charge a card. Did not invent a paid row.
- Opened the test client portal (minted a session, then revoked it). Pressed Sign **once**. The card was still unsigned.
- Looked at inquiry cases and the live `inquiry.removed` count. Did not fake that event. Did not press Mark Cleared.
- Pressed Pull TransUnion, Pull Experian, and Pull Equifax on the test file. No letter mail.
- Tried one Messaging send on the test client. Did not rewrite the client’s email or phone. Did not print the test inbox or test phone.
- Checked the pipeline for a test card. Did not move the 17 real cards.

## Score

| id | Board ask | Result |
|---|---|---|
| G3a | $32 diagnostic pay link lands | **BROKEN** — live create returns `commas_not_configured`. Stopped. |
| G3b | Dispute-letter Sign on test portal | **Sign wrote a consent row.** Nothing else unlocked. |
| G3c | Inquiry complete → next round | **UNVERIFIED** — event never fired. Count still 0. |
| G3d | Bureau pull on test file | **BROKEN** — all three buttons refuse. No consent row the pull reads. |
| G3e | Mail or SMS arrives | **BROKEN** — screen will send, then fails. No inbox or phone proof. |
| G3f | Pipeline Archive / MOVE | **UNVERIFIED** — test client has no card. Did not move real people. |

## BROKEN

### G3a — Pay link does not create

- Journey: **MISSING.** `client-intended.md` only says the client can reach Finance.
- Expected (board): owner on the test file can make a $32 diagnostic link (Commas / Fanbasis, not Stripe). Do not charge a real card.
- Observed: Client Control Panel has no “create pay link” button. `GET /api/payment-links?client_id=` test client → 200, **0** items. `POST /api/payment-links` create $32 diagnostic → **503** `commas_not_configured`. No checkout URL. `payment_links` for this client still **0**. No `diagnostic.paid` row for this client. Stopped. Did not invent a paid event.
- Local `.env` has `FANBASIS_CHECKOUT_API_KEY` (name only). The **live** site still says not configured.
- Evidence: `g3a-ccp-before-pay.png` `walk.json` `g3a-create` `db.json` `payment_links`

### G3d — Bureau pull refuses — COMPLIANCE REVIEW REQUIRED

- Journey: **MISSING.**
- Expected (board): click soft pull and/or TransUnion / Experian / Equifax on the test Client Control Panel. Record refuse vs return. No letter mail.
- Observed: all three buttons are live. Each click posted `POST /api/finance/crs-pull` → **403**. Screen: “no soft-pull consent on file for this client — capture consent before requesting a pull.” Scores still dashes. `soft_pull_requests` **0**. `crs_results` **0**. There is a signed SOFT-PULL-CONSENT **contract**, but the pull reads `client_consents` kind `soft_pull_consent`, and that row is still missing. After G3b we have a `dispute_authorization` consent only. That is a different kind. No bureau letter was mailed.
- There is no separate “Soft Pull” button on this screen. The three bureau buttons **are** the pull.
- Evidence: `g3d-pull-transunion.png` `g3d-pull-experian.png` `g3d-pull-equifax.png` `walk.json` writes 403

### G3e — Message does not land

- Journey: **MISSING.**
- Expected (board): one send from Messaging on the test client to the test-inbox / test-phone destinations, if the screen will send. Prove inbox or phone, or honest fail.
- Observed: compose was on. Send was on. Channel showed Text. Clicked Send once. Screen: “Not sent. We do not have a phone number or email address for this person.” `POST /api/messages` → 200. New row `0b1d9316-…` `channel=sms` `status=failed` `has_to=false`. The screen only sends to the client’s stored email / phone. Those do **not** match `FUNDHUB_TEST_INBOX` / `FUNDHUB_TEST_PHONE` (names only; both are set). Did not rewrite the client. Did not text a real person. Inbox and phone landing stay unproven. A2P was not reached.
- Evidence: `g3e-messaging.png` `g3e-messaging-send.png` `walk.json` `g3e-send`

## WORKS (narrow)

### Owner sign-in

- Lands on the app. `00-owner-login.png`.

### G3b — Sign wrote a consent row — COMPLIANCE REVIEW REQUIRED

- Journey step: **MISSING.**
- Expected (board): press Sign once on the test file if still unsigned. Record the consent row, document status, and what unlocked.
- Observed: magic-link was not used. Session minted with `createAccountSession`, then revoked. Portal said “Welcome back, TEST.” Card was unsigned. Pressed Sign **once**. `POST /api/consent/capture` → 200. Screen: “You already signed” / “Signature recorded. We can prepare dispute letters. This is not a credit pull.”
- Consent row: `d81a91d7-…` kind `dispute_authorization` method `signature` at 17:51:44Z. Not revoked.
- Documents: same two authorization files as before. No new document. No delivery change.
- What unlocked: **nothing.** Welcome video still “not available.” Entitlements still **0 unlocked / 6 locked.** Entitlements table still empty. Scores on the staff file still dashes. No letter pack appeared.
- Evidence: `g3b-portal-home.png` `g3b-dispute-before.png` `g3b-dispute-after.png` `g3b-video-after.png` `portal.json`

## UNVERIFIED

### G3c — Inquiry complete → next round — COMPLIANCE REVIEW REQUIRED

- Journey: **MISSING.**
- Expected (board): do not fake `inquiry.removed`. Prove whether a test case can complete. If the event is still 0, class = event never fired.
- Observed: live `events` count for `inquiry.removed` is still **0**. Test client has 3 Queued cases (`f872cc9d-…`, `e235efc2-…`, `1d212e99-…`). None have a call. None have a letter. Open count on the case is 0. The desk shows Send, Mark Cleared, and Close. Mark Cleared / Close would write `inquiry.removed` with no bureau call (`api/inquiry-cases.mjs` `mark_cleared` / `close`). **Did not press them.** That would fake the event. So the unlock never ran.
- Class: **event never fired.**
- Code that *would* listen: Inngest `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs` (task “Start next funding round — clean file”, tag `inquiry:completed`, `ready_for_next_round`). `src/register-all.mjs` has **no** bus handler for `inquiry.removed`. Tasks for that workflow on this client: **0**.
- Evidence: `g3c-inquiry-desk.png` `g3c-inquiry-case-open.png` `walk.json` `db.json` `events_inquiry_removed`

### G3f — Pipeline Archive / MOVE

- Journey: **MISSING.**
- Expected (board): only if a cards row exists for the test client. If not, do not move the 17 real cards.
- Observed: `cards` for test client **0**. Live board **17** cards. Test client is not on the board. Did not click Archive or MOVE.
- Evidence: `g3f-pipeline.png` `walk.json` `after.cards` `after.live_cards`

## MISSING ground truth

These steps have no `*-intended.md` step. Do not invent one.

- paid → stage / unlock
- dispute-letter Sign unlocks X
- inquiry complete → next funding round
- bureau pull besides “button exists”
- mail or SMS transmits and lands
- pipeline Archive / MOVE

`client-intended.md` only lists that a client can reach Finance.

## What I did not do

- No real card charge.
- No fake `diagnostic.paid` row.
- No second Sign.
- No fake `inquiry.removed`.
- No bureau letter mail.
- No live credit file.
- No rewrite of the test client’s email or phone.
- No move or archive of a real board card.
- No deploy. No app, test, config, env, or intended-journey edits.

## Stop

Chris names what to fix.
