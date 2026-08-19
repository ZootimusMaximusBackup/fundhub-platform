## T1 — Client Portal & welcome video — change manifest (wave 2)

**Branch** `fix/T1-client-portal-video`, cut from `origin/main` @ `c860b8c`.
**Evidence** `docs/workflows/fix-2026-08-18/evidence/T1/` — start at `SUMMARY.md`, written for a non-coder.

### Files touched — all within T1's ownership

| File | What changed |
|---|---|
| `public/portal-login.html` | Stores the `account` the verify endpoint already returns (and the role hint). **This one missing write was the root cause of four headline items.** No API shape changed. |
| `public/app/client-portal.html` | One shared `/api/auth/session` read; client file id now also resolvable from the session; the early refusal moved behind that answer; dispute card waits for the id; welcome-video hero now performs a real read; dead "Download ↓" button replaced with honest text |
| `public/app/content-admin.html` | Two CSS lines — phone overflow (T0's request, closed above) |
| `api/content/welcome-video.mjs` | **NEW** — the client-readable welcome video read |
| `src/content/welcome-video.mjs` | **NEW** — tier→video resolution and the signed playback link |
| `api/content/tiles.mjs` | Swallowed catches narrowed to one SQLSTATE each; false save message corrected |
| `src/http/content-tiles.test.mjs` | 11 tests added. No assertion deleted or weakened. |
| `netlify/functions/api.mjs` | **APPEND-ONLY** — one import + one ROUTES key |

### Routes added
`content/welcome-video` → `api/content/welcome-video.mjs`. Gate: `requirePrincipal(["staff","client"])`,
a client pinned to their own session (a `?client_id=` in the address bar is not read for a client).
A second mode serves bytes on a signed link with no session, exactly as `api/documents/[id].mjs` does.

### Journeys
`client` — no route the journey did not already name; regenerated with `npm run journeys`, changelog appended.

### Menu rows needed from T0
**None.** T0's `a749196` already landed `content-admin.html` in `ALL` + `OWNER_ADMIN_ONLY`, the Content
sidebar row, and the signed-out-client → `/portal-login.html` redirect. Verified present; not re-fixed.

### Already fixed before this thread started — proven live, not assumed
- **T1-01** (portal fails when staff open it) — fixed by `80d4d3d`. Owner walk now paints "Welcome back, TEST".
- **T1-06 (half)** — Content Admin is reachable and boots. The "boot-order bug" named in the prompt
  **does not exist** on `origin/main`: `content-admin.html` already has a re-arming `DOMContentLoaded`
  guard (`1f36677`). The screen was stuck because `shell.js` bounced the owner out, which T0 fixed.

### Blockers — no code change fixes these
1. **`DOCUMENT_STORE_PROVIDER` is not set.** `src/documents/store.mjs` defaults to an in-process `memory`
   Map, so an uploaded video's row survives while its bytes die with the lambda. **A welcome video
   cannot play in production until this is switched on.** Owner's call; not touched.
2. **`DOCUMENT_URL_SECRET`** must be set or the route answers `503 not_configured`. Check the name
   before touching — regenerating it breaks every document link already sent to a client.
3. **The sign-in email is only `queued`.** Message row `d55a805d-…`, `status=queued`, `provider=internal`.
   Nothing dispatches it — that is T5/T6. T1 proved its own fix by reading the token from the message
   row; true end-to-end mail is T17's.

### Open questions for the owner — build is blocked on these, not on code
1. **Which fact picks a client's welcome video?** Nothing in the code maps a client to a tier. Content
   Admin offers product codes; the portal knows none of them. Shipping serves the **Default** mapping only.
2. **Should a client read their own chat history?** No intended journey names it. Designed, deliberately
   not built (CLAUDE.md §4).
3. **Offers 1 / 2 / 3 / 5** (credit score + inquiries, funding applications, dispute-letter status, the
   mini course) — all four need a client-facing surface that does not exist. Not wiring gaps.

### Found and deliberately not touched
- `client-portal.html`'s **upload card** has a third copy of the same id resolver, so a magic-link client
  still sees "Uploads are off". Fixing it needs either a second session round trip or DOM-listener
  ordering tricks; it is not on T1's item list. **Reported, not built.**
- `api/content/tiles.mjs` **write side**: if the tile UPDATE fails for any reason it silently re-runs
  without the price column, so a price the owner typed is discarded and the save reports success.
  Pre-existing, money-adjacent, outside T1's items.
- `shell.js signOut()` does not clear `fh_account`, so one person's file id can outlive their session
  on a shared browser. T0's file.
