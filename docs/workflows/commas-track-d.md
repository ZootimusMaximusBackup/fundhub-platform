# Commas Track D — board

Status as of 2026-08-12.

## Tasks

| Unit | Owner | Status |
| --- | --- | --- |
| Set `COMMAS_API_KEY` on Netlify (all contexts, secret) | agent | done |
| Fix `normalizeCommasEvent` for `buyer.email` / `item.title` / `api_metadata` + tests | agent | done (code) |
| Register webhook `https://fundhub.ai/api/webhooks/commas` + refresh `COMMAS_WEBHOOK_SECRET` | agent | claimed |
| Payment-link checkout-session rewire | — | **ticketed** (keep 503) |
| `commas_inbox` bare RLS fix (migration 162) | agent | claimed |
| Test webhook + $1 real payment | agent | pending |
| Note at-most-once ⇒ reconciliation poller is launch requirement | agent | pending |
| Flip demo mode off (separate) | — | deferred |

## Ticket: payment links via checkout-session API

**Do not ship URL-query `COMMAS_CHECKOUT_BASE_URL` links.** Docs confirm minting is `POST https://www.fanbasis.com/public-api/checkout-sessions` with `x-api-key`, body including `product.title`, `amount_cents`, `type` (`onetime_non_reusable` for CRM asks), and `metadata: { link_ref }` (string values only). Response `payment_link` is what clients open; webhooks echo metadata as `data.api_metadata.data`.

**Why ticketed (not built now):** rewire is well over 30 lines — new outbound create in `src/payments/commas-api.mjs` (auth is `x-api-key`, base is `www.fanbasis.com/public-api`, not `api.commas.io` / Bearer), change `createPaymentLink` / `buildCommasCheckoutUrl`, handler env gate, tests, and one deploy. Until that lands, keep **503 fail-closed** when checkout is not configured.

**Existing webhook on Commas account:** subscription `24414` → `https://underwrite-iq-lite.vercel.app/api/lite/commas-payment` (`payment.succeeded`, `payment.failed`). Left alone. FundHub gets its own subscription.

## Shared notes

- Auth header: `x-api-key` (not Bearer).
- Signature: `x-webhook-signature`, HMAC-SHA256(raw body, secret), hex.
- Deliveries are at-most-once; no retry. Reconciliation poller via API key is a launch requirement.
- Pending migrations `160` / `161`: leave untouched; `162` is commas_inbox only and is applied without running 160/161.
