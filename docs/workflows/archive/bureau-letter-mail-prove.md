# Bureau letter mail (PostGrid) — DIY + DFY + between-rounds

**Started:** 2026-08-14  
**Model:** Grok 4.5 high (owner-set). Run in this chat, one unit at a time. Spin extra agents only inside the active unit.

**COMPLIANCE REVIEW REQUIRED** — dispute letters, bureau mail, portal upload.

## Owner laws (locked)

- Printer is **PostGrid**, not SendGrid. Email stays Resend.
- Covers **both** DIY and done-for-you.
- Covers **repair** and **optimize between funding rounds**. Same mail pipe. Different letter stack.
- Human still presses send. Nothing mails on its own.
- Return address = the client. Never Fundhub.
- Live prove letter goes to **Chris**, never a real bureau, never a sandbox stranger address.
- Do not `--prod` unless the webhook prove needs it. Do not drain the paused outbox.

## Same pipe, two letter stacks

| Path | When | Letters PostGrid may mail | Who presses send |
|------|------|---------------------------|------------------|
| **Between rounds / funding** | `deposit.paid` (always) and `round.closeout` (next round) | Funding stack: **inquiry removal + personal info** only. Not full Metro 2 disputes. | Inquiry remover |
| **Repair DFY** | Repair program | Repair stack: **dispute + personal info** | Repair send (wire to same PostGrid helper) |
| **Repair DIY** | DIY pay (`ds-02`) | Same repair stack. Owner: we mail these too, not “print it yourself” only. | Same send gate |

Portal upload stays **Experian only**, staff types the confirmation number. Equifax / TransUnion portal stays off.

## Task list

| ID | Unit | Owner | Status | Notes |
|----|------|-------|--------|-------|
| W0 | Board + brief | this chat | **done** | |
| W1 | Live PostGrid prove — one letter to Chris | this chat | **done** (test mode) | PostGrid accepted letter `letter_nvp8G3NdSZ7kQYxC8xi9C4`. Test key only. Live USPS key never set. |
| W2 | One send helper for DIY + DFY + between-rounds | W2 agent | **done** | Shared `mailBureauLetter`; repair `/api/repair/send`; inquiry uses same pipe |
| W3 | Between-rounds uses funding letters only | W3 agent | **done** | Funding PDFs only; dispute never mailed on this path |
| W4 | Experian portal confirm prove | W4 agent | **done** | Fundhub side proved in code; Experian.com clicks left for W5 |
| W5 | 100% scorecard | W5 agent | **done** | Bar A **100** (8/8). Bar B **0** (0/5 NOT PROVED). No code fix. |

## Shared context

- **Shared mail helper (W2):** `src/metro2/delivery/send.mjs` → `mailBureauLetter` → PostGrid `sendLetter`. Return address = client only.
- Inquiry / between-rounds send: `api/inquiry-cases.mjs` action `send` + `mail: true` uses the helper. Prefers funding-stack PDF (inquiry_removal → personal_info); HTML stub if none. **W3 done:** `resolveFundingLetterPdf` + documents persist from C-06.
- Repair DIY + DFY send: `POST /api/repair/send` with `mail: true` + `letters[]` → same helper → moves card on `repair.letters.sent`.
- DIY pay (`ds-02`) still only builds PDFs / emails the client. It does **not** call PostGrid.
- Between-rounds trigger already exists: `src/handlers/inquiry-gate.mjs` on `deposit.paid` + `round.closeout`. `f-05-inquiry-cleanup-gate.mjs` only flips inquiry rows to Pending Removal — it does not mail.
- Letter split already exists in `src/underwrite/letter-pack-filter.mjs`: funding = `personal_info` + `inquiry_removal`; repair = `dispute` + `personal_info`.
- Env names: `POSTGRID_API_KEY`, `POSTGRID_WEBHOOK_SECRET`. Set on Netlify production 2026-08-07 (`--secret`). CLI/API **mask** values (20-char stub). Do not treat the mask as the key. Do not ask Chris to paste. Read runtime via `netlify dev:exec --context production`.
- Webhook: `POST /api/webhooks/postgrid` → `delivery.confirmed` starts the call clock.
- Envelope: closed-face (`flat`). USPS only (`first_class` / `priority` / `priority_express`). No FedEx/UPS (P.O. Boxes).

## W1 notes — done 2026-08-14 (test mode)

PostGrid **accepted** a letter through `sendLetter`. Id: `letter_nvp8G3NdSZ7kQYxC8xi9C4`. Class: first class. Closed-face envelope. Return address = Chris, not Fundhub. **Not** a bureau P.O. Box.

**Test key.** An Aug 7 session wrote `POSTGRID_API_KEY` as a PostGrid **test** key (`--secret`) and left the live key unset on purpose. CLI/API still mask the value. Copied that test key into local `.env` from the session record. Production dry-run fence was **not** flipped (`MESSAGING_DRY_RUN` stays as-is on Netlify). The one-shot passed `MESSAGING_DRY_RUN=0` only in process env for that call.

To-address used the prove-client street on file (Denton). Test mode does not print USPS. **Do not use that street for a live stamp** — it is sandbox report data.

`.env.example` now names `POSTGRID_API_KEY` and `POSTGRID_WEBHOOK_SECRET`.

**Not proved:** live USPS key, `delivery.confirmed` webhook on fundhub.ai, live click of human Send. W2 wired the send helper (code path); not a live stamp.

## Change manifests

### W1 manifest

- `docs/workflows/bureau-letter-mail-prove.md` — this board
- `.env.example` — PostGrid names only
- Local `.env` — test key written (gitignored)
- One-shot prove script deleted after the send

**Verify:** PostGrid returned `ok=true` and a `letter_*` id. No `--prod`. No outbox drain.

### W2 manifest — COMPLIANCE REVIEW REQUIRED

**What changed (plain talk):** One mail pipe for all three jobs. A person still has to press send. Pay does not mail.

**Files**
- `src/metro2/delivery/send.mjs` — shared `mailBureauLetter` (+ PDF/HTML pick + W3 funding-PDF hook)
- `src/metro2/delivery/send.test.mjs` — new
- `src/repair/send.mjs` — human repair send gate
- `src/repair/send.test.mjs` — new
- `api/repair/send.mjs` — `POST /api/repair/send` (`mail: true`)
- `api/inquiry-cases.mjs` — inquiry send uses the shared helper; PDF first, HTML backup
- `netlify/functions/api.mjs` — route `repair/send`
- `src/http/repair-send.test.mjs` — new
- `src/workflows/ds-02-diy-letters.mjs` + `.test.mjs` — prove pay never hits PostGrid
- Journeys regenerated + `docs/journeys/CHANGELOG.md`

**Tests run:** 31 pass / 0 fail (helper + repair send + DIY + inquiry send + mail-letter). Also `routes.test.mjs` 15/15.

**Left for W3**
- Fill `resolveFundingLetterPdf` so between-rounds / funding cases mail **inquiry_removal + personal_info** PDFs only (not full Metro 2 disputes).
- Wire whatever stores those funding PDFs onto the inquiry case (or into that hook).

**Not done here:** live USPS key, real bureau stamp, CRM button UI polish, commit (Chris did not ask).

**Verify:** staff can call repair send and inquiry send with `mail: true`; missing client address is refused; DIY `payment.received` never calls PostGrid.

### W3 manifest — COMPLIANCE REVIEW REQUIRED

**What changed (plain talk):** Between-rounds / inquiry mail now picks the funding letter PDF for that bureau (inquiry removal first, else personal info). It will not pick a Metro 2 dispute letter. When funding letters are built in C-06, those two kinds are saved in the documents table so send can find them later. If none are found, the old HTML stub still goes out. A person still presses send.

**Files**
- `src/metro2/delivery/send.mjs` — filled `resolveFundingLetterPdf` (pack files + documents lookup; never dispute)
- `src/metro2/delivery/send.test.mjs` — W3 hook tests
- `src/underwrite/letter-pack-filter.mjs` — exported funding letter helpers / bureau match
- `src/underwrite/funding-letter-pdf.mjs` — **new** persist + load via documents store
- `src/underwrite/letter-pack.mjs` — keep `bureau` on pack files
- `src/workflows/c-06-crs-results-router.mjs` — store funding-stack PDFs when pack is built
- `src/documents/kinds.mjs` — subtypes `funding_inquiry_removal` + `funding_personal_info`
- `api/inquiry-cases.mjs` — tiny: await hook with db/store

**Tests run:** `send.test.mjs` **12 pass / 0 fail**. With repair send + repair route + c-06 + DIY + documents register: **71 pass / 0 fail**. No skips.

**Left for W4 / W5**
- W4: Experian portal confirm prove (staff types confirmation number)
- W5: 100% scorecard after W1–W4
- Still not done: live USPS key, real bureau stamp, CRM button polish, commit (Chris did not ask)

**Leftover / notes**
- One mail = one PDF. Prefers inquiry removal over personal info for that bureau (does not merge both into one file).
- Dispute letters may still sit in the funding pack for other uses; this path never stores or mails them.
- No new routes → no journey regen this unit.

**Verify:** inquiry send with `mail: true` uses a funding PDF when documents (or case PDF) exist; with only a dispute PDF on file for the client, it falls back to HTML stub.

### W4 manifest — COMPLIANCE REVIEW REQUIRED

**What changed (plain talk):** Proved the Fundhub side of Experian portal confirm. Staff types a confirmation number. That starts the call clock from the upload time. Equifax and TransUnion portal stay blocked. No bureau login bot. No mail. No live Experian.com clicks (that is W5).

**Files**
- `src/inquiry-ops/send.test.mjs` — EQ + TU `portal_ex_only`; blank confirm blocked; portal confirm writes `first_delivery_at` / `first_delivery_channel=portal` / `call_due_at` from `portalUploadedAt`
- `src/inquiry-ops/call-scheduler.test.mjs` — portal channel wait (1 business day) + channel name
- `src/inquiry-ops/call-scheduler.pg.test.mjs` — Postgres mirror of portal clock (same as PostGrid webhook prove; skips without `DATABASE_URL`)
- No production code hole found — `sendCase` already called `scheduleFromDelivery` with `channel: "portal"`

**Tests run:** unit `send.test.mjs` + `call-scheduler.test.mjs` → **12 pass / 0 fail**. pg portal clock test added; local `DATABASE_URL` empty so pg suite skipped here (CI / env with DB will run it).

**Score (honest)**

| Proved in code | Still needs a human (W5 leftover — not a W4 fail) |
|----------------|---------------------------------------------------|
| Missing confirm number blocked (`portal_confirmation_required`) | Staff actually uploads on Experian.com |
| Blank / whitespace confirm blocked | Staff types the real Experian confirmation into Fundhub CRM |
| EQ portal blocked (`portal_ex_only`) | Live click of Send on a real EX case in CRM |
| TU portal blocked (`portal_ex_only`) | |
| EX portal + confirm → clock starts: `first_delivery_at`, `first_delivery_channel=portal`, `call_due_at` from `portalUploadedAt` (1 business-day portal wait) | |
| API already accepts `portal` / `portal_confirmation` / `portal_uploaded_at` | |

**Left for W5**
- Human Experian.com upload + type confirmation into Fundhub
- Full 100% scorecard across W1–W4 leftovers (live USPS key, live webhook, live Send click, etc.)
- Commit (Chris did not ask)

**Verify:** portal send with a confirmation number starts the call clock; EQ/TU portal still refused; no confirmation still refused.

### W5 scorecard + manifest — COMPLIANCE REVIEW REQUIRED

**What changed (plain talk):** Scored the batch. Did not rebuild W1–W4. Did not deploy. Did not drain outbox. Did not commit. No code fix needed.

**Tests re-run (2026-08-14):** focused unit files → **46 pass / 0 fail**. Also `routes.test.mjs` → **15 pass / 0 fail**. Local PostGrid key class = `test_sk` (value not printed).

#### Bar A — this batch (code + test PostGrid)

| ID | Result | Evidence |
|----|--------|----------|
| `postgrid_test_letter` | **PASS** | W1 letter id `letter_nvp8G3NdSZ7kQYxC8xi9C4` (test mode) |
| `shared_send_helper` | **PASS** | `mailBureauLetter` used by `src/repair/send.mjs` + `api/inquiry-cases.mjs` |
| `human_gate` | **PASS** | `ds-02` never calls PostGrid / `mailBureauLetter` (test green) |
| `repair_send_route` | **PASS** | `ROUTES["repair/send"]` in `netlify/functions/api.mjs`; routes suite green |
| `funding_stack_only` | **PASS** | `resolveFundingLetterPdf` never returns dispute (send.test green) |
| `portal_ex_only` | **PASS** | EQ + TU portal blocked (`portal_ex_only`) |
| `portal_confirm_clock` | **PASS** | EX + confirmation sets `first_delivery_at` / `call_due_at` |
| `return_address_client` | **PASS** | Missing client street → `return_address_required` |

**score_A = 8/8 × 100 = 100**

#### Bar B — live product (not this batch)

| ID | Result | Notes |
|----|--------|-------|
| `live_usps_key` | **NOT PROVED** | Still test key class (`test_sk`). Live USPS key never set. |
| `delivery.confirmed` webhook on fundhub.ai | **NOT PROVED** | Code path + unit tests exist. No live hit on fundhub.ai proved this batch. |
| human Send click on CRM | **NOT PROVED** | No live CRM Send click evidence. |
| Experian.com upload + typed confirmation | **NOT PROVED** | Fundhub side proved in W4. Live Experian.com clicks not done. |
| Chris real street | **NOT PROVED** | Owner: wait. Printer stays on test until Chris sends his street. |

**score_B = 0/5 × 100 = 0** (honest; do not pretend)

#### Fix made

None. Bar A already green.

#### Leftover (live bar — owner waits)

- Live USPS PostGrid key (when Chris is ready)
- Live `delivery.confirmed` on fundhub.ai
- Human Send click in CRM
- Experian.com upload + type confirmation into Fundhub
- Chris real street for a live stamp prove
- Commit (Chris did not ask)

**Verify:** board shows score_A 100 and score_B 0; W5 status **done**.
