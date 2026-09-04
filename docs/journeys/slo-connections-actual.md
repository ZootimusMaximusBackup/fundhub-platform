# SLO connections — actual (first slice)

Generated from the code in this worktree. Not from the spec.

## What the code does

```mermaid
flowchart TD
  A["GET /api/read/slo-connections ROLE_SETS.OPS"] --> B["list slo_connections for the session org"]
  C["POST /api/slo-connections ROLE_SETS.OPS"] --> D["saveConnection: funnel ID + CF product ID → products.id"]
  E["POST /api/webhooks/clickfunnels"] --> F["verifyClickFunnelsSignature"]
  F -->|bad| G["401 bad_signature"]
  F -->|good| H["handleSloPaidWebhook"]
  H --> I["extractSloPaidPurchase"]
  I -->|not paid / no fundhub_client_id / no funnel / no CF product / no amount| J["200, no sale"]
  I -->|paid fields present| K["findActiveConnection by funnel + CF product"]
  K -->|missing or off| J
  K -->|on| L["recordSloPurchase: sales + transactions + sale_payments"]
```

## Traced paths

- `public/app/products-commissions.html` — SLO connections tab, hidden until
  `/api/auth/session` says owner or admin.
- `api/read/slo-connections.mjs` — `ROLE_SETS.OPS` (owner, admin).
- `api/slo-connections.mjs` — same gate. Writes `slo_connections`.
- `src/slo/purchase.mjs` — paid types: `order.completed`,
  `one-time-order.completed`, `one_time_order.completed`, `new_purchase`.
  Client key is only `fundhub_client_id`. Amount is `amount_cents` or a CF 2.0
  integer cent total. Classic integer dollars without a cents field are refused.
- `src/adapters/clickfunnels.mjs` — after a good signature, calls
  `handleSloPaidWebhook` before the email / survey / booking path.

## Not in this code

Soft pull, UnderwriteIQ, black reports, paper, recurring, white-label, the CRM
writes, a new checkout, ClickFunnels apply.
