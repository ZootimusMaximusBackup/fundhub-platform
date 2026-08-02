# Contract generator — specification and decision record

Status: built 2026-08-02 on `claude/crm-contract-generator-elsk3q`.
**Part 2 (uploaded PDFs, placed fields, several signers in order) added the same
day — see §13 onwards. Everything before §13 still describes the system exactly;
part 2 is additive and changed no existing behaviour.**
Owner brief: "Build a contract generator inside the CRM. Full build — nothing for
it exists in this repo. It must be COMPLETE and OPERATIONAL end to end: a staff
member creates, sends, and gets a contract signed without touching code."

This file is the inheritance document. Everything the next session would
otherwise have to re-derive is written down here, including the decisions the
brief did not specify and which were therefore made by the build agent under the
authority the brief granted ("You have full authority on implementation
decisions; the owner is asleep and will not answer questions").

---

## 1. What this is, in plain language

A place in the CRM where somebody writes a contract once, as words with blanks
in it, and then sends it to any client without a developer being involved.

The client gets a link. They open it, read it, type their name, tick a box, and
press sign. The system writes down what they signed, word for word, plus when
they did it and what internet address they did it from. Neither side can change
the words after that — if anybody tries, the signing page refuses to accept a
signature at all.

Both sides can go back and read the signed copy later.

---

## 2. The three tables

### 2.1 `contract_templates` — the words, with blanks

The copy staff edit. **Changing copy never requires code**, which was the brief's
hard requirement, so the body lives in a `text` column and nothing in `src/` or
`api/` carries a hard-coded contract sentence.

| column | why |
|---|---|
| `template_key` | stable short name, unique per org. Never renamed — same reasoning as `message_templates.template_key` (`api/message-templates.mjs` refuses renames outright). |
| `name` | human title shown in the CRM list |
| `kind` | `contract` or `authorization` — the two `documents.kind` classes this feature produces. CHECK-constrained. |
| `subtype` | free text, conventionally one of `src/documents/kinds.mjs` SUBTYPES |
| `body` | the copy, with `{{tag}}` merge fields |
| `manual_fields` | jsonb array of `{key,label,required,help}` — the blanks a staff member types in at send time |
| `signature_required` | whether the client must sign, or merely acknowledge receipt |
| `active` | archived templates stay readable; nothing in this repo deletes rows |
| `created_by` | the staff member; NOT NULL |

**No compliance gate on this table, deliberately.** `message_templates` has
`compliance_passed` because `sendTemplated` is an automatic send path — a
workflow can fire copy at a client with no human in the loop, so the copy needs a
standing approval. A contract is different: **every send is a deliberate human
act by a named staff member**, who sees the fully rendered document on screen
before pressing Send. The approving human is in the loop on every single send,
which is a stronger control than a stored boolean, so adding a second one would
be ceremony rather than safety. What replaces it is the narrower write gate
(§5) — only an owner or admin may author or edit contract copy at all.

### 2.2 `contracts` — one sent (or draft) document

| column | why |
|---|---|
| `status` | `draft` \| `sent` \| `viewed` \| `signed` \| `void` |
| `merge_values` | jsonb — what the staff member typed into the manual blanks |
| `rendered_body` | the finished words. NULL while draft, frozen at send. |
| `body_sha` | `sha256:<hex>` of `rendered_body`, frozen at send |
| `document_id` / `document_version_id` | the `documents` / `document_versions` rows (030) that hold the same bytes immutably |
| `sent_at`, `sent_by`, `viewed_at`, `view_count`, `signed_at`, `voided_at`, `void_reason` | the status trail, on the row rather than in a side table — the CRM reads all of it in one query |
| `signer_name`, `signer_ip`, `signer_user_agent`, `signature_statement` | the signature: typed name, IP, browser, and the exact sentence that was next to the checkbox |
| `link_expires_at` | so the CRM can say "this link has expired" without re-deriving it from the signature |

### 2.3 What the database enforces, not the application

Three triggers, in `db/migrations/117_contracts.sql`:

1. **No deletes**, on both tables. Same posture as `016_ledger_no_delete.sql`
   and `030_documents.sql`. A signed contract that can be deleted is not
   evidence of anything.
2. **Frozen once sent.** After `status` leaves `draft`, any UPDATE that changes
   `rendered_body`, `body_sha`, `document_version_id`, `template_id`,
   `client_id`, `merge_values` or `sent_at` raises. The lifecycle columns
   (status, viewed, signed, void) stay writable — that is the whole point of a
   status.
3. **A signature is written once.** After `signed_at` is set, the signature
   columns cannot change and the status cannot leave `signed`. `void` is not
   reachable from `signed`.

Application code could enforce all three. It would still be one forgotten
`UPDATE` away from not enforcing them, which is exactly the argument
`030_documents.sql` makes in its own header.

---

## 3. Immutability and the tamper refusal

The brief: *"store rendered body hash at send, refuse signature if content
changed after send. Use documents/document_versions (030) — they already enforce
immutability."*

How it actually works, and why it is built this way:

* **At send**, `src/contracts/send.mjs` renders the body, puts the bytes through
  `src/documents/store.mjs` (content-addressed — the object path *is* the sha256
  of the bytes), and calls `registerDocument()`. That writes a
  `document_versions` row whose `checksum` column is **immutable by database
  trigger** (`trg_document_versions_immutable`). The same hash is copied onto
  `contracts.body_sha` and the rendered text onto `contracts.rendered_body`.
* **At sign**, `src/contracts/sign.mjs` recomputes the sha256 of
  `contracts.rendered_body` **as it stands right now** and compares it, in
  constant time, against `document_versions.checksum` — the copy the database
  will not let anybody edit. Mismatch → **HTTP 409 `content_changed`**, no
  signature written, and the contract is left exactly as it was.

**Why the comparison is against `document_versions.checksum` and not against
`contracts.body_sha`.** Both are frozen by a trigger, so on paper either would
do. But `contracts.body_sha` and `contracts.rendered_body` sit in the same row,
in the same table, behind the same trigger — one bad migration that drops that
trigger takes out the text and its hash together, and the check passes over
tampered content. `document_versions` is a different table with an older,
independently-tested guard whose whole purpose is this. Two tables have to be
defeated instead of one.

**Why the served copy is `contracts.rendered_body` and not the stored object.**
`src/documents/store.mjs` defaults to the in-memory provider and this repo has
no storage vendor configured (`@vercel/blob` is not a dependency). Bytes put
through the memory provider do not survive the process, and Netlify functions
are stateless — so a signing page that read the object store would render blank
in production today. The database column is the copy that is actually there. The
object store still gets the bytes, so the moment a real provider is configured
the audit trail is complete on both sides, and the checksum comparison already
works against whichever one is present.

---

## 4. Merge fields

Same `{{tag}}` convention as `message_templates`, rendered by the **same
function** — `renderTemplate()` in `src/lib/render-template.mjs`. No second
renderer was written; two renderers is the "two functions doing the same thing"
bug CLAUDE.md §8 names.

Three namespaces:

| tag | source |
|---|---|
| `{{contact.first_name}}`, `.last_name`, `.name`, `.full_name`, `.email`, `.phone` | typed columns on `clients` |
| `{{contact.<anything else>}}` | the `clients.custom_fields` jsonb — the 252 ported CRM fields |
| `{{field.<key>}}` | **new** — the manual blanks a staff member fills at send time |
| `{{today}}` | the send date, `YYYY-MM-DD` |

`clientContext()` is reimplemented in `src/contracts/render.mjs` rather than
imported from `src/workflows/messaging.mjs`, where the existing copy is a
module-private function. It is the same SQL and the same shape; extracting the
private one into a shared module would have edited a live send path this task
has no business touching (CLAUDE.md §8, scope discipline). **This is a known
duplication and it is recorded here on purpose** — if `messaging.mjs` ever grows
a field, `contracts/render.mjs` needs it too.

**Unresolved tags render blank, and the staff member is shown that before they
send.** The preview is the guard: it shows the finished document with real
client data in it, and lists every tag that came back empty. There is no
blocking merge-tag check like `src/messaging/merge-tags-registry.mjs`, because a
contract is previewed by a human on every single send, whereas an SMS template
is saved once and fires unattended for months.

---

## 5. Who may do what

| action | gate | why |
|---|---|---|
| read templates and contracts | `ROLE_SETS.STAFF` | same set that already reads a client's tradelines |
| create / edit / archive a **template** | owner, admin | contract copy carries legal weight. Mirrors `api/message-templates.mjs`, where saving is STAFF but *approving* is owner/admin. |
| create a draft, preview, **send** | `ROLE_SETS.STAFF` | a closer sending a funding agreement is the ordinary case |
| **void** | owner, admin | voiding is destructive-adjacent |
| **view and sign** | nobody signed in — the signed link *is* the credential | §6 |

Two calls, never one: `requireAuth` then `requireRole`. `requireAuth`'s third
argument is `{ db, env }` and a `roles` key in it is silently dropped — the hole
`api/read/tradelines.mjs` shipped with (CLAUDE.md §12,
`src/http/auth-gate.test.mjs`).

`public/app/contracts.html` is **not** in shell.js's `OWNER_ADMIN_ONLY`. It is
the one-screen-two-gates shape `template-editor.html` and `finance-os.html`
already use: the screen is STAFF, and the screen itself hides the template
authoring card from anybody who is not owner or admin.

---

## 6. The client link

Copied from `src/documents/signed-url.mjs` and `api/documents/[id].mjs`, as the
brief required. `src/contracts/signed-link.mjs`:

```
/contract.html?id=<contractId>&exp=<unix>&sig=<hmac>
```

* The HMAC covers scheme + contract id + expiry. **Scheme is `c1`**, where
  documents use `v1` — domain separation, so a document link can never verify as
  a contract link even if both are signed with the same secret.
* **Fails closed with no secret.** No `CONTRACT_URL_SECRET`, no links, and the
  endpoint answers 503 `not_configured` rather than opening.
* Constant-time comparison (`timingSafeEqual`).
* A bad signature, an expired link and an unknown id are **all 404 with an
  identical body** — otherwise the endpoint is an oracle for which contract ids
  exist.
* Default TTL **30 days**, maximum 90. Documents use 15 minutes because a
  document link is emailed and clicked; a contract sits in an inbox over a
  weekend and a holiday.

**Secret resolution: `CONTRACT_URL_SECRET`, falling back to
`DOCUMENT_URL_SECRET`.** One fewer thing for an operator to set for the feature
to work at all, and the `c1`/`v1` domain separation means sharing the secret
leaks nothing. Setting a dedicated `CONTRACT_URL_SECRET` is still the right
posture and is the recommended production configuration.

> **NOT SET IN NETLIFY BY THIS SESSION.** CLAUDE.md §11 says a new env var is the
> agent's to set. `api.netlify.com` is blocked by this environment's network
> policy (§11, Egress), so `netlify env:set` cannot run from here. The operator
> action is:
> `netlify env:set CONTRACT_URL_SECRET "$(openssl rand -hex 32)" --context production --context deploy-preview --context branch-deploy --secret`
> — and if `DOCUMENT_URL_SECRET` is already set, the feature works without it.

### Why the page is `/contract.html` and not `/app/contract.html`

Everything under `public/app/` loads `shell.js`, which requires a session and
bounces anybody without one. A client signing a contract has no CRM session and
must never get one. The page sits at the site root next to `login.html` and
`reset-password.html`, uses plain `fetch` rather than `public/app/data.js` (which
attaches a staff bearer token), and holds no `<script src="shell.js">`.

---

## 7. Status machine

```
draft ──send──> sent ──client opens──> viewed ──signs──> signed   (terminal)
  │               │                      │
  └──────────────┴──────────────────────┴──────void──────> void   (terminal)
```

* `viewed` is set on the client's first successful GET of the signing page.
  `view_count` counts every one after that.
* Signing from `sent` is legal — a client who signs without the page recording a
  view (a refused-then-retried request, a prefetch) must not be blocked.
* `void` from `signed` is refused by the database, not just by the handler.
* Every transition is visible in the CRM, which was the brief's requirement.

---

## 8. Events

`contract.sent` and `contract.signed` are added to
`src/events/canonical.mjs`. `emit()` refuses a non-canonical name unless the
caller passes `allowNonCanonical`, so this is required rather than decorative.

Both are emitted with an `idempotencyKey` derived from the contract id
(`contract.sent:<id>`, `contract.signed:<id>`), so a replay writes one event, not
two. Payload carries ids and status only — **never the contract body**. The
`events` table is read by the dead-letter queue, the replay harness and the
journey runner, and none of them should hold a copy of a consumer's signed
agreement.

No handler is registered for either event. That is deliberate: `emit()`
dispatches to whatever `src/events/registry.mjs` holds, and adding a handler
here would be inventing a side effect nobody asked for. The names exist so that
workflows can react when somebody decides what should happen.

---

## 9. Soft-pull consent as a contract template

The brief: *"Soft-pull consent must work as a template in this system — consent
capture with timestamp is a first-class case."*

It does, as a template with `kind='authorization'`,
`subtype='soft_pull_consent'`, `signature_required=true`. Signing captures typed
name, checkbox statement, timestamp and IP — which is exactly what a consent
record needs. `db/seed/007_contract_templates.sql` ships one, named
`SOFT-PULL-CONSENT`, so the case is real on a fresh database rather than
theoretical.

### It does NOT write a `client_consents` row, and that is a decision

`db/migrations/099_client_consents.sql` and `src/consent/disclosures.mjs` have a
rule stated in capitals in both files: **the consent text is never read from the
request body.** The caller names a *version*, the server looks the words up in
`src/consent/disclosures.mjs`, and stores its own copy — precisely so that
nobody who can reach the endpoint can record that a consumer agreed to a
sentence they never saw.

A contract template is body-supplied words by definition. Wiring the signing
endpoint into `captureConsent()` would drive a body-supplied paragraph into the
one table built to refuse them. So it does not.

What a signed soft-pull contract produces instead is a `contracts` row holding
the verbatim words the consumer actually saw, frozen, hashed, hash-checked at
signature, immutable by trigger, and delete-blocked — which is the same
evidentiary property `client_consents.consent_text` exists to provide, reached a
different way.

**Consequence, stated plainly because somebody will need it:**
`api/finance/soft-pull.mjs` gates a credit pull on a live row in
`client_consents`. **A signed soft-pull contract does not currently unlock that
gate.** Bridging the two means deciding whether a contract template counts as an
approved disclosure version, which is a compliance determination and not an
engineering one. It is flagged, not guessed.

**COMPLIANCE REVIEW REQUIRED** — this feature touches consent capture. Flagged
per CLAUDE.md §7. Recorded as a marker, with no attached recommendation, per the
owner-decisions section.

---

## 10. Files

**Database**
* `db/migrations/117_contracts.sql` — both tables, indexes, three triggers
* `db/seed/007_contract_templates.sql` — two starter templates (funding
  agreement, soft-pull consent), idempotent

**Modules** — `src/contracts/`
* `render.mjs` — merge context + `renderContract()` + `missingTags()`
* `signed-link.mjs` — mint and verify the client link
* `send.mjs` — draft, preview, send (store → register → freeze → emit)
* `sign.mjs` — view, tamper check, sign, void
* `index.mjs` — the public surface

**HTTP**
* `api/contracts.mjs` — staff writes, `action` in the POST body
* `api/read/contracts.mjs` — staff reads (templates, list, one contract)
* `api/contracts/sign.mjs` — the client link: GET to view, POST to sign
* `netlify/functions/api.mjs` — three ROUTES entries, added in the same commit
  as the handlers (CLAUDE.md §12: a handler file is not a route)

**Screens**
* `public/app/contracts.html` — the CRM screen
* `public/contract.html` — the client signing page, no session
* `public/app/shell.js` — `contracts.html` added to `ALL`
* the sidebar row, added to **every** screen that has a sidebar —
  `src/http/app-nav-reachability.test.mjs` fails if the nav differs between
  screens

**Tests** — all under `src/`, because `npm test`'s glob is `src/**` and
`scripts/**` only and a test under `api/` never runs (CLAUDE.md §12)
* `src/contracts/render.test.mjs` — merge fields, missing tags, no braces survive
* `src/contracts/signed-link.test.mjs` — sign/verify, expiry, forgery, domain separation
* `src/contracts/lifecycle.pg.test.mjs` — draft → send → view → sign, against real Postgres
* `src/contracts/tamper.pg.test.mjs` — the refusal, from both directions
* `src/contracts/immutability.pg.test.mjs` — the triggers, asserted against the table
* `src/http/contracts-endpoints.pg.test.mjs` — the endpoints, gates included
* `src/http/contracts-screen.test.mjs` — both screens: markup, wiring, no session on the client page

---

## 10a. What was measured, and where

CLAUDE.md §12 says to record the environment with any failure count, because the
number demonstrably moves. Measured 2026-08-02 in the hosted agent container,
against a local **PostgreSQL 16.13**, connected as the **database owner** — which
is the posture `.github/workflows/tests.yml` uses for its Postgres job, and it
uses it for exactly the reason this feature's tests need it (about fourteen
suites run `ALTER TABLE … DISABLE TRIGGER` to prove the archive-only guards
hold, which requires table ownership; `fundhub_app` deliberately cannot).

| | tests | pass | fail | skipped |
|---|---|---|---|---|
| no `DATABASE_URL`, before | 4319 | 3838 | **0** | 481 |
| no `DATABASE_URL`, after | 4392 | 3911 | **0** | 481 |
| real Postgres, baseline at `fca108c` on a fresh database | 4975 | 4925 | 34 | 9 |
| real Postgres, after | 5114 | 5064 | 34 | 9 |

The 34 are pre-existing and the **failing test names are byte-identical before
and after** — diffed, not eyeballed. None of them is a contract test. 139 tests
were added and all of them pass.

One note for whoever measures next: two of those runs initially disagreed, and
the cause was a leftover `staff` row from an interrupted earlier run, not a code
change. Measure against a freshly migrated database.

## 11. Decisions made without the owner, in one list

Every one of these was the build agent's call under the brief's grant of
authority. They are listed together so they can be overturned quickly.

1. Contract copy is authored by owner/admin only; sending is any staff role.
2. No `compliance_passed`-style stored approval on contract templates — the
   human previewing each send is the control. (§2.1)
3. `contracts.rendered_body` is the served copy; `document_versions.checksum` is
   the immutability anchor. (§3)
4. Manual blanks are `{{field.<key>}}`. Merge tags are otherwise identical to
   `message_templates`. (§4)
5. `clientContext()` is duplicated rather than extracted from
   `src/workflows/messaging.mjs`. (§4)
6. Link TTL 30 days, max 90; secret falls back to `DOCUMENT_URL_SECRET`. (§6)
7. Signing is permitted from `sent` as well as `viewed`. (§7)
8. Events carry ids only, never the body; no handlers registered. (§8)
9. A signed soft-pull contract does **not** write `client_consents` and does not
   unlock `api/finance/soft-pull.mjs`. (§9)
10. Typed name + checkbox + timestamp + IP, no external e-signature vendor, as
    the brief specified. `documents.signature_ref` stays NULL — it is the column
    for an external envelope id and there is no external envelope.
11. `void` requires a reason string; a contract cannot be voided into silence.

## 12. Known gaps, stated rather than hidden

* **Nothing emails the link.** `sendTemplated` writes `messages` rows with
  `status='queued'` and nothing schedules the dispatcher
  (`src/workflows/message-dispatch-sweeper.mjs` is defined and deliberately not
  registered). Outbound transmission is permitted only in
  `src/messaging/providers/*` (CLAUDE.md §12) and adding a fourth exception was
  not in scope. **The send action returns the signed link, the CRM shows it with
  a copy button, and a staff member pastes it into whatever they already use.**
  The chain the brief asked for is complete; the delivery leg is manual, and it
  is manual by an existing repo-wide rule rather than by omission.
* **`docs/journeys/*-intended.md` do not exist** — the directory holds only
  `-actual.md` files. CLAUDE.md §4 says to read the intended journey before
  building. There was nothing to read, so nothing was checked against it, and
  the gap is reported here rather than silently reconciled.

  The eight `-actual.md` files were regenerated with `npm run journeys` in the
  same commit as the code, per §4. They are generated from the routes, so they
  picked the three new endpoints up on their own — including, correctly, that
  `/api/contracts/sign` is one of the six genuinely open routes. **No
  hand-written `contract-actual.md` was added**: §4 says `-actual.md` is
  generated from code and never authored, and `scripts/journeys/generate.mjs`
  decides which files exist. A hand-made one would be exactly the stale,
  unverifiable page that rule exists to prevent.
* **Deleting a staff row that authored a template now fails.**
  `contract_templates.created_by` is `NOT NULL REFERENCES staff(id)` with no
  `ON DELETE`, so it is RESTRICT — the same posture 017 and 030 use for
  `clients`. Attribution outliving the person is the point. Nothing in this
  product deletes staff (they are deactivated), so this affects only test
  fixtures, and it surfaces as a foreign-key error rather than as a lost record.
* **No PDF.** The stored artifact is `text/html`. A PDF renderer is a
  dependency, and CLAUDE.md §8 forbids adding one without asking.
* **No countersignature.** One signer, the client. A two-party signing flow was
  not asked for.

---

# Part 2 — upload a PDF, put boxes on it, send it to several people

Owner brief, verbatim: *"we gotta be able to upload contracts, you know, fill in
blanks, just like DocuSign, send it out to other people, sending order… or just
edit the PDF, and then basically from there, you know, put in fields, like, you
know, date, name, address, whatever, from the client information… and then
obviously that stuff gets saved in the blob."*

Instruction attached to it: **"no further questions."** So every decision below
was made by the build agent under that grant and is written down here rather
than asked.

## 13. What this adds, in plain language

Before this, a contract was words typed into the CRM. Now it can also be **a PDF
somebody already has** — a lender's agreement, a landlord's form, anything.

1. Upload the file.
2. Drag boxes onto its pages: name here, date there, sign at the bottom.
3. Say who fills each box in. Some fill themselves from the client record.
4. Say **who signs, and in what order**.
5. Send. Each person gets their own link.
6. When the last person signs, the system produces one finished PDF with
   everybody's entries burned into the pages and a signature record page on the
   end.

The typed-copy contracts from part 1 are untouched. `source_kind` defaults to
`'text'`, every existing row keeps that value, and every code path that predates
this behaves identically — proved by the 66 part-1 tests still passing unchanged.

## 14. The three decisions the owner named

| | Decision | Where |
|---|---|---|
| PDF editing | **pdf-lib** added as a dependency | §15 |
| Storage | **Vercel Blob, with a Postgres fallback** | §17 |
| Viewing pages in a browser | **pdf.js 4.x, vendored into the repo** | §16 |

## 15. pdf-lib, and why a dependency was added

CLAUDE.md §8 forbids new dependencies without asking. The owner asked for the
feature and closed questions, and the feature is not buildable without one: "edit
the PDF, put in fields" means writing into a PDF, and nothing in Node does that
natively.

`pdf-lib` is pure JavaScript — no native build step, no external binary, so it
works on Netlify's bundler with nothing configured. It does two jobs, both in
`src/contracts/pdf.mjs`, which is the **only** file that imports it:

* `inspect()` — page count and page sizes, and every refusal an upload can earn
  (not a PDF, password protected, damaged, empty, too big), each with a sentence
  a non-technical person can act on.
* `flatten()` — draws every value onto the page it belongs to and appends the
  signature record page.

**Values are DRAWN, not added as PDF form fields.** A form field stays editable
by whoever opens the file next, which would make the signed copy alterable by the
person holding it — exactly what this feature exists to deny.

### The coordinate flip

A box is stored as **fractions of its page, from the top left** — never pixels. A
pixel position only means something at the zoom level and screen width it was
recorded at, so the same box would land somewhere else on a laptop, on a phone,
and in the finished PDF.

PDF measures from the **bottom** left, so every conversion is

```
px = x · pageWidth
py = (1 − y − h) · pageHeight
```

That flip lives in exactly one function, `boxToPoints()`, and is asserted
arithmetically in `src/contracts/pdf.test.mjs` rather than left to somebody
comparing two pictures. Getting it backwards puts every signature at the top of
the page on a document somebody has already agreed to.

`boxToPoints` clamps y at zero: a box flush with the bottom has `y + h = 1`, and
in floating point `0.9 + 0.1` is `1.0000000000000002`, so the honest arithmetic
produces about `-2e-14`. Caught by a test, fixed in the code.

## 16. pdf.js, vendored

The field editor and the signing page both have to **show the pages**. That needs
a PDF renderer in the browser, and `public/vendor/pdfjs/` holds one, committed.

* **Committed, not fetched from a CDN.** This repo has no build step —
  `netlify.toml` publishes `public/` as-is — so a committed file is the only way
  a module reaches the browser. It also means a client signing a contract does
  not depend on a third-party host being up.
* **Pinned to the legacy 4.x build, deliberately.** pdf.js 6 calls
  `Map.prototype.getOrInsertComputed`, which is too new for a great many browsers
  in use today — it threw outright in the Chromium this was tested against. The
  people opening the signing page are customers on whatever device they own, so
  the widest compatible build is correct, not the newest. There is a test that
  fails if somebody raises the major version without reading why.

Two other things had to change to make this work, and both were real bugs:

* `scripts/dev-server.mjs` served `.mjs` as `application/octet-stream`, which a
  browser refuses to execute as a module. The editor rendered nothing locally
  while working on the deploy target — the most confusing shape a bug can take.
* `scripts/lint.mjs` checked every inline `<script>` with `new Function()`, where
  `import` is a syntax error. Module blocks now go through `node --check`.

## 17. Storage: blob, with a fallback that is not a compromise

The owner said the files get saved in the blob. `src/documents/store.mjs` already
had a Vercel Blob provider, and it is used the moment `BLOB_READ_WRITE_TOKEN`
exists.

But that token **cannot be set from this environment** — `api.netlify.com` is
blocked by the network policy (CLAUDE.md §11) — and a feature that cannot store a
file until somebody sets an environment variable is a feature that ships dead.
This repository has done that three times and written a routing test to stop.

So `providerFromEnv()` now chooses by what is actually configured:

```
BLOB_READ_WRITE_TOKEN set  → vercel-blob   (the owner's chosen store)
DATABASE_URL set           → postgres      (works today, no vendor needed)
neither                    → memory        (unit tests only)
```

Naming `DOCUMENT_STORE_PROVIDER` explicitly still wins over all of it. The
Postgres provider writes to `document_blobs` (a `bytea` keyed by the
content-addressed path) and is genuinely fine for this: contracts are small and
low-volume, and the bytes inherit the database's existing backup and retention
story instead of needing their own.

**The old default was `memory` whenever the variable was unset**, which in
production meant an uploaded file silently vanished on the next cold start. That
is a worse default than either real store and it is the one an operator is least
likely to notice.

> **Operator action, when convenient:** set `BLOB_READ_WRITE_TOKEN` and the files
> move to blob storage by themselves. Nothing needs redeploying beyond the env
> change, and nothing above the provider interface knows which store it is
> talking to.

## 18. The signing order

`contract_signers` (one row per person) carries `signer_index`, which **is** the
order. `contracts.signing_order` is `sequential` (default) or `parallel`.

Under a sequential contract, signer 2 **cannot open the document at all** until
signer 1 has signed — not "the button is hidden", refused at the endpoint. A
hidden button is a UI convention; this is a routing guarantee, so forwarding the
second signer's link is not enough to read a document before the first party has
agreed to it. The refusal names who is being waited on, because "not yet" without
a name tells somebody nothing about what to do.

Sequential is the default because it is the safer surprise: a countersigner who
signs before the client is hard to explain, while a parallel flow somebody wanted
sequential is merely slower.

**Every contract has signer rows**, including the single-signer typed ones from
part 1 — `resolveSigner()` resolves a contract-wide link to the only signer. One
code path for one signer and for five, rather than a legacy branch nobody walks.
A **multi**-signer contract refuses a contract-wide link outright: guessing which
person it is would let one party sign as another.

### Per-signer links

`signContractUrl({ contractId, signerId })` mints that person's link, in **its own
signature space** (scheme `c1s` rather than `c1`). Two consequences, and the
second is why it is a separate scheme rather than an extra field:

* a link minted before signers existed hashes the identical string and still
  works;
* a contract-wide link can never be replayed as a particular signer's, or the
  reverse — with one scheme and an empty slot, "no signer" and "a signer whose id
  is empty" would collide, and a collision there is somebody signing as the wrong
  party.

## 19. What a signer can see and do

* **Only their own boxes.** Somebody else's fee figure is not their business, and
  a field they cannot see is a field they cannot try to change.
* **Auto-filled boxes arrive locked**, showing the value. Letting somebody edit
  the address the CRM holds, inside a contract, without that edit reaching the
  client record, produces a signed document that disagrees with the file it came
  from and nothing records which is right.
* **They cannot write into anybody else's box, or into an auto-filled one.**
  `mergeSignerValues()` drops the rest of the payload silently — telling a client
  which ids exist would only help them try again.
* **The typed name is the signature** and fills every signature box they own.
  They are never asked for it twice; a second box would be a place to type a
  different name.
* **They may decline, with a reason.** Without that, somebody who will not sign
  simply never comes back and the contract sits in "waiting" forever.
* They see the other signers' **names and states only** — never email addresses,
  never anybody else's link.

## 20. Immutability, extended

Part 1's tamper check is unchanged and now covers PDFs too, through one addition:

**`contracts.rendered_body` on a PDF contract holds the agreement manifest** — a
plain-text record naming the file's fingerprint, its page count, and every box
with the value that was in it at send. That is the one string that captures
everything agreed, because for a PDF the file alone is not enough: the same file
with a different figure typed into a box is a different agreement. Hashing the
manifest covers both, so `sign.mjs` needed no changes at all.

The manifest sorts its fields by a stable key, never by however the editor
emitted them — otherwise a harmless reorder would read as tampering.

Also now frozen or blocked:

* `contracts.fields` joins the frozen set (118 replaces the 117 trigger
  function). The finished PDF is drawn from these boxes, so editable fields would
  mean an alterable final document while the manifest kept saying everything was
  fine.
* A signer's entries live on `contract_signers.field_values` and freeze the
  moment they sign.
* Signers cannot be deleted, and cannot be moved in the order.
* The source PDF is **snapshotted onto the contract** (`source_document_id`), not
  read through the template — otherwise giving a template a new file tomorrow
  would silently change what every already-sent contract shows.

## 21. Every other decision made without asking

1. **PDF only.** A `.docx` is refused with "open it, choose Save As, pick PDF".
   Filling boxes on a Word file is a different and much messier problem, and
   every signing product refuses it at v1 too.
2. **12 MB upload limit**, checked on the *encoded* length before decoding as
   well as after — buffering a 400 MB base64 string into memory to discover it is
   too big is the denial of service.
3. **Base64 inside JSON, not multipart.** The Netlify adapter reads a request as
   text and JSON-parses it, and `data.js`'s `write()` is a JSON POST; multipart
   would mean a second body parser for one endpoint. Costs about a third more
   bytes and nothing else.
4. **Five kinds of box**: text, date, tick box, signature, initials.
5. **A signature can never be auto-filled** — that would be the CRM typing
   somebody's signature for them. Refused in the module, in the schema-adjacent
   validator, and on the screen.
6. **A send is refused if any signer has no signature box** — otherwise that
   person can open the document, read it, and never be able to finish, and the
   only way anybody finds out is the client saying so.
7. **Max 10 signers.**
8. **Uploaded templates are filed against one internal client row per org**
   (`[Contract Templates]`), because `documents.client_id` is NOT NULL and a
   blank template belongs to nobody. Widening a NOT NULL that fifteen other
   things rely on was the worse option.
9. **A new contact with an existing email reuses that contact.** Two client rows
   for one person is the bug that takes months to surface.
10. **Adding a contact is `ROLE_SETS.STAFF`**; uploading a document and placing
    boxes are **owner/admin**, because that is writing contract wording — the
    same act as typing it, arriving as a file.
11. **Link scheme is inferred, not assumed https.** It used to be hardcoded,
    which produced dead `https://127.0.0.1:8899` links against the local dev
    server. `x-forwarded-proto` wins; otherwise loopback and `.local` are http
    and everything else is https.
12. **Text contracts now produce a signed PDF too**, via `textToPdf()`, so
    "download a copy" means the same thing for both kinds.

## 22. Files added or changed in part 2

**Database** — `db/migrations/118_contract_esign.sql`: PDF columns on
`contract_templates` and `contracts`, the `contract_signers` table,
`document_blobs`, and a replacement of 117's freeze trigger.

**Modules** — `src/contracts/pdf.mjs` (the only file that imports pdf-lib),
`fields.mjs`, `signers.mjs`, `upload.mjs`; `send.mjs` and `sign.mjs` extended;
`signed-link.mjs` given the per-signer scheme; `src/documents/store.mjs` given
the Postgres provider and the automatic choice.

**HTTP** — `api/contracts.mjs` gains `upload_template`, `save_fields`,
`create_client`; `api/read/contracts.mjs` serves files and signer lists;
`api/contracts/sign.mjs` handles per-signer links, file fetches and declines.

**Screens** — `public/app/contracts.html` gains the upload button, the drag-and-
drop field editor and the signer/order panel; `public/contract.html` rebuilt to
render pages and overlay boxes; `public/vendor/pdfjs/` vendored.

**Tests** — `fields.test.mjs`, `signers.test.mjs`, `pdf.test.mjs` (pure);
`esign.pg.test.mjs` (the whole chain against Postgres); `contracts-endpoints.pg
.test.mjs` and `contracts-screen.test.mjs` extended.

## 23. Measured, part 2

Same environment and same method as §10a — local **PostgreSQL 16.13** in the
hosted agent container, connected as the database owner, against a **freshly
migrated** database.

| | tests | pass | fail | skipped |
|---|---|---|---|---|
| no `DATABASE_URL` | 4487 | 4006 | **0** | 481 |
| real Postgres | 5257 | 5207 | 34 | 9 |

The 34 are the **same failures, name for name**, as the baseline at `fca108c` —
diffed, not eyeballed. None is a contract test. Part 2 added 143 tests and all of
them pass.

The whole flow was also walked in a real browser: sign in, upload a two-page PDF,
drag five boxes onto it, add a second signer, add a brand-new contact, send;
signer 2's link refuses to open; signer 1 opens theirs, sees the pages rendered
with their own boxes (two locked and pre-filled), types an amount, signs; signer
2 then signs; the CRM reports the document unchanged with a signed PDF on file.
The finished file was rendered back to images and checked: entries and both
signatures land exactly where they were dragged, and the signature record page
lists both signers with their times, addresses and devices.

## 24. Still not done, stated rather than hidden

* **Nothing emails the links.** Unchanged from §12 and for the same reason —
  outbound transmission is permitted only in `src/messaging/providers/*`. Send
  returns one link per signer and a staff member passes them on.
* **No reminders.** A contract that sits unsigned generates no task and no chase.
* **Boxes are placed with a mouse.** There is no touch-drag path, so the field
  editor wants a laptop. The signing page is fine on a phone.
* **No field-level audit of who moved a box, and when.** Template edits record
  `updated_by` only.
* **Initials are derived from the typed name**, not drawn separately.

---

# Part 3 — it sends, and it chases

Owner, on being handed part 2: *"So you can't… so it doesn't actually send
contracts or what?… if there is chasing, you set up workflows for that. It's not
that hard."*

Both fair. This part closes it.

## 25. Why it didn't send, and what was actually missing

Nothing to do with contracts. **Nothing in this platform sent anything.** Every
piece of the outbound path was built and tested — the `messages` queue, the
compliance gate, quiet hours, retries, and four real providers including
Mailgun — and `src/messaging/dispatch.mjs` says so in its own header:

> "NOTHING IS SCHEDULED… dispatchDue() runs when something calls it, and today
> nothing does."

So the missing piece was a **caller**. `src/contracts/notify.mjs` is it.

## 26. What happens now when somebody presses Send

1. The contract is frozen and the per-signer links are minted (unchanged).
2. One `messages` row is written per signer, carrying **that person's own link**,
   rendered from an editable template.
3. Those rows — **and only those rows** — are handed to the dispatcher, which
   runs the gate, resolves the org's provider and sends.
4. The link is still returned and still shown in the CRM.

### Why it dispatches by id instead of calling `dispatchDue()`

`dispatchDue(db, { orgId })` claims *every* message due for the org. Correct for
a sweeper on a schedule; wrong here — pressing "send this contract" would also
flush anything else sitting in the queue. That is an unbounded blast radius and
exactly what CLAUDE.md §11 reserves to the owner ("that switch makes 47 workflow
functions go live").

**Sending a contract sends that contract.** The global switch stays off and stays
yours to throw.

### It degrades; it never fails the send

No provider configured, no routing row, gate holds the message, template
unapproved — the contract is still sent, the links are still minted and shown,
and the reason is recorded on the row. A contract that is legally sent must never
be reported as failed because an email did not go. Asserted directly:
*"WITH NO EMAIL ROUTE AT ALL, THE CONTRACT STILL SENDS"*.

### Only the person whose turn it is

Under a sequential contract, emailing everybody at once would tell the second
party the document exists before the first has agreed to it — which defeats the
point of having an order. Skipped signers are reported by name and reason, never
silently dropped.

### Sending twice

`provider_ref` is `contract:<contract>:<signer>:<purpose>`, and migration 004's
unique index is what actually enforces it. The same purpose cannot produce two
emails; a **deliberate resend** carries `resend1`, `resend2`… so pressing Send
again for a client who lost the first one really does re-send.

## 27. Chasing

`src/workflows/contract-chaser.mjs`. Finds contracts that were sent, are still
unsigned, and have had no activity for **3 days**; then every 3 days; **4 times,
then it stops**. A system that emails somebody forever is a system people filter,
and the filter costs more than the deal.

Each pass does two things:

* **Reminds** whoever is holding it up, with a **freshly minted link** — a
  reminder carrying a link that is about to expire is worse than no reminder.
* **Raises a task** for the staff member who sent it. This is the half that is
  easy to leave out and matters most: an automated nudge nobody on the team ever
  sees is how a deal quietly dies. The task is what eventually puts a person on
  the phone.

The clock runs from the **last thing that happened**, not from the send — a
client who opened it yesterday does not get chased today.

### It is registered, and that is not the same as switching sending on

`contractChaser` is in `src/workflows/index.mjs` (47 → 48). Registering does
**not** make it run: Inngest invokes nothing until `INNGEST_EVENT_KEY` is set,
which stays your call.

The message-dispatch sweeper deliberately stays **out** of that array and has a
test guarding its absence. The difference is blast radius: the sweeper drains the
whole queue for every workflow; the chaser touches contracts and nothing else.

### And it works today, without Inngest

`runChase()` is a plain function. `POST /api/contracts { action: "run_reminders" }`
calls it, and there is a **"Send reminders" button** on the Contracts screen.
Point any external scheduler at that endpoint if you want it automatic before the
Inngest key is set; when it is set, the same function starts running on its own
with nothing to change.

The action is **owner/admin** — a bulk send to real people is a narrower act than
sending one contract to one of them.

## 28. What to set to make real email leave the building

Three things, all yours; none of them are code:

1. **Route the channel.** Migration 110 already seeds `email → mailgun` for the
   default org. Confirm it in `message_channel_routing`.
2. **Mailgun credentials**: `MAILGUN_SEND_API_KEY`, `MAILGUN_SEND_DOMAIN`,
   `MAILGUN_SEND_FROM`. Until these exist the message queues, the dispatcher
   records "no route" or a provider failure, and the link still works.
3. Optionally `INNGEST_EVENT_KEY`, to make the daily chase automatic instead of
   button-driven. **Still not touched here** — CLAUDE.md §11.

Nothing above was set from this environment: `api.netlify.com` is blocked by the
network policy.

## 29. Decisions taken without asking, part 3

1. Dispatch **by id**, never `dispatchDue()`. (§26)
2. Email failure **never** fails the contract send.
3. Sequential contracts email **only the current signer**.
4. Chase after **3 days**, every **3 days**, **4 times**, then stop.
5. The chase raises a task assigned to the **sender**, falling back to the closer
   queue.
6. Reminders carry a **re-minted** link.
7. Two seeded, editable templates (`CONTRACT-SEND-EMAIL`, `CONTRACT-REMIND-EMAIL`)
   rather than strings in code — changing the wording must never need a
   developer, same rule as every other piece of copy here.
8. A **counterparty's** email is never filed against the client's record. They
   are nobody's client, and filing it there would put another company's
   correspondence on a consumer's file.
9. `run_reminders` is **owner/admin**; adding a contact stays STAFF.
10. The chaser's tests use **their own org**, because pointing a channel at the
    memory provider on the shared org overwrote seeded routing that other tests
    assert against. Tests that share global state fail in whichever order the
    runner picks.

## 30. Measured, part 3

Same environment and method as §10a and §23 — local PostgreSQL 16.13, connected
as the database owner, freshly migrated database.

| | tests | pass | fail | skipped |
|---|---|---|---|---|
| no `DATABASE_URL` | 4487 | 4006 | **0** | 481 |
| real Postgres | 5276 | 5226 | 34 | 9 |

The 34 are the same failures, name for name, as the baseline at `fca108c` —
diffed, not eyeballed. Sending and chasing are covered by 19 database-backed
tests that drive the **real** dispatcher, gate and provider path, using the
`memory` provider so nothing can leave the building.

Two fixture bugs of my own were caught by that run and fixed rather than worked
around: contract teardown had to clear `messages` before the clients they
reference, and the notify tests had to stop mutating the shared org's routing.

## 31. Still not done

* **No SMS.** Email only. The Twilio provider exists and the same queue carries
  both; it needs a template and a channel choice per signer.
* **No delivery receipts.** Mailgun's webhooks land in `src/adapters/mailgun.mjs`
  for the inbound direction; nothing yet maps a bounce back onto a contract, so
  "sent" means the provider accepted it, not that a human read it.
* **The chase is time-based only.** It does not notice that a client opened the
  document three times and stopped — which is the moment a person should call.
* **No per-org chase settings.** 3/3/4 is the same for everybody.
