# Client file uploads — what was built

Storage decision was made before this build started: **Netlify Blobs**
(`@netlify/blobs`), not S3, not Vercel Blob. Everything below routes through
that.

Full flow: a browser (client portal, or staff on a client's behalf) POSTs a
file → `POST /api/documents-upload` sniffs and validates the bytes → stores
them in Netlify Blobs → registers the upload as a `documents` row through the
**existing** documents registry (`src/documents/register.mjs`) → mints a
signed download link → emits `docs.received` on the event bus.

## Two decisions made without asking, and why

**1. The event is `docs.received`, not `docs.uploaded`.**

The build brief said "emit `docs.uploaded`... workflows already reference a
`docs:uploaded` trigger." That trigger does not exist — grepped the whole
repo (`docs.uploaded`, `docs:uploaded`, case-insensitive) and found nothing.
What *does* exist is `docs.received`, already a canonical event
(`src/events/canonical.mjs`), already consumed by
`src/workflows/f-06-funding-conditions-missing-docs.mjs` to clear a client's
"Missing Documents" hold — which is exactly the real-world effect of a client
finishing an upload. Inventing a second, non-canonical event name would have
both duplicated that and left F-06 listening to nothing. `canonical.mjs`
itself says new event names are proposed, not added unilaterally
(`src/documents/PROPOSED-EVENTS.md`); `docs.received` sidesteps that question
entirely by reusing what's already there.

**2. Uploads got a fifth `documents.kind`: `client_upload`.**

`src/documents/PROPOSED-EVENTS.md` says the documents registry "stores what
the platform PRODUCES," and draws a line between that and documents "coming
IN from a client." The build brief overrides that line directly — "write the
blob reference as `storage_key` via the existing register.mjs path" — and the
four existing kinds (`authorization`, `contract`, `invoice_document`,
`deliverable`) don't fit a client-uploaded bank statement or ID photo. Rather
than force-fit one or bypass the registry, `db/migrations/117_client_uploads.sql`
widens the `documents.kind` CHECK to five values. Same table, same versioning,
same signed-download path, one registrar — not a second system.

## What's new

| File | What it does |
|---|---|
| `db/migrations/117_client_uploads.sql` | Adds `kind = 'client_upload'` to the `documents` CHECK constraint. Finds and drops the old constraint by its definition (not a guessed name), so it can't silently no-op. |
| `src/documents/kinds.mjs` | `KINDS.CLIENT_UPLOAD`, subtypes (`id_document`, `bank_statement`, `proof_of_income`, `tax_return`, `other`), titles. |
| `src/documents/store.mjs` | `netlifyBlobsProvider()` — the storage decision. Lazily imports `@netlify/blobs` (actionable error if missing). `storage_key` is `netlify-blob://<store>/<pathname>`, an opaque key, never a public URL. Also: `providerFromEnv()`'s memory branch now shares one `Map` for the process instead of minting a fresh empty one per call — see "A real bug this caught" below. |
| `src/documents/upload-validate.mjs` | `sniffMimeType()` — magic-number detection for jpg/png/pdf. `validateUpload()` — size cap + type check. Nothing here trusts a declared filename or `Content-Type`. |
| `api/documents-upload.mjs` | The endpoint. `POST /api/documents-upload`, multipart/form-data. Serves both `staff` and `client` principals (`requirePrincipal`), same pattern as `api/consent/capture.mjs`. |
| `api/documents/[id].mjs` | Extended, not replaced. Still 302-redirects when `storage_key` is a public URL (Vercel Blob) — the existing test for that keeps passing unchanged. Now ALSO streams bytes through `store.mjs` when the key is opaque (Netlify Blobs, the in-memory test provider) — that path did not exist before; it 501'd. |
| `netlify/functions/api.mjs` | Multipart bodies now go through `request.formData()` instead of `request.text()` — `.text()` runs bytes through `TextDecoder`, which is lossy for anything that isn't valid UTF-8 (i.e., almost every jpg/png/pdf). Route added at `documents-upload` (see below for why not `documents/upload`). |
| `public/app/data.js` | `FHData.uploadFiles(path, files, fields)` — the multipart POST helper, same `{ok, source, data, error}` contract as `get()`/`write()`. |
| `public/app/client-portal.html` | The existing "Upload Documents" card's send button was a `setInterval` fake progress bar with no backend call. Now calls `FHData.uploadFiles`; falls back to the old simulated flow only when there's no resolvable client id (sample/demo mode — same posture as the rest of the file). |
| `public/app/client-control-panel.html` | New "Documents" collapsible group with a drop zone — staff uploading on a named client's behalf, from the same client screen. Posts to the same endpoint. |
| `src/documents/upload-validate.test.mjs`, `src/documents/store.test.mjs` (extended), `src/http/documents-upload.pg.test.mjs` | Tests — see below. |

### Why the route is `/api/documents-upload`, not `/api/documents/upload`

`netlify/functions/api.mjs` reaches the signed-download route
(`api/documents/[id].mjs`) via a **prefix** branch: any path starting with
`documents/` that isn't an exact `ROUTES` key gets treated as a document id.
`src/http/routes.test.mjs` has a test that deliberately fails on any exact
`ROUTES` key under that prefix, because such a key's correctness would depend
on the exact-match lookup always running before the prefix branch — true
today, but not asserted anywhere except by that ordering. Rather than fight
the test (or weaken it), the handler file lives flat at
`api/documents-upload.mjs` and routes at the key `documents-upload`. No
ambiguity, no reliance on lookup order.

### A real bug this caught

`storeFromEnv()` (the normal way anything gets a store) called
`memoryProvider()` fresh on every invocation, and the default in-memory
provider allocates its own empty `Map` unless told otherwise. Two callers —
the upload handler storing bytes, the download route reading them back a
moment later — each called `storeFromEnv()` independently and got two
*different* empty stores. A document would register successfully, mint a
signed link, and that link would immediately 404, because the bytes were
sitting in a `Map` nobody but the upload call could see. This didn't show up
before because nothing had exercised the memory-provider round trip
end-to-end across two separate handler invocations in one process — every
prior document test either stayed inside one call or used a fake `https://`
storage key and never touched `store.get()`. Fixed by giving
`providerFromEnv()`'s memory branch one shared, lazily-created `Map` for the
life of the process; explicit `memoryProvider()` calls (most of
`store.test.mjs`) are unaffected and still get their own isolated store.

## Validation

- **Type**: `sniffMimeType()` checks the file's actual first bytes against
  fixed signatures (`%PDF`, PNG's 8-byte header, JPEG's `FF D8 FF`) — a
  declared `Content-Type` or a `.pdf` filename on a text file is rejected.
  Only `image/jpeg`, `image/png`, `application/pdf` are accepted.
- **Size**: `DOCUMENT_UPLOAD_MAX_BYTES` env var, default 10 MB
  (`DEFAULT_MAX_BYTES` in `upload-validate.mjs`). Not set in any environment
  yet — 10 MB is a reasonable default, not a measured one; raise it if real
  bank statements need more.
- **Auth**: `requirePrincipal(req, res, ["staff", "client"])`. A client
  principal's own `clientId` is used regardless of what the form claims (a lie
  in the `client_id` field is ignored, tested). A staff principal must name a
  `client_id` and that client must belong to the staff member's own org (404
  otherwise, not 403 — doesn't confirm the client exists in another org).
- **One document per file**: each upload gets its own random discriminator
  (`crypto.randomUUID()`), so two files never collapse into one
  `document_key` and overwrite each other's "current version."

## What's NOT done / left for a human

- **`DOCUMENT_STORE_PROVIDER=netlify-blobs` is not set anywhere.** Per
  CLAUDE.md §11, setting env vars and deploying are normally mine to do
  without asking — but `api.netlify.com` is blocked by this environment's
  network policy (confirmed: it's in the explicit blocked-host list), so I
  cannot run `netlify env:set` or `netlify deploy` from this session. Someone
  with Netlify CLI access needs to run:
  ```
  netlify env:set DOCUMENT_STORE_PROVIDER "netlify-blobs" --context production --context deploy-preview --context branch-deploy
  netlify env:set DOCUMENT_URL_SECRET "$(openssl rand -hex 32)" --context production --context deploy-preview --context branch-deploy --secret
  netlify deploy --build --prod
  ```
  (`DOCUMENT_URL_SECRET` may already be set from an earlier session — check
  before overwriting; regenerating it invalidates every outstanding signed
  link.) Until `DOCUMENT_STORE_PROVIDER` is set, the deployed app falls back
  to the in-memory provider, which does not survive a cold start —
  `storeFromEnv()` already warns about this in production logs.
- **`117_client_uploads.sql` needs to be applied to the real database.**
  Same CLAUDE.md §11 rule — normally mine to run
  (`DATABASE_URL="$(netlify env:get DATABASE_URL --context production)" node db/migrate.mjs`)
  — but that also goes through `api.netlify.com` to fetch the connection
  string, which is blocked here for the same reason. I migrated and ran the
  full test suite against a local disposable Postgres 16 instead (see Test
  results below) to prove the migration and every code path actually works;
  someone needs to run the real migration against the production database
  separately.
- **No real Netlify Blobs round-trip has been run.** The `netlifyBlobsProvider`
  is exercised against a fake in-memory SDK in `store.test.mjs` (matching the
  existing `vercelBlobProvider`'s test posture, and its own header note:
  "⚠️ CONFIRM before cutover"). Verify one real put/get against a live Netlify
  Blobs store before this carries production traffic.
- **jpg/png/pdf only, 10 MB cap** — both are my calls, not measured
  requirements. If clients need to send `.docx` bank statements or larger
  scans, that's a scope change, not a bug.

## Tests

- `src/documents/upload-validate.test.mjs` — unit: magic-number sniffing
  (real pdf/png/jpg accepted, a renamed `.txt` rejected even with a lying
  `Content-Type`), size cap (under/at/over), `DOCUMENT_UPLOAD_MAX_BYTES`
  override and its fallback on garbage input.
- `src/documents/store.test.mjs` — extended: `netlifyBlobsProvider` put/get
  round-trip (text AND raw binary bytes, byte-for-byte), unknown-key → null,
  a storage key from a different provider is refused rather than silently
  misread, exists()/del(), missing-`@netlify/blobs` fails with an actionable
  message, `DOCUMENT_STORE_PROVIDER=netlify-blobs` selects it.
- `src/http/documents-upload.pg.test.mjs` — end-to-end against the real
  Netlify handler + real Postgres (`DATABASE_URL`, skips without it — this is
  why `npm test` alone won't run it): auth required, client uploads their own
  document, a client's lie about `client_id` in the form is ignored, staff
  uploads on a named client's behalf, staff must name a client, staff cannot
  reach a client outside their org, unknown subtype falls back to `other`,
  invalid file type rejected (bytes-based, not filename-based), oversized
  file rejected, no file in the request is a 400, **the signed download link
  returned by the upload actually resolves and returns byte-identical
  bytes** (pdf and png), a successful upload emits exactly one `docs.received`
  event naming the right document/client, two uploads from the same client
  produce two distinct documents (never collapse into one).

### Test results

`npm run lint`: clean, 693 files.

`npm test` with `DATABASE_URL` unset (this sandbox's default — see CLAUDE.md
§12): 3862 pass, 0 fail, 481 skip (442 of the skips are pre-existing
`.pg.test.mjs` files that need a database; my new pg test is one more).

`npm test` against a real local Postgres 16 (migrated with `MIGRATION_DATABASE_URL`
as the table owner, then run with `DATABASE_URL` pointed at the unprivileged
`fundhub_app` role for the general suite and at the owner role for two
pg-test files whose cleanup needs `ALTER TABLE ... DISABLE TRIGGER`, matching
the existing `src/documents/download-route.pg.test.mjs` pattern — an
unprivileged connection cannot run those regardless of this change): every
new test passes. 17 pre-existing suites still fail — **identical set, by
name, to a clean checkout of the branch's base commit run against the same
database** (verified with a throwaway `git worktree` at the base commit
before this build; diffed the two failure lists). None of the 17 touch
documents, storage, or uploads. Not caused by this change; not fixed by it
either — out of scope.
