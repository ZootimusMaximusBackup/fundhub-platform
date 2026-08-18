# W-SIG

Findings only. This file: simulated client `41a3199f-…`. We sent and signed one **Funding Agreement**. We did not invent a list of things a signature should unlock. The written journeys do not name that chain.

## What we did

1. Before: this file had **no contracts**. Card was already `sales` / `decision_rendered`. `clients.updated_at` was `19:14:46Z`. No tasks.
2. Send: `POST /api/contracts` `create_draft` then `send`. Template **FUNDING-AGREEMENT**. Contract `82f9232a-…`. HTTP 200. Sign link came back on the response.
3. Mail: the designed send path emails the signer. The sim address is not a real inbox, so we used the designed `signers[]` email field and sent to **FUNDHUB_TEST_INBOX** (name only). A `CONTRACT-SEND-EMAIL` row went `sent` via Resend. That is the send mail, not a later unlock mail.
4. Sign: opened the in-app link. Typed test name. Page said **SIGNED**. Row `status=signed`. Event `contract.signed` `98346e63-…` with this `client_id`. Payload is ids + template key + status. No body.

## Did the signature unlock anything on this file?

**No.** After the sign, compared to right after the send:

- Stage: still `decision_rendered`. Did not move.
- Tasks: still none.
- Entitlements: still none.
- Soft-pull gate: no new consent row, no new pull. (W-CONSENT already wrote consent with `POST /api/consent/capture`. That is a different path.)
- No letter send. We did not press inquiry or repair Send.
- No follow-up email or text after the sign.
- GHL id flag did not change.
- `clients.updated_at` did not change.

The only new event after the sign is `contract.signed` itself. Sign also wrote a signed PDF `864fd394-…`. That copy is **not delivered**. Same as W10. That write is inside `sign()`, not a listener.

## Who listens for `contract.signed`?

Nobody.

- Code that **writes** the event: `src/contracts/sign.mjs`.
- Name listed: `src/events/canonical.mjs` — comment says no handler on purpose.
- `src/register-all.mjs`: none.
- Inngest list: none.
- Grep of `src` / `api` / `netlify` (not tests): only the emitter and the name.

Empty listener list + no unlock row change = **W10 is still true for this file.**

## W10 cross-check

| W10 claim | This file |
|---|---|
| `contract.signed` fired; nobody listened (no stage, task, follow-up mail/SMS, `updated_at` unchanged) | **SAME** |
| Soft-pull consent sign did not unlock soft pull | **N/A** — we signed FUNDING-AGREEMENT, not SOFT-PULL-CONSENT |
| Dispute-letter sign never done | **SAME** — still not signed |
| Signed copy generated and not sent | **SAME** |

## Left for W-TEAR

Do not tear down from here. Extra rows from this unit:

- contract `82f9232a-3c6d-4cd5-85eb-b4995e4f539a`
- signer `78e99a73-2665-4291-9982-f8471387a4d8`
- documents `9e11d5b1-…` (sent copy) and `864fd394-…` (signed copy, not delivered)
- message `12e64626-…` (`CONTRACT-SEND-EMAIL`)
- events `678a8671-…` (`contract.sent`) and `98346e63-…` (`contract.signed`)
