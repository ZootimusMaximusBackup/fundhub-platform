# Contract generator — specification and decision record

Status: built 2026-08-02 on `claude/crm-contract-generator-elsk3q`.
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
