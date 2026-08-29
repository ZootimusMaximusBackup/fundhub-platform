# Fix 3 — download links for saved files — agent-f3

Status: **done**. Branch `worktree-agent-ae9e930c4a2d7cc08`, own worktree, never `main`.

## The problem, in one line

A saved file got ONE working link, minted in the reply to its own upload, dead
fifteen minutes later. After that nobody could open it — not the client, not
staff.

## What was already built (this matters — most of it was already paid for)

The coordinator's first brief said the download path did not exist. That was only
half right, and the correction it sent later was closer. Traced properly:

| Piece | State before this work |
|---|---|
| Client portal front end | **Already built.** `paintDocs()` in `public/app/client-portal.html` has always rendered `d.download.url` as a link and falls back to plain text without one. |
| Signing layer | **Already built.** `shapeDocument()` in `src/documents/retrieve.mjs` attaches exactly that shape. |
| `read/portal-summary` route | **Already routed.** |
| The signed download route | **Already built.** `api/documents/[id].mjs`, reached by the `documents/` prefix branch. |
| `api/read/portal-summary.mjs` | **The gap.** Hand-written SELECT over `documents`; signed nothing, so `download` was undefined on every row. |
| Staff Documents desk | **The other gap.** `public/app/documents.html` reads `/api/read/documents`, which signs nothing. No way to download at all. |

So the client side was one file. The staff side was genuinely missing.

## What I changed

### Client side — one file, zero front-end change

`api/read/portal-summary.mjs` now calls `listClientLibrary()` (one of the four
readers in `retrieve.mjs` that had **zero callers** anywhere in `src/`, `api/` or
`scripts/`) with signing on. `public/app/client-portal.html` is **byte-for-byte
unchanged** — verified with `git diff`.

**The rows are narrowed back down, and that is the security-relevant half.**
`listClientLibrary` selects the registry's full public column set, which carries
`metadata` — for an upload that holds the original filename and an `uploaded_by`
object naming the **staff member's id** — plus `checksum`, `generated_by`,
`signature_ref`, `org_id` and `current_version_id`. None of that was in this
response before and none of it belongs to a consumer. An explicit allow-list
(`portalDocuments()`) projects each row back to exactly the fields it returned
yesterday, plus `download`. Sort order (`created_at DESC`) and `LIMIT 50` are
preserved, so the only visible change on that screen is that titles are links.

An **expired** document gets no link — `api/documents/[id].mjs` refuses one
anyway, and a control that cannot finish is worse than none. The row still shows.

### Staff side — a new endpoint, wired into the existing desk

`GET /api/documents-download?id=<uuid>` mints **one fresh link per click**.
A `Download` button was added inside the **existing** Document cell on
`public/app/documents.html`. No new page, screen, tab or menu row.

**Click-time rather than list-time, deliberately.** That screen asks for 200 rows.
Signing the list would mint up to 200 live bearer credentials to credit reports
and photo IDs on every page load, whether or not anyone clicked, and drop them
into any log or cache holding a copy of that response. The original brief also
said in terms: `api/read/documents.mjs` strips `storage_key` via `redact()` —
do not undo that; add a separate, properly-gated way to fetch the bytes.
`api/read/documents.mjs` is untouched.

## Files touched

| File | Change |
|---|---|
| `api/documents-download.mjs` | **NEW** — mints a fresh signed link for one saved document. |
| `api/read/portal-summary.mjs` | Documents read now goes through `listClientLibrary()` with signing; new `portalDocuments()` allow-list narrows the rows back. |
| `api/documents-upload.mjs` | Local `baseUrlFrom` replaced by the shared `baseUrlFromRequest` — reuse, not a second copy. |
| `src/documents/signed-url.mjs` | **New export** `baseUrlFromRequest(req)`. |
| `netlify/functions/api.mjs` | Import + `ROUTES["documents-download"]`. |
| `src/pulse/registry.mjs` | `documents-download` added to `API_KEYS`. |
| `public/app/documents.html` | `dlCell()`, `ACT.download`, `data-dl` branch in the existing delegated listener, `file:` on the row model. |
| `public/app/data.js` | **New helper** `FHData.documentDownload(id)`. |
| `src/http/documents-download.pg.test.mjs` | **NEW** — 26 tests covering both surfaces. |
| `src/http/simplify-implementation.test.mjs` | One assertion updated to the new call shape — **strengthened, not weakened** (5 params pinned instead of 2). |
| `docs/journeys/*-actual.md` | Regenerated (`npm run journeys`). |
| `docs/journeys/CHANGELOG.md` | One line appended. 223 → 224 lines, checked. |

### Exports added

* `src/documents/signed-url.mjs` → `baseUrlFromRequest(req)`
* `public/app/data.js` → `FHData.documentDownload(id)`
* `api/documents-download.mjs` → `default` handler

### Routes affected

* **Added** `GET /api/documents-download` — staff + client principals.
* **Changed payload only** `GET /api/read/portal-summary` — each document row
  gains `download`. No gate change, no new field otherwise.

### Journeys impacted

`client` and all six role journeys — regenerated, one new row each:
`/api/documents-download | GET | staff, client`.

## Security notes

* **Route key is `documents-download`, not `documents/download`.**
  `src/http/routes.test.mjs` refuses any exact ROUTES key sitting under the
  `documents/` prefix branch, because it would depend on lookup order.
* **Two gates, not one.** `requirePrincipal(["staff","client"])` first, then a
  **separate** `requireRole(res, staff, ROLE_SETS.STAFF)` — `requireAuth`
  forwards opts to `authenticate()`, which reads only `{db, env}`, so a `roles`
  key there is silently dropped (CLAUDE.md §12).
* **Tenancy comes from the session, never the query string.** The org is passed
  into the reader; `getDocument`/`listClientLibrary` put it in the WHERE clause.
  `src/http/read-api.mjs:150-153` records that decision going unimplemented in
  ten endpoints while the comment stayed — neither of these is the eleventh.
* **A client must own the document.** Every client of a company shares its org,
  so the org clause alone would let any client open any other client's credit
  report. Both paths check ownership on top of the org.
* **One identical 404** for unknown id, wrong company and wrong client, so
  neither endpoint is an inventory oracle. Pinned byte-for-byte by a test.
* **Fail closed with no `DOCUMENT_URL_SECRET`** — and on the portal it fails
  closed on the **link**, not the **page**: a missing secret used to be able to
  take the client's scores, pre-qual and upload doors down with it.
* **TTL: 15 minutes (`DEFAULT_TTL_SECONDS`) on both**, and the query string
  cannot ask for longer — pinned by a test. Deliberately not the 7-day
  `MAX_TTL_SECONDS`; that is for a link inside an email that has to survive a
  weekend, not for a page the reader already has open.
* **Nothing is logged** — no filename, no storage key, no URL.
* **`storage_key` never leaves.** Never selected, deleted again by
  `shapeDocument`, and asserted absent from the whole serialized body.
* **Both answers are narrowed by an explicit allow-list.** `getDocument()` and
  `listClientLibrary()` return the registry's full public column set, which
  carries `metadata` (holding an `uploaded_by` object with a **staff member's
  id**), `checksum`, `generated_by`, `signature_ref` and `org_id`. Both
  endpoints answer a CLIENT, and a consumer opening their own bank statement
  has no reason to learn which employee filed it. Two tests fail if anybody
  stops narrowing either response.

## For agent-f1 — minting a link from server-side code

You do **not** need my HTTP endpoint. Both paths go through the same one
function, and it is callable from any server-side module:

```js
import { getDocument } from "../documents/retrieve.mjs";

const doc = await getDocument(db, {
  orgId,                       // REQUIRED — null means "any org". Never pass null.
  documentId,
  sign: { ttlSeconds: 60 * 60 * 24 * 7,      // up to MAX_TTL_SECONDS (7 days)
          baseUrl: "https://fundhub.ai" }    // absolute, or the link is relative
});

doc.download.url;         // the link
doc.download.expiresAtIso;
```

For a whole client's library in one query, `listClientLibrary(db, { orgId,
clientId, sign: {...} })` — it throws without both keys, which is the behaviour
you want.

Three things to hold onto:

1. **`orgId` is the tenancy gate.** Passing `null` reads across every company.
2. **For an email, use a long TTL** — the 15-minute default will be dead before
   the mail is read. `MAX_TTL_SECONDS` is 7 days and `signDocumentUrl` throws
   above it.
3. **`baseUrl` is required for anything that leaves the page.** Without it you
   get a relative path, which is correct in a browser and useless in an email.
   If you have a request in hand, `baseUrlFromRequest(req)` from
   `src/documents/signed-url.mjs`.

## Verification

* `npm run lint` — clean, 1596 files.
* `npx tsc --noEmit` — exit 0 (note: no tsconfig include set, so this checks
  very little; not a real gate in this repo).
* `npm test` — see the count and the honest caveat in the report.
* `src/http/documents-download.pg.test.mjs` — **26/26 pass** against a scratch
  Postgres 16 (`fh_f3_dl`, 216 migrations applied to an empty database).
* Playwright — staff desk and client portal driven in a real browser against a
  local dev server on the scratch database.

## Findings — reported, not fixed (out of scope)

1. **`docs/journeys/CHANGELOG.md` has a stray `<<<<<<< HEAD` merge-conflict
   marker committed on `main`, at line 3**, with no matching `=======` or
   `>>>>>>>`. Pre-existing; confirmed with `git show main:`. Left alone — other
   agents are appending to this file and a fix here would collide.
2. **`getByClientAndKind`, `getHistory` and `getVersion` in
   `src/documents/retrieve.mjs` still have zero callers.** `listClientLibrary`
   now has one. The other three stay uncalled because no shipped screen asks for
   a document by kind or for its version history — inventing a caller to retire a
   warning would be building a surface nobody asked for.
3. **The staff Documents desk shows a Download button only where the row has
   bytes** (`mime_type` present). A document registered but never generated gets
   no button rather than a click that 404s.
