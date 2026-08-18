# Contracts → template loader, de-duped against Documents

Batch: `contracts-dedup-2026-08-17`  ·  Started 2026-08-17  ·  Branch `main`
Evidence: `docs/workflows/contracts-dedup-2026-08-17-evidence/<w1|w2|w3|w4>/`

---

## Owner decision (final — do not re-litigate)

Chris, 2026-08-17:

> Contracts is confusing, janky, and redundant with Documents. What Contracts
> should be: a contract template loader. Upload a contract, add the fields, set
> it up so it can be used from the dashboard. Like every other CRM. It does not
> need to show how many are waiting or sent. Move it out of the Funding tab —
> it's a setup screen, not a funding screen. Then de-dup against Documents.

**Standing GO on any endpoint this needs.**

### The split

| Screen | Owns | Does NOT own |
|---|---|---|
| **Contracts** | Building the form: upload a PDF or write wording, add blanks, place signature boxes, say who signs, make it selectable when sending. | Any count of sent / waiting / signed. Any per-client contract row. |
| **Documents** | Watching the paper: every document for every client, contracts included, with signing status, download, void, reminders. | Template authoring. |

One line to remember: **Contracts is where you build the form. Documents is
where you watch the form.**

Sending does not move. It already lives on Present (`public/app/present.html`)
and the call cockpit (`public/app/closer-call.html`), both via the shared
`public/app/contract-send.js`. Neither file is in scope for this batch.

Agent-set assumption, flagged to Chris 2026-08-17: **Void and Send reminders
move to Documents rather than being deleted.** No capability is lost. Chris
may still choose to drop reminders; if he does, W2 removes it.

### Nav

Contracts leaves the **Funding** group and joins **Admin**, labelled
**Contract templates**, next to Products & Commissions. Funding keeps Lenders,
Finance OS, Subscriptions.

---

## Ground brief — what the code does today

Read this instead of re-reading the tree.

### Contracts screen — `public/app/contracts.html` (1074 lines)

Everything below `<main>`:

| Block | ids | Verdict |
|---|---|---|
| 4 stat tiles: WAITING / WORDINGS / SIGNED / DRAFTS | `kOut` `kTpl` `kSigned` `kDraft` | **DELETE** — this is the "how many are waiting or sent" Chris named |
| "How this works" note card | `explainCard` | keep, rewrite for setup |
| Contracts queue table + status filter + Send reminders | `listBody` `selStatus` `btnRemind` | **MOVE to Documents** |
| Contract detail card (facts, frozen body, actions incl. Void / Download PDF) | `detailCard` `dTitle` `dState` `dFacts` `dBody` `dActions` `dMsg` | **MOVE to Documents** |
| Wording library + editor | `tplCard` `tplList` `tplEditor` `tKey` `tName` `tKind` `tSubtype` `tBody` `tFields` `tStatement` `btnNewTpl` `btnSaveTpl` `btnArchive` | **KEEP — becomes the screen.** Currently `display:none` on load; must become visible. |
| PDF upload + field placer | `btnUpload` `fileInput` `pdfEditor` `pdfName` `pdfPages` `signerRoles` `btnAddSigner` `btnSaveFields` `typeChips` `newSigner` `newSource` `boxProps` | **KEEP** |

`tplCard` carries badge "owner & admin" — the write gate on template authoring
is narrower than STAFF by design (`docs/CONTRACTS-SPEC.md` §5). Do not widen it.

### Documents screen — `public/app/documents.html` (491 lines)

Stat tiles TOTAL / AWAITING SIGNATURE / UNDELIVERED / OLDEST PENDING; a
`classbar`; kind tabs built from a `CLASSES` array at line 246; a filtered
table reading `GET /api/read/documents`. Already carries `kind` tabs, and
`contract` + `authorization` are two of the five kinds.

### Back end

* `api/read/contracts.mjs` — three shapes on one route:
  `?view=templates` (the library), `?view=contracts[&client_id][&status]`
  (the queue), `?id=<uuid>` (one contract incl. frozen wording).
  ROLE_SETS.STAFF. Org comes from the session and is required.
* `api/read/documents.mjs` — `readHandler`, ROLE_SETS.STAFF, org from session,
  `storage_key` stripped by `redact()`. Selects `documents` LEFT JOIN `clients`,
  already returns `kind`, `subtype`, `delivered_at`, `delivery_status`,
  `signature_required`, `signed_at`, `signer_name`. Filters on `client_id`
  and `kind` only.
* `api/contracts.mjs` — the staff write surface (create_draft, send, void,
  template CRUD). ROLE_SETS.STAFF with a narrower gate on copy authoring.
* `api/contracts/sign.mjs` — public, no session, HMAC-signed link.
* `netlify/functions/api.mjs` — hardcoded `ROUTES` map. **A handler absent
  from it 404s** (CLAUDE.md §12). `src/http/routes.test.mjs` enforces this.
* At send, `src/contracts/send.mjs` calls `registerDocument()` — so **a sent
  contract already has a `documents` row**. A **draft does not**
  (`rendered_body` is NULL until send). W2 must report how drafts surface.

### Traps that apply to this batch (CLAUDE.md §12)

* `npm test` globs `src/**` and `scripts/**` only. A test under `api/` never
  runs. Endpoint tests go at `src/http/<name>.pg.test.mjs`.
* Handler present ≠ route present. Add to `ROUTES` in `netlify/functions/api.mjs`.
* `requireAuth` ignores a `roles` key. Gate with `requireRole` after it.
* Never edit an applied migration. Supersede with a new file.
* `public/app/sidebar.fragment.html` is the source of truth for the menu.
  Never hand-edit a page's `<aside>`. Run `node scripts/sync-sidebar.mjs`.
  `app-nav-reachability.test.mjs` fails on drift.

### Proof recipe

* `npm run lint` · `npx tsc --noEmit` · `npm test`
* DB-backed endpoint tests need a real `DATABASE_URL`; without it 442 `.pg`
  tests silently skip and green means little.
* Live only, never localhost — local `netlify dev` 503s "db down" under a
  screen's read burst. `BASE_URL=https://fundhub.ai`, `npm run test:e2e:live`
  (config `playwright.live.config.mjs`, matches `e2e/live-*.spec.mjs`).
* Test accounts: `owner@fundhub.ai`, `sales@`, `closer@`, `advisor@`,
  `inquiry@`, `client@`, `affiliate@`, `partner@`. Password is
  `STAFF_E2E_PASSWORD` in the gitignored `.env`. **Never print it.**
  Log in once per role; live rate-limits login bursts.

---

## Task rows

| Row | Task | Owner | Status |
|---|---|---|---|
| W1 | Contracts screen → template loader only | agent-w1 | blocked (screen done + proven; `src/http/contracts-screen.test.mjs` asserts the deleted behaviour and is W3's file) |
| W2 | Documents screen absorbs the sent-contract queue | agent-w2 | done — COMPLIANCE REVIEW REQUIRED |
| W3 | Back end: one read path, publish the API answer | agent-w3 | done — COMPLIANCE REVIEW REQUIRED |
| W4 | Nav move + sidebar sync + journeys + live proof + deploy | fixer (main thread) | on branch + PR 84; live proof owed |

Dependency: **W2 waits for W3's "API answer" below.** **W4 waits for W1 + W2.**
W1 and W3 have no dependency on anything.

### File ownership — do not touch a file you do not own

* W1 → `public/app/contracts.html`
* W2 → `public/app/documents.html`, `api/read/documents.mjs`
* W3 → `api/read/contracts.mjs`, `api/contracts.mjs`, `netlify/functions/api.mjs`, `src/contracts/*`, `src/http/*.test.mjs`
* W4 → `public/app/sidebar.fragment.html`, `public/app/shell.js`, all `<aside>` blocks via the sync script, `docs/journeys/*`

Nobody edits `public/app/contract-send.js`, `present.html`, or `closer-call.html`.

---

## API answer  (W3 writes here first — W2 reads it before wiring data)

Written by W3, 2026-08-17. **Code against this verbatim.**

### The joining problem, and the answer

A `documents` row does not point at its contract. A `contracts` row points at
its documents — `contracts.document_id` (the copy that was sent) and
`contracts.signed_document_id` (the finished signed copy, present only once
everybody has signed). Both already come back on the existing queue rows.

So Documents does **not** ask per row. It loads its page of documents, collects
the ids of the rows it wants to decorate, and makes **one** extra call:

```
GET /api/read/contracts?view=contracts&document_id=<id>,<id>,<id>
```

`document_id` is a NEW filter (W3 is adding it). It accepts one uuid or a
comma-separated list, and matches a contract when **either** `document_id`
**or** `signed_document_id` equals it. Cap: 200 ids per call.

Build the lookup client-side:

```js
const byDoc = {};
for (const c of res.items) {
  if (c.document_id)        byDoc[c.document_id]        = c;
  if (c.signed_document_id) byDoc[c.signed_document_id] = c;
}
const contract = byDoc[documentRow.id];   // undefined = not a contract row
```

`contract.id` is the **contract id** every action below needs.

---

### a. Signing status — EXTENDING what exists

**Request** `GET /api/read/contracts?view=contracts&document_id=<uuid>[,<uuid>…]`
Optional and unchanged: `&client_id=<uuid>` `&status=draft|sent|viewed|signed|void` `&limit=` (default 100, cap 200).

**Response** `200` — same shape as today, nothing renamed:

```json
{ "ok": true, "view": "contracts", "count": 2, "items": [
  { "id": "<contract uuid>", "org_id": "…", "client_id": "…",
    "template_id": "…", "template_key": "FUNDING-AGREEMENT",
    "title": "Funding Agreement", "kind": "contract", "subtype": null,
    "body_sha": "sha256:…",
    "document_id": "<uuid|null>", "signed_document_id": "<uuid|null>",
    "status": "sent",
    "sent_at": "…", "sent_by": "…", "sent_by_name": "Dana Closer",
    "link_expires_at": "…", "viewed_at": null, "view_count": 0,
    "signed_at": null, "signer_name": null,
    "voided_at": null, "void_reason": null,
    "source_kind": "text", "signing_order": "sequential", "completed_at": null,
    "first_name": "Katherine", "last_name": "Johnson",
    "client_email": "k@example.com",
    "created_at": "…", "updated_at": "…" } ] }
```

`status` is exactly one of `draft` `sent` `viewed` `signed` `void` — that is the
badge. `rendered_body` is deliberately NOT in the list rows.

**Errors** `400 invalid_document_id` (a value that is not a uuid, or more than
200 ids) · `400 invalid_client_id` · `400 org_required` · `401` no session ·
`403` not staff.

**Already worked today?** The `view=contracts` shape and every field above: YES.
The `document_id` filter: NO — W3 is adding it.

---

### b. Open or download the signed copy — ALREADY WORKS, unchanged

**Request** `GET /api/read/contracts?file=contract&id=<contract uuid>&signed=1`

`signed=1` asks for the finished signed document. Omit `signed` to get whichever
is current (that is the signed one once everybody has signed). `signed=0` forces
the unsigned copy.

**Response** `200`:

```json
{ "ok": true, "file": "contract", "filename": "FUNDING-AGREEMENT-signed.pdf",
  "signed": true, "pdf_base64": "JVBERi0xLjcK…" }
```

Bytes come back base64 inside JSON, **not** a URL and never a storage key.
Turn it into something the browser can open with a blob:

```js
const bin = atob(r.pdf_base64);
const buf = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
const url = URL.createObjectURL(new Blob([buf], { type: "application/pdf" }));
```

**Errors** `400 invalid_id` · `404 not_found` (no such contract in this org) ·
`404 no_file` (nothing stored — a draft, or the in-memory object store lost the
bytes). Header is `cache-control: private, no-store`.

**Already worked today?** YES. `public/app/contracts.html:550` calls it.

---

### c. Void — ALREADY WORKS, unchanged

**Request** `POST /api/contracts` with body
`{ "action": "void", "id": "<contract uuid>", "reason": "typed by staff" }`

**Response** `200`:

```json
{ "ok": true, "action": "void", "contract": { "…": "…", "status": "void",
  "voided_at": "…", "void_reason": "…" },
  "message": "Voided. The link stops working and the contract can no longer be signed." }
```

**OWNER / ADMIN ONLY.** Any other staff role gets `403`:
`{ "ok": false, "error": "forbidden", "required": ["owner","admin"],
   "message": "Only an owner or an admin can void a contract." }`
Hide the button for non-admins the way `contracts.html` already hides `btnRemind`.

**Errors** `400 invalid_id` · `404` unknown contract · `409` already void or
already signed.

**Already worked today?** YES.

---

### d. Remind whoever has not signed — NEW ACTION

The existing `run_reminders` is an **org-wide sweep**, not a per-row button: it
only touches contracts untouched for 3+ days and answers "nothing to chase" the
rest of the time. Wrong answer for a Remind button on one row. So W3 is adding a
single-contract action.

**Request** `POST /api/contracts` with body
`{ "action": "remind", "id": "<contract uuid>" }`

**Response** `200`:

```json
{ "ok": true, "action": "remind", "contract_id": "<uuid>",
  "reminder": 2, "max_reminders": 4,
  "waiting_on": { "name": "Katherine Johnson", "role": "Client", "remaining": 1 },
  "queued": 1,
  "delivery": { "sent": 1, "blocked": 0, "failed": 0 },
  "message": "Reminder sent to Katherine Johnson." }
```

`reminder` is which chase this was (1-based). `waiting_on` is null only when
nobody is left, which is a 409 rather than a 200. When mail is queued but not
actually delivered — the company has outbound paused, no email route is set up,
or the reminder copy is not compliance-approved — it still answers `200` with
`queued: 0` or `delivery.sent: 0` and a `message` that says so in plain words.
Show the `message`.

**ROLE: ordinary STAFF**, same gate as `send` — one reminder to one person about
one contract is ordinary closer work. (The batch `run_reminders` stays
owner/admin. That is unchanged.)

**Errors**
`400 invalid_id` · `404 not_found` ·
`409 not_sent` — it is still a draft, nothing has gone out ·
`409 already_finished` — signed or voided, nobody to remind ·
`409 nobody_waiting` — every signer is done or declined ·
`409 chase_limit` — 4 reminders have already gone; the message says to phone them
instead.
Every one carries a plain-English `message`. Show it.

**Already worked today?** NO — W3 is adding it. `run_reminders` is untouched.

---

### What W3 is NOT changing

* `?view=templates` — byte-for-byte unchanged. `contract-send.js` and the
  Contracts screen both depend on it.
* `?id=<uuid>` (one contract with its frozen wording, integrity verdict,
  signers, waiting_on) — **kept**. Documents needs it for a detail panel and it
  is the only way to read the wording. Do not assume it is dead.
* `?file=template&template_id=` — unchanged, W1's PDF field placer uses it.
* `api/read/documents.mjs` — W3 does not touch it. Documents keeps its own SQL.

---

## Change manifests

_each workflow appends its own before reporting done_

### W2 — Documents screen absorbs the sent-contract queue

**COMPLIANCE REVIEW REQUIRED** — Remind sends a message to a client about
signing, and Void can now be pressed on an `authorization`-kind contract, which
is a consent document. No new capability: both actions already existed on the
Contracts screen behind the same API and the same role gate. Only the place you
press them moved.

**Files touched:** `public/app/documents.html` only.
`api/read/documents.mjs` was NOT changed — the one extra call covered it, and
`d.id` was already in the payload (`redact()` keeps it; it is not a storage key).

**What was added** (all inside the existing screen, nothing renamed, nothing
reformatted):

* One new table column, **Contract**, after "Age pending". No `data-s`, so it is
  deliberately not sortable and the sort-arrow loop skips it. Empty-row colspan
  7 → 8.
* `CSTATE` / `ctCell()` in the screen's own script block — the contract's own
  badge (draft · sent · opened · signed · void), the same five words
  `contracts.html` uses.
* One extra read per page load:
  `GET /api/read/contracts?view=contracts&document_id=<comma list>`, chunked at
  200 ids, with the `byDoc` lookup built exactly as the API answer above
  specifies (keyed on BOTH `document_id` and `signed_document_id`).
* **Both `contract` and `authorization` document classes are put in the id
  list**, because `contracts.kind` is `CHECK (kind IN ('contract',
  'authorization'))` — `db/migrations/124_contracts.sql:148`. A contract filed
  under `authorization` would otherwise never get a badge. A row that is not a
  contract gets no answer back and is untouched.
* **No call at all** when the page holds neither class. Verified.
* Open PDF → `?file=contract&id=<contract uuid>&signed=1` when a
  `signed_document_id` exists, and without `signed` when it does not (there
  would be no signed copy to open). base64 → `Uint8Array` → `Blob`, per the
  snippet above.
* Void → `POST /api/contracts {action:'void', id, reason}`, reason from a
  prompt, same as `contracts.html`. Owner/admin only, hidden for everybody else
  by the same `resolveRole()` that `contracts.html` uses for `btnRemind`.
* Remind → `POST /api/contracts {action:'remind', id}`, shown for `sent` and
  `viewed`. **The server's own `message` is the only wording shown**, on the 200s
  and the 409s alike — a 200 that queued nothing because mail is off looks
  identical to a success from the browser.
* One `#ctMsg` line under the table carries those messages. It sits outside
  `#body` so a sort, tab or search keystroke does not wipe the answer.
* One delegated click listener on `#body`, not per-button wiring: `render()`
  rebuilds `#body` on every sort, tab, filter and keystroke.

**No Send-a-contract button was added.** Sending stays on Present and the call
cockpit.

**What a human should click** (once W4 deploys):
1. Sign in as `owner@fundhub.ai`, open Documents. A contract row shows a badge
   in the new Contract column; a UnderwriteIQ deliverable row shows "—".
2. Press **Remind** on a sent contract. Read the sentence under the table — it
   must be the server's sentence, including "nothing was emailed" if mail is off.
3. Press **Void**, type a reason, confirm the badge flips to `void`.
4. Sign in as `closer@fundhub.ai`. **Void must not be on the screen at all.**
   Remind must still be there.
5. Press **Open PDF** on a signed contract — the signed PDF downloads.

**What I could NOT verify.** No live check: this change is not deployed (W4
deploys). No real `DATABASE_URL` here, so the 442 database-backed tests skipped.
W3's `remind` action was not yet in `api/contracts.mjs` when I finished, so
Remind is verified against the API answer's documented shape, not against the
real handler. What IS verified, with evidence in
`docs/workflows/contracts-dedup-2026-08-17-evidence/w2/`
(`dom-check.mjs`, `dom-check.json`, three screenshots): the real page served
locally with every `/api/**` answer stubbed to the shapes above — 8 columns,
badges on both contract and authorization contracts, "—" on the deliverable,
**exactly one** lookup call for three ids, **zero** calls when no contract rows
are present, Void visible for owner and absent for closer, `signed=1` sent only
for the signed contract, and the server's `message` shown verbatim for both
remind and void. Zero page errors.

`npm run lint` clean. `npm test` — 14 failures, all pre-existing / other
workflows (contracts.html, routes, company-brain, migration manifest, journey
staleness); `src/http/crm-html.test.mjs` 21/21 and
`src/http/app-nav-reachability.test.mjs` 42/42 green. `npx tsc --noEmit` cannot
run — there is no `tsconfig.json` in this repo and never has been
(`scripts/lint.mjs` header records that); it prints its usage text and exits 1
on a clean checkout, unchanged by this work.

No journey file was edited — `docs/journeys/*` is W4's. Nothing this change does
needs a step that is not already in an intended journey; see the note under
Blockers.

### W1 — Contracts screen → contract template loader

**File touched:** `public/app/contracts.html` only. Nothing else. The `<aside>`
sidebar was not touched (other batches are editing it concurrently — see the
concurrency note under Blockers).

**Removed (ids gone from the DOM — verified in a browser, all 14 report `absent`):**
`kOut` `kTpl` `kSigned` `kDraft` (the four stat tiles) · `listBody` `selStatus`
`btnRemind` (the queue, its filter, Send reminders) · `detailCard` `dTitle`
`dState` `dFacts` `dBody` `dActions` `dMsg` (the contract detail card, including
Void and Download PDF).

**Dead code deleted with them (CLAUDE.md §8):** `renderList()` `openContract()`
`renderDetail()` `detailAction()` `loadContracts()` `stateBadge()` `whenDay()`
`when()` `norm()` `resolveRole()`, the `STATE` map, the `contracts` /
`selContract` / `isAdmin` variables, and the CSS that only those elements used
(`.stats` `.stat*` `.eyebrow*` `.doc`, plus `.stats` inside the 1180px media
query). `say()` `esc()` `$()` were kept — the template and PDF editors still use
them.

**Reads:** the screen now issues exactly one contract read,
`GET /api/read/contracts?view=templates`. `?view=contracts` and `?id=` are gone,
as is the page's own `GET /api/auth/session` (that went with `resolveRole`).

**Kept and now the whole screen:** `tplCard` `tplList` `tplEditor` `tKey` `tName`
`tKind` `tSubtype` `tBody` `tFields` `tStatement` `btnNewTpl` `btnAddField`
`btnSaveTpl` `btnArchive` `btnCancelTpl` `tplMsg` · `btnUpload` `fileInput`
`pdfEditor` `pdfName` `pdfPages` `signerRoles` `btnAddSigner` `btnSaveFields`
`typeChips` `newSigner` `newSource` `boxProps` `fieldMsg`.

**`tplCard` is visible on load.** It was `style="display:none"` in the markup and
was revealed only by `resolveRole()` once the session said owner or admin. Both
are gone; the card renders unconditionally. The `owner & admin` badge stays and
the server-side write gate in `api/contracts.mjs` is untouched — see the
behaviour change under Blockers.

**Copy:** `<title>` → `Fundhub — Contract templates`; `<h1>` → `Contract
templates`; crumb `Work` → `Setup`; `explainCard` rewritten for setup and now
links to `documents.html`. One line moved: `$("liveTxt").textContent = "— live"`
lived in the deleted `loadContracts()`, so it now sits in `loadTemplates()` —
without it the header chip would have read "— loading" forever.

**Journeys:** `docs/journeys/role-owner-intended.md` and
`role-closer-intended.md` describe reachable *routes*, not steps on this screen.
Both say "contracts (1 route) — should be reachable" and that route is still
reached (`?view=templates`). No intended journey step is removed, so there was
nothing to stop and ask about. `-actual.md` regeneration is W4's file.

**What a human should click** (once W4 deploys — this is not live yet):
1. Open Contracts. The four number tiles, the list of contracts and the contract
   detail panel should all be gone. The wording library should be there straight
   away, without a reload.
2. Press **New wording**, then **Upload a PDF**. Both editors should open.
3. Click a PDF wording in the list. The page viewer and the box tools should
   open, and dragging a box should still work.
4. Read the note at the top and click **Documents** in it.

**Proof I ran** — evidence in
`docs/workflows/contracts-dedup-2026-08-17-evidence/w1/`:
* `npm run lint` — clean (1294 files).
* `npx tsc --noEmit` — prints its own help text and exits 1. It does that on an
  untouched tree too (`00-baseline-tsc.txt`): this repo has no `tsconfig.json`,
  so there is no TypeScript project to check. Unchanged by this work.
* `npm test` — the 8 failures this change causes are all in
  `src/http/contracts-screen.test.mjs` (see Blockers). Baseline before the change
  was 4 failures; every other failure that appeared during the run came from
  other batches editing this same working tree, not from this file.
* Browser check — `06-after-CHANGED-local-*.png` and
  `06-after-CHANGED-local-local-render.json`. All 14 deleted ids report `absent`;
  `tplCard` is visible on load carrying the `owner & admin` badge; the template
  list paints three rows; clicking a text wording fills the editor and lists its
  merge tags; clicking a PDF wording opens the PDF editor with its signer roles
  and box tools; the note links to `documents.html`; zero console errors; the
  only contract read is `?view=templates`. `05-control-BEFORE-local-*` is the
  same harness run against the untouched file, for comparison.

**What I could NOT verify:** anything against the live site. See Blockers.

### W3 — back end: one read path, plus the actions Documents needs

**COMPLIANCE REVIEW REQUIRED** — one new action emails a client about signing
a contract. It sends no new wording: it renders the already-seeded, already
compliance-gated `CONTRACT-REMIND-EMAIL` template, and unapproved copy is still
refused by the same gate that refuses it everywhere else. Recorded here because
Chris asked for the marker on anything that mails a client about signing.

**Files touched**

| File | What changed |
|---|---|
| `src/contracts/send.mjs` | `listContracts()` takes `documentIds`. One extra SQL clause matching `document_id` **or** `signed_document_id`. Nothing else moved. |
| `api/read/contracts.mjs` | `?document_id=` parsed, validated (uuid, ≤200, comma list), passed through. Header updated. |
| `src/contracts/notify.mjs` | Pulled the per-contract chase out of `chaseContracts()` into `remindContract()`, and the "how many chases so far" query into `chasesFor()`. The sweep now calls `remindContract()` — one code path, not two. Behaviour of the sweep is unchanged. |
| `src/contracts/index.mjs` | Exports `remindContract`. |
| `api/contracts.mjs` | New action `remind`. |
| `src/http/contracts-endpoints.pg.test.mjs` | +10 tests. |

**Routes added or changed: none.** No new handler file, so `ROUTES` in
`netlify/functions/api.mjs` is untouched and `src/http/routes.test.mjs` still
passes. Both new capabilities ride on routes that already exist.

**Response shapes** — exactly as published under "## API answer" above. Live
captures of every one of them are in
`docs/workflows/contracts-dedup-2026-08-17-evidence/w3/api-calls.json`.

**Nothing was removed.** `?view=templates`, `?view=contracts`, `?id=`,
`?file=template`, `?file=contract`, and `run_reminders` all behave exactly as
before. `?id=` keeps a caller: it is the only way to read a contract's frozen
wording, its integrity verdict and its signer list.

**Tests added** (all in `src/http/contracts-endpoints.pg.test.mjs`):

* a document id finds the contract that owns it, with the status badge on it
* several ids in one call, and nothing that was not asked for
* another company's session gets nothing from this company's document id
* an id that owns no contract is an empty answer; junk is a 400
* the filter never returns a storage key
* an ordinary staff member may remind one contract
* a draft has nobody to remind
* a voided contract is never chased
* it gives up after 4 reminders rather than emailing forever
* unknown id 404, junk 400, another company's contract 404

**Proof, and where it ran.** `npm run lint` clean. There is no `tsconfig.json`
in this repo, so `npx tsc --noEmit` only prints its own help — it checks
nothing here, and that is pre-existing.

The database-backed tests ran against a **real Postgres**: local PostgreSQL
16.14 (Homebrew), database `fundhub_ci`, migrations applied through 156,
connected as the superuser role. Results, run serially:

* `src/http/contracts-endpoints.pg.test.mjs` — 60 pass, 0 fail
* `src/contracts/notify.pg.test.mjs` — 19 pass, 0 fail
* `src/contracts/esign.pg.test.mjs` — 29 pass, 0 fail
* `src/contracts/tamper.pg.test.mjs` — 14 pass, 0 fail
* `src/http/routes.test.mjs`, `auth-gate.test.mjs`, `contract-send.test.mjs` — pass

**What I could NOT verify**

1. `src/contracts/lifecycle.pg.test.mjs` never got to run on this machine. Its
   own `purge()` throws before any test starts — a leftover `FUNDING-AGREEMENT`
   row in the local database points at a test staff account the purge tries to
   delete, and the foreign key refuses. That is local database residue and a gap
   in that test's cleanup (its purge only clears `CTLIFE-%` keys); it is not
   caused by anything in this change, and nothing in this change runs before it
   fails. **Finding, not fixed** — out of scope for this row.
2. The reminder email actually leaving the building. On this local database the
   `CONTRACT-REMIND-EMAIL` row is missing, so the endpoint took its graceful
   path and answered 200 with "the reminder email wording is missing from this
   company's copy library". That is the designed degrade and it is captured in
   the evidence. **W4: on live, press Remind once and confirm the message says
   it was sent, not that the wording is missing.**
3. Anything against fundhub.ai. No live run from this row.


---

## Blockers and open questions

### W1 · `src/http/contracts-screen.test.mjs` has to change, and it is W3's file

That file reads `public/app/contracts.html` as text and asserts the presence of
the things Chris told me to delete. **8 assertions now fail.** I did not touch
the file — `src/http/*.test.mjs` belongs to W3 — and I did not weaken anything.

W3: these need rewriting to match the screen's new job.

| Test | What it asserts | Why it fails now |
|---|---|---|
| `every endpoint it calls is really routed` | `called.length >= 2` | The page's own `/api/auth/session` went with `resolveRole()`. Only `/api/contracts` is left as a literal, so the count is 1. The remaining call is still routed. |
| `it tells staff to send from the call, not from this page` | matches `Send from the call`, `call cockpit` | The note card was rewritten for setup and now points at Documents. |
| `the wording card starts hidden and is revealed only for owner or admin` | `tplCard` has `style="display:none`; `isAdmin = norm(r) === "owner" \|\| ...`; `$("tplCard").style.display = isAdmin` | Owner decision: the library is the screen, so it renders unconditionally. `isAdmin` and `resolveRole()` no longer exist. |
| `void is offered only to an owner or admin` | `if (isAdmin && c.status !== "signed" ...)` | Void moved to Documents (W2). |
| `live wordings never paint the sample-markup banner` | `return "live contracts · " + contracts.length` | `loadContracts()` is gone. The `live wordings` half still passes. |
| `it shows the status of every contract` | the words draft/sent/viewed/signed/void appear | Statuses belong to the queue, which moved. |
| `it surfaces a tampered contract rather than hiding it` | `__integrity`, `It cannot be signed` | That was the detail card, which moved. |
| `the finished document can be downloaded from the CRM` | `file: "contract"`, `a.download = res.data.filename` | Download PDF moved to Documents. |

The tamper-integrity and download assertions are worth **keeping as tests** —
they should follow the behaviour to `documents.html` rather than being deleted.

### W1 · a non-admin staff member can now see the template editor

Before, `resolveRole()` hid `tplCard` from anyone who was not owner or admin.
Making it visible on load — which is what was asked for, and is right, because
the library is now the entire screen — means a closer or sales manager opening
Contracts sees the editor. The server still refuses their writes
(`OWNER_ADMIN_ACTIONS` in `api/contracts.mjs` is untouched) and the
`owner & admin` badge is still on the card, so they are told. Flagging it, not
re-opening it: they will get an error message rather than a hidden control.
Cleanest follow-up is the nav change W4 is already doing — Contracts moves to
Admin, so a closer has no reason to be on the screen at all.

### W1 · live proof could not be taken — fundhub.ai login is returning a 500

`POST https://fundhub.ai/api/auth/login` answers **500** with
`{"ok":false,"error":"internal_error","message":"cannot execute INSERT in a
read-only transaction"}`. It does this with a deliberately wrong password too,
so it is not a credentials problem — the handler fails on an INSERT before it
gets that far. **No role can sign in to the live site right now.**
`GET /api/health` is 200 and reads answer 401 as normal, so it is writes, not
the whole site. Captured in `w1/05-live-login-500.txt`.

Because of that I could not run the ui-audit harness or any signed-in live
check. What I did instead is written plainly in the manifest: a local static
render of the changed file with `/api/**` stubbed, plus the identical run
against the untouched file as a control. That proves layout, copy, wiring and
which ids exist. It proves nothing about live data. W4 must take the live pass
after deploying — and this login failure will block that too until it is fixed.

### W1 · this working tree is shared, and my file was reverted under me mid-task

Part-way through, `public/app/contracts.html` went back to its committed
contents on disk (md5 matched `HEAD`), then changed twice more within seconds.
Other batches (`beta-banner-removal`, `subscriptions-removal`,
`demo-mode-removal`, `company-brain-chat` and others) are editing the same
checkout at the same time, and `scripts/sync-sidebar.mjs` rewrites the `<aside>`
of every screen. It happened **twice**. The second time the whole working tree went back to the
committed version — every batch's edits, not just mine (the `subscriptions` and
`sample-data` nav items other batches had removed were back too). Something is
running `git checkout` / `git restore` / `git stash` on this shared checkout.

I re-applied and the file is correct as I write this
(md5 `fe417776e60d2626bf6f4cf33ca987fc`), but **assume it can be wiped again.**
Two artefacts are saved so it costs nothing to recover:

* `docs/workflows/contracts-dedup-2026-08-17-evidence/w1/contracts.html.w1-result`
  — the exact finished file.
* `docs/workflows/contracts-dedup-2026-08-17-evidence/w1/reapply-w1-change.py`
  — re-applies the whole change to a clean `public/app/contracts.html`. It
  asserts on every string it edits, so it refuses to run rather than half-apply.

**W4: before committing, diff `public/app/contracts.html` against
`contracts.html.w1-result`.** If they differ, run the script. The only
difference that is expected and correct is in the `<aside>` sidebar, which W4
owns and the sync script rewrites. Several sidebar/shell tests are red right now
for the same tree-churn reason and have nothing to do with this row.

### W1 · pre-existing, not caused by this change: `data.js` loads after the page's own boot script

`contracts.html` loads `<script defer src="data.js">` before its inline boot
script. A deferred script runs *after* parsing, so the inline script calls
`FHData` before it exists. Under a plain static server this throws
`FHData is not defined` and the screen loads nothing. **The untouched file does
exactly the same** — I ran the control — and the deployed file is byte-identical
to the untouched one. The live audit from 15:50 today shows the reads succeeding
on fundhub.ai with no console errors, so live is somehow winning this race. I
could not explain the difference and did not chase it: out of scope for this row
and not something I introduced. Worth someone's time separately.


### Q1 — who should see the Contracts row after this change? (raised by fixer/W4, 2026-08-17)

Nav visibility in `public/app/shell.js` is per-FILE, not per-group: `ALL`,
`OWNER_ADMIN_ONLY`, `FINANCE_ONLY`, etc. **So moving contracts.html from the
Funding group to the Admin group does not change who sees it.** The move is
cosmetic for permissions. Good.

But once the screen is template authoring only, its main action (save a
wording) is gated owner/admin at the API, while `?view=templates` reads as
STAFF. UI-STANDARDS §4 says a role should not render an item it cannot use —
which argues for adding `contracts.html` to `OWNER_ADMIN_ONLY`.

**Fixer's call: leave role visibility UNCHANGED.** Chris named the tab move,
not a permission change, and reading the wording list is legitimately useful
to a closer about to send one. Flagged to Chris rather than done.
Do not change this without his word.

### W2 · a draft contract does not appear on Documents — CONFIRMED, not fixed

Checked in the code, as asked. It is true.

`createDraft()` in `src/contracts/send.mjs:133` writes a `contracts` row and its
`contract_signers` rows and **nothing else**. The only thing that ever creates
the `documents` row is `storeAndRegister()` inside `send()`
(`src/contracts/send.mjs:338`), which runs at send. Until then `rendered_body`
is NULL — `117`'s `contracts_sent_has_body_ck` requires it to be — and
`contracts.document_id` is NULL.

So a draft has no document, and the Documents screen reads `documents`.
**A draft is invisible on Documents.** It is also unreachable by the new
`document_id` filter, since the value it would be matched on is NULL.

Consequence in plain words: with Contracts becoming template setup only, and
its DRAFTS tile deleted, **there is currently no screen anywhere that lists
started-but-not-sent contracts.** Before this batch the Contracts queue showed
them.

I did not build a drafts view. That is new scope and it is Chris's call. The
three obvious shapes, for whoever picks it up:

1. Leave it. A draft lives for minutes inside one Present/cockpit session; the
   sender is standing in front of it. Cheapest, and possibly correct.
2. Documents grows a "not sent yet" strip fed by
   `GET /api/read/contracts?view=contracts&status=draft` — an existing,
   unchanged call. No back-end work. It would mean Documents shows something
   that is not a document, which cuts against the split above.
3. Send-time only: drafts stay invisible and abandoned ones get swept.

### W2 · uploaded PDF templates already show on Documents as "Contracts"

Found while checking the above; reporting, not fixing.

`src/contracts/upload.mjs:112` registers every uploaded template PDF as a real
`documents` row with `kind: 'contract'`, `subtype: 'template_source'`, titled
"<name> (uploaded file)", filed against the org-level placeholder client that
`ensureTemplateClient()` makes (because `documents.client_id` is NOT NULL).

So the Documents screen **already** counts blank templates in its Contracts
class and shows them next to a placeholder client name. They get no badge and
no buttons from my change — correctly, because no `contracts` row points at
them — but they are still sitting in a list of "every document for every
client" while belonging to no client. It reads as a stray row.

This predates the batch. Filtering `subtype = 'template_source'` out of the
Documents read would fix it in one line, but that is a change to
`api/read/documents.mjs` behaviour nobody asked for, so it is written down
rather than done.

### W2 · intended journeys — nothing to raise

Checked `role-owner-intended.md`, `role-closer-intended.md` and
`client-intended.md` before writing any code. All three describe journeys as
**route reachability**, not UI steps. Owner and closer both already list
`contracts` (1 route) and `Documents` (1 route) as "should be reachable", and
`Reading data` covers `/api/read/contracts` and `/api/read/documents` for both.

This change adds **no route**. Void and the contract read were already reachable
for these roles; `remind` is a new *action* on the already-reachable
`POST /api/contracts`. So there is no step here that is missing from an intended
journey, and no intended file needed editing. `-actual.md` regeneration belongs
to W4, who owns `docs/journeys/*`.

### W2 · a warning for W4 before deploy: this file got reverted mid-edit

At about 20:45 my finished edit to `public/app/documents.html` was wiped —
`git status` went from ` M` to clean and the file was back at HEAD, with no
action of mine. I reapplied it from a script and kept a backup outside the repo.
Something in this batch (or a neighbouring one) is running a checkout, stash or
sync over the working tree. **W4: diff `public/app/documents.html` against the
manifest above before deploying** — it must contain `ctCell`, `decorateContracts`
and `data-ct`. If those three strings are missing, the change was wiped again.

### W3 · the working tree was wiped TWICE — how to get the work back

Same thing W1 and W2 saw, and it happened to my files twice while this row was
running. Both times `git status` went from a page of modified files to almost
clean, with no action of mine. Something in one of the parallel batches is
running `git stash` over the shared working tree before it commits.

It is recoverable. Each wipe leaves a stash:

```
git stash list
git show 'stash@{0}' --stat          # see whose work is in it
git show 'stash@{0}:<path>' > <path> # restore ONE file, leaving the stash alone
```

Restore only your own files that way. **Do not `git stash pop`** — that dumps
every workflow's half-finished edits back over the tree at once.

I keep a copy of my six files outside the repo as well. **W4: before deploying,
check `api/contracts.mjs` contains the string `"remind"` in `ALL_ACTIONS` and
`api/read/contracts.mjs` contains `invalid_document_id`.** If either is missing,
the work was wiped again and needs restoring from the newest stash.

### W3 · answer to W1 on `src/http/contracts-screen.test.mjs` — NOT done, and why

W1 is right that it has to change and right that the file is on my list. I did
not rewrite it, on purpose.

Those 8 assertions describe **W1's screen and W2's screen**, not the back end.
Rewriting them from the outside is how a real regression gets papered over: I
would be writing down whatever the new HTML happens to say, which proves
nothing. The two that matter — the tamper warning and the signed-copy download —
must **move to a documents.html test**, not be deleted, and only someone who
knows what W2's final markup does can write those honestly.

It is also roughly a second task's worth of work on top of this row, which
CLAUDE.md §8 says to re-scope rather than push through.

**Recommendation:** one short follow-up row, after W1 and W2 are both settled,
that rewrites `contracts-screen.test.mjs` for the setup screen and adds a
`documents-screen` test carrying the tamper and download assertions across.
Until then the suite is red on those 8, and that redness is honest — it is
saying two screens changed and their tests have not caught up.

---

## W4 manifest — nav move, tests, journeys (fixer, main thread)

**Files I changed**

| File | What |
|---|---|
| `public/app/sidebar.fragment.html` | `contracts.html` row moved out of the **Funding** group into **Admin**, directly under Products & Commissions, relabelled **Contract templates**. Icon unchanged. |
| 25 × `public/app/*.html` + `public/app/shell.js` | `node scripts/sync-sidebar.mjs` — "wrote aside into 33 screens + shell.js". No page body touched; verified by diffing every modified screen against HEAD with the `<aside>` block masked out. |
| `src/http/contracts-screen.test.mjs` | The 8 red assertions resolved. See below — none deleted for convenience. |
| `src/http/documents-screen.test.mjs` | **NEW.** 9 tests. Home for the assertions that moved with the queue. |
| `docs/journeys/CHANGELOG.md` | One line at top recording the batch and why no journey moved. |

**The 8 red tests — what happened to each**

| Test | Outcome |
|---|---|
| `every endpoint it calls is really routed` | Kept. Threshold `>= 2` → `>= 1`; the page has one literal `/api` call left. The routing assertion — the part that catches a 404 — is untouched. |
| `it tells staff to send from the call…` | **Rewritten** as `it hands off to Documents for anything already sent`, and strengthened: it now also asserts `listBody` and `detailCard` never come back. |
| `the wording card starts hidden…` | **Rewritten** to assert the opposite, because the owner reversed the behaviour. Still asserts the `owner & admin` badge, so a narrower role is told. |
| `void is offered only to an owner or admin` | **Moved** to `documents-screen.test.mjs`, same assertion. |
| `live wordings never paint the sample-markup banner` | Kept; the `live contracts` half moved with the queue. |
| `it shows the status of every contract` | **Moved** to `documents-screen.test.mjs`, plus a `CSTATE` assertion. |
| `it surfaces a tampered contract` | **Moved** to the signing-page block, asserting on `public/contract.html`. See the gap below. |
| `the finished document can be downloaded` | **Moved** to `documents-screen.test.mjs`, same assertion. |

**Gate results (this machine, no `DATABASE_URL`, 2026-08-17)**

* `npm run lint` — clean, 1297 files parse.
* `npm test` — **5629 pass, 2 fail, 3 skipped.** Both failures are other batches' in-flight work, neither touches contracts or documents:
  * `gifts/message-blaster: a gate is referenced but its shape was not recognised` (Message Blaster batch — already recorded as UNVERIFIED in the journeys changelog)
  * `company-brain-affiliate.mjs` no longer passes `orgId` (Company Brain batch)
* `npx tsc --noEmit` — **not run, because it is not a real check.** There is no TypeScript and no tsconfig in this repo; `tsc` with no inputs prints help and exits 0. `.github/workflows/tests.yml:13` already says so. CLAUDE.md §6 lists it as a gate; that line is misleading. Flagged to Chris, not changed.
* `npm run journeys` — all 9 files regenerated **byte-identical**. Correct: no route added or removed, no role gate moved.
* Live Playwright — **not run.** `POST https://fundhub.ai/api/auth/login` returns 500 `cannot execute INSERT in a read-only transaction`. Reproduced independently by W1 and by the fixer. No role can sign in, so no signed-in live check is possible for anybody today.

**GAP — reported, not reconciled (CLAUDE.md §4)**

The staff-side tampered-contract warning is gone from the CRM. It lived on the
contract detail card, which moved off Contracts; Documents did not rebuild a
detail panel, so no staff screen now shows `__integrity` / "It cannot be
signed". **The protection itself is untouched:** `src/contracts/sign.mjs` still
answers 409 `content_changed`, `api/read/contracts.mjs?id=` still returns the
verdict, and `public/contract.html` still tells the signer. What is missing is
staff visibility. Owner's call whether to rebuild it.

## BLOCKER — this batch cannot be committed on its own

`public/app/sidebar.fragment.html` is shared state, and the **subscriptions-removal**
batch's change was already in it before I edited it. So:

* The fragment I edited already had the Subscriptions row removed from Funding.
* `node scripts/sync-sidebar.mjs` therefore carried *their* change into all 25
  screens along with mine. The two are now inseparable in the working tree.
* `public/app/shell.js` additionally carries their non-sidebar edits —
  `subscriptions.html` pulled from `BETA_PAGES`, from `ALL`, and from
  `OWNER_ADMIN_ONLY`, with the explaining comments deleted.

Committing my nav move commits their unfinished batch too, and `main` deploys.
Leaving `shell.js` out instead makes `SIDEBAR_HTML` disagree with the 25 screens,
which fails `app-nav-matches-shell.test.mjs`.

**Not resolvable from inside this batch.** Escalated to Chris. Recommendation:
let the subscriptions-removal batch land its own commit first, then this one
goes on top cleanly.

**Nothing committed, pushed, or deployed.** Backups of the two finished screens
are outside the repo, and `w1/contracts.html.w1-result` + `reapply-w1-change.py`
remain in the evidence folder.

### BLOCKER RESOLVED — built in a worktree instead

The entanglement above was solved by leaving the shared checkout rather than
untangling it. `git worktree add -b fix/contracts-template-loader <scratchpad> HEAD`
gave a pristine tree; the batch's files were copied in, and the nav move was
re-applied to the **pristine** `sidebar.fragment.html` before re-running the
sync. That dropped the subscriptions-removal batch's fragment change entirely,
so the branch carries only this batch's rows.

* Commit `a49e11a` on `fix/contracts-template-loader`
* PR https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/84
* Worktree gates: lint clean · `journeys:check` up to date · `npm test`
  **5627 pass / 4 fail / 3 skip**, and all 4 failures reproduce on `main`
  without this branch.

**`main` is red on its own, and it is shipping a dead link.** Another batch
deleted `public/app/subscriptions.html` and committed it, but left the row in
`sidebar.fragment.html` and seven references in `shell.js`. Live:
`https://fundhub.ai/app/subscriptions.html` → **404**, and every screen's
sidebar still offers it. Two suite failures come from exactly that. Not this
batch's to fix (owner-scope) — reported to Chris.

Still owed on this branch once sign-in works: live Playwright to 100/100 and
the human click path. Row W4 stays open until then.
