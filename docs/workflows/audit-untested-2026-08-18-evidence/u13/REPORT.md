# U13 — SMS lands on the test phone

**Result: UNVERIFIED — cannot send**

Chris’s claim: a text actually arrives on the test phone.

Ground truth: **MISSING.** Intended journeys do not name “SMS lands on the phone.”

`FUNDHUB_TEST_PHONE` set: **yes.** Number not printed.

---

## WAVE B rollup

| Unit | Result |
|---|---|
| U2 reply → Messaging | **BROKEN / not sent.** Resend From is `fundhub.ai` (Cloudflare). Mailgun only hears `mg.fundhub.ai`. Bare inbox = live file. `message.inbound` = 0. |
| U3 email STOP | **BROKEN.** No unsubscribe link. `/api/unsubscribe` 404. Email STOP does not write `opt_outs`. Mailgun `unsubscribed` ignored. `opt_outs` = 0. |
| U13 SMS on test phone | **UNVERIFIED — cannot send.** TEST has no phone. No To box. Test phone **is** the live file’s phone. Did not text. Did not patch. |

Did not open or write `9af65808-…`. Did not deploy. Did not commit.

---

## 1. Messaging Send to the test phone

**Expected:** Type `FUNDHUB_TEST_PHONE` as To. Send once.

**Observed:** TEST client `8556bedc-…` still has **no phone**. Messaging has **no To box**. Send uses the stored phone only.  
Right rail shows the `@fundhub.ai` email. Two old audit texts already say “Not sent — the client has no phone to send to.”  
`FUNDHUB_TEST_PHONE` **equals** the live file’s phone. Texting that number would text the live file. Forbidden.  
Did not press Send. Did not patch the client.

**Result:** Cannot send.

**Evidence:** `01-clients.json`, `03-send-door.json`, `05-decision.json`, `08-screen.json`, `shots/01-messaging-test-client.png`

---

## 2. Messages row

**Expected:** status, provider, error for a send we made.

**Observed:** No new send today. Two old TEST rows (`0b1d9316-…`, `eb95733f-…`): `status=failed`, provider Twilio, error “the client has no phone to send to,” `has_to=false`.

**Result:** No new row. Old refuse still true.

**Evidence:** `02-sms-rows.json`, `06-test-sms-errors.json`

---

## 3. Phone proof

**Expected:** Device shot or Twilio “delivered” log. Provider “sent” alone is not enough.

**Observed:** Three older rows (2026-08-16) already went to `FUNDHUB_TEST_PHONE`. They belong to the **live file**. Status `sent`. That is not device proof.  
Twilio auth token names are **unset** locally, so A2P / delivery cannot be asked. Did not open the live file to look at those texts.

**Result:** Inbox landing UNVERIFIED.

**Evidence:** `07-rows-to-test-phone.json`, `04-a2p.json`

---

## 4. A2P

**Expected:** A2P status if a send fails.

**Observed:** No send, so A2P was not reached. `TWILIO_SEND_AUTH_TOKEN` / `TWILIO_AUTH_TOKEN` unset. Cannot ask Twilio.

**Result:** A2P UNVERIFIED.

---

## Findings

1. SMS landing is **MISSING** from the intended journey.
2. Cannot send: TEST has no phone; screen has no To box; do not patch.
3. `FUNDHUB_TEST_PHONE` is the live file’s phone. Do not text it.
4. Device landing not proven. Twilio “sent” on 2026-08-16 is not a phone shot.
