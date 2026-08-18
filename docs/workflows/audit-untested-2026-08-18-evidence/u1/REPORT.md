# U1 — Client magic-link paints their file

Date: 2026-08-18  
Test client only: `8556bedc-46e1-4d85-b0cd-a24adfee1521`  
Never opened: `9af65808-…`

## Ground truth

`docs/journeys/client-intended.md` names who can open routes. It does **not** name “magic-link → own file / video / 6 tiles.”

**MISSING** journey step. Scored against Chris’s claim on the board.

Env names used: `FUNDHUB_TEST_INBOX`, `STAFF_E2E_PASSWORD`, `DATABASE_URL`. Values not printed.

## Chris’s claim

A client gets a sign-in link, opens it, and sees THEIR file, the welcome video, and the six offer tiles. Staff-open does not count.

## Score

**UNVERIFIED — cannot be done safely.**

A real magic-link cannot be received in a mailbox this audit can open, for a non-live client, without writing the live file’s email onto that client.

Did not mint a portal session. Did not send a link to the bare `FUNDHUB_TEST_INBOX`. Did not open `?t=`.

## Prove 1 — mailbox a person can open

- Test client email == watched inbox: **false**
- Live file email == watched inbox: **true**
- Test client email is `@fundhub.ai`: **true**
- Gmail session: **no**. Landed on Google sign-in. Did not type the inbox.
- Plus-tag clients that are not the live file: **5** (ids only in `db-plus-tag-ids.json`). None is the TEST client. None equals the bare inbox. Still cannot open Gmail, so no plus-tag link was requested.
- Fake `e2e+aff-*` / `e2e+wl-*` clients: **0**
- Test-client magic-link rows: **4** issued, **0** still valid unused
- Last magic-link mail on this file (P1, not re-sent today): went to `@fundhub.ai`, not the inbox (`to_address_eq_inbox=false`)

Sending a new link to `@fundhub.ai` still cannot be opened. Sending to the bare inbox would open the live file. Writing the inbox onto the TEST client is forbidden.

## Prove 2 — after that link

**UNVERIFIED.** No received-mail link was opened.

## Extra — staff-open only (not a PASS)

Owner opened `client-portal.html?id=8556bedc-…`. Session is staff, not a client magic-link.

- File paint: “Welcome back, TEST.” (P1 staff-open said “could not load.” Today it paints TEST.)
- Hero: “Welcome video is not available.” No video element.
- Footer: `live entitlements · 0 unlocked · 6 locked`
- Dispute: “You already signed.” Did not press Sign.

Staff-open does not count for this claim.

## Evidence

- `01-portal-login-form.png`
- `02-gmail-session.png`
- `03-staff-file-paint.png` (staff-open, not magic-link)
- `04-staff-hero-video.png` (staff-open, not magic-link)
- `05-staff-entitlements.png` (staff-open, not magic-link)
- `06-staff-dispute-card.png` (staff-open, not magic-link)
- `db-email-booleans.json`
- `db-mailbox-options.json`
- `db-plus-tag-ids.json`
- `db-magic-link-rows.json`
- `db-queued-message-booleans.json`
- `gmail-session.json`
- `portal-login-form.json`
- `staff-opened-portal.json`

## FAIL — magic-link from received mail

- Journey: client sign-in link → own file (Chris’s claim; **MISSING** in `client-intended.md`)
- Step: open a received-email magic link for a non-live client
- Expected: mailbox a person can open; then file / video / n/6 / dispute
- Observed: TEST mail is `@fundhub.ai` (not inbox). Live file mail IS the inbox. Gmail has no session. No safe send path without writing the live email onto someone. Did not mint a session.
- Evidence: `db-email-booleans.json`, `02-gmail-session.png`, `gmail-session.json`
