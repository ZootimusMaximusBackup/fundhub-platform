# Company Brain — chat rebuild + upload + approval gating

**Batch:** `company-brain-chat-2026-08-17`
**Owner ask (2026-08-17):** "Company Brain is a tiny box floating in a mostly empty page.
It should be a full ChatGPT-style chat interface — full width, room to read, proper message
history. It needs document upload and the ability to ask questions against loaded documents,
with approval gating. Standing GO on any endpoint this needs. No invented data."

**Ground workflow (W1) is complete.** The contracts in §3 are FROZEN. Build against them.
Do not redesign them. If one is wrong, write the problem in §6 and stop — do not improvise
a different shape, because three other workflows are building against it right now.

---

## 1. Task rows

| ID | Task | Owner | Status |
|---|---|---|---|
| W1 | Ground: read the code, freeze contracts, write this board | main session | **done** |
| W2 | Chat screen rebuild — `public/app/company-brain.html` | agent | **claimed** |
| W3 | Upload + ingest — new endpoint, new migration, reuse pipeline | agent | **done** |
| W4 | Chat history — threads + messages, persist each turn | agent | **done** |
| W5 | Approval gating — uploads unanswerable until owner approves | agent | **done** |
| W6 | Integration: ROUTES wiring, migrations, lint, tests, live capture, deploy | main session | pending |

---

## 2. Shared brief — what ALREADY EXISTS (reuse, do not rebuild)

Company Brain is not a blank page. Most of the engine is built and working. Read this before
you write a line, or you will build a second copy of something that already ships.

### Already built and working

| Thing | File | What it does |
|---|---|---|
| Ask endpoint | `api/read/company-brain.mjs` | POST `{question}` → answer + cited sources. Auth via `requireAuth`, then `requireRole(ROLE_SETS.STAFF)`, then `canQueryBrain(role)`. Role comes from the **session only**. |
| External ask | `api/read/company-brain-affiliate.mjs` | Affiliate/partner path. Allowlist only. **Do not touch it in this batch.** |
| Tier gate | `src/company-brain/access.mjs` | `tiersForRole`, `assertBrainAccess`, `canQueryBrain`. Reuses `ROLE_SETS`. |
| Retrieval | `src/company-brain/retrieve.mjs` | pgvector nearest-neighbour, **filters by tier BEFORE ranking**. |
| Answer | `src/company-brain/answer.mjs` | Claude via `src/agents/model.mjs`. Falls back to extractive text with no key. Returns `{text, thin, source, citations}`. |
| Chunk / embed / store | `src/company-brain/{chunk,embed,store}.mjs` | `chunkText`, `embedTexts` (OpenAI), `upsertExtractedFile`. Store defaults tier to `owner` — fail closed. |
| Extract | `src/company-brain/{extract,office,pdf-text,mime}.mjs` | Text out of pdf / docx / xlsx / pptx / plain text. |
| Classification | `src/company-brain/{classify,review}.mjs` | Proposes a tier. `public`/`sales`/`staff` auto-assign. `owner`/`affiliate` **never** auto-assign — they enqueue a review. |
| Review queue | `api/company-brain/reviews.mjs` | GET pending, POST approve/reject. **Owner role only** — admin deliberately excluded (owner-set H-3, 2026-08-02). |
| Tables | `db/migrations/130..133_company_brain*.sql` | `brain_files`, `brain_chunks`, `brain_classification_reviews`, `brain_affiliate_allowlist`. |
| Screen | `public/app/company-brain.html` | A search box in a small card. This is the thing Chris called a tiny box. |

### Multipart is already parsed for you

`netlify/functions/api.mjs` (≈line 846) parses `multipart/form-data` before a handler sees it.
A handler reads:

```js
req.body.fields   // { name: "value", ... }  plain text fields
req.body.files    // [{ field, filename, mimeType, buffer, size }]  Buffer, bytes intact
```

Do **not** add a multipart parser, and do not add `busboy` or `formidable`. No new dependencies
in this batch.

### The three traps that have cost time here before

1. **A handler file is not a route.** `netlify/functions/api.mjs` holds a hardcoded `ROUTES`
   map. A handler missing from it 404s locally *and* deployed. This has shipped broken twice.
   **In this batch you do NOT edit that file** — see §4. Write your route key into §5 instead.
2. **`npm test`'s glob is `src/**` and `scripts/**` only.** A test placed under `api/` silently
   never runs. Endpoint tests go at `src/http/<name>.test.mjs` and import the `api/` handler.
3. **Editing an applied migration is a silent no-op.** `migrate.mjs` keys each file by
   `<dir>/<file>` in `schema_migrations`. Always add a new numbered file.

### Standing rules for every workflow in this batch

- Role comes from the **session**, never the request body. This is the whole security model.
- **Fail closed.** The only mistake that matters is a document being readable by someone who
  should not see it. When unsure, deny.
- Never weaken, skip, or delete a test to get green.
- No new dependencies. No drive-by refactors. Touch only the files you own in §4.
- No invented data. If a number or a document is not in the database, the screen says so.

---

## 3. FROZEN CONTRACTS

### 3.1 Upload — `POST /api/company-brain/upload` (W3)

Request: `multipart/form-data`, one file per request, field name `file`.
Optional text field `thread_id` (uuid) to tie the upload to a conversation.

Auth: `requireAuth` → `requireRole(res, staff, ROLE_SETS.STAFF)` → `canQueryBrain(staff.role)`.
Reject with 403 `forbidden_role` otherwise. 403 `no_org_scope` when `staff.org_id` is missing.

Accepted types (sniffed from the bytes by magic number, never from the declared header):

| Type | Magic |
|---|---|
| `application/pdf` | `%PDF` |
| `text/plain` (also `.md`) | no signature — accepted when the bytes decode as UTF-8 text |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (docx) | `PK\x03\x04` |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (xlsx) | `PK\x03\x04` |
| `application/vnd.openxmlformats-officedocument.presentationml.presentation` (pptx) | `PK\x03\x04` |

Max size: 25 MB, overridable by env `COMPANY_BRAIN_UPLOAD_MAX_BYTES`.

Success `200`:
```json
{ "ok": true,
  "file": { "id": "uuid", "name": "Closer Script v4.pdf", "mimeType": "application/pdf",
            "sizeBytes": 184213, "source": "upload", "approvalStatus": "pending",
            "chunkCount": 12, "proposedTier": "sales", "reviewId": "uuid",
            "uploadedAt": "2026-08-17T00:00:00.000Z" } }
```

Errors — always `{ "ok": false, "error": "<code>" }`:
`400 no_file` · `400 empty_file` · `413 file_too_large` · `415 unsupported_file_type` ·
`403 forbidden_role` · `403 no_org_scope` · `405 method_not_allowed` · `502 embed_failed`

### 3.2 Uploaded-document list — `GET /api/company-brain/upload` (W3)

Same handler, method branch. Same auth.

```json
{ "ok": true,
  "uploads": [ { "id": "uuid", "name": "Closer Script v4.pdf", "mimeType": "application/pdf",
                 "sizeBytes": 184213, "approvalStatus": "pending", "accessTier": "owner",
                 "proposedTier": "sales", "chunkCount": 12, "uploadedAt": "…",
                 "uploadedByName": "Chris" } ],
  "pendingCount": 1 }
```

### 3.3 Threads — `/api/company-brain/threads` (W4)

`GET` (no query) → newest first, capped at 50:
```json
{ "ok": true, "threads": [ { "id": "uuid", "title": "Rate objections",
    "messageCount": 6, "createdAt": "…", "updatedAt": "…" } ] }
```

`GET ?thread_id=<uuid>` → that thread and its messages in ascending time order:
```json
{ "ok": true,
  "thread": { "id": "uuid", "title": "Rate objections", "createdAt": "…", "updatedAt": "…" },
  "messages": [
    { "id": "uuid", "role": "user", "text": "What is our rate objection script?",
      "sources": [], "answerSource": null, "thin": false, "createdAt": "…" },
    { "id": "uuid", "role": "assistant", "text": "…", "sources": [ /* §3.5 shape */ ],
      "answerSource": "model", "thin": false, "createdAt": "…" } ] }
```

`POST` `{ "title": "optional" }` → `{ "ok": true, "thread": { "id": "uuid", "title": "…" } }`
Title defaults to the first 60 characters of the first question when left empty.

Errors: `400 invalid_thread_id` · `404 thread_not_found` · `403 forbidden_role` ·
`403 no_org_scope` · `405 method_not_allowed`.

Scope: a thread belongs to one org **and one staff member**. A staff member sees only their
own threads. Never another person's.

### 3.4 Ask, with history — `POST /api/read/company-brain` (W4 extends)

Existing request keys (`question`, `limit`) are unchanged. Adds one optional key:

```json
{ "question": "…", "thread_id": "uuid (optional)" }
```

- No `thread_id` → the endpoint creates a thread, titled from the question.
- Both the question and the answer (with citations) are written to `brain_messages`.
- Response gains `"thread_id": "uuid"` at the top level. **Every existing response key stays
  exactly as it is** — `ok`, `question`, `answer{text,thin,source}`, `sources`, `role`.
- If persistence fails, the answer is still returned. A history write must never cost the
  user their answer. Set `"history_saved": false` when that happens.

### 3.5 Source shape (already shipped — do not change it)

```json
{ "n": 1, "fileName": "Closer Script v4.pdf", "webViewLink": "https://…", "driveFileId": "…",
  "accessTier": "sales", "clientId": null, "mimeType": "application/pdf", "excerpt": "…" }
```

For an uploaded file `webViewLink` and `driveFileId` are `null`. The screen must handle that
without printing "null" — show the file name with no link.

### 3.6 Approval gating (W5)

**The rule:** an uploaded document cannot be part of any answer until the owner approves it.

- `brain_files` gains `approval_status` (`pending` | `approved` | `rejected`). Created by
  W3's migration 174 (§3.7) so both workflows can rely on it.
- Rows that exist today, and every future Drive-synced row, are `approved`. **Drive behaviour
  does not change in this batch.** Only uploads are gated.
- Every upload starts `pending` and enqueues a review row, whatever tier was proposed.
- `src/company-brain/retrieve.mjs` adds `AND f.approval_status = 'approved'` to **both**
  queries — staff and affiliate. Filter before ranking, never after generation. The model must
  never receive a chunk from a pending document.
- Approve / reject stays owner-only, through the existing `api/company-brain/reviews.mjs`.
  Admin stays excluded (owner-set H-3).
- Approve → `approval_status = 'approved'` and the approved tier lands on the file **and every
  one of its chunks**. Reject → `approval_status = 'rejected'`, tier stays `owner`, and the
  document never becomes answerable.

### 3.7 Migration numbers — assigned, do not pick your own

| File | Owner | Contents |
|---|---|---|
| `db/migrations/174_company_brain_uploads.sql` | W3 | `brain_files`: `source` (`drive`\|`upload`, default `drive`), `approval_status` (default `approved`), `original_name`, `size_bytes`, `uploaded_by`. Backfill every existing row to `source='drive'`, `approval_status='approved'`. Uploads carry a synthetic `drive_file_id` of `upload:<uuid>` because that column is `NOT NULL UNIQUE(org_id, drive_file_id)`. Grant to `fundhub_app` in the same `DO $$` shape migration 132 uses. |
| `db/migrations/175_company_brain_threads.sql` | W4 | `brain_threads`, `brain_messages`. Org scoped, staff scoped, RLS matching the other tenant tables. `set_updated_at` trigger. Grants to `fundhub_app`. |
| `db/migrations/176_company_brain_upload_reviews.sql` | W5 | Supersede the `proposed_tier` CHECK on `brain_classification_reviews` so an upload proposing `public`/`sales`/`staff` can also enqueue. Add `kind` (`classification` \| `upload`, default `classification`). New file — never edit 132. |

---

## 4. File ownership — do not touch another workflow's files

| Workflow | Owns (and only these) |
|---|---|
| **W2** | `public/app/company-brain.html` |
| **W3** | `api/company-brain/upload.mjs` (new) · `src/company-brain/upload.mjs` (new) · `src/company-brain/upload-validate.mjs` (new) · `db/migrations/174_company_brain_uploads.sql` (new) · `src/company-brain/upload-validate.test.mjs` · `src/http/company-brain-upload.test.mjs` |
| **W4** | `api/company-brain/threads.mjs` (new) · `src/company-brain/threads.mjs` (new) · `db/migrations/175_company_brain_threads.sql` (new) · `api/read/company-brain.mjs` (the §3.4 additions only) · `src/company-brain/threads.test.mjs` · `src/http/company-brain-threads.test.mjs` |
| **W5** | `src/company-brain/retrieve.mjs` · `src/company-brain/review.mjs` · `api/company-brain/reviews.mjs` · `db/migrations/176_company_brain_upload_reviews.sql` (new) · `src/company-brain/upload-gate.test.mjs` |
| **W6** | `netlify/functions/api.mjs` · journeys · changelog |

**Nobody except W6 edits `netlify/functions/api.mjs`.** Two agents editing that file at once
would overwrite each other. Write your route key into §5 and W6 wires it before lint and tests.

---

## 5. Route keys to wire (W6 does this)

| ROUTES key | Handler file | From |
|---|---|---|
| `company-brain/upload` | `api/company-brain/upload.mjs` | W3 |
| `company-brain/threads` | `api/company-brain/threads.mjs` | W4 |

---

## 6. Blockers and open questions

_(empty — write here and stop if a frozen contract turns out to be wrong)_

---

## 7. Change manifests

_(each workflow appends its own: files touched, exports added, endpoints added, journeys hit)_

### W4 — chat history (threads + messages)

**Files added**

| File | What it is |
|---|---|
| `db/migrations/175_company_brain_threads.sql` | `brain_threads` + `brain_messages`. Org **and** staff scoped, `set_updated_at` trigger on threads, RLS policy attached at creation (the 109/154/166/171 shape — never bare RLS), grants to `fundhub_app` in the migration-132 `DO $$` shape. |
| `src/company-brain/threads.mjs` | Data layer. Exports `listThreads`, `getThread`, `createThread`, `appendMessage`, `titleFromQuestion`. |
| `api/company-brain/threads.mjs` | Handler for §3.3. |
| `src/company-brain/threads.test.mjs` | 9 cases — title derivation, org+staff scoping on every read, role guard on writes. |
| `src/http/company-brain-threads.test.mjs` | 12 cases — list, get one, create, 400 bad uuid, 404 another person's thread, 403 non-staff, 403 no scope, 405. Runs the real scoping SQL against a fake db, not a stubbed data layer. |

**Files changed**

| File | Change |
|---|---|
| `api/read/company-brain.mjs` | §3.4 only: optional `thread_id` in the body, a `saveTurn` helper that writes the question and the answer, `thread_id` added to the response, `history_saved: false` when the write fails. Every existing response key is untouched (`ok`, `question`, `answer{text,thin,source}`, `sources`, `role`). Auth, retrieval and answer calls are byte-for-byte unchanged. |
| `src/http/company-brain.test.mjs` | 5 cases appended for §3.4. Nothing above them edited, weakened, or removed. |

**Exports added:** `listThreads(db,{orgId,staffId,limit})` · `getThread(db,{orgId,staffId,threadId})` ·
`createThread(db,{orgId,staffId,title})` · `appendMessage(db,{orgId,threadId,role,text,sources,answerSource,thin})` ·
`titleFromQuestion(question)` — all from `src/company-brain/threads.mjs`.

**Endpoints added:** `GET|POST /api/company-brain/threads`.

**Behaviour worth knowing**

- A thread belongs to one org **and** one staff member. Every read filters on both columns.
  Another person's thread reads as `404 thread_not_found` — the same answer a thread that never
  existed gets, so nothing confirms it exists.
- A `thread_id` on the ask endpoint that the session does not own resolves to a **new** thread of
  the asker's own. Nothing is ever appended to somebody else's conversation, and the answer is
  still returned.
- History is best effort. A failed write returns the answer with `history_saved: false`.
- `brain_threads.staff_id` is deliberately **not** a foreign key to `staff(id)` — a conversation
  should outlive an offboarded account. Scoping does not depend on the FK.

**For W6 at integration**

1. Wire the route key **`company-brain/threads` → `api/company-brain/threads.mjs`** in `netlify/functions/api.mjs` (§5).
   `src/http/routes.test.mjs` fails until both this key and W3's `company-brain/upload` are wired —
   that is the expected, planned red, not a regression.
2. Apply `db/migrations/175_company_brain_threads.sql`.
3. Run `npm run migrations:manifest` once after 174/175/176 all land — `db/expected-migrations.mjs`
   is generated and is already stale (it is missing `173_specialist_role_name.sql` too). No workflow
   in this batch edited it, on purpose: three agents regenerating one generated file would collide.
4. Journeys: no `docs/journeys/*-intended.md` step changed. Company Brain gains memory; the flow
   through it is the same.

**Verified:** `npm run lint` clean (1294 files). `node --test src/company-brain/threads.test.mjs
src/http/company-brain-threads.test.mjs src/http/company-brain.test.mjs` → **36 pass, 0 fail**.

---

### W3 — document upload + ingest

**Files added** (nothing outside this list was touched)

| File | What it is |
|---|---|
| `db/migrations/174_company_brain_uploads.sql` | `brain_files` gains `source` (`drive`\|`upload`, default `drive`), `approval_status` (`pending`\|`approved`\|`rejected`, default `approved`), `original_name`, `size_bytes`, `uploaded_by`. Every existing row backfills to `drive` / `approved` via the column DEFAULT, restated as an idempotent `UPDATE`. Index `brain_files_org_source_approval_idx (org_id, source, approval_status)`. Grants in the migration-132 `DO $$ ... pg_roles` shape. |
| `src/company-brain/upload-validate.mjs` | Magic-number validator for the Company Brain accept list. Separate from `src/documents/upload-validate.mjs` on purpose — that one guards client ID documents and was not touched. |
| `src/company-brain/upload.mjs` | Uploaded bytes → text → chunks → embeddings → stored rows, reusing `office.mjs`, `pdf-text.mjs`, `chunk.mjs`, `embed.mjs`, `review.mjs`. Plus the §3.2 list query. |
| `api/company-brain/upload.mjs` | Handler for §3.1 (POST) and §3.2 (GET). |
| `src/company-brain/upload-validate.test.mjs` | 10 cases — each accepted type, renamed ELF and PE executables, empty, oversize, declared-vs-sniffed disagreement, invalid UTF-8, env override. |
| `src/http/company-brain-upload.test.mjs` | 16 cases — imports the `api/` handler and drives it with a fake db and fake deps. 405, 400 `no_file`, 400 `empty_file`, 413, 415, 403 non-staff, 403 `no_org_scope`, 502 `embed_failed`, the §3.1 success body with `approvalStatus: "pending"`, the §3.2 list, and the real ingest SQL. |

**Exports added** — `src/company-brain/upload-validate.mjs`: `validateCompanyBrainUpload({buffer,declaredMimeType,maxBytes})` ·
`maxUploadBytes(env)` · `sniffKind(buffer)` · `looksLikeUtf8Text(buffer)` · `normalizeDeclaredType(declared)` ·
`ALLOWED_MIME_TYPES` · `OOXML_MIME_TYPES` · `DEFAULT_MAX_BYTES` · `PDF_MIME` · `TEXT_MIME` · `DOCX_MIME` · `XLSX_MIME` · `PPTX_MIME`.
`src/company-brain/upload.mjs`: `ingestUploadedFile(db,{orgId,staffId,buffer,mimeType,originalName,…})` ·
`listUploads(db,{orgId,limit})` · `extractUploadText(buffer,mimeType,…)` · `uploadDriveFileId(id?)`.

**Endpoints added:** `POST|GET /api/company-brain/upload`.

**Behaviour worth knowing**

- **Every upload is written `approval_status='pending'` and `access_tier='owner'`**, on the file row
  and on every one of its chunks. Classification may propose a lower tier; it never changes
  `approval_status`. The gate that makes an upload unanswerable is W5's `approval_status` filter in
  `retrieve.mjs`, not the tier.
- **The bytes decide the type, never the claim.** `%PDF` → pdf. `PK\x03\x04` → a zip, and only then
  is the declared type read to say which of docx/xlsx/pptx it is; a zip that declares anything else
  is refused. No signature → the bytes must decode as strict UTF-8 **and** contain no NUL or control
  characters, which is what catches an ELF or PE binary renamed to `.pdf`. A declared type that
  contradicts the sniffed bytes is refused.
- **Nothing is written until the embeddings come back.** A failed embed leaves zero rows behind, so
  there is never a half-indexed file nobody can search.
- **A file we cannot read answers `415 unsupported_file_type`**, not a 500. §3.1 has no code for
  "right format, unreadable contents", and 415 is the honest member of that list — we do not accept
  this file. Flagged here so W2 renders it as "we could not read that file".
- Uploads carry a synthetic `drive_file_id` of `upload:<uuid>`. `web_view_link` stays NULL, which is
  the §3.5 shape W2 must render as a name with no link.
- `size_bytes` is NULL for Drive rows and stays NULL through `listUploads` — unknown never becomes 0.
- A PDF with no extractable text stores with `chunkCount: 0` and `needs_ocr` set. It is honest, not
  an error, and it is unanswerable anyway.

**Two things W6 must know**

1. **Wire the route key `company-brain/upload` → `api/company-brain/upload.mjs`** in
   `netlify/functions/api.mjs` (§5). `src/http/routes.test.mjs` currently fails naming
   `company-brain/upload` and W4's `company-brain/threads`. That is the planned red from §2's
   trap 1, not a regression — no workflow but W6 may edit that file.
2. **Run `npm run migrations:manifest` once after 174/175/176 all land.**
   `src/http/health-migrations.test.mjs` fails until then. Same reason W4 gave: three agents
   regenerating one generated file would collide.

**Two gaps, named rather than papered over**

- **`thread_id` is accepted and not stored.** §3.1 offers an optional `thread_id` field, but §3.7
  gives migration 174 no column for it and threads are W4's tables. The handler reads the field and
  ignores it rather than inventing a column. If tying an upload to a conversation is wanted, it
  needs a column decision.
- **§3.6 says every upload enqueues a review row whatever tier was proposed.** `classifyAndApply`
  does not yet take a `kind`, so an upload proposing `sales` auto-assigns and returns
  `reviewId: null`. `src/company-brain/upload.mjs` already passes `kind: "upload"` into that call —
  inert today, live the moment W5 reads it. `enqueueClassificationReview` already accepts it.
  W5's file, W5's row; nothing here was edited to force it.

**Not run here:** the deployed-site Playwright pass and the human click path. Both need the route
wired and the migration applied, which is W6's step.

**Verified:** `npm run lint` clean (1296 files and inline scripts).
`node --test src/company-brain/upload-validate.test.mjs src/http/company-brain-upload.test.mjs` →
**26 pass, 0 fail.** With `src/company-brain/store.test.mjs` and `src/http/company-brain.test.mjs`
added → **46 pass, 0 fail** — no existing test was weakened, skipped or deleted.

---

### W5 — approval gating (done)

**One line:** an uploaded document is invisible to every answer until the owner approves it.

**Files touched (W5 owns all five)**

| File | Change |
|---|---|
| `src/company-brain/retrieve.mjs` | `AND f.approval_status = 'approved'` added to BOTH queries — staff and affiliate. In the WHERE clause, ahead of `ORDER BY`, so the filter runs before ranking and the model never receives a gated chunk. Tier logic, the affiliate double gate and the `assertTierListSafe` calls are untouched. |
| `db/migrations/176_company_brain_upload_reviews.sql` (new) | Supersedes 132's `CHECK (proposed_tier IN ('owner','affiliate'))` with all five tiers, named `brain_classification_reviews_proposed_tier_ck`. Adds `kind` (`classification`\|`upload`, NOT NULL DEFAULT `classification`, CHECK). Index `(org_id, kind, status, created_at DESC)`. Grants in 132's `DO $$ … pg_roles` shape. **132 was not edited.** |
| `src/company-brain/review.mjs` | `enqueueClassificationReview` takes `kind`; an upload may queue at ANY of the five tiers, the Drive path still only `owner`/`affiliate`. `classifyAndApply` takes `kind` and NEVER auto-assigns an upload. `decideClassificationReview` sets `approval_status` `approved`/`rejected` alongside `classification_status`, in the same UPDATE (parameter positions unchanged). `listPendingReviews` also selects `r.kind`, `f.source`, `f.approval_status`, `f.size_bytes`, `f.original_name`. |
| `api/company-brain/reviews.mjs` | GET now lists uploads next to Drive classifications. Response key `reviews` unchanged; every existing snake_case field is preserved by spread. Added per row: `kind`, `isUpload`, `source`, `fileName`, `originalName`, `proposedTier`, `accessTier`, `approvalStatus`, `sizeBytes`, `mimeType`, `webViewLink`, `createdAt`. Added top level: `uploadCount`. Owner-only (H-3) untouched — admin still 403 on GET and POST. |
| `src/company-brain/upload-gate.test.mjs` (new) | 16 tests, fake db, no live database needed. |

**Exports changed:** none added or removed. Three existing functions gained an optional
`kind` argument that defaults to today's behaviour: `enqueueClassificationReview`,
`classifyAndApply`. `decideClassificationReview` returns two ADDED fields
(`approvalStatus`, `kind`); nothing was renamed or removed.

**Endpoints added:** none. `api/company-brain/reviews.mjs` is already routed, so W6 has
no new ROUTES key from W5.

**Journeys hit:** `role-owner` (the owner now approves uploads as well as Drive tier
proposals). `-actual.md` and the changelog are W6's per §4.

**The gap W3 named in §7 is closed.** W3 reported that `src/company-brain/upload.mjs`
passes `kind: "upload"` into `classifyAndApply`, which did not read it — so an upload
proposing `sales` auto-assigned and returned `reviewId: null`. `classifyAndApply` now
reads it: an upload never auto-assigns, always queues at the proposed tier, and leaves
the live tier at `owner`. The Drive path is unchanged and still auto-assigns `sales`.
Both behaviours are covered by tests.

**Verified**

- `npm run lint` → clean, 1296 files and inline scripts.
- `node --test src/company-brain/upload-gate.test.mjs src/company-brain/access.test.mjs src/company-brain/affiliate.test.mjs` → **26 pass, 0 fail.**
- Wider regression, every Company Brain suite including W3's and W4's:
  `upload-gate, access, affiliate, classify, store, sync, config, answer, upload-validate,
  http/company-brain, http/company-brain-upload, http/company-brain-sync` →
  **124 pass, 0 fail.** Plus `threads` + `http/company-brain-threads` → **22 pass, 0 fail.**
  No existing test was weakened, skipped or deleted.
- **Mutation check.** With `AND f.approval_status = 'approved'` deleted from both queries,
  8 of the 16 gate tests fail; restored, 16 pass. The fake database honours the WHERE
  clauses the real SQL carries, so these tests fail if the filter is removed OR moved
  somewhere ineffective — they are not string matches.
- **Migration 176 applied for real**, on a throwaway local Postgres seeded with 132.
  Result: the three CHECK constraints are exactly as intended; an upload row with
  `proposed_tier='sales', kind='upload'` inserts (132's CHECK blocked this); a junk tier
  is still refused by the enum; a junk `kind` is refused by the new CHECK; `kind` defaults
  to `classification` for a row that omits it. Throwaway database dropped. **Nothing was
  applied to production — migrations are W6's step.**

**Two findings, not fixed here (not W5's files)**

1. `src/http/read-endpoints-org-scope.test.mjs` subtest 2 fails, naming
   `api/read/company-brain-affiliate.mjs`. Pre-existing on `main` and unrelated to this
   batch: both that handler and that test file are unmodified in the working tree. The
   test looks for the literal `orgId: staff.org_id`; the affiliate handler correctly uses
   `principal.orgId` at line 36 because its caller is an external principal, not a staff
   session. The endpoint IS org-scoped — the excuse regex simply does not recognise the
   external shape. Someone owns fixing the regex or the excuse note; W5 does not.
2. `src/http/company-brain-screen.test.mjs` fails while W2's rewrite of
   `public/app/company-brain.html` is in flight (689 insertions uncommitted). W2's file,
   W2's test.

**Not run here:** live Playwright and the human click path. Both need the migration
applied and W2's screen finished — W6's step.
