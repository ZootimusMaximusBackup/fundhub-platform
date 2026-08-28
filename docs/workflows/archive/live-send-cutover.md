# Live send cutover — Twilio texts + Resend emails + Bland calls

**Owner laws (2026-08-14):**
- **GoHighLevel is OUT.** Do not call or debug GHL. The old GHL send path is a no-op stub.
- **SMS:** Twilio (prove Monday — not approved until then).
- **Email:** Resend.
- **Calls:** Bland (unchanged).

**Prove on:** phone `6616180865` / `+16616180865`, email `stanbridgejchris@gmail.com`.

**Current fences (prod):** `MESSAGING_DRY_RUN=0`, `ADAPTERS_DRY_RUN=0`. Bulk outbox **paused** (`outbound_enabled=false`) so the old queue does not blast people when providers come back. **Do not dump that queue.**

---

## Plain picture

| Channel | Who sends | Code today | Live status |
|---------|-----------|------------|-------------|
| SMS | Twilio | `twilio` provider; routing `sms → twilio` (migration 164) | **Waiting on Monday prove** — A2P + working send creds + from number |
| Email | Resend | `resend` provider; routing `email → resend` (migration 164) | **Keys on Netlify + .env** — still need domain SPF/DKIM (or use Resend onboarding From until domain is ready) |
| Voice | Bland | inquiry vendor + `BLAND_API_KEY` | Separate from this cutover; leave alone unless proving calls |

GHL (`ghl_relay`) is stubbed: `ENABLED=false`, `TRANSMITS=false`. Mailgun stays in the repo but is **not** the outbound default (`ENABLED=false`).

---

## What already shipped in code

- `src/messaging/providers/resend.mjs` — email send
- `src/messaging/providers/ghl-relay.mjs` — no-op stub (GHL removed)
- Twilio `ENABLED=true`, Mailgun `ENABLED=false` for outbound default
- `db/migrations/164_resend_twilio_routing.sql` — flips routing to Resend + Twilio
- `RESEND_API_KEY` / `RESEND_FROM` on Netlify and local `.env` (names only in chat)
- Provider / live-fence tests updated for the new defaults

---

## W1 — SMS (Twilio)

### Owner rule

Twilio SMS is **not approved until Monday**. Do not treat a green probe as “go live” before that day.

### What still has to be true before Monday prove

1. Working Twilio send Account SID + Auth Token (`TWILIO_SEND_*`).
2. A real from number in `TWILIO_SEND_FROM` (E.164).
3. A2P / 10DLC (or whatever Twilio requires for US SMS) so messages actually reach phones.
4. One CRM compose SMS to `+16616180865` → outcome `sent` and a real phone ding.

### Safety

Keep **`outbound_enabled=false`** until that prove passes. A staff compose can still send one-offs when dry-run is off — be careful who clicks Send.

---

## W2 — Email (Resend)

### Env (names only)

| Name | Role |
|------|------|
| `RESEND_API_KEY` | API key |
| `RESEND_FROM` | From header, e.g. `Fundhub <noreply@fundhub.ai>` (never `FundHub`) |
| `RESEND_BASE_URL` | Optional; defaults to `https://api.resend.com` |

### What still blocks a clean prove

1. **Domain DNS** — SPF + DKIM for the From domain in Resend (or temporarily use Resend’s onboarding From if that is the agreed prove path).
2. One CRM compose email to `stanbridgejchris@gmail.com` → outcome `sent` and inbox delivery.
3. Keep the outbox paused until that prove passes; only then decide whether to turn `outbound_enabled` back on.

Mailgun is no longer the product email path. Do not revive it for FundHub outbound unless the owner reverses this law.

---

## W3 — Bland (calls)

Unchanged from prior work. Not part of the GHL→Twilio/Resend cutover. Prove separately when needed.

---

## Order of work

```text
1. Domain SPF/DKIM for Resend (or agreed onboarding From)
2. Monday: Twilio A2P + from number + one live SMS prove
3. One live Resend email prove to the owner inbox
4. Keep outbound_enabled=false until those proves pass
5. Then decide: re-enable outbound queue and/or restore MESSAGING_DRY_RUN=1
```

**Do not** dump the paused outbound queue. **Do not** deploy just to flip docs.

---

## Safety while fences are open

- Keep **`outbound_enabled=false`** until prove pass (queued messages were waiting — leave them).
- `MESSAGING_DRY_RUN=0` means a staff compose **can** send when providers work — good for the prove, bad if someone sends to a real client early.
- After prove: either restore `MESSAGING_DRY_RUN=1` or leave off **and** keep daily cap + outbound switch under owner control.

---

## What I need from you

When ready:

1. **Resend:** “domain DNS done” (or “use onboarding From for prove”).
2. **Twilio (Monday):** “A2P + from number ready” — then agent runs the SMS prove.
3. Never paste keys — agent reads `.env` / Netlify by name.
