# Soft pull + pay links in CRM — 2026-08-15

Owner: this chat. Chris: fix everything from soft-pull prove thread.

## Status

| Unit | Status |
| --- | --- |
| FanBasis checkout-session mint in `createPaymentLink` | **done** — uses `FANBASIS_CHECKOUT_API_KEY` |
| `$1` live pay link for Chris prove client | **minted** — see below |
| Soft-pull consent copy ("Consent saved") | **done** |
| CRS live host + `CRS_ALLOW_LIVE=1` | **on Netlify** (redeployed) |
| Closer deck shows amount / consent / pull / tier | **done** (present.js + softPullStatus) |
| Stuck `processing` soft-pull cleared | **done** |
| Resend `fundhub.ai` domain verify | **blocked** — send-only API key |
| Full CRM visual redesign | **not done** — needs Chris to name the worst screen |

## Prove client

- Org `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6`
- Client `9af65808-a619-4e65-ae91-239766a006b7`
- **$1 pay (use this):** https://www.fanbasis.com/agency-checkout/fundhub-1/8YZPo

## After pay

Webhook → `payment_links` paid → `diagnostic.paid` → C-00 soft pull (live CRS).
