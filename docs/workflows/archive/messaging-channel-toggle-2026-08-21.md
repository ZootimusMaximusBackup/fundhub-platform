# Messaging channel toggle — 2026-08-21

Owner: Chris. Separate Email / Text conversations (not same thread, different send channel).

## Tasks

| id | status | owner | note |
|----|--------|-------|------|
| W1 | done | this session | Email/Text toggle live on fundhub.ai |
| W2 | pending | other session | Twilio + agent texts visible to closers |
| W3 | done | this session | Test email + SMS sent to Chris; toggle clicked on live |

## Decision (owner)

Toggle opens / starts the other channel’s conversation for the same client.

## Manifest (W1)

- `public/app/messaging.html` — compose Email/Text toggle; switch loads other thread or empty stub
- Deployed to production (`--dir=public --no-build`) so live Messaging has the toggle

## Prove (W3)

- Email to Stanbridgejchris@gmail.com — **delivered** (Resend), subject “Fundhub Messaging toggle test”
- SMS to +16616180865 — **delivered** (Twilio), body starts “Fundhub Messaging toggle test text”
- Live UI: Email / Text buttons switch `thSub` between EMAIL and SMS for client ProveFunding
