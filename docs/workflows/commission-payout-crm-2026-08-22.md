# Commission payout CRM — pointer into the CRM repair board

**Do not treat this file as a second master list.** The durable backlog lives in:

**`docs/workflows/build-spec-2026-08-22.md` → section 5B.4 / 5B.5 / 5B.6 / 5B.10**

That is the shared board for the [CRM build repair process](c0df1039-a500-4f6c-8de3-68e3c82fcf1e) thread.

| Id | What | Status |
|---|---|---|
| **5B.4** | Approve / Mark paid on Products & Commissions | **Live** on `main` |
| **5B.5** | Email closer/manager on Mark paid (amount + ACH expected) | **Built** — needs deploy for code; seed live in DB |
| **5B.6** | Deal-close dopamine SMS for closer + sales manager | **Built** — needs deploy; needs staff phones |
| **5B.10** | Real ACH rail (Melio / Plaid Transfer) | Queued — see build-spec |

COMPLIANCE REVIEW REQUIRED when shipping 5B.5 / 5B.6.

## Staff setup so alerts fire

1. Staff & Teams: each closer/manager needs **email** (payout notice) and **phone** (win SMS).
2. After Mark paid: they get the email if Resend is live (`MESSAGING_DRY_RUN` off).
3. After deposit/sale close: they get the SMS if attributed on the sale and phone is set.
