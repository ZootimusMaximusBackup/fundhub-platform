# P1 portal spot — 2026-08-19

Test client only: `8556bedc-46e1-4d85-b0cd-a24adfee1521`.  
Never opened: `9af65808-a619-4e65-ae91-239766a006b7`.  
Ground truth: `docs/journeys/client-intended.md` does not define paint / hero / entitlements / dispute. Scored against Chris’s P1 prompt.

`FUNDHUB_TEST_INBOX` set: yes.

DB (booleans only, `db-email-booleans.json`):

- test client email == inbox: **false**
- live file email == inbox: **true**
- test email is `@fundhub.ai`: **true**

## One line per item

- File paint (magic-link): **UNVERIFIED**. Extra staff-opened, not magic-link: page says "We could not load your file." — `03-staff-file-paint.png`
- Hero (magic-link): **UNVERIFIED**. Extra staff-opened, not magic-link: "Welcome video is not available" (G4c still true on a new live shot) — `04-staff-hero-video.png`
- Entitlements (magic-link): **UNVERIFIED**. Extra staff-opened, not magic-link: **0/6** unlocked — `05-staff-entitlements.png`
- Dispute card (magic-link): **UNVERIFIED**. Extra staff-opened, not magic-link: "You already signed" — `06-staff-dispute-card.png`
- Magic-link from watched inbox: **not possible**. Requested a real link for the test client’s own stored email. Form showed "link sent" (`02-portal-login-link-sent.png`). Mail row went to `@fundhub.ai`, not the inbox (`db-queued-message-booleans.json`: `to_address_eq_inbox=false`, status `sent`, provider `resend`). Gmail had no session (`gmail-session.json`). Did not mint `createAccountSession`. Did not open `?t=` from the request. Did not send a link to `FUNDHUB_TEST_INBOX`.

## Evidence files

- `01-portal-login-form.png`
- `02-portal-login-link-sent.png`
- `03-staff-file-paint.png` (staff-opened, not magic-link)
- `04-staff-hero-video.png` (staff-opened, not magic-link)
- `05-staff-entitlements.png` (staff-opened, not magic-link)
- `06-staff-dispute-card.png` (staff-opened, not magic-link)
- `db-email-booleans.json`
- `db-magic-link-rows.json`
- `db-queued-message-booleans.json`
- `magic-link-request.json`
- `staff-opened-portal.json`
- `gmail-session.json`

## FAIL — magic-link from received mail

- Journey: client portal sign-in (Chris P1 prompt; not in `*-intended.md`)
- Step: open a received-email magic link for test client `8556bedc-…`
- Expected: request a real link for the test client, then open the link from mail in `FUNDHUB_TEST_INBOX`
- Observed: test client email is not the inbox (DB false). Live file email is the inbox (DB true). Live form accepted the test-client request (`02-portal-login-link-sent.png`, API 200). Message `7fc5ff39-…` sent via Resend to `@fundhub.ai`, `to_address_eq_inbox=false`. Watched inbox cannot get that mail. Opening Gmail in a new Chrome window hit Google sign-in; no session. Safe stop: no minted session, no inbox-address request, no `?t=` token.
- Evidence: `02-portal-login-link-sent.png`, `db-email-booleans.json`, `db-queued-message-booleans.json`, `gmail-session.json`

## Extra — staff-opened only (not a magic-link PASS)

- Journey: same P1 checks, owner opened `client-portal.html?id=8556bedc-…`
- Step: file paint / hero / entitlements / dispute
- Expected: file paints; welcome video plays; record n/6; dispute card state
- Observed: greeting "We could not load your file."; hero "Welcome video is not available" (no video element); footer `live entitlements · 0 unlocked · 6 locked`; dispute "You already signed". Session `fh_account.clientId` was null (staff, not a client magic-link). URL stayed on the test id. Footer also showed live documents 2 and live agreements 1.
- Evidence: `03-staff-file-paint.png`, `04-staff-hero-video.png`, `05-staff-entitlements.png`, `06-staff-dispute-card.png`, `staff-opened-portal.json`
