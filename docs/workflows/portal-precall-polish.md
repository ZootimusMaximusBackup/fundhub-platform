# Portal pre-call polish — 2026-08-15

Portal access is granted **before** the sales call. Empty states must not look like a funded DFY file.

**COMPLIANCE REVIEW REQUIRED** — offers, credit-pull empty states, chat collecting client data.

## Owner decisions (locked)

- Facebook wins group: `https://www.facebook.com/groups/1713376659872201` (share alias also given: `https://www.facebook.com/share/g/1NRdxVdmkc/`). Use the groups/ URL.
- Hero video = welcome to the Fundhub portal (full-width), not a tiny Card Stacking DFY side card.
- Offers on the portal = `src/config/offers.mjs`. Soft pull **$32 fixed**. Everything else closer-set on the call.
- No fake $46,500 / dummy PDFs / “we still need 2 things” until that data is real.
- Chat pops open on login if they have not been on a call; asks if they have questions before the call; replies land in the existing portal-message thread.

## Tasks

| ID | Owner | Status | Notes |
|----|-------|--------|-------|
| W1 | this chat | done | Hero, Facebook, offers, placeholders on `public/app/client-portal.html` + e2e |
| W2 | this chat | done | Chat auto-open pre-call + persist via portal-message |
| W3 | this chat | done | Portal Playwright covers pre-call, Facebook, catalog offers, chat auto-open |

## File fences

- W1: `public/app/client-portal.html`, `e2e/client-portal-ux.spec.mjs`, `docs/journeys/CHANGELOG.md`, this board
- W2: `public/app/chat-widget.js`, `public/app/shell.js`, `api/auth/session.mjs` (optional `had_call` on existing session — no new route unless you must), `api/chat/portal-message.mjs` only if needed, tests under `src/`
- Do not edit `*-intended.md`

## Manifests

### W1

**COMPLIANCE REVIEW REQUIRED** — offers on the portal, credit-pull empty states.

**Status:** done. No --prod. No commit.

**What it does**
- Hero video is full-width “Welcome to the Fundhub portal” and always shows (not hidden behind funding-snapshot).
- Facebook wins group: `https://www.facebook.com/groups/1713376659872201`
- Unlock More tiles match `src/config/offers.mjs` (soft pull $32 fixed; other list prices; closer sets final amount on the call). Removed fake $450 / $2,000 / $1,000 tiles.
- Before-call placeholders: no $46,500, no dummy PDFs, no fake “we still need 2 things.” Files appear when entitlements exist. Live funding status does not invent a dollar amount.
- Staff STATE toggle gained **Before call** (default).

**Files**
- `public/app/client-portal.html`
- `e2e/client-portal-ux.spec.mjs` (9 passed, including W3 chat checks)
- `docs/journeys/CHANGELOG.md`

**Journeys:** changelog only. No new routes, so `client-actual.md` was not regenerated.

### W2

**COMPLIANCE REVIEW REQUIRED** — portal chat now collects pre-call questions from the client and stores them on that client's existing conversation thread.

**Status:** done. No --prod. No commit.

**What it does**
- On client login to `/app/client-portal.html`, if they have not been on a sales call, the chat panel opens by itself (not just the bubble).
- First message (local, not POSTed): “Your call is coming up. Any questions you want us to know before we talk? Type them here and your advisor will see them.”
- Replies still `POST /api/chat/portal-message` on the existing thread. No second send path. `/api/chat/ask` stays staff-only.
- After a call is logged, the panel does not auto-open.
- Demo/sample portal: greeting still shows locally; send does not hit the live API.

**had_call**
- Added to the existing `GET /api/auth/session` payload for **client principals only** (top-level and on `staff`). No new route.
- Source: a `call_outcomes` row for that org + client_id. `outbound_calls` is not used — Bland dispatch never updates status past `initiated`, so it is not a reliable call signal.
- Query failure → `had_call: false` so the session still answers and the greeting can still open.

**Files**
- `src/auth/client-had-call.mjs` — lookup
- `api/auth/session.mjs` — `had_call` / `had_call_at` on client sessions
- `public/app/chat-widget.js` — `FHChat.mount({ portal, demo, hadCall, autoOpenPrecall })`
- `public/app/shell.js` — passes `had_call` from session into the mount
- `api/chat/portal-message.mjs` — untouched (reuse as-is)
- `public/app/client-portal.html` — untouched (W1)

**Tests** (all green)
- `src/auth/client-had-call.test.mjs`
- `src/http/auth-session.test.mjs`
- `src/http/chat-widget-precall.test.mjs`
- `src/http/routes.test.mjs` (no new ROUTES key)
- `src/http/app-client-carry.test.mjs` (shell still loads)

**Journeys:** none. Route gates unchanged; W3 owns extra Playwright/journeys.

**Left for W3:** live Playwright that the panel is open on a pre-call client session, and closed after a `call_outcomes` row exists.

