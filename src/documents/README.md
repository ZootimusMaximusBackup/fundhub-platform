# `src/documents/` — documents registry + object storage

Generated artifacts had nowhere to live. Letters, deliverables, contracts and
soft-pull authorizations were produced and delivered but never stored: DS-02
POSTs a letter pack to underwrite-iq-lite and keeps a boolean in
`clients.custom_fields`, the UnderwriteIQ deliverables are emailed, consent is a
custom field rather than a signed record. A client could not re-access anything
they paid for, and none of it had an audit trail.

This module is where artifacts live. Schema: `db/migrations/030_documents.sql`.

## Shape

```
documents           one row per LOGICAL document (document_key), carrying a
                    denormalized snapshot of its current version
document_versions   append-only history — every generation, immutable
```

Regeneration **appends a version**. It never overwrites, so a client keeps
access to the exact bytes they were sent. That is enforced by the database
(delete-blocking triggers on both tables, plus an immutability trigger on the
stored-artifact columns), not by convention in these files.

| File | Owns |
|---|---|
| `kinds.mjs` | the taxonomy: four `kind` classes, the conventional `subtype` vocabulary, `buildDocumentKey()` |
| `store.mjs` | object storage behind a provider interface; content-addressed keys |
| `register.mjs` | recording a document; idempotent on `source_event_id` |
| `retrieve.mjs` | reads — newest version by default, full history on request |
| `signed-url.mjs` | short-lived HMAC-signed download links |
| `fake-db.mjs` | test double (not production code) |

## Writing a document

```js
import { storeFromEnv, storeAndRegister, KINDS } from "./documents/index.mjs";

const store = storeFromEnv();

const { document, version } = await storeAndRegister(db, store, {
  orgId, clientId,
  kind: KINDS.DELIVERABLE,
  subtype: "credit_analysis_report",
  body: pdfBytes,                 // Buffer | Uint8Array | string
  mimeType: "application/pdf",
  generatedBy: "u-02-analyzer-complete-delivery",
  sourceEventId: event.id         // ← replay safety (Rule 9)
});
```

Pass `sourceEventId`. It is what makes a replayed generation event produce one
document instead of two — checked before any write and backstopped by a unique
index. Without it every call is treated as a genuine new generation.

Idempotency is scoped **per document**, not per event, so one
`analysis.completed` can generate all five UnderwriteIQ deliverables under the
same event id in a single pass. What it cannot do is append two versions to the
same document.

Documents that are **not** one-per-client (per funding round, per invoice, per
dispute cycle) need a `discriminator`, or their versions collapse into one
another:

```js
await storeAndRegister(db, store, { ..., subtype: "funding_snapshot", discriminator: fundingRoundId });
```

Then `markDelivered(db, { documentId, channel: "email" })` and
`markSigned(db, { documentId, signerName })` as the lifecycle progresses. Both
are idempotent; delivery only moves forward, so a replayed `sent` cannot walk a
`delivered` document backwards, and the first signature on a version wins.

## Reading

```js
// the client portal's main read — ONE query, newest version each
const library = await listClientLibrary(db, {
  orgId, clientId,
  sign: { secret, baseUrl: "https://app.fundhub.com" }
});

// by client + kind, newest version by default
const { document, history } = await getByClientAndKind(db, {
  orgId, clientId, kind: "deliverable", history: true
});
```

`listClientLibrary` is one statement because `documents` already carries the
current-version snapshot — no per-document follow-up. **Entitlements** (session
G, wave 2) join on `documents.id`; to keep the entitlement check a single round
trip too, pass the permitted ids as `documentIds` and the filter happens in the
same query. Expired documents are returned with `expired: true` rather than
hidden — an expired authorization is still something the client owns — and
`includeExpired: false` drops them.

## Storage keys never leave this module

Every read path strips `storage_key` and hands out a signed URL instead. This
matters more than it looks: under Vercel Blob the storage key **is** a public,
permanent, unguessable URL, so passing one to a template or a portal payload
hands out a permanent bearer credential to that document — revocable only by
deleting the object, which the registry forbids.

`resolveStorageTarget()` is the single exception and exists for the download
route alone.

Links are **version-pinned**: a link emailed on Tuesday keeps resolving to the
bytes that were current on Tuesday, even after a regeneration.

### The route this needs

`api/` is owned by another session, so the download route is not built here.
`signed-url.mjs` provides both halves; the handler is about twenty lines:

```js
const v = verifyDocumentRequest(req.url);            // signature, then expiry
if (!v.valid) return res.status(404).end();          // 404, not 403 — do not confirm existence
const target = await resolveStorageTarget(db, v);    // ← the only storage_key read
const object = await store.get(target.storage_key, { expectedChecksum: target.checksum });
res.setHeader("content-type", target.mime_type);
res.end(object.body);
```

The route must never put `target.storage_key` in a response body, a redirect
`Location`, a log line, or a template.

## Configuration

| Env var | Purpose |
|---|---|
| `DOCUMENT_STORE_PROVIDER` | `memory` (default) or `vercel-blob` |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob credential — required when that provider is selected |
| `DOCUMENT_URL_SECRET` | HMAC key for signed URLs, >= 32 chars (`openssl rand -hex 32`). Fails closed if unset. |

None of these are in `.env.example` yet — that file belongs to another session.

**`@vercel/blob` is deliberately not a dependency.** `package.json` is owned by
another session, so the SDK is imported lazily: selecting the provider without
it installed fails with an actionable message instead of breaking module load
for everyone else. Whoever adds `npm i @vercel/blob` should also set
`BLOB_READ_WRITE_TOKEN`. The three SDK call shapes (`put`/`del`/`head`) match
the API as used by underwrite-iq-lite but have not been exercised against the
live SDK from this repo — verify with one real round-trip before it carries
production traffic (same `⚠️ CONFIRM` posture as `src/adapters/`).

The in-memory provider is the **default**, so tests and local runs never need a
storage vendor configured. It warns if it is somehow selected in production.

Adding a provider (S3, R2, GCS) is one function implementing
`{ name, put, get, del, exists? }` — nothing above `store.mjs` changes.

## Two flags

**Retention — not implemented, deliberately.** Credit-adjacent documents (soft-pull
authorizations above all, plus dispute letter packs and anything derived from a
credit pull) almost certainly carry a statutory minimum retention. That is a
legal determination, so no policy is coded and nothing here expires or prunes
anything. `expires_at` is document *validity*, not a deletion clock, and nothing
reads it as one. Needs Chris + counsel. Full note in the migration header.

**Canonical events.** `document.generated`, `document.delivered` and
`document.signed` are proposed in `PROPOSED-EVENTS.md`, not added —
`src/events/canonical.mjs` is untouched. Nothing here depends on them existing.

## Tests

```sh
npm test                                    # unit tests, no database needed
DATABASE_URL=postgres://... npm test        # adds the real-Postgres integration test
```

`documents.pg.test.mjs` is the authoritative check for what a stub cannot model:
the real column lists never return `storage_key`, the unique indexes really do
absorb a replayed event, the delete guards and immutability trigger really do
fire, and the portal read really is one statement. It runs inside a transaction
that is rolled back — necessary rather than tidy, since the tables block
`DELETE` and a committing test could never clean up after itself.
