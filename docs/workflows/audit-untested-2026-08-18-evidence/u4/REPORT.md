# U4 findings — pay rail, no card charge

**COMPLIANCE REVIEW REQUIRED** — payment rails.

Walked 2026-08-18 on `https://fundhub.ai`. Owner `chris@fundhub.ai`. Closer `closer@fundhub.ai`. Writes only the create ask on test client `8556bedc-…`. Never opened the live credit file. Did not type a card number. Did not invent a paid event. Did not put Commas or Stripe in sandbox.

Ground truth for “closer makes a live pay link and a card can be charged” is **MISSING**. `client-intended.md` only says a client can reach Finance. `role-closer-intended.md` lists Finance routes, not a pay-link step. Scored against Chris’s claim on the board. Do not invent a journey.

Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u4/`. Logs: `walk.json` `db.json`.

No PASS without a shot, HTTP status, or database row.

## Score

| Ask | Result |
|---|---|
| Owner or closer creates a $32 diagnostic pay link | **BROKEN** — live create returns `commas_not_configured` |
| Hosted checkout opens (stop before card) | **MISSING** — no URL |
| Other live pay door (Stripe, invoice, portal) | **MISSING** — no Stripe, no TEST invoice, portal says checkout is not available |

Chris’s claim (closer can make a live pay link and a card can be charged): **BROKEN**. The rail does not mint a checkout URL. A card cannot be charged from this door today.

## BROKEN

### Pay link create refuses

- Journey: **MISSING.**
- Expected (board): owner or closer on the TEST file can make a $32 diagnostic link. Prove the rail. Do not charge.
- Observed:
  - Owner `GET /api/payment-links?client_id=` TEST → **200**, **0** items.
  - Owner `POST /api/payment-links` create purpose `diagnostic` price **32** → **503** `commas_not_configured`. Body message: `COMMAS_CHECKOUT_BASE_URL is not set — no checkout link can be built`.
  - No checkout URL. Did not open a pay page. Did not type a card.
  - `payment_links` for this client still **0**. Org has **40** links on other files. Did not open those.
  - Client Control Panel has no “create pay link” button. URL with the TEST id still showed “Choose a client” after load.
  - Closer `POST /api/payment-links` create $32 → **403** `forbidden`. That door is owner / admin / sales manager only.
  - Closer Present opened the TEST file (`?contact=` TEST). Slide 1. Script asks if they have a card for the soft-pull. No pay button on that slide. Did not press Send. Send would email or text.
- Local `.env` has `FANBASIS_CHECKOUT_API_KEY` (name only). Live still says not configured. `COMMAS_CHECKOUT_BASE_URL` unset. No `STRIPE_*` keys.
- Prior W16 already wrote fake paid events on this TEST file (`diagnostic.paid` 1, `deposit.paid` 1, `payment.received` 6). This unit did not add another.
- Evidence: `00-owner-login.png` `01-ccp-test.png` `02-after-create-api.png` `walk.json` `pay-create` `db.json`

## Other pay doors — same stop line

- **Stripe:** no `STRIPE_*` in local env. Finance OS has no checkout or Stripe button. Bank is not connected. Shot: `04-finance-os.png`.
- **Invoice:** `GET /api/read/invoices` → 200, 2 org rows. TEST client invoices **0**. Did not email. Did not open another person’s invoice.
- **Portal pay:** staff-open `/app/client-portal.html` — file did not load (owner is not the client). Six products. **0** have a checkout URL. On-screen: “Online checkout is not available yet. Ask an advisor in chat and we will send you a payment link.” Shot: `05-portal-pay.png`.

## Left undone

- Nothing in this unit. Did not charge. Did not send a pay text or email.

## Next

U5 — bureau pull on the same TEST file.
