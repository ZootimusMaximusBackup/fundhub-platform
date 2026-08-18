# F-MAIL — Magic-link, inbound reply, email STOP

Date: 2026-08-18  
Test client only: `8556bedc-46e1-4d85-b0cd-a24adfee1521`  
Never opened / never wrote: `9af65808-…`

Env names used: `FUNDHUB_TEST_INBOX`, `RESEND_API_KEY`, `MAILGUN_SIGNING_KEY`, `STAFF_E2E_PASSWORD`, `DATABASE_URL`. Values not printed. Plus-tag used. Bare inbox not used.

Ground truth: `docs/journeys/client-intended.md` does **not** name magic-link → own file, reply → staff inbox, or email STOP. All three claims are **MISSING** there. Scored against Chris’s fire ask.

Did not press dispute Sign.

---

## 1. Magic-link (must open as the client)

**Chris’s claim:** Client gets a sign-in link, opens it, and sees THEIR file, the welcome video, and n/6 tiles. Staff-open does not count.

**What we did**

- TEST file mail was `@fundhub.ai`, not a plus-tag. We set TEST client + matching account to the `+e2e-fire` plus-tag. Live file still equals the bare inbox.
- `POST /api/auth/magic-link` with the plus-tag → **200**.
- Link came from the `messages` row (`EMAIL-PORTAL-MAGIC-LINK`). Token last-4: `KPbg`. Full token not printed.
- Today’s magic-link row stayed **queued** (not handed to Resend). We still opened the real link from that row.
- Opened the link in a browser. Session: **client**, TEST id, not the live file. Not a staff-open.

**What the client saw**

- Header: `TEST — Client Role · client`.
- File: **“We could not load your file.”**
- Video: **“Welcome video is not available.”**
- Tiles: no `n/6` line. The page never got a file id, so it never painted tiles.
- Dispute card: “Sign to authorize…” and “Sign in to load the legal wording.” Did **not** press Sign.

**Score:** Link opened as the TEST client. **PASS** for “opened as the client.” File / video / n/6 **FAIL**.

**Why the file is blank:** the portal only reads a file id from the URL or from a saved `fh_account` note. The magic-link page saves the sign-in token and does not write that note. So the person is signed in, and the page still says it cannot load the file.

**Evidence:** `01-file-paint.png`, `02-hero-video.png`, `03-entitlements.png`, `04-dispute-card.png`, `04-magic-request.json`, `06-magic-link.json`, `15-portal.json`

---

## 2. Inbound reply

**Chris’s claim:** A client reply shows in staff Messaging.

**What we did**

- Staff sent one live email **to the plus-tag** (`POST /api/messages`). HTTP **200**, outcome **sent** (Resend).
- Posted a signed Mailgun inbound body to `https://fundhub.ai/api/webhooks/mailgun`. From = plus-tag. Subject/text = `e2e fire reply — ignore`.
- HTTP **200**. Events named: `mail.response`, `message.inbound`.

**What landed**

- `message.inbound` on TEST: **2** (reply + STOP).
- Inbound email rows on TEST: reply row + STOP row.
- Staff Messaging EMAIL thread shows the outbound fire mail, the reply, and STOP.

**Score:** **PASS.** The reply is on the TEST EMAIL thread.

**Evidence:** `03-staff-send.json`, `07-inbound-reply.json`, `10-events.json`, `11-inbound-messages.json`, `05-staff-messaging.png`, `16-staff-messaging.json`

---

## 3. Email STOP

**Chris’s claim:** A client can stop email. After STOP, Fundhub does not keep mailing them.

**What we did**

- Same inbound door. From = plus-tag. Text = `STOP`. HTTP **200**. `message.inbound` written.
- Live unsubscribe pages:
  - `GET /api/unsubscribe` → **404**
  - `GET /unsubscribe` → **404**
  - `GET /app/unsubscribe.html` → **404**

**What landed**

- STOP shows in staff Messaging.
- `opt_outs` on TEST: **0** rows. Email is **not** stopped.
- Live file opt-outs unchanged (**0**).

**Score:** **FAIL.** STOP is saved as a message. It does not write an opt-out. Email STOP is ignored on purpose in the inbound handler (only texts use STOP). There is no unsubscribe page to click.

**Evidence:** `08-inbound-stop.json`, `09-unsub-doors.json`, `12-opt-outs.json`, `05-staff-messaging.png`

---

## Live-file guard

- Live file new events (30 min): **0**
- Live file new messages (30 min): **0**
- Live file opt-outs: **0**
- Live file mail still equals the bare inbox

**Evidence:** `14-live-guard.json`, `01-align.json`

---

## Findings

1. Magic-link → own file is **MISSING** from the intended journey.
2. Real magic-link opened as TEST client. File did not paint. Video missing. No n/6. Staff-open was not used.
3. Reply → Messaging is **MISSING** from the intended journey. The live door **works** when From is the plus-tag.
4. Email STOP is **MISSING** from the intended journey. STOP does **not** stop email. No unsubscribe page.

---

## FAIL — magic-link file paint

- Journey: client sign-in link → own file (Chris’s claim; **MISSING** in `client-intended.md`)
- Step: after the real link, see file / video / n/6 / dispute
- Expected: TEST name, video or “not available”, n/6, dispute card
- Observed: signed in as TEST client; page says “We could not load your file”; video not available; no n/6; dispute asks to sign in. Did not press Sign.
- Evidence: `15-portal.json`, `01-file-paint.png`, `02-hero-video.png`, `03-entitlements.png`, `04-dispute-card.png`

---

## FAIL — email STOP

- Journey: client can stop email (Chris’s claim; **MISSING** in `client-intended.md`)
- Step: inbound STOP or unsubscribe link writes `opt_outs`
- Expected: opt-out row for email on TEST
- Observed: STOP is a message. `opt_outs` empty. Unsubscribe URLs 404.
- Evidence: `12-opt-outs.json`, `08-inbound-stop.json`, `09-unsub-doors.json`
