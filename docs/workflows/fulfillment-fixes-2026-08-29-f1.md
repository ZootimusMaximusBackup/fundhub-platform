# agent-f1 — save the correction letters, and stop saying they are attached

**COMPLIANCE REVIEW REQUIRED** — credit-repair messaging, dispute documents, customer-facing copy.

Branch: `fix/save-repair-letter-pdfs` (off `main` @ `4f551ff1`)
Status: `done`

---

## MERGE ORDER — READ THIS FIRST

This copy change should land **together with, or after, agent-f3's portal-summary
signing change**. The portal's Documents tab already renders download links;
it just is not being handed signed URLs yet. Until f3 lands, a client following
this email would see their letters listed as **On file** but not be able to open
them.

Specifically: `public/app/client-portal.html` `paintDocs()` renders a clickable
download link when a document row carries `download.url`, and
`src/documents/retrieve.mjs` already produces that shape.
`api/read/portal-summary.mjs` runs its own raw SELECT and never signs the rows,
so the link never appears. That one endpoint is f3's job — it is **not** touched
here.

---

## What was broken

1. **The letters were built and thrown away.** Two paths generated a client's
   repair letter pack, mapped every PDF down to a filename and a byte *count*,
   and dropped the bytes:
   - `src/workflows/ds-02-diy-letters.mjs` — the fallback taken when the Metro 2
     engine finds no violations but the vendor letter generator does.
   - `src/sales/closer-deck.mjs` `generateDeckLetters` (line ~722) — the closer's
     "generate letters" action, reached through `api/closer-deck.mjs`.

   The Metro 2 **engine** path (`src/metro2/diy/deliver.mjs`) has always
   persisted. These two never did.

2. **The email lied.** `EMAIL-DS02-DIY-LETTERS-READY` opened *"your correction
   letters are attached and ready to send"* and then told the client how to print
   and sign letters they had never received. Nothing was attached and nothing
   could be — `sendTemplated` has no attachments parameter,
   `src/messaging/compose.mjs:110` states attachments are asset keys and never
   raw bytes, and `src/messaging/assets.mjs:11` is a frozen map with one entry
   pointing at a file inside the repo. **Verified, not re-litigated.**

---

## Change manifest

### Code — saving the letters (Part A)

| File | Change |
|---|---|
| `src/metro2/diy/persist.mjs` | `persistDiyPackageFiles` now also understands the repair letter pack's file shape. New `SUBTYPE_BY_TYPE` map classifies off a file's own `type`; new `isPdfFile` refuses to store a text cover sheet as `application/pdf`; new optional `pack` parameter for the metadata label. An **untyped** file still falls through to the old filename classifier, so the Metro 2 engine pack is unchanged. |
| `src/workflows/ds-02-diy-letters.mjs` | `deliverLettersInRepo` persists the fallback pack through `persistDiyPackageFiles` before reporting delivered. New optional `store` / `sourceEventId` threading (`handle` → `deliverLettersOnce` → `deliverLetters`), `store` defaults to `storeFromEnv()`. Returns `documents` + `persistSkipped`. |
| `src/sales/closer-deck.mjs` | `generateDeckLetters` persists the pack it builds. New optional `store` parameter (defaults to `storeFromEnv()`). Returns `documentsStored` + `persistSkipped`. A storage failure is recorded, not thrown — the call outcome is not lost. |

**No new storage path, no new document `kind`, no new table, no new migration for
this half, no new route, no new screen.** Everything goes through the existing
`storeAndRegister` → `documents` / `document_versions` registry.

**Kind chosen:** `KINDS.DELIVERABLE` — the same kind the Metro 2 engine pack and
the funding letter pack already use for these exact documents. Subtypes:
`metro2_dispute_letter_pack`, `cfpb_complaint`, `state_ag_complaint`,
`furnisher_validation`.

**Multi-tenant safety:** `orgId` and `clientId` are passed straight from the
caller's own scope (`event.orgId` / the authenticated staff's `org_id`) into
`storeAndRegister`, exactly as `persistFundingLetterFiles` and the engine path do.
A test asserts every stored row carries both.

### Copy — the email (replaces the original Part B)

Owner-set 2026-08-29: **no attachments and no download links in the email at
all. Clients log into their portal.**

| File | Change |
|---|---|
| `db/seed/023_ds02_letters_portal_copy.sql` | **NEW.** Supersedes the `EMAIL-DS02-DIY-LETTERS-READY` body in `db/seed/015_live_template_backfill.sql`. |
| `fundhub-docs/sources/EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md` | Same two sentences changed. |
| `db/expected-migrations.mjs` | Regenerated (`npm run migrations:manifest`) — 217 keys. Required, or `src/http/health-migrations.test.mjs` fails. |

**Why a new seed file and not an edit.** `015_live_template_backfill.sql` is
already applied on live. `db/migrate.mjs` records each file in
`schema_migrations` keyed `<dir>/<file>`, so editing 015 in place would change
nothing anywhere (CLAUDE.md §12). `023` re-upserts the row. `compliance_passed`
is deliberately **not** in its `DO UPDATE` list, so an existing row keeps
whatever approval state it already has.

**Why the source-of-truth doc had to change too.**
`src/messaging/seed/seed.mjs` parses that document and upserts bodies with
`ON CONFLICT … DO UPDATE`. Leaving it stale means the next manual run of that
seeder silently reverts the copy (and sets `compliance_passed=false`).

#### Exact before / after

Two sentences changed. Nothing else in the body moved.

**Line 2 — before:**
> As promised — your correction letters are attached and ready to send.

**Line 2 — after (Chris's wording, verbatim):**
> Your correction letters are ready. Log into your client portal to view and download them.

**"How to use them" step 1 — before:**
> Print and sign each one. Include a copy of your government-issued ID and one proof of current address — a utility bill or bank statement works.

**"How to use them" step 1 — after:**
> Download each one from your portal, then print and sign it. Include a copy of your government-issued ID and one proof of current address — a utility bill or bank statement works.

Subject line `Your correction letters are ready` is **unchanged** and was already
true. The certified-mail, 30-day-response, analyzer-rerun and done-for-you
paragraphs are **unchanged** and remain true.

### Tests

| File | Added |
|---|---|
| `src/sales/closer-deck.test.mjs` | 2 tests. Runs the **real** `generateDeckLetters` against the **real** repair pack built from the sandbox credit pull (same fixture `src/underwrite/output-baseline.test.mjs` pins): dispute letter + CFPB complaint + state AG complaint all reach the registry, every row carries the right `org_id`/`client_id`/`kind`, the text cover sheet is not stored, the bytes read back out of the store starting `%PDF`. Second test: a broken store is reported via `persistSkipped`, not swallowed and not thrown. |
| `src/metro2/diy/deliver.test.mjs` | 3 tests. The repair pack is classified off each file's own `type` (the state AG complaint's filename matches no filename rule); a `.txt` cover arriving as a Buffer is never stored; a repair summary keeps its own document type instead of posing as a dispute letter. |

No test weakened, skipped or deleted.

### Journeys

`npm run journeys` run — **no change**. The generated `-actual.md` files come
from the routing table and the gate on each handler; this work adds no route and
no gate. One line appended to `docs/journeys/CHANGELOG.md` recording that
deliberately (223 → 224 lines, verified against `origin/main`).

---

## Blockers / open questions for Chris

1. ~~**The email has no portal link in it.**~~ **ANSWERED AND DONE — see the
   agent-f1b section below.** Chris said yes on 2026-08-29. The link is in.
   Note for anyone reading the old suggestion: `{{custom_values.portal_link}}`
   was the **wrong tag** and would have broken the template editor.
   `{{portal_login_url}}` is what shipped.
2. **`DOCUMENT_STORE_PROVIDER` must be `netlify-blobs` in production.** If it is
   unset, `storeFromEnv()` falls back to an in-memory store and the saved letters
   do not survive a cold start. `docs/workflows/launch-100-scorecard-2026-08-24.md`
   records it as set on all contexts; that could not be re-verified from here
   (`api.netlify.com` is blocked by the network policy in this environment).

---

# agent-f1b — put the clickable portal link in the email

**COMPLIANCE REVIEW REQUIRED** — credit-repair messaging, customer-facing copy.

Branch: `fix/save-repair-letter-pdfs` (extends `2dc54e60`, same PR #296)
Status: `done`

Owner answered the open question above on 2026-08-29: **yes, put the clickable
portal link in the email.** That is the whole of this change. The letter-saving
work on this branch was not touched.

## The copy — exact before / after

Chris's two sentences are **unchanged. Not one word moved.** One line was added
under them. Everything else in the email is identical.

**Before**

```
Hey {{contact.first_name}},

Your correction letters are ready. Log into your client portal to view and download them.

These aren't templates. They were generated off your actual report: …
```

**After**

```
Hey {{contact.first_name}},

Your correction letters are ready. Log into your client portal to view and download them.

{{portal_login_url}}

These aren't templates. They were generated off your actual report: …
```

Rendered for a real client, that line reads:

```
https://fundhub.ai/portal-login.html?email=marcus%40example.com
```

## Which merge tag, and why it mattered

Three tags resolve to the **identical** URL. All three are filled by
`clientContext()` in `src/workflows/messaging.mjs` (lines 102, 121, 124–125):

| Tag | Registry verdict | Usable? |
|---|---|---|
| `{{portal_login_url}}` | `resolvable`, listed in `AVAILABLE_TAGS` | **chosen** |
| `{{CLIENT_PORTAL_URL}}` | `unverifiable` — editor warns "will send as blank" | no |
| `{{custom_values.portal_link}}` | `unknown` — **a save that adds it is refused** | no |

The previous manifest suggested the third one. It would have worked at send time
and **broken the template editor**: `src/messaging/merge-tags-registry.mjs`
`classifyChange()` blocks an unknown tag that a save *introduces*, so once the
link was in the body no staff member could ever have saved an edit to this
template again without deleting the link first. Verified by running
`classifyChange` against the real before and after bodies — `custom_values.
portal_link` returns `ok:false, blocking:["custom_values.portal_link"]`;
`portal_login_url` returns `ok:true, blocking:[]`.

(`custom_values.booking_link` further down the same body is also `unknown`, but
it is **grandfathered** — it was already in the stored copy, so the editor warns
instead of refusing. That is why it can stay and a new one could not go in.)

`{{portal_login_url}}` is also what `db/seed/009_u02_funding_delivery_template.sql`
and `db/migrations/253_repair_email_templates.sql` already use, so this matches
the pattern rather than adding a second one.

## No anchor tag, deliberately

This body is plain text. `src/messaging/providers/resend.mjs:139` only sets
`payload.html` when the body matches `<!DOCTYPE html|<html[\s>]|<table[\s>]`.
An `<a href>` here would go out as `payload.text` and reach the client as
visible angle brackets. A bare URL on its own line is what mail clients
auto-link, and it is the same shape the `{{custom_values.booking_link}}` line
further down already uses.

## WHERE THE LINK ACTUALLY LANDS A CLIENT — it is not one click

Traced through the code, not assumed:

1. Click the link → `public/portal-login.html?email=<theirs>`. The sign-in form
   with their email **pre-filled** (`prefillEmailFromQuery`, line ~92).
2. They press "Email me a sign-in link" → `POST /api/auth/magic-link`.
3. **A second email arrives** with a one-time link (`?t=<token>`).
4. They click that → `api/auth/magic-link-verify.mjs` answers
   `next: PORTAL_PATH` = `/app/client-portal.html` (line 39, 95).
5. The portal home page. Their letters are inside the **closed** `<details>`
   drawer headed "Account & history", and then the **Documents** tab — the
   third of five, with "Payments" the one that opens by default
   (`public/app/client-portal.html` lines 718–753).

`public/app/client-portal.html` supports **no** `?tab=` or `#docs` deep link —
the tab switch is a click handler only (line 1201–1213). And this email carries
no sign-in token, so it cannot skip step 2 and 3.

**So: click → request link → second email → click → portal home → open drawer →
Documents tab.** That is the furthest any existing mechanism reaches without new
code. It is a real improvement on naming no address at all, and it is honestly
not a link to the letters. Two things would be needed to close that gap, and
neither was in scope here: a token minted into this email (the `magic_link.`
context prefix exists but is supplied only for `EMAIL-PORTAL-MAGIC-LINK` /
`EMAIL-S04-01-CONFIRM`), and a deep link to the Documents tab.

## SMS — none exists, and none was created

There is no `SMS-DS02-*` key anywhere in the repository. Both call sites send
this beat on email only: `src/workflows/ds-02-diy-letters.mjs:179` and
`src/sales/closer-deck.mjs:744`, both `channel: "email"`. Creating an SMS twin
nothing sends would be dead copy, so none was written. If Chris wants a text as
well, that is a new template plus a second `sendTemplated` call at both sites —
a separate task.

## Editing the seed file in place — the §12 trap was checked first

`db/seed/023_ds02_letters_portal_copy.sql` is **new on this unmerged branch** and
absent from `origin/main` (`git ls-tree -r origin/main -- db/seed/` lists 20
files, none of them 023). Migrations run on the production deploy only, and only
`main` deploys, so this file has never been applied anywhere. Editing it in place
changes what will actually run. Confirmed, not assumed.

`db/expected-migrations.mjs` did **not** need regenerating: it is a list of
filenames with no content hash, and no file was added or renamed.

## Change manifest

| File | Change |
|---|---|
| `db/seed/023_ds02_letters_portal_copy.sql` | One line added to the body: `{{portal_login_url}}` under Chris's opening. Header comments record the owner's second call, the tag choice, why not an anchor tag, and where the link lands. |
| `fundhub-docs/sources/EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md` | The identical line, in the `EMAIL-DS02-DIY-LETTERS-READY` block. **Required** — `src/messaging/seed/seed.mjs` upserts bodies straight from that document, so leaving it stale means the next hand-run of that seeder strips the link back out. |
| `docs/journeys/CHANGELOG.md` | One line prepended (224 → 225, verified). The stray `<<<<<<< HEAD` marker inherited from `main` was left untouched — it is being fixed separately. |
| `docs/workflows/fulfillment-fixes-2026-08-29-f1.md` | This section; open question 1 marked answered. |

No code file changed. No route, no gate, no screen, no migration, no new
dependency. `npm run journeys` unaffected — this adds no route and no gate.

## Verified

* Both bodies parse and are **byte-identical** in the changed paragraphs —
  checked by running the real `parseEmailTemplates` over the doc and splitting
  the SQL on its `$fh023$` dollar quotes.
* `renderTemplate` on the seed body produces a real URL, not a blank.
* `classifyChange` on the real before/after: `ok:true`, nothing blocking.
