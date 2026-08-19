# Proof on real Netlify infrastructure (deploy preview for PR 88)

Run 2026-08-19T04:15:30Z. Preview: https://deploy-preview-88--transcendent-wisp-888771.netlify.app

Only refusal paths were exercised. **The deploy preview shares the production database**, so
nothing here writes: no POST that would create an opt_out row was sent.

```
GET  /unsubscribe.html                 -> 200   (was 404 on live)
GET  /api/public/unsubscribe (bad tok) -> 400   (routed, refuses, no write)
POST /api/webhooks/resend (unsigned)   -> 503   (routed, fails closed: RESEND_WEBHOOK_SECRET unset)
POST /api/webhooks/nosuchprovider      -> 404   (control: an unrouted provider really is 404)
```

The last two together are the point: **503 means the route exists and is refusing**
for want of a signing secret. A missing route answers 404, as the control shows.
