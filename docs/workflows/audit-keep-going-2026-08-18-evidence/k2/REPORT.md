# K2 — Why magic-link portal cannot load the file

Date: 2026-08-18  
Test client only: `8556bedc-46e1-4d85-b0cd-a24adfee1521`  
Never opened / never wrote: `9af65808-…`  
Did not press dispute Sign.

Ground truth: `docs/journeys/client-intended.md` does **not** name magic-link → own file. Scored against Chris’s fire ask.

---

## What we did

1. Confirmed TEST mail is still the plus-tag from F-MAIL. Live file is still the bare inbox. Did not write mail. Did not open the live file.
2. `POST /api/auth/magic-link` to that plus-tag → **200**.
3. Opened the real link from the `messages` row (`EMAIL-PORTAL-MAGIC-LINK`). Token last-4: `ozZ8`. Full token not printed.
4. Landed as **client** on `/app/client-portal.html` with **no** file id in the URL.

---

## Live page

- Header: `TEST — Client Role · client`.
- File: **“We could not load your file. Use the link we sent you, or sign in again.”**
- Video: **“Welcome video is not available.”**
- Tiles: no `n/6` line.
- Dispute: “Sign in to load the legal wording…” Did **not** press Sign.

Shot: `01-file-paint.png`

---

## Session vs TEST id

| place | client id |
|---|---|
| TEST file | `8556bedc-…` |
| magic-link-verify `account.clientId` | `8556bedc-…` (match) |
| `fh_account.clientId` after portal-login | **missing** (`fh_account` not stored) |
| URL `?id=` | **none** |
| `/api/auth/session` | **200**, principal `client`, name `TEST — Client Role` |

Verify body keys: `ok`, `token`, `expiresAt`, `principal`, `account`, `next`.  
`account` keys: `accountId`, `affiliateId`, `clientId`, `email`, `kind`, `name`, `orgId`, `partnerId`.  
Email values not printed.

W1 still true on the live pages:

- `portal-login.html` stores `fh_token`. It does **not** store `fh_account`.
- `login.html` stores `fh_token` **and** `fh_account`.

Evidence: `04-storage-compare.json`, `07-session-compare.json`

---

## Fetches (no PII)

Page itself (before our probe):

- `POST /api/auth/magic-link-verify` → **200**
- `GET /api/auth/session` → **200** (twice)
- No entitlements call. No `n/6`.

Auditor probe with the same sign-in token (page did not do this):

- `GET /api/read/portal-summary` → **200** keys: `ok`, `prequal_amount`, `prequal_display`, `soft_pull_complete`
- `GET /api/read/portal-contracts` → **200** keys: `ok`, `count`, `items` (count **1**)

Not 401. Not an empty API. The page never asked, because it had no file id.

Evidence: `05-portal.json`, `06-fetches.json`, `09-hop.json`

---

## Exact broken hop

**front-end quit**

The sign-in worked. The server handed back TEST’s file id on `account.clientId`. The magic-link page saved only the token. The portal only looks for a file id in the URL or in a saved `fh_account` note. Both were empty, so it painted “We could not load your file” and stopped. Video and n/6 never ran.

Not session missing. Not wrong id. Not API 401. Not API 200 empty.

---

## FAIL — magic-link file paint

- Journey: client sign-in link → own file (Chris’s claim; **MISSING** in `client-intended.md`)
- Step: after the real link, see file / video / n/6
- Expected: TEST name, video or “not available” after a file load, n/6
- Observed: signed in as TEST client; page says it cannot load the file; video missing; no n/6; dispute asks to sign in. Did not press Sign.
- Evidence: `01-file-paint.png`, `05-portal.json`, `09-hop.json`

---

## Live-file guard

- Live file new events (20 min): **0**
- Live file new messages (20 min): **0**
- Opened live: **false**

Evidence: `08-live-guard.json`, `01-align.json`
