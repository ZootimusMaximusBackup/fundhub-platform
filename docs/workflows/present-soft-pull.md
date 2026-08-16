# Present soft-pull + e-book downsell

Shared board for this batch. Agents claim before work. Manifest here when done.

## Owner decisions (locked)

- Soft pull = **fixed $32**. Not negotiable. Hard cost.
- Everything else = **closer-set price** on a Commas pay link.
- E-book: Chris will supply the real PDF later. Until then: **empty placeholder PDF** so we can prove the file is attached and sent in email.
- Closer stays on Present / Google Meet; one-tap actions from the cockpit.

## Tasks

| ID | Owner | Status | Notes |
|----|-------|--------|-------|
| W1 | Present UI (soft-pull btn, wait status, e-book price + send) | done | this session |
| W2 | Soft-pull send path (pay + consent email → pay → pull) | done | this session |
| W3 | E-book: empty PDF + variable Commas amount + email with attachment | done | this session |
| W4 | Journeys + tests + prove | done | unit/routes/journeys green; live prove deferred |

## Shared brief

- Soft pull offer: `SOFT_PULL` in `src/config/offers.mjs` ($32, purpose `diagnostic`).
- Consent: `public/app/consent-capture.html` + `api/consent/capture.mjs` + `soft-pull-v1` disclosure.
- Pay links: `src/payment-links` → Commas checkout; closer-deck already has `send_pay_link`.
- Pull after pay: `diagnostic.paid` → `c-00-crs-soft-pull-request` (existing; may need consent gate alignment).
- Present today: script talks soft pull on S-05; **no soft-pull send button**. Close screen only has agreement pay / letters / disposition.
- Messaging: Mailgun provider currently has **no attachment field** — W3 must add attach support (or stop and report) so the empty PDF actually goes out on the email.

## Change manifests

### W1–W3 (this session)

**Files**
- `public/app/present.js` — soft-pull + e-book controls on Soft pull phase
- `public/app/soft-pull-approve.html` — client approval form (signed link)
- `api/soft-pull-approve.mjs` — GET/POST token-gated consent + identity
- `api/closer-deck.mjs` — `send_soft_pull`, `send_ebook`
- `src/sales/closer-deck.mjs` — send helpers + `soft_pull` status on deck payload
- `src/consent/approve-token.mjs` — HMAC approve links (DOCUMENT_URL_SECRET)
- `src/messaging/assets.mjs` + `assets/ebooks/fundhub-ebook-placeholder.pdf`
- `src/messaging/compose.mjs` / `dispatch.mjs` / `providers/resend.mjs` — attachments
- `db/migrations/165_messages_attachments.sql`
- `netlify/functions/api.mjs` — route soft-pull-approve
- journeys regenerated + CHANGELOG

**Owner laws encoded**
- Soft pull amount fixed $32 (SOFT_PULL)
- E-book amount closer-set ($1–$500k)
- Empty PDF placeholder until Chris replaces file

**Needs before live use**
1. Apply migration 165
2. `DOCUMENT_URL_SECRET` + `COMMAS_CHECKOUT_BASE_URL` + `PUBLIC_BASE_URL` set
3. Swap placeholder PDF when ready

**Left for live prove**
- End-to-end Meet dry-run on fundhub.ai after deploy
