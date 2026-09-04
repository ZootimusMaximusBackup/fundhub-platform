# The deliverables and credit-repair flow — what is actually true

**Read this before touching deliverables, dispute letters, or personal-information disputes.**

Chris has had this work redone three times because each pass rediscovered the wrong thing and the
right answer was never written down. Everything below was verified by running code, not by reading
it. Every claim carries the command or the file:line that proves it. Do not re-derive it. If you
believe a line here is wrong, prove it with a command and update this file in the same commit.

Measured 2026-09-04.

---

## 1. The full-length document printer IS built. It is Python, and production cannot run it.

**This is the single most important fact in this file.**

`scripts/black-reports/fundhub_gen.py` (1,614 lines) uses WeasyPrint and produces Chris's designed
documents. Run directly it produced **12 / 9 / 9 / 14 pages**. Run through the real live call path
(`printBlackReports`, engine `auto`) on a machine that has WeasyPrint it produced **9 / 7 / 9 / 12**
for a smaller synthetic client. It is fully data-driven — `src/underwrite/black-report-client.mjs`
(597 lines) maps real UnderwriteIQ engine output into its input, and
`src/underwrite/black-report-pdf.test.mjs:56-58` asserts no sample data leaks through.

The same client through the Node printer gives **5 / 4 / 6 / 4**. That is what every real client
gets today, 100% of the time.

**The silent fallback**, `src/underwrite/black-report-pdf.mjs:56-58`:

```js
const python = resolveWeasyprintPython();
if (!python || engine === "node") return printBlackReportsNode({ client });
if (!existsSync(BLACK_REPORT_SCRIPT)) return printBlackReportsNode({ client });
```

No throw, no log, no flag. Netlify's Node runtime has no Python, so `resolveWeasyprintPython()`
returns null and the cheap printer runs instead. Line 90 does the same thing after a Python crash.

The script is already **shipped to production** — `netlify.toml:99-103` bundles
`scripts/black-reports/**`. Only the interpreter is missing.

This was a deliberate trade, not an accident. Commit `d0ff04ab` (2026-08-26, Zooted):

> Live Netlify has no WeasyPrint, so the funding pack uses the same pdf-lib stack letters already
> use. The Mac Python printer stays as a nicer path when that box has it.

**OWNER DECISION 2026-09-04: run the Python printer as its own service the site calls.** Chris:
"I just want the documents to be perfect... this is one of the most valuable parts of the company."
The Node printer stays as the fallback so a service outage degrades instead of failing.

**Do NOT try to rebuild the Node printer to match.** A lane spent a full pass on that and moved it
from 4 pages to 5 against a 12-page target.

### The reference set is not an outside artefact

The four "designed reference" PDFs are **byte-identical** to
`docs/workflows/gold-deliverables-v5/` which is already on `origin/main`. Same sha256. Page counts
12 / 9 / 10 / 15. They are this repo's own Python printer output.

---

## 2. Identity comes from the client's documents, never from the credit report

**OWNER RULE, 2026-09-04, final.** Chris:

> You definitely want to take the information from the identity forms and then match it to the
> credit report. That's it.

The flow he sells:

1. Client uploads a government ID and a proof of address (utility bill or bank statement). They can
   also **text a photo** — that path is built, see §3.
2. An agent reads both images, checks they are legible, and checks the **two addresses match**.
3. The verified name and address from those documents are **the truth**.
4. On the credit report, that one name stays and every other name variant is disputed off. That one
   address stays and every other address is disputed off.
5. Inquiries with no matching open account are **woven into the same letters**, not sent separately.
6. Six rounds. R1-R3 disputes, R4 CFPB, R5 state attorney general, R6 final notice.

### The repo's own knowledge base teaches the OPPOSITE. Fix it or this happens a fifth time.

`docs/metro2/AI-CREDIT-REPAIR-LETTER-GENERATION-PROMPT.md:19` instructs:

> Pull every fact you need, including the consumer's name, address … **directly from the uploaded
> report.** Do not stop and ask the consumer for information the report already provides.

`:347` makes personal-info cleanup conditional ("Run this when the file shows mixed-file risk").
`docs/metro2/METRO2_MASTER_KNOWLEDGE_BASE.md:1029` says three rounds, not six, and `:1194` makes
address removal **age-based** ("more than 2 cycles old") rather than identity-based.

Any agent pointed at the knowledge base first builds the wrong product. That is the root cause of
three of the rebuilds.

---

## 3. The document-collection agent is built. So is texting a photo in.

Chris was right and two investigations were wrong before this one.

- **The agent**: `src/handlers/ghl-doc.mjs` (renamed to `doc-check.mjs`) loads the real image bytes
  (`loadDocumentBytes` → `resolveStorageTarget` → store) and calls a vision model
  (`callModel`, `mediaFromBytes`). Registered as an Inngest workflow at
  `src/workflows/ghl-doc-document-check.mjs`, imported by `src/workflows/index.mjs:43`.
- **Its rules**, seeded in `db/migrations/114_ghl_agent_seed.sql`:
  > Check every document for quality first: fully in frame, all corners, no glare, not blurry,
  > legible… the address on the ID and the proof of address match and are current
  It also matches name and date of birth against the file, and falls back to asking for a passport
  when the licence address is stale. Outcomes: `accept` / `request_more` / `hold`.
- **Texted photos**: `src/handlers/inbound-mms-docs.mjs` downloads Twilio media, stores it, emits
  `docs.received`. Registered at `src/register-all.mjs:54`. The "MMS auto-upload is parked" comment
  in `vendor/inquiry-remover/src/agents/doc-chase-prompt.js:20` is **stale — ignore it**.
- **The phone chase**: `vendor/inquiry-remover/src/agents/doc-chase-prompt.js` is a Bland voice
  agent that coaches the client on photo quality and the address match.

### THE ACTUAL GAP

The agent verifies the two addresses match **and then throws the values away.** Its output schema is
only `{outcome, documents_reviewed, issues, message_to_client, hold_reason}` — there is no field for
the verified name or address, and `routeGhlDocOutcome` writes none.

So the letters fall back to:
- name → `clients.first_name + clients.last_name` (`src/repair/analyze.mjs:167-173`), a field a
  closer types during a sales call. **Never carries a middle name.**
- address → `pii_identity.addresses[0]` (`src/inquiry-ops/call-scheduler.mjs:100-111`), the first
  element of an unvalidated jsonb array.

That mismatch caused both mailed-letter defects found in this batch: a letter asserting a file
carried two names when it carried one, and a letter asserting a client's **business** address was
their home address while demanding deletion of their real one.

---

## 4. Lenders: two states, two lanes

**OWNER RULE, 2026-09-04.** Chris:

> It's based off of home state and home address, which is their personal address, and then also
> their business address as well… So if they live in Arizona but they also have a business in
> Florida, that opens up two lanes of opportunity to national banks and then local banks that only
> do business in those two states.

State matching is already built: lenders carry `eligible_states`, and `stateEligible()`
(`src/lenders/match.mjs:239`) matches correctly and treats empty or "all states" as national.

**The bug**: `resolveMatchState()` (`src/lenders/match.mjs:48`) returns **one** state. It loops the
businesses and `return`s on the first business state found, so the home state is a fallback that
never runs when a business exists. An Arizona client with a Florida business gets Florida only and
every Arizona-only lender is silently dropped.

---

## 5. Repair path blockers

1. **A repair client cannot see the ID upload door.** `src/repair/upload-doors.mjs:9-18` gates the
   door carrying `id_document` and `proof_of_address` on the `funding-snapshot` entitlement. The
   $200 `REPAIR_TRIAL` grants `metro2-letter-pack` (`src/repair/enroll.mjs:9`), so a repair client
   gets only the bureau-response door.
2. **The "we need your documents" stage never fires.** `src/repair/pipeline.mjs:9-11` defines
   `intake → awaiting_documents → analysis`; `src/repair/portal.mjs:5` has the copy;
   `src/repair/sla.mjs:5` has a 14-day chase; `src/repair/handlers.mjs:35-49` has the branches.
   **`repair.docs.needed` and `repair.docs.complete` are emitted by nothing.** The stage is
   unreachable and no repair client has ever entered it.
3. **A texted photo is filed as `subtype: "other"`** (`src/handlers/inbound-mms-docs.mjs`), so
   neither the document agent nor the gate can tell an ID from a utility bill.
4. **Personal-information checks cannot fire on main.** `src/metro2/normalize.mjs:434-443` sets
   `consumer.legalName`, `dateOfBirth` and `employers` to `notVisible()`, and the only production
   caller `src/metro2/diy/from-crs.mjs:66` never overrides them. So M2-032 (name variants), M2-033
   (DOB) and M2-034 (employment) return `[]` on every real file. Only M2-031 runs, and its rule is
   **address age**, not identity. Today's product is age-based cleanup, not what is sold.

---

## 6. The round ladder is correct — do not redesign it

`src/metro2/letters/catalog.mjs:19-37`, owner-set 2026-08-28 ("1, 2, 3, escalation, escalation,
escalation final notice… We just use more aggressive law as we go"):

```
R1  Round 1 Metro 2 dispute          the bureau must reinvestigate
R2  Round 2 method of verification   the bureau must show its work
R3  Round 3 final notice             delete what you cannot verify
R4  CFPB complaint                   a federal regulator
R5  State attorney general complaint state consumer-protection law
R6  Final notice, reissued
```

R1→R2 and R2→R3 auto-advance; crossing into R4 needs a human (`src/metro2/rounds/state.mjs:77-84`).
State AG letters are mailable in 38 states; 12 refuse with `ag_postal_address_unknown`.

**OWNER DECISION 2026-09-04: the $200 REPAIR_TRIAL cap of 2 rounds
(`src/repair/enroll.mjs:61`) is CORRECT. Full programs get 6. Do not change it, do not re-raise it.**

---

## 7. GoHighLevel and Airtable are not used

**OWNER RULE 2026-09-04:** strip both from the repo. Measured: GHL/GoHighLevel 4,695 occurrences
across 470 files; Airtable 1,051 across 126.

`GHL-DOC` → `DOC-CHECK`, `GHL-RECON` → `RECON`. **Both are rows in the live `agents` table**, so a
code rename without a migration updating the row stops the agent silently. Code and migration land
together or not at all.

---

## What was verified by execution, not by reading

- The Python printer run, both directly and through the live `printBlackReports` call path.
- The Node printer run on identical input, giving 5 / 4 / 6 / 4.
- `sha256` equality of the reference set and `gold-deliverables-v5`.
- Page counts of every PDF, with `pdf-lib`.
- `fundhub.ai/api/health`: database up, 0 pending migrations.
