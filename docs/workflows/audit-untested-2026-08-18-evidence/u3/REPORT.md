# U3 — Email STOP / unsubscribe

**Result: BROKEN**

Chris’s claim: a client can stop email. After STOP, Fundhub does not keep mailing them.

Ground truth: **MISSING.** `docs/journeys/client-intended.md` does not name unsubscribe or STOP.

Did not click a live person’s mail. Did not email STOP. Did not text.

---

## 1. Does outbound mail have an unsubscribe link?

**Expected:** A real link a person can click.

**Observed:** 173 of 182 email templates contain the word “Unsubscribe” in the footer. **Zero** have an `href`, a `/unsubscribe` URL, or a List-Unsubscribe header.  
Contract send, contract remind, and portal magic-link have **no** unsubscribe word at all.  
Last 20 sent bodies: no unsubscribe URL.

Live pages:
- `GET /api/unsubscribe` → **404**
- `GET /unsubscribe` → **404**
- `GET /app/unsubscribe.html` → **404**

**Result:** No link. Footer word only.

**Evidence:** `01-templates.json`, `02-named-templates.json`, `03-sent-bodies.json`, `00-unsub-doors.json`, `06-href.json`

---

## 2. What if they click, or email STOP?

**Expected:** A click or the word STOP stops later mail.

**Observed:** There is no link to click.  
Emailing STOP from the watched inbox would attach to the live file. Not sent.  
Even if STOP arrived as email, the handler only treats STOP as an opt-out when the channel is **sms**.

**Result:** No safe STOP path. Not clicked. Not sent.

**Evidence:** `05-decision.json`, `src/handlers/comms.mjs`

---

## 3. Is an opt-out row written? Is Mailgun `unsubscribed` ignored?

**Expected:** An `opt_outs` row. Later sends blocked.

**Observed:** `opt_outs` table has **0** rows. No client has `dnd_email`.  
Mailgun event `unsubscribed` is in `IGNORED_DELIVERY_EVENTS`. It writes nothing.  
The only email stop path in code is a **spam complaint** (`event=complained` → `opt_outs` channel `email`, source `provider_complaint`). That has never happened.

**Result:** Mailgun `unsubscribed` is ignored. No row. Claim fails.

**Evidence:** `04-opt-outs.json`, `src/adapters/mailgun.mjs`

---

## Findings

1. Email stop is **MISSING** from the intended journey.
2. No unsubscribe link. No unsubscribe page.
3. Email STOP does not write `opt_outs`.
4. Mailgun `unsubscribed` is ignored.
5. `opt_outs` is empty. Nobody has ever been stopped this way.
