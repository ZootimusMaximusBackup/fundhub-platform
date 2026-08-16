# Portal pre-call + onboard — 2026-08-15

**COMPLIANCE REVIEW REQUIRED** — soft-pull pay, identity docs, address proof.

## Owner decisions (locked)

- **No “confirm your call.”** Redundant. Do not build it. Cancelled.
- Pre-call chat: stay **closed on first paint**, then **pop open after login** (~900ms). Not already open when they land.
- Soft-pull unlock (quiet): $32 UnderwriteIQ can go to Commas checkout before the call — tile Unlock + optional soft chat offer. Not in-your-face.
- Onboard/funded docs: ID + current-address proof (utility **or** bank statement). Address must match ID / credit file. SSN already on file — do not re-ask unless missing.
- Upload quality gate: refuse blurry / hand-in-frame / wrong type / junk. Workflow must **not** check off docs-received on a reject.

## Tasks

| ID | Owner | Status | Notes |
|----|-------|--------|-------|
| W0 Chat pop-after-login | this chat | done | Delayed auto-open in `chat-widget.js` |
| W1 Soft-pull unlock → checkout | — | pending | Quiet $32 Commas path |
| W2 Confirm call | — | **cancelled** | Owner: redundant |
| W3 Onboard docs + photo quality | — | pending | ID + address proof; quality gate |

## Manifests

### W0 — Chat pop after login (done)

- `public/app/chat-widget.js` — pre-call auto-open waits ~1400ms (`popAfterMs`), panel starts closed
- `src/http/chat-widget-precall.test.mjs` — asserts closed on mount, open after timer flush
- `e2e/client-portal-ux.spec.mjs` — catches closed window, then open + greeting
