# Launch readiness — can we take real money?

**Date:** 2026-08-21 (after the live journey on 2026-08-20)  
**Facts from:** `docs/workflows/live-journey-2026-08-20.md` and tonight’s proofs  
**Copy dump:** `docs/workflows/live-journey-2026-08-20-evidence/all-template-copy.md` (237 templates)  
**Automation key:** `INNGEST_EVENT_KEY` stays **ON**. Do not turn it off. Ever.

This page answers one question: can Fundhub take a real customer from first click to paid, and keep the money recorded?

**Short answer: not yet.**

---

## The money spine

This is the path that has to work to take real money.

| Step | Status | One line |
|---|---|---|
| **Lead** | **READY** | A real person can come in through the apply site and land as a client file. |
| **Book** | **NOT READY** | The slot saves, and the “you’re booked” text **does** send. The confirm email does **not**. The confirm/reminder job (`s-04b`) sat dead for 90 days until someone forced it. This PR fixes the confirm-text clock, puts Fundhub as calendar organizer, and points reschedule at the live book URL — **not live until you merge**. Josh auto-call is wired here as a dry-run only. |
| **Call** | **UNPROVEN** | The closer desk and Present deck exist and are protected. A live call → save the outcome → feed the next agent was **not** walked tonight. |
| **Authorization** | **UNPROVEN** | Staff can copy the consent link on the client file. A client did **not** finish signing tonight. |
| **Pull** | **NOT READY** | Credit is **sandbox only**. We cannot pull a real report. |
| **Contract** | **UNPROVEN** | Contract screens exist. A real sale → send contract → client signs was **not** proven tonight. |
| **Pay** | **NOT READY** | A live deposit failed to save (`product_id` missing, database error **23502**). A real card charge and a real refund have **never** been proven. |
| **Unlock** | **NOT READY** | Unlock means “they paid, now the file opens.” Pay is broken, so unlock cannot work. |
| **Portal** | **READY** | The portal sign-in email **did** send and land (Resend delivered the magic link). |

---

## Top 3 things between today and real money

These three block taking money. Fix these before a real card or a real bureau.

### 1. Deposits do not save

When someone pays a deposit, the system tries to write the payment and dies. The product id is missing. Postgres error **23502**. No payment row. No commission. Proven live twice tonight (**BLK-008**). Overnight work (W3) is meant to wire this. It is **not live** until you merge and deploy.

### 2. A real card has never been charged or refunded

We can build a pay link. We have **not** charged a live card. We have **not** refunded one. Do not take a customer’s card until that path is proven end to end.

### 3. Credit is fake (sandbox)

Every credit pull tonight is sandbox. You cannot price a real file, and you cannot unlock real work that needs a real report.

---

## What already works (do not “fix” these)

- **Booked SMS** (`bs-01`) **did** fire on a real book. Phone got: “Hey Chris, it’s Fundhub. You’re booked…”
- **Portal magic link** **did** fire. Inbox got “Your Fundhub sign-in link.”
- Texts and emails **can** leave the building (Twilio + Resend delivered on the live journey).
- The automation key stays **on**. Leave it on.

---

## Other launch holes (not the top 3, still real)

- **Josh auto-call** is wired on this branch (`booking.created` → AG-04 / vendor prompt). Tests stub the dial. No live ring until you merge **and** the outbound switch allows it.
- **Confirm email** never queued on the real book.
- **`s-04b` confirm/remind texts** never auto-fired in 90 days. Only a forced fire produced them.
- **Calendar + confirm time** are fixed on this branch (Fundhub organizer, book-URL reschedule, human clock). Not live until you merge. A named advisor is still not assigned to the invite.
- **165 of 237** message templates are still `compliance_passed=false` (**MSG-04**). Those sit in the gate and will not send until marked passed. Full copy: `docs/workflows/live-journey-2026-08-20-evidence/all-template-copy.md`.
- **Inquiry sweeper** dials **bureaus**, not customers. It is not a “call the lead” tool.

---

## What this file is not

- Not a deploy plan. Nothing here ships tonight.
- Not a request to turn automations off. The key stays on.
- Not a full audit of every screen. This is the money path only.

---

## Next

Do not take a real card until (1) deposits save, (2) a charge and a refund are proven, and (3) you decide whether sandbox credit is enough for the first paid file.

Chris: name which of the top 3 you want live first after this overnight branch merges.
