# P3 — Client response loop (2026-08-19)

Findings only. Chris names fixes.

Ground truth for this loop is **MISSING** in `docs/journeys/*-intended.md`. Those files only list routes. This report is scored against the board prompt.

Sim client: `cb6f5839-2979-491d-9080-00ca51833b07`  
Contract: `003b3da3-0467-46ac-be78-b4b1d2fdcd31`  
Live file and P1 client were not edited. `FUNDHUB_TEST_INBOX` set: **yes**. Bare inbox was never written onto the sim file.

---

## a) Contract mail lands in the inbox

**Expected:** Staff send a contract. Mail lands in the watched inbox. A person opens that mail in Gmail. Screenshot of the opened mail.

**Observed:** Send worked. Row `836085e3-…` is `CONTRACT-SEND-EMAIL`, `status=sent`, provider **Resend**, To was the plus-tag (not the bare inbox). Client row stayed on the demo address.  
First agent pass missed the logged-in Gmail tab and called inbox open a fail. Re-check on the already-signed-in inbox: subject **Please sign: Funding Agreement**, 1:05 PM, preview names TEST and the sign URL for contract `003b3da3-…`. Same id as this audit. Inbox landing is proven. Body click was not needed for landing; the row shows the link.

**Result:** PASS (inbox landing). First-pass “no Google login” was wrong.

**Evidence:** `dumps/05-send.json`, `dumps/06-after-send-db.json`, `dumps/33-inbox-landing.json`, `shots/14-inbox-landing-logged-in.png`, `shots/15-chris-inbox-logged-in.png`

---

## b) Sign link → view badge → sign → reminders

**Expected:** Client clicks the sign link from the mail. The view badge updates. Client signs. `POST /api/contracts {action:"run_reminders"}` sends a chase mail. The new link still signs, or the file is already signed / the link is dead.

**Observed:** The sign link used was the one on the send response, not a link copied from Gmail.  
Open: badge **WAITING FOR YOUR SIGNATURE**. Database: `status=viewed`, `view_count=1`.  
Sign: badge **SIGNED**. Database: `status=signed`.  
`run_reminders`: 200, “Nothing outstanding.” `reminded=0`.  
One-contract remind: 409, already signed. No chase mail. Chase link not proven.

Staff Documents opened with this client id painted the **live file**, not this sim file.

**Result:** View + sign PASS. Chase mail FAIL (already signed; none sent). Staff Documents filter FAIL.

**Evidence:** `shots/03-contract-open.png`, `shots/05-contract-signed.png`, `dumps/11-after-view.json`, `dumps/12-after-sign.json`, `dumps/14-run-reminders.json`, `dumps/15-remind-one.json`, `shots/06-staff-documents.png`

---

## c) Reply → Mailgun → inbound router → staff Messaging

**Expected:** Client replies to the contract mail. Mailgun hits `/api/webhooks/mailgun`. Event `message.inbound` is written. `dpc-03-inbound-reply-router` runs. The reply shows in staff Messaging.

**Observed:** Mailgun **does** have one inbound route. It is `catch_all()` and it forwards to `https://fundhub.ai/api/webhooks/mailgun`. That only fires for mail that hits Mailgun (domain `mg.fundhub.ai`).  
`fundhub.ai` mail goes to Cloudflare, not Mailgun. The contract went out through **Resend**.  
A Gmail reply would come From the **bare inbox**. That address is the live file. The code matches From to the oldest client with that email. The live file would win.  
No reply was sent. No `message.inbound` and no `mail.response` for this sim id. dpc-03 did not run.  
dpc-03 only acts on YES / RESCHEDULE / CLOSE anyway.

**Result:** FAIL / stopped. Provider route exists. Reply hop cannot be proven safely.

**Evidence:** `dumps/07-mailgun-routes.json`, `dumps/07b-mailgun-route-expr.json`, `dumps/29-inbound-leg.json`, `dumps/27-events.json`

---

## d) Portal chat → staff Messaging

**Expected:** Client sends a portal chat. It lands in `api/chat/portal-message.mjs`. Staff Messaging shows it. Magic link for the plus-tag must not open the live file.

**Observed:** Plus-tag is not stored on any client, so it does not resolve to the live file. Bare inbox **does** resolve to the live file. Magic link was requested for the sim demo address only.  
Session `client_id` was the sim id, not the live file.  
`POST /api/chat/portal-message` → 200. Message `45e51565-…`.  
Staff Messaging on this client shows the chat text.  
Portal page still says **We could not load your file.** Welcome video is missing.

**Result:** Chat landing PASS. Portal file paint FAIL.

**Evidence:** `dumps/25-session-shape.json`, `dumps/26-portal-chat-result.json`, `dumps/28-staff-messaging-after.json`, `shots/12-portal-chat-attempt.png`, `shots/13-staff-messaging-after-chat.png`

---

## e) Email unsubscribe / STOP

**Expected:** What suppresses mail, which table records it. One safe click of an unsubscribe link in a mail we sent, if one exists. No SMS STOP.

**Observed:** The contract mail has **no** unsubscribe link. There is no `/api/unsubscribe` page.  
Email STOP words do **not** write an opt-out (SMS only). Mailgun’s `unsubscribed` event is **ignored**.  
The only email stop path in code is a spam complaint → table `opt_outs`, channel `email`, source `provider_complaint`. The send gate then blocks later mail.  
No click. No SMS test.

**Result:** Documented. Click UNVERIFIED (no link).

**Evidence:** `dumps/22-unsubscribe-code.json`, `db/seed/008_contract_messages.sql`, `src/lib/opt-out.mjs`, `src/handlers/comms.mjs`, `src/adapters/mailgun.mjs`

---

## f) Teardown

**Expected:** `DELETE /api/demo/simulate {client_id}` removes this sim file. Zero leftovers on this id. Live file and P1 untouched.

**Observed:** DELETE returned **500**. Error: cannot delete the client because `events` still point at it. Designed teardown does not delete events, contracts, documents, signers, accounts, or magic-link rows.  
Client **still there**.  
Leftover rows for this id: **14** (`clients` 1, `events` 5, `documents` 2, `contracts` 1, `contract_signers` 1, `account_magic_links` 3, `accounts` 1).  
Live file still present. P1 still present.

**Result:** FAIL.

**Evidence:** `dumps/31-delete.json`, `dumps/32-orphans-after.json`

---

## Findings (Chris names fixes)

1. Inbox landing not proven — no Gmail session, so the opened mail was not seen.
2. Staff Documents with this client id showed the live file, not the sim file.
3. A reply from the watched inbox would attach to the live file (From = bare inbox).
4. Contract mail goes out on Resend / `fundhub.ai`. Mailgun inbound only hears `mg.fundhub.ai`.
5. Portal file does not load for this sim client (“We could not load your file”).
6. No email unsubscribe link. Mailgun `unsubscribed` is ignored. Email STOP words do nothing.
7. `DELETE /api/demo/simulate` dies on `events` and leaves 14 rows, including the client.
