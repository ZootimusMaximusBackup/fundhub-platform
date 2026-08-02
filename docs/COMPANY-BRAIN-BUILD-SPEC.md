# COMPANY BRAIN — BUILD SPEC v1

**Status:** specced, not started. Behind the GHL cutover and the flagged screen queue.
**Owner decision required before build starts:** H-1, H-2, H-3 (bottom of this doc).

---

## 1. What this is

A search layer over Fundhub's existing documents and call recordings.

Files stay in Google Drive. Nothing is moved, renamed, or reorganized. The system indexes Drive in place and answers questions from it, filtered by role.

Accessed through the Fundhub CRM. One screen.

## 2. Why it exists

Drive is disorganized and will stay that way. The system removes the need to organize it — you stop deciding where a file goes, and you stop hunting for it later. New material (call recordings, video, SOPs) gets dropped into Drive and becomes searchable automatically.

## 3. Explicitly out of scope

- Reorganizing Google Drive
- Migrating files off Drive
- Writing, editing, moving, or deleting any file
- Claude Code / MCP integration — this is a CRM feature, reached through the CRM only
- Image content (v1 skips images)

---

## 4. Architecture

### 4.1 Connector

Google Drive API, service account, **read-only**.

Setup:
1. Google Cloud Console → new project → enable Drive API
2. Create service account → download JSON key
3. Enable domain-wide delegation on the service account
4. Authorize it in Google Workspace Admin console with scope `https://www.googleapis.com/auth/drive.readonly`

Operations:
- `files.list` — initial full walk
- `files.get` / `files.export` — content retrieval
- `changes.list` with a stored page token — incremental pickup of new and modified files

The connector cannot write, delete, or move. Scope enforces this.

Runs continuously, not as a one-time batch. New material arrives in Drive daily and must be picked up without a rebuild.

### 4.2 Extraction

| Source | Method |
|---|---|
| Google Docs / Sheets / Slides | native export to text |
| PDF | text extraction; OCR fallback for scans |
| DOCX / XLSX / PPTX | direct parse |
| Video / audio (call recordings) | Whisper transcription, timestamped |
| Images | skipped in v1 |

**Call recordings need two extras documents don't:**
- Speaker labels (diarization)
- A link back to the client record — pull `client_id` from the filename or parent folder if present. A transcript with no deal attached is much less useful. If no client can be determined, index it anyway and flag it as unattached.

### 4.3 Classification

Each file gets an access tier proposed by a model from its content and path.

Tiers:

| Tier | Contents |
|---|---|
| `public` | already-published marketing, VSL scripts |
| `sales` | scripts, objection handling, closer study guide, roleplay material |
| `staff` | SOPs, process docs, internal training |
| `owner` | LLC filings, cap table, partner deals, comp math, anything legal or financial |
| `affiliate` | external-facing — separate boundary, see 4.4 |

Rules:
- `public`, `sales`, and `staff` may auto-assign
- `owner` and `affiliate` **never** auto-assign — both route to a review queue
- Anything unclassifiable defaults to `owner`

**Fail closed.** The only failure that matters is a sensitive document landing in a lower tier.

### 4.4 Affiliate boundary

Affiliates and white-label partners are **external**. They are not a tier above or below the internal ones — they are a separate allowlist.

- No document is affiliate-visible unless a human explicitly marked it
- Affiliate queries hit only the allowlist
- No fallback to internal tiers under any condition

This is the only part of the system where a mistake is externally visible. Build it last, review it hardest.

### 4.5 Store

Chunked text plus embeddings. **Access tier stored on every chunk**, not just on the file.

Vector store: Cognee for the graph layer, or plain pgvector in Neon if the graph isn't earning its keep in v1. Decide at build time (H-1).

### 4.6 Retrieval

**Filter by tier before retrieval, not after generation.** The model must never receive a chunk the asker isn't cleared for — it cannot leak what it never saw.

Reuse the platform's existing `ROLE_SETS`. Do not invent a second permission model.

Role comes from the session. Never from the request body.

### 4.7 CRM surface

One screen:
- Search box
- Results list with source filename and a link back to the file in Drive
- An answer synthesized from the top matching chunks, with sources cited
- For call recordings: timestamp link and the client record if attached

Same auth as the rest of the CRM.

---

## 5. Cost

| Item | Cost |
|---|---|
| Google Drive API | free |
| Whisper transcription | ~$0.36 per hour of audio, ongoing as recordings accrue |
| Embeddings | cents per million tokens; whole current Drive well under $20 |
| Query-time model calls | small, per query |
| Storage | Neon, already paid |

Initial index: roughly $50–100. Then pennies per search plus transcription on new recordings.

The expensive input is build time, not runtime.

---

## 6. Build order

1. **Connector + extraction.** No classification. Prove everything can be read.
2. **Store + retrieval, owner-only access.** Prove search works before permissions matter.
3. **Incremental pickup.** `changes.list` page token, so new files appear without a rebuild.
4. **Classification + review queue.**
5. **Tier filtering + ROLE_SETS wiring.**
6. **CRM screen.**
7. **Affiliate boundary.** Last — the only step where a mistake is external.

Steps 1–3 are a few hours with agents. Steps 4–7 are where the real time goes, because they need judgment, not code.

---

## 7. Human decisions required

- **H-1:** Cognee vs pgvector for v1
- **H-2:** Which Drive folders (if any) are excluded from indexing entirely
- **H-3:** Who besides the owner can approve an `owner` or `affiliate` classification

---

## 8. Priority

Behind, in order:
1. GHL cutover — merge, migrations 110 + 111, env vars, routing flip
2. First real Journey Runner run
3. automations.html — wire to real workflow registry
4. agent-editor.html — remove sample data from live render path
5. Separate agents from workflows
6. Seasoning hole — check whether CRS payload carries an account-open date
7. Six missing pipeline endpoints
8. Hardcoded closer dashboard cards
9. Per-screen audit
10. Mobile

Company Brain lands after that.

---

## 9. Additions from 2026-08-02 conversation — not yet incorporated above

- **Employee uploads.** Staff should be able to upload company material directly (sales scripts, notes, recordings) rather than everything routing through the owner's Drive. Needs an upload surface and a decision on whether uploaded material lands in Drive or bypasses it.
- **Owner does not want more clutter in personal Drive.** Drive-as-intermediary was accepted as the cheap v1 path, but a dedicated store may be preferable once employee uploads exist. Revisit at build time.
- **Chat widget scope.** The CRM chat surface should also allow pinging employees, not only querying documents. That overlaps with the staff reply inbox built 2026-08-01 (conversations, threading, send path already exist) — reuse rather than rebuild.
