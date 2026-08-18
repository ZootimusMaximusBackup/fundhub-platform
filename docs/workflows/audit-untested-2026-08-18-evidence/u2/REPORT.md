# U2 — Client reply lands in Messaging

**Result: BROKEN / not sent**

Chris’s claim: a client replies to a Fundhub email, and that reply shows in staff Messaging.

Ground truth: **MISSING.** `docs/journeys/client-intended.md` only lists who can open routes. It does not name “reply → staff inbox.”

`FUNDHUB_TEST_INBOX` set: **yes.** Live file `9af65808-…` is the only client with that exact address. No reply was sent.

---

## 1. Where outbound mail is sent from

**Expected:** A real From we can reply to.

**Observed:** Live routing sends email through **Resend**, not Mailgun. 49 sent + 13 failed Resend rows. Latest send today (portal magic link).  
`RESEND_FROM` is on **fundhub.ai** (not `mg.fundhub.ai`). Resend does not set a Reply-To. Mailgun send-from is not set.

**Result:** Outbound = Resend / `fundhub.ai`.

**Evidence:** `04-routing.json`, `05-outbound-email.json`, `00-env-names.json`

---

## 2. Where a reply would land

**Expected:** Reply hits Mailgun, then `https://fundhub.ai/api/webhooks/mailgun`.

**Observed:**
- `fundhub.ai` mail goes to **Cloudflare**.
- `mg.fundhub.ai` mail goes to **Mailgun**.
- Mailgun has 1 route: `catch_all()` → live webhook. HTTP 200.
- Live webhook door exists (GET/HEAD **405** — POST only).
- A reply to the Resend From therefore hits Cloudflare, not Mailgun.

**Result:** BROKEN hop. The inbound route is real. The mail we send out does not use the domain that route hears.

**Evidence:** `01-mx.json`, `03-mailgun-routes.json`, `02-live-doors.json`

---

## 3. Safe reply?

**Expected:** Plus-tag From that cannot match the live file. Then watch webhook, `message.inbound`, staff Messaging.

**Observed:** Gmail Reply From is the **bare** watched inbox. That address **is** the live file. The matcher uses exact `lower(email)` (`resolveClientFromSender`). A send would attach to `9af65808-…`. Forbidden.  
No client stores our plus-tag (`+u2audit`). Five other Gmail plus-tag files look like real people — not used. P3 sim plus-tag is `demo.fundhub.local` — cannot send from Gmail.

**Result:** No send. That is the finding.

**Evidence:** `06-collision.json`, `10-send-decision.json`, `11-plus-clients-safe.json`

---

## 4. Has a reply ever landed?

**Expected:** At least one `message.inbound` or inbound email row.

**Observed:** `message.inbound` = **0**. `mail.response` = **0**. Inbound messages = **0**.

**Result:** This door has never fired.

**Evidence:** `07-inbound.json`, `12-event-names.json`

---

## Findings

1. Reply → staff Messaging is **MISSING** from the intended journey.
2. Outbound is Resend on `fundhub.ai`. A reply goes to Cloudflare, not Mailgun.
3. Mailgun inbound only hears `mg.fundhub.ai`.
4. A Gmail reply from the watched inbox would hit the live credit file. Not sent.
5. `message.inbound` has never been written.
