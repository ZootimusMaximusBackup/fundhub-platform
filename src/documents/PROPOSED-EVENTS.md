# Proposed canonical events — documents

**Proposal only. `src/events/canonical.mjs` has not been edited.**

The documents registry needs three event names that do not exist in
`CANONICAL_EVENTS` today. Per the build rules they are proposed here rather than
added unilaterally — `canonical.mjs` is the spec §4 event spine and adding to it
is Darwin's call.

**Nothing in `db/migrations/030_documents.sql` or `src/documents/` depends on
these existing.** Every function takes its inputs as arguments and is driven by
whoever wires the handlers. These are what those handlers would naturally emit.

---

## What already exists and is nearly enough

| Existing event | Relationship to documents |
|---|---|
| `letter.generated` | The closest existing name. It is *specifically* about dispute letters (DS-02 / the Metro 2 pack) and says nothing about where the artifact went. A letter pack is one of twelve document subtypes; `document.generated` is the general fact and `letter.generated` is a special case of it. |
| `docs.received` | The opposite direction — documents coming IN from a client or bank (bank statements, ID). This registry stores what the platform PRODUCES. Worth keeping distinct; conflating them would put client uploads and generated deliverables in one stream. |
| `invoice.created` / `invoice.sent` | About the invoice RECORD (money owed, `invoices` table), not the rendered artifact. An `invoice_document` is the PDF of one. |

So: no existing name covers "an artifact was produced and stored".

---

## Proposed

### `document.generated`

Emitted after `registerDocument()` commits — the artifact exists and is
re-accessible. This is what a portal "new document available" notification and
the §14 telemetry counters hang off.

```jsonc
{
  "name": "document.generated",
  "version": 1,
  "idempotency_key": "document|<document_id>|v<version>",
  "client_id": "<uuid>",
  "payload": {
    "document_id": "<uuid>",
    "version_id": "<uuid>",
    "version": 2,
    "document_key": "deliverable|credit_analysis_report|<client_id>",
    "kind": "deliverable",
    "subtype": "credit_analysis_report",
    "title": "Credit Analysis Report",
    "mime_type": "application/pdf",
    "byte_size": 184320,
    "checksum": "sha256:<hex>",
    "generated_by": "u-02-analyzer-complete-delivery",
    "generated_at": "2026-07-28T12:00:00Z",
    "signature_required": false,
    "regenerated": true,          // version > 1 — supersedes, never overwrites
    "supersedes_version": 1
  }
}
```

No `storage_key` in the payload — deliberately. Under Vercel Blob the storage
key is a permanent public URL, so an event payload carrying one would put a
bearer credential into the append-only events table forever. Consumers that need
bytes call `retrieve.resolveStorageTarget()` or take a signed URL.

The idempotency key is `document|<document_id>|v<version>`, which is stable under
replay: the registry has already deduped on `source_event_id`, so a replayed
generation event resolves to the same `(document_id, version)` and the events
table's unique index absorbs the duplicate. Replay-safe end to end (Rule 9).

### `document.delivered`

Emitted by `markDelivered()` when a version actually goes out. Distinct from
`message.*`: the message is the envelope, this is the artifact inside it.

```jsonc
{
  "name": "document.delivered",
  "version": 1,
  "idempotency_key": "document.delivered|<version_id>|<delivery_status>",
  "client_id": "<uuid>",
  "payload": {
    "document_id": "<uuid>",
    "version_id": "<uuid>",
    "version": 2,
    "kind": "deliverable",
    "subtype": "metro2_dispute_letter_pack",
    "delivery_channel": "email",     // email | sms | portal | api | manual | print
    "delivery_status": "delivered",  // pending | sent | delivered | failed | bounced
    "delivered_at": "2026-07-28T12:05:00Z",
    "message_id": "<uuid|null>"      // link to messages(id) when it went out as one
  }
}
```

The key includes the status so a `sent` → `delivered` → `bounced` progression
emits three distinct events rather than being swallowed as a duplicate.
`markDelivered()` already refuses to walk a delivery backwards, so the sequence
is monotonic apart from failures.

### `document.signed`

Emitted by `markSigned()`. The one that unblocks two things nobody can do today:
gating funding on a countersigned agreement, and gating affiliate payouts on a
current partner license.

```jsonc
{
  "name": "document.signed",
  "version": 1,
  "idempotency_key": "document.signed|<version_id>",
  "client_id": "<uuid>",
  "payload": {
    "document_id": "<uuid>",
    "version_id": "<uuid>",
    "kind": "contract",
    "subtype": "partner_license",
    "signer_name": "Jane Partner",
    "signature_ref": "<external e-sign envelope id|null>",
    "signed_at": "2026-07-28T12:30:00Z",
    "expires_at": null
  }
}
```

One key per version, because the first signature wins — `markSigned()` will not
overwrite one, so a version can only ever emit this once.

---

## Two questions rather than assumptions

1. **`letter.generated` — keep, or fold in?** DS-02 emits it today for the Metro
   2 pack. Once letter packs are registered documents, that pack also produces a
   `document.generated` with `subtype: "metro2_dispute_letter_pack"`. Keeping
   both means one artifact fires two events. Recommendation: **keep**
   `letter.generated` (existing handlers depend on it, and the events table is
   append-only history that should not be rewritten), but treat
   `document.generated` as the general fact going forward and stop adding new
   consumers to `letter.generated`.

2. **`document.expired`?** Deliberately NOT proposed. `expires_at` is document
   validity, not a deletion clock, and nothing in this module sweeps for expired
   rows — that would need a scheduled job, and the retention question behind it
   (see the flag in `030_documents.sql`) is unanswered. If a soft-pull
   authorization expiring needs to *drive* something, that is a real event worth
   adding then, with a real policy behind it.

---

## Summary for `canonical.mjs`, if approved

```js
// documents
"document.generated",
"document.delivered",
"document.signed",
```

Three names, in a new `// documents` grouping alongside the existing
`// side events` block — none of them is part of the journey spine.
