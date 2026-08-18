# All audits today — one review

Built 2026-08-18, after Chris signed the Credit Repair Agreement on TEST.

**COMPLIANCE REVIEW REQUIRED** — credit-repair agreement, consent, bureau pull, inquiry Send, fees / pay.

This is the human file. Full boards stay where they are. Shots stay in evidence folders.

Did not open live credit file `9af65808-…`. Did not charge a card.

---

## You signed. This is what happened

You signed **Credit Repair Agreement** on TEST `8556bedc-…` at 22:03 UTC.

- Contract `8dfa576f-…` status **signed**. Template `CREDIT-REPAIR-AGREEMENT`.
- Event `contract.signed` `4f042145-…` written.
- Portal contracts for TEST: **2** (this + the old soft-pull consent).
- Unlocks granted: **0**.
- Product unlock map (`product_entitlements`): still **0** rows.
- No job listens for `contract.signed`. Sign does not start the next hop.

The SIGNED badge on the page is real. The rest of the machine did not move.

Evidence: `docs/workflows/audit-today-merge-2026-08-18-evidence/sign.json`  
`docs/workflows/audit-today-merge-2026-08-18-evidence/after-sign.json`

---

## What is broken (one list)

These were proven on the live site. Do not walk them again unless you name a fix.

1. **Client magic-link cannot load the file.** Link works. Session is TEST. The login page drops the file id. Portal says “We could not load your file.” No video. No n/6. APIs answer 200 if asked by hand.
2. **Owner Calendar does not show tonight’s book.** 8:00 PM E2e Fire is in the database and in the task API. Screen still says “Nothing booked.” Pipeline Booked card is honest.
3. **Apply confirm mail bounces** when the address is `e2e+aff-*@fundhub.ai`.
4. **Pay → unlock is dead.** Pay-link create **503**. Unlock map empty. Six tiles stay locked after a fake payment event. Sign (above) also grants nothing.
5. **Bureau pull will not run.** Consent page dumps you on Pipeline. After an API consent save, Experian is **422** “no identity on file.” Scores stay dashes. Soft-pull consent contract ≠ the consent row the pull reads.
6. **Inquiry Send is “VIEW is not defined.”** No letter. No Bland start from the CRM.
7. **Mark Cleared writes a task, not a funding round.** `funding_rounds` still 0.
8. **Agent Editor ≠ live Bland.** Save writes the `agents` table. Calls use vendor JS. CRM inquiry launch **503**.
9. **GHL and Plaid webhook URLs 404.** PostGrid / Bland signed pings 200 then ignore.
10. **Bank launcher 503.** No Plaid Connect button.
11. **Hiring Hire / Reject is read-only** (POST 405).
12. **Email STOP does not opt out.** Message saves. `opt_outs` 0. `/unsubscribe` 404.
13. **Company Brain Ask 502.** Upload 502. Token issuer reject.
14. **Affiliate money not wired.** Paid is a dash. Copy says “not connected to this page yet.”
15. **No course player.** `/education/` is a $5,000 sales page.
16. **Welcome video missing.** Content Admin bounces.
17. **Incomplete-apply job dies.** `s-02-incomplete-survey-nudge` is the failed-run pile.
18. **GoHighLevel list APIs 401.**

---

## What already works

- Staff login. Galaxy owner / partner pages.
- Inbound email reply shows in Messaging.
- One SMS to the test phone (Twilio accepted). Check the phone.
- Apply extras + book a live slot. Thank-you page. `booking.created` + Inngest book jobs (`s-04` finished).
- Present **Send contract** (that is the CRA you signed).
- Job switch is on. Cloud rebuild picked up the keys.
- Live Playwright required ids **100/100** (3 extra Company Brain tests still red).
- TEST archive works.

---

## Threads folded in

| Thread | What it owns |
|---|---|
| [CRM audit event tracing](d3d26b6c-a03f-4449-8c39-957651b878b7) | Whole CRM + leftover fire + keep-going + this merge |
| [Portal spot-check](6845bb65-5c13-4f55-babe-f00b2e579609) | Portal / underwrite / reply |
| [Audit of fulfillment machine](b4db0de5-a45e-4aca-b3bf-b425bf56bf65) | Engine / sign / pay hops |
| [Audit documents request](2326e2cb-c5fb-4f3d-ae2f-07242b67c655) | Gaps G1–G5 |
| [Fundhub CRM owner feedback](9226010e-669b-47fd-af00-ec3aad2fcf7e) | Whole CRM W walks |
| [CRM page layout](94833c4b-ca20-4877-ad51-29106616c66f) | Width / gutter |
| [Fundhub audit overview](df3af742-e186-4f4d-877f-fece93bfc5bf) | Overview |
| Older Aug 16–17 | UI, speed, Fable, sixteen prompts |

Boards: `audit-crm-whole-2026-08-18.md`, `audit-untested-2026-08-18.md`, `audit-untested-fire-2026-08-18.md`, `audit-keep-going-2026-08-18.md`, `audit-engine-2026-08-18.md`, `audit-gaps-2026-08-18.md`, `audit-2026-08-19.md`.

Old dump: `docs/workflows/ALL-THREADS-AUDIT-REPORTS.md` (long). Use this file instead.

---

## Still untested — only these

Do **not** open the live credit file. Do **not** charge a card.

| Still open | Why |
|---|---|
| **[Fundhub form submission](8e44450c-4f98-405f-8ae4-e2a78a6f44d4)** | Other chat, still moving ~10 min before this merge. No report landed in `docs/workflows/` from that thread. |
| Affiliate **as an affiliate**, not as owner | We only opened the page as Chris. |
| White-label **as a partner** | Owner/partner Galaxy was scored. Partner-site login path was not fired today. |
| SMS **STOP** | Email STOP was. Text STOP was not. |
| Client portal **after this sign**, as the client | Magic-link still drops the file. Staff API already shows 0 unlocks. A client click would show the same “could not load.” |
| Dispute **letter generate** after CRA sign | Would be a new credit-repair hop. Do not mail a bureau. |
| 8:00 PM **Join Call** | Real Meet on your calendar. Calendar screen cannot see it anyway. |

Everything else on the leftover list was already walked.

---

## This thread’s boards

All rows **done**. Findings only. No app edits from the audits.
