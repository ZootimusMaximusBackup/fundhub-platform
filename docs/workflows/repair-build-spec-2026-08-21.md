# Repair Build Spec — 2026-08-21

Repo: `fundhub-platform`. This file is the shared board for the batch (CLAUDE.md §0).
Builder: Cursor sessions, run in parallel. Each workstream below has a copy-paste prompt.
Owner: Chris. Owner decisions in §2 are final. Open decisions in §3 have defaults — build the default unless Chris says otherwise.

---

## Context primer (every Cursor session reads this before its workstream)

**What this is.** Fundhub.ai — a live business-funding + credit-services platform. Live means live: real clients, real credit files, real mail. §1 rails apply to every session.

**Stack.** Vanilla HTML/JS frontend in `public/app/` (no framework). API is Netlify Functions behind one `ROUTES` map in `netlify/functions/api.mjs`. Postgres with sequential numbered migrations in `db/migrations/`. Event-driven core: canonical events in `src/events/canonical.mjs`; background workflows registered in `src/workflows/index.mjs`.

**Three lanes, one set of rails.** Funding (`src/funding/`, `src/banking/`), inquiry removal (`src/inquiry-ops/` — the oldest, most-built lane), credit repair (`src/repair/` + `src/metro2/`). Every letter in the company comes from one engine, `src/metro2/letters/` — the catalog holds 8 types including `personal_info`, `inquiry_removal`, and `furnisher_validation`. The Specialist screen `public/app/inquiry-remover.html` hosts both inquiry and repair work; that's why the repair dashboard is a tab there, not a page.

**Repair spine.** 13 stages on the `optimization` pipeline (`src/repair/pipeline.mjs`); 16 `repair.*` events map to stages via `EVENT_STAGE`. Handlers are registered ONLY in `src/workflows/index.mjs`; HTTP-path code calls `onRepairEvent` directly. That split is intentional and load-bearing — keep it.

**Metro 2 layer.** 38 deterministic checks, provenance on every field (`observed`/`absent`/`not_visible`), rules never fire on `not_visible`. Only 12 of 38 fire on a CRS soft pull (`docs/metro2/CRS-FIELD-COVERAGE.md`) — the trial-run demo finds real violations, just a thinner set than a full file.

**House patterns to preserve.** Honest refusals (`{ok:false, reason}` with HTTP 200). Pure-derive + SQL-gather split for lenses (see `window.FHFulfillmentLens` in `pipeline.html` + `src/fulfillment/`). The `mail:true` human gate. Per-item round advancement. The letter variance gate. Tiles render em-dashes until data lands — never fake zeros.

**Truth hierarchy.** Repo code > this spec > everything else. The GHL source-of-truth PDF is outdated reference; DisputeFox is dead. One known stale doc line: `CLAUDE.md` claims the message dispatch sweeper is unregistered — it IS registered (`src/workflows/index.mjs:12,90`).

**The presentation deck.** `public/app/present.js` is the sales script + outcome recorder to `/api/closer-deck`. The offer ladder including `REPAIR_TRIAL` ($200) already lives there. It fires nothing else today — WS-A changes that.

**The wireframe.** `docs/workflows/repair-dashboard-wireframe.html` is the visual contract for WS-E — structure, chips, states, and stub data mirror §8–§9. Open it in a browser; the state switcher at the top demos all four states.

---

## §0 — Workflow split (do this first, per CLAUDE.md)

Five workstreams. A is the front door and unblocks the demo. B is the engine. C is the return path. D is templates. E is the screen.

| WS | Name | Depends on | Can start |
|----|------|-----------|-----------|
| A | Enrollment, money, fire button | claimed | Cursor · `feature/repair-enroll-fire` | rebuilding + shipping |
| B | Engine: six rounds + furnisher letters | claimed · `feature/repair-ws-b-engine` | PR ready (unit-proved B1–B3) |
| C | Inbound: doors, response agent, parse loop | uploads go-live (prereq P1–P2) | now (code), live after prereqs |
| D | Repair emails | event names in A/B (already listed here) | now |
| E | Dashboard tab | data contract in §9 (build against it with stub rows) | now |

Merge order if conflicts: B → A → C → D → E. A and B both touch `src/repair/analyze.mjs`; B owns the furnisher loop, A owns the authorization gate — they are different functions in the same file, coordinate on the board.

### Copy-paste prompts (one per Cursor session)

**WS-A** — "Read `docs/workflows/repair-build-spec-2026-08-21.md` §4 and §2. Build the repair enrollment endpoint, the `repair_programs` table, and the presentation fire-letters flow. Respect the safety rails in §1 and the repo traps in §11. Prove with the §10 items marked A."

**WS-B** — "Read `docs/workflows/repair-build-spec-2026-08-21.md` §5 and §2. Widen rounds to R6, add the letter target column, generate furnisher letters, feed prior responses into next-round letters. Repo traps §11. Prove with §10 items marked B."

**WS-C** — "Read `docs/workflows/repair-build-spec-2026-08-21.md` §6 and §2. Build the three portal upload doors, the bureau-response reader agent, and wire parse → confirm → advance. Repo traps §11. Prove with §10 items marked C."

**WS-D** — "Read `docs/workflows/repair-build-spec-2026-08-21.md` §7. Seed the six repair email templates and wire them to repair events. Prove with §10 items marked D."

**WS-E** — "Read `docs/workflows/repair-build-spec-2026-08-21.md` §8 and §9, then open `docs/workflows/repair-dashboard-wireframe.html` in a browser — it is the visual contract. Expand the Repair tab in `public/app/inquiry-remover.html` to match it: tiles, chip column, due dates, actions, four states. Prove with §10 items marked E."

---

## §1 — Safety rails (every session, no exceptions)

- NEVER touch client `9af65808-…`. That is a real live credit file. The TEST client is `8556bedc-…`.
- Plus-tagged emails only for test clients. The bare watched Gmail is the live file.
- No real bureau mail without a human press. The `mail:true` gate in `src/repair/send.mjs` stays. The fire button is a human press — it satisfies the gate; it does not remove it.
- The system is live. Never describe it as sandbox or demo. `INNGEST_EVENT_KEY` stays on.

---

## §2 — Owner decisions (locked, 2026-08-21)

1. **CROA 3-business-day hold: removed from the send path.** Letters may generate and mail immediately after payment. Remove the hold enforcement at its call sites; keep `src/repair/croa.mjs`'s contract-key checks if anything else uses them. `COMPLIANCE REVIEW REQUIRED`
2. **Trial offer:** 2 rounds, $200, paid up front on the call, credits toward the full program as a deposit. `COMPLIANCE REVIEW REQUIRED`
3. **Full program:** up to 6 rounds, variable price per client. Upsell at ~60 days after trial. Full program **resumes** where the trial stopped — never restarts. Balance owed = full price minus $200.
4. **Email only for repair.** No Twilio, no SMS. Emails are specific and name the accounts being disputed.
5. **Soft pull is a manual button** (existing CCP Pull, UnderwriteIQ). Never automated.
6. **Dashboard is a tab in the Specialist screen** (`public/app/inquiry-remover.html`). No new page, no new nav row.
7. **Upload doors are separate and gated by the client's active lane.** Funding docs door, inquiry docs door, bureau-response (repair) door. A client sees only the doors for lanes active on them. When a repair client upgrades to funding, the funding door turns on — gate on current track, not original purchase.
8. **The repo is truth.** The GHL source-of-truth PDF is outdated reference. DisputeFox is dead — no DF fields, no DF sync.
9. **Creditor-direct is core.** Metro 2 violations go at the furnisher for their proof; bureau disputes can run at the same time. The system decides per account.
10. Repair and funding tags stay mutually exclusive on a client (HX-01). Trial-complete upsell flow flips the track.
11. **No dollar amounts on the repair desk.** The Specialist Repair tab shows program (trial/full) and round only. Money lives in `repair_programs` and renders on owner/closer surfaces (presentation) — never in the VA's face all day.
12. **Every letter carries the client's signature from the signed repair contract.** The contract system captures a typed-name signature — `signer_name`, attestation, `signed_at`, IP, user agent (migration `124_contracts.sql`; no drawn image, no e-sign vendor, by design). Letters render it as the script-styled name over the printed name plus "Signed electronically · <signed_at date>". The §4.3 authorization gate and this are the same fact: repair contract signed. Unsigned → generate refuses, so the blank hand-sign line should never render; keep it only as the defensive fallback.

---

## §3 — Open decisions (build the default)

| # | Decision | Default (build this) |
|---|----------|---------------------|
| D1 | AI enhancement in letters | **Off in v1.** Deterministic variance already guarantees no two letters match (`src/metro2/letters/variance.mjs`). The AI prompt doc (`docs/metro2/AI-CREDIT-REPAIR-LETTER-GENERATION-PROMPT.md`) stays unwired. Leave a clean seam in `generateLetter` where it can plug in. |
| D2 | Personal-info cleanup letters at onboarding | **Manual button** on the dashboard row ("Clean personal info"), using existing `PERSONAL_INFO` letter type (rules M2-031..034). Not automatic. |
| D3 | Letter content for rounds 4–6 | **Cycle the R2 (MOV) and R3 (final notice) prompt pools** with fresh variance and accumulated evidence. No new letter types. |
| D4 | Payment capture at enrollment | **Manual:** closer enters amount paid on the enroll call. Stripe/processor later. |
| D5 | Signature printed in the letter | **Decided — owner locked it, see §2.12.** Typed-name signature from the signed repair contract renders in every letter. |
| D6 | Inbound mail inbox (PostGrid return / watched inbox) | **v1.1.** Client upload door is the v1 return path. Stub the webhook route, don't build IMAP now. |

---

## §4 — WS-A: Enrollment, money, fire button

### What exists
- `public/app/present.js` has the full offer ladder: `REPAIR_DFY` (rung 0), `REPAIR_TRIAL` (rung 1, $200), rung buttons, per-client price overrides. It records outcomes to `/api/closer-deck` and fires nothing else.
- `src/repair/dispute-auth.mjs` → `hasDisputeAuthorization()` exists and **nothing calls it**.
- No repair money fields anywhere. No `repair.enrolled` producer — this is why nobody lands on the board today.

### Build

**1. Migration `<next>_repair_programs.sql`** (new file — never edit applied migrations):
```sql
CREATE TABLE IF NOT EXISTS repair_programs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  program       text NOT NULL CHECK (program IN ('trial','full')),
  rounds_cap    int  NOT NULL,            -- 2 for trial, 6 for full
  price_total   numeric(10,2) NOT NULL,   -- variable per client
  amount_paid   numeric(10,2) NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','complete','upsell_pending','cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, client_id)
);
```
Upgrade path: trial → full is an UPDATE on the same row (`program='full'`, `rounds_cap=6`, `price_total` = new total, `amount_paid` keeps the $200). One row per client, ever.

**2. Endpoint `POST /api/repair/enroll`** — new file `api/repair-enroll.mjs`, registered in the `ROUTES` map in `netlify/functions/api.mjs` (missing = 404, see §11). Roles: owner, admin, closer, inquiry_specialist via `requireRole` after `requireAuth`.
Body: `{ client_id, program: 'trial'|'full', price_total, amount_paid }`.
Does: insert/update `repair_programs`, emit `repair.enrolled` via `onRepairEvent` (direct call, same pattern as `analyze.mjs` — HTTP path does not have handlers registered, this is intentional). `repair.enrolled` already maps to the `intake` stage in `EVENT_STAGE` — the card lands on the board.
Endpoint test at `src/http/repair-enroll.pg.test.mjs` (tests under `api/` never run — §11).

**3. Authorization gate** — in `src/repair/analyze.mjs`, before generating: call `hasDisputeAuthorization(db, {orgId, clientId})`. If false → `{ ok:false, reason:'no_authorization' }` (same honest-refusal pattern as `no_credit_file`). This is the "agreement signed" gate from the owner's own requirement.

**4. Fire-letters flow in `present.js`** — after the closer picks a repair rung and records payment:
- Button 1 **"Stage letters"**: calls `/api/repair/enroll`, then `/api/repair/generate`. Renders the returned letters on screen (the reveal — script S-15 sells the button-press).
- Button 2 **"Send now"**: calls `/api/repair/send` with `mail:true`. Closer's press satisfies the human gate.
- If generate refuses (`no_authorization`, `no_credit_file`, `no_violations`), show the refusal reason plainly. No silent failures on a sales call.
- Same two buttons also appear on the dashboard row (§8) for non-presentation closes.

**5. Remove the CROA hold** from the generate/send call sites per §2.1. Tag the diff `COMPLIANCE REVIEW REQUIRED` in the PR description.

---

## §5 — WS-B: Engine — six rounds + furnisher letters + evidence

### What exists
- `dispute_cases.round` and `dispute_items.round` CHECK IN ('R1','R2','R3','FURNISHER'). `nextRound()` in `src/metro2/rounds/state.mjs` returns null after R3.
- `dispute_letters.bureau` is `text NOT NULL`; there is **no column saying who the letter is addressed to**. `analyze.mjs` loops `BUREAU_CODES` only — furnisher letters are never generated even though the content exists: catalog type `FURNISHER_VALIDATION` ("Debt validation — direct to furnisher", audience furnisher, for collection/debt-buyer furnishers), FURNISHER prompt pool (12 CFR 1022.43 direct-dispute language), `furnisher_mail_addresses` table, `furnisher-validation.mjs`.
- Rounds advance PER ITEM (`advanceAfterParse`): verified → escalate + bump round; deleted/updated → closed; unaddressed → stays open and strengthens next round. `preDispatchRecheck` drops items missing on a fresh pull. Keep all of this.
- `generateLetter` does not accept prior responses — "their answer becomes evidence" is not built.

### Build

**1. Migration `<next>_repair_rounds_six.sql`:**
- Drop and recreate the round CHECKs on `dispute_cases` and `dispute_items`: `('R1','R2','R3','R4','R5','R6','FURNISHER')`.
- `ALTER TABLE dispute_letters ADD COLUMN target text NOT NULL DEFAULT 'bureau' CHECK (target IN ('bureau','furnisher'));`
- `ALTER TABLE dispute_letters ADD COLUMN furnisher_address_id uuid REFERENCES furnisher_mail_addresses(id);` (null for bureau letters).

**2. `nextRound()`** — takes the client's `rounds_cap` (join `repair_programs`). R1→R2→…→R`cap`→null. Trial caps at R2; when the cap is hit with open items, set program `status='upsell_pending'` and emit `repair.program.complete` (already maps to `program_complete` stage). That event is the 60-day sales-sequence hook — emitting it is in scope; the sales sequence itself is not.

**3. Furnisher generation in `analyze.mjs`** — after the bureau loop: for items whose catalog `sendWhen` matches (collection / debt-buyer furnishers), generate a `FURNISHER_VALIDATION` letter with `target='furnisher'`, round `'FURNISHER'`, addressed from `furnisher_mail_addresses` by `name_norm` match on the item's creditor. No address match → skip with reason `no_furnisher_address` (it shows as a chip, §8 — a human adds the address, regenerates). Bureau letters for the same items still generate — both sides at once is intended (§2.9).

**4. `send.mjs` target-aware:** furnisher letters mail to their `furnisher_address_id`; bureau letters keep current addressing. Same `mail:true` gate for both.

**5. Evidence into the next round:** `generateLetter` accepts `priorResponses` — the confirmed parse outcomes + `dispute_responses.raw_text` excerpts for this item's earlier rounds. R2+ prompt pools already reference "you verified this" language; feed the actual quoted outcome ("On <date> you responded '<verified>' for account ending 1234") into the letter body. Rounds 4–6 per D3.

---

## §6 — WS-C: Inbound — doors, reader agent, parse loop

### What exists
- Uploads are **built, not live**: `POST /api/documents-upload` → byte sniff → Netlify Blobs → `documents` row (kind `client_upload` from migration 118) → signed link → emits `docs.received`. Go-live blockers are prereqs P1–P3 in §12, human tasks.
- `GHL-DOC` "Document Check" agent (migration 114): full prompt, quality gate (in frame, no glare, not blurry, legible), consistency checks, outcomes accept/request_more/hold, JSON out, image reading ON. It lives in GHL, listens for tag `docs:uploaded` **which never fires** (real event is `docs.received`). It checks identity docs, not bureau letters.
- Parser `parseResponseText` (`src/metro2/inbound/parse-response.mjs`): deterministic keyword match per item → deleted/verified/updated/unaddressed + confidence; `needsConfirm` under 0.85. Human confirm via `confirmParse` + the existing exceptions panel. `advanceAfterParse` does the round math. **Nothing feeds any of it.**
- Portal: `public/app/client-portal.html` exists; no upload doors in it.

### Build

**1. Migration `<next>_bureau_response_kind.sql`:** widen `documents.kind` CHECK to add `'bureau_response'` and `'inquiry_doc'`.

**2. Three doors in `client-portal.html`,** gated by the client's active lane (funding track → funding + inquiry doors; repair track → bureau-response door):
- **Funding documents** (ID, utility bill, Articles) → kind `client_upload` (unchanged path).
- **Inquiry documents** (FTC report, supporting ID) → kind `inquiry_doc`.
- **"Upload your bureau response"** in the repair section → kind `bureau_response`.
All three POST the existing `/api/documents-upload` with the kind. The door stamps the kind — no classification, no guessing, no misrouting.

**3. Bureau-response reader agent** — new `src/repair/response-agent.mjs`:
- Listens where `docs.received` is consumed (same pattern F-06 uses), filtered to `kind='bureau_response'`.
- Sends the stored image/PDF to a vision-capable model with a prompt modeled on GHL-DOC's quality-gate half (in frame, legible, retake instructions) plus: transcribe the letter text faithfully; output JSON `{quality: pass|retake, text, bureau_guess, message_to_client}`.
- `retake` → email the client the fix instruction (WS-D template). `pass` → `parseResponseText({ text, items })` against the client's open items → write `dispute_responses` → under 0.85 lands in the existing exceptions panel for human confirm → confirmed (or ≥0.85) → `advanceAfterParse` → next round becomes available.
- Outbound model call goes through the repo's existing AI-provider pattern; if none exists, place the client under `src/messaging/providers/` — outbound `fetch` is only allowed there (§11).

**4. Stub `POST /api/repair/inbound-mail`** for the mail-service return path — accepts the same `{text|document}` shape into the same parse loop. Route registered, marked v1.1 per D6, no IMAP.

**5. GHL config task (not code, for Chris/Darwin):** repoint GHL-DOC's trigger from the dead `docs:uploaded` tag to the platform's `docs.received` (or retire the GHL copy once the platform-side identity check exists).

---

## §7 — WS-D: Repair emails

### What exists
Zero repair templates — only the DS-01/DS-02 downsell keys. The dispatch sweeper **is** registered (`src/workflows/index.mjs:12,90` — the CLAUDE.md line saying otherwise is stale). Templates need `compliance_passed=true` to send (template-approval migration).

### Build
Seed migration `<next>_repair_email_templates.sql` with six email templates, then wire each to its event via the repair handlers → `sendTemplated` (channel email only, §2.4):

| Key | Fires on | Says |
|-----|----------|------|
| `EMAIL-REPAIR-WELCOME` | `repair.enrolled` | What happens next, portal link, upload door explained |
| `EMAIL-REPAIR-LETTERS-SENT` | `repair.letters.sent` | Excited, **names the accounts and bureaus disputed this round**, what a bureau response looks like, "upload it when it arrives" |
| `EMAIL-REPAIR-RESPONSE-RESULTS` | parse confirmed | Per-account outcomes in plain words (deleted / verified / updated), what we do next |
| `EMAIL-REPAIR-ROUND-ADVANCED` | round bump | "Round N is out," which items escalated and why |
| `EMAIL-REPAIR-RETAKE-PHOTO` | agent `retake` | Kind, specific retake instructions from the agent's `message_to_client` |
| `EMAIL-REPAIR-TRIAL-COMPLETE-UPSELL` | `repair.program.complete` (trial) | Results recap, hand-off to the sales sequence |

Copy rules come from the owner's own presentation script (S-11 watch line): **describe the process; never promise removals, score changes, or results.** Merge fields available: account names/last4, bureaus, round number, outcomes.

---

## §8 — WS-E: The dashboard tab

Expand the existing Repair tab inside `public/app/inquiry-remover.html`. One pager, at-a-glance, no task assignment — the screen itself says what needs doing. Clone the Fulfillment-lens pattern from `public/app/pipeline.html`: pure-derive module + SQL gather, tiles start on em-dash (never fake zeros), all-or-nothing attach.

### New files (mirror the fulfillment pattern)
- `src/repair/lens.mjs` + `lens.test.mjs` — pure: row in → chip + due words out. No DB, no clock arg passed implicitly.
- `src/repair/read-repair-signals.mjs` + `.pg.test.mjs` — SQL gather for the extra fields in §9.

### Chip dictionary (first match wins, one action chip per client)
| # | chip key | Label on screen | True when |
|---|----------|-----------------|-----------|
| 1 | `needs_agreement` | Needs agreement | No dispute authorization on file |
| 2 | `review_answer` | Read their answer | Unconfirmed parse sitting in exceptions |
| 3 | `send_letters` | Send letters | Ready letters exist, none sent this round |
| 4 | `stuck` | Stuck | Stage `stalled` or SLA breach (`sla.mjs` clocks) |
| 5 | `waiting_on_bureau` | Waiting on the bureau | Sent; in transit / awaiting response |
| 6 | `round_done` | Round done — next? | Stage `round_complete`, next round available under cap |
| 7 | `trial_done` | Trial done — sales | Program `upsell_pending` |
| 8 | `none` | — | Nothing needed |

**Warning dots** (secondary, can coexist with the action chip): `no_address` (letter would mail with no return address — today this fails silently), `no_furnisher_address` (creditor letter skipped, address needed).

### Layout top to bottom
1. **Tiles:** Need me · Ready to send · Waiting on bureau · Stuck (existing rollups) + **Trial ending** (count of `upsell_pending`). Em-dash until loaded. **Every tile is a filter:** press it to show only those clients, press it again to show all. `role="button"`, `aria-pressed`, keyboard-operable.
2. **Table:** Name | Program (trial/full — **no dollar amounts on this screen**, §2.11) | Round (n of cap) | Stage (existing plain-word pills) | Chip | Due (countdown words from `response_due_at`: "due in 3 days" / "overdue 2 days") | Warning dots.
3. **Row expand:** items (deletion→strong→moderate, existing sort), letters (bureau/furnisher target shown, status, view body), simple timeline from `repair_decision_log`. **The detail block renders directly beneath whichever row was pressed** — single-expand, it moves with the click; pressing the open row closes it. **Clicking a letter opens the letter drawer** (reuse the app's existing drawer pattern from the Fulfillment lens): full body text, target address (bureau or furnisher name + mailing address), round, rule ids, the §2.12 signature block, and a per-letter **Send this one** (`mail:true`) next to the existing send-all. The body already ships in the detail payload (`letters[].html` from `body_text` when generated/ready) — no new endpoint. The presentation "Stage letters" step (§4.4) renders the same drawer stack so the closer reviews before Send now.
4. **Row actions:** Stage letters · Send (mail:true) · Soft pull (existing CCP button) · Clean personal info (D2) · Enroll (for clients closed off-presentation). **Soft pull opens the same typed-confirm disclosure modal as the pipeline archive** (`public/app/pipeline.html`, `#fhDelModal` pattern: one plain-words paragraph saying what happens and what's logged, then type **PULL** to confirm with the go button disabled until typed). Copy that structure and behavior exactly.
5. **Exceptions panel:** keep the existing one (unconfirmed parses, Mark as checked).

### Four states
Loading = em-dashes everywhere. Empty = "No repair clients yet." Error = "Couldn't load — retry" with a retry button. Loaded = the above. Never render a fake zero.

---

## §9 — Data contract additions

`GET /api/read/repair-cases` list rows add: `program` ('trial'|'full'), `rounds_cap`, `authorization_ok` (bool), `address_ok` (bool), `response_due_at` (min across open cases — the column exists on `dispute_cases` and is **never selected today**; add it to the `cases.mjs` SQL), `upsell_pending` (bool). **No money fields in this payload** (§2.11) — `amount_paid`/`price_total` stay in `repair_programs` for owner/closer surfaces only.
Detail adds: `timeline[]` from `repair_decision_log` (ts, action, plain words), `target` + furnisher name on each letter, and the signature fields for the letter render (`signer_name`, `signed_at` from the signed repair contract, §2.12).
Rollups add: `trial_ending`.
Chip derivation happens client-side in `lens.mjs` from these fields — the API ships facts, not conclusions (same split as the fulfillment lens).

---

## §10 — Proof list (Chris clicks these; each PR quotes its lines)

- **A1:** Close TEST client `8556bedc-…` on Trial in the presentation → Stage letters shows real letters with their name → Send now → `dispute_letters.status='sent'`, `repair_programs` row exists (trial, 2, 200), card on `intake`→`letters_generated`→`ready_to_send` history in the decision log.
- **A2:** Client with no signed authorization → Stage letters refuses `no_authorization` → dashboard shows **Needs agreement**.
- **A3:** Signed client's letter body renders the script-styled `signer_name` over the printed name with "Signed electronically · <date>" from the repair contract (§2.12) — no blank signature line.
- **E2:** Press each tile → table shows only that set, tile reads pressed; press again → all rows back. Keyboard works.
- **E3:** Press any client row → the detail block opens directly beneath that row; press the open row → it closes. No dollar amounts render anywhere on the tab. Soft pull opens the typed-confirm disclosure (PULL) matching the pipeline archive modal.
- **B1:** Collection item generates BOTH a bureau letter and a furnisher letter; furnisher letter addressed from `furnisher_mail_addresses`; item's creditor with no address on file shows the `no_furnisher_address` dot instead.
- **B2:** Trial client at end of round 2 with open items → blocked from R3, program `upsell_pending`, **Trial done — sales** chip, `repair.program.complete` emitted. Full client advances to R3+ fine.
- **B3:** R2 letter body quotes the bureau's actual R1 response line for that account.
- **C1:** Upload a clear bureau-letter photo through the portal door → agent transcribes → parse ≥0.85 auto-advances OR <0.85 appears in exceptions → confirm → items move (verified→escalated, deleted→closed).
- **C2:** Upload a blurry photo → client gets the retake email, nothing parses.
- **C3:** Funding-track client does not see the bureau-response door; repair-track client does not see the funding docs door.
- **D1:** Every A1 send queues `EMAIL-REPAIR-LETTERS-SENT` naming the exact accounts; sweeper dispatches it (test-client plus-tagged inbox only).
- **E1:** Tab shows em-dashes → loads → tiles match table math; kill the API → error state with retry; org with no repair clients → empty state.
- **All:** `npm test` green; new endpoint tests live under `src/http/` and actually ran (paste the test-run lines).

---

## §11 — Repo traps (verbatim rules, they bite)

- `npm test` glob is `src/**` and `scripts/**` only — tests under `api/` silently never run. Endpoint tests go at `src/http/<name>.pg.test.mjs`.
- A handler not in the `ROUTES` map in `netlify/functions/api.mjs` 404s.
- `requireAuth` ignores a `roles` key — gate with `requireRole` after it.
- Editing an applied migration is a silent no-op. New numbered files only.
- Outbound `fetch` only in `src/messaging/providers/*`.
- Repair handlers are registered in `src/workflows/index.mjs` only — HTTP-path code calls `onRepairEvent` directly. Keep that pattern.
- No new screens/tabs/nav rows beyond §2.6 (owner standing rule).

---

## §12 — Prerequisites (human tasks, before WS-C goes live)

- **P1:** `netlify env:set DOCUMENT_STORE_PROVIDER "netlify-blobs"` (all contexts) + confirm `DOCUMENT_URL_SECRET` exists (do NOT regenerate if set — it kills outstanding links). Then deploy.
- **P2:** Apply migration `118_client_uploads.sql` (and this batch's new migrations) to the production DB.
- **P3:** One real Netlify Blobs round-trip on the deployed app with the TEST client.
- **P4:** GHL: repoint or retire the `GHL-DOC` trigger (dead `docs:uploaded` tag) — §6.5.
- **P5:** Make the repo private at launch (owner's earlier call).

---

## §13 — Out of scope for this batch (on the radar, not in the build)

- ML system for creditor-inquiry landing / bank fit — does not exist anywhere; separate project.
- Stripe/payment processing (D4 manual for now).
- IMAP / mail-service inbound inbox (D6, stub only).
- AI letter enhancement wiring (D1).
- The 60-day sales sequence itself (this batch emits the event that starts it).
