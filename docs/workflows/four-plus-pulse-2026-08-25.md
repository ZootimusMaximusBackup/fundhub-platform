# Four plus pulse — game plan (2026-08-25)

**Door:** plan only this pass. Do not write product code until Chris says go.  
**Model:** Grok 4.6 very high fast.  
**Writers:** cap at two at a time after the LLC line lands. One writer per row.  
**Shared board:** this file. Claim a row before you edit.  
**Prove:** the agent clicks the live path twice. Do not ask Chris to click.  
**Leave alone:** UnderwriteIQ dollar math (5.5× / age bands). ClickFunnels apply. Live credit pull. Card charge. Paper mail.

**COMPLIANCE REVIEW REQUIRED** on the pulse text to Chris (ops SMS) and on any Lendflow hide that still sits next to funding copy.

**Pulse dest (2026-08-25):** pulse dest is env `PULSE_SMS_TO` (alias `CHRIS_PULSE_SMS`). Darwin skipped. `DARWIN_WHATSAPP` left unset. No full number on this board. Last four `0865`.

**Merge note (2026-08-26):** PR #156 merged to `main` with a merge commit (`dca608c2`). https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/156 — suggestions see the company on file; no “don’t have an LLC” when a company is saved. P1 live after deploy. UnderwriteIQ dollar math not changed. T2 pg/drill (`11d9fe9f`, PR #150) is still on `main`. No force-push. No `.env` in git. Did not start another product fix.

**Merge note (2026-08-26):** PR #161 merged to `main` with a merge commit (`e6289900`). https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/161 — pulse dest is env `PULSE_SMS_TO`. Darwin skipped. T2 pg/drill (`11d9fe9f`, PR #150) is still on `main`. No force-push. No `.env` in git. Did not send a test SMS. Did not invent `DARWIN_WHATSAPP`. Did not start another product fix. No four-builds code.

**Merge note (2026-08-26):** PR #160 merged to `main` with a merge commit (`c0eb0958`). https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/160 — new live paths must join the 7am pulse registry. T2 pg/drill (`11d9fe9f`, PR #150) is still on `main`. No force-push. No `.env` change. Did not invent `DARWIN_WHATSAPP`. Did not start another product fix.

**Merge note (2026-08-26):** PR #159 merged to `main` with a merge commit (`00698da0`). https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/159 — Chrome add-on wakes on fundhub.ai. T2 pg/drill (`11d9fe9f`, PR #150) is still on `main`. No force-push. No Oxylabs login. No `.env` change. Did not start another product fix.

**Merge note (2026-08-26):** PR #158 merged to `main` with a merge commit (`747db78c`). https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/158 — T2 pg/drill (`11d9fe9f`, PR #150) is still on `main`. No force-push. Did not start another product fix. Darwin WhatsApp still unset. PRs #155 (`2230751c`) and #157 (`cc0e5e06`) were already on `main`.

---

## In one page

Chris named four leftover jobs plus a 7:00 a.m. Mountain check.

1. **LLC line** — the screen says “you don’t have an LLC” even when a company is already on the file. Tiny, certain.
2. **Lender filter** — it already exists. Staff still see “307 fit” because the Lenders desk lists the whole book, and the real match often has no company state.
3. **Apply bank page** — city/state is already fixed (T3). The leftover is the proxy login. The two names are not in local `.env`.
4. **Lendflow / Alt-Fin** — we are not using it. Hide the desk path. Do not delete the adapter.
5. **Dead Document Check texts** — already fixed (T1). Not remaining.
6. **Daily pulse + tripwire** — after the four, or docs-only in parallel. Audit only. No auto-fix. Pulse texts Chris personal cell; Darwin skipped.

---

## Dead Document Check texts — already done

A retired robot (old Document Check / GHL-DOC) was still texting people to “fix your upload.” That is **CONFIRMED-FIXED** (T1, PR #147). It is not remaining.

---

## Order

| # | Row | Why first |
|---|---|---|
| 1 | P1 LLC suggestion | Tiny. Certain. Unblocks honest talk on the file. |
| 2 | P2 Lender filter | Reuse what is already there. Do not build a new engine. |
| 3 | P3 Apply proxy | Job-stop. Env if the login is already in the house. |
| 4 | P4 Park Lendflow | Desk hide only. |
| 5 | P5 Pulse + tripwire | After the four, or docs-only in parallel. **Wait-on:** Darwin WhatsApp number. |

---

## Rows

| ID | Owns | Status | Who | Wait |
|---|---|---|---|---|
| P1 | LLC suggestion reads company on file | CONFIRMED-FIXED | fundhub-eight-llc | PR #156 merged `dca608c2` — P1 live after deploy |
| P2 | Lender filter reuse (no new engine) | CONFIRMED-FIXED | eight-lenders fixer + auditor | PR #157 merged — auditor prove twice PASS |
| P3 | Apply proxy login | set | fundhub-eight-oxy | names set on local `.env` + Netlify (production / deploy-preview / branch-deploy); one prod deploy done; prove waiting (no Oxylabs HTTP this pass) |
| P4 | Hide Lendflow / Alt-Fin on the desk | fixer-done | lendflow-auditor | PR #155 merged 2026-08-26 — https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/155 — live prove after deploy |
| P5 | 7:00 a.m. Denver pulse + existing tripwire | fixer-done | fundhub-eight-pulse | pulse texts Chris personal cell; Darwin skipped. Dest `PULSE_SMS_TO` (last four `0865`). `DARWIN_WHATSAPP` unset. PR #158 / #160 on `main`. |

Status: `pending` → `claimed` → `fixer-done` → `CONFIRMED-FIXED`

---

## P1 — LLC suggestion

### What already exists

The talk line lives in UnderwriteIQ suggestions:

- `src/underwrite/vendor/suggestions.cjs` (the copy Fundhub runs)
- Same words in `vendor/underwriteiq-full/api/lite/suggestions.js`

The condition is simple: `hasLLC` is missing, so the engine treats it as **false**. Then it always prints one of these:

- “You’re approved, but you don’t have an LLC…”
- “You don’t have an LLC yet…”

The read path `api/read/underwrite.mjs` calls `buildSuggestions(underwrite)` and **does not pass a person/company object**.

The adapter (`src/underwrite/adapter.mjs`) still says “Fundhub stores no LLC field.” That note is **stale**. The company is already on file:

- table `businesses` — `name`, `age_months`, `entity_data`
- the same read already loads those rows for age
- the file screen already shows the company (`src/http/client-detail.mjs`)

So the engine never gets told “this person has a company.” It guesses “no LLC” for everyone.

### What we change (smallest)

Pass the company that is already loaded.

In `api/read/underwrite.mjs` (and the adapter so the “missing” map is honest):

- If a `businesses` row exists for this file, set `hasLLC: true`
- Set `llcAgeMonths` from `businesses.age_months` when that number is there
- Call `buildSuggestions(underwrite, { hasLLC, llcAgeMonths })`

Do **not** change dollar math. Do **not** add a new LLC column. Do **not** rewrite the suggestion catalog.

A few tests today say “hasLLC is always missing.” Those tests match the old lie. Update them to the new truth (company on file → not missing). Do not delete or weaken them.

### Prove

Agent, twice, on a sim file that already has a company (reuse Sim Fund Horse `614927f7-…`):

1. Open Underwrite / suggestions.
2. The “you don’t have an LLC” line is gone.
3. If age is on the company, the line talks about seasoning, not “form an LLC.”

Do not ask Chris to click.

**Auditor prove (2026-08-25) — CONFIRMED-FIXED on preview.** Sim Fund Horse `614927f7-95a9-4623-86e8-cd85420d9716`. Scored on `https://deploy-preview-156--transcendent-wisp-888771.netlify.app` (PR #156 merged `dca608c2`; P1 live after deploy).

- Open 1: staff login → Finance OS `?client_id=614927f7-…` → `GET /api/read/underwrite`. HTTP 200. LLC line: “Your LLC is fully seasoned. Combined with a strong personal profile, you are positioned for top-tier business limits.” No “don’t have an LLC.”
- Open 2: same page + same API again. Same line. Still no “don’t have an LLC.”

Finance OS / Client Control Panel do not paint those sentences. Evidence: `docs/workflows/four-plus-pulse-2026-08-25-evidence/p1-llc-api-texts.json` (suggestion texts only) and `p1-llc-suggestions-MARKED.png`.

### Risk

A sole-prop company with no LLC in the name still counts as “has a company.” That matches what Chris said: the company is already on the file. We are not inventing a new entity-type field.

### Wait-on

None.

---

## P2 — Lender filtration

### Search result — it already exists. Do not recreate it.

There are **two** filters. Neither is missing. The desk is not using them the way staff think.

**A. UnderwriteIQ lender matrix (sample shortlist)**  
Path: `vendor/underwriteiq-full/api/lite/crs/lender-matrix.js`  
This is a **small hardcoded list** (Chase Ink, OnDeck, Bluevine, and about a dozen more). It filters by score, months in business, and “needs a company.” It feeds the **PDF** “Capital Partner Shortlist” inside letter packs (`generate-deliverables.js` → `lender_match`).  
Fundhub’s live Underwrite read (`src/underwrite`) does **not** import this file. Wiring this list to Apply would **replace** the real 307-row book with ~15 sample names. Do not do that.

**B. Fundhub live match (the real book)**  
Paths:

- `src/lenders/match.mjs` — `matchLenders`
- `src/lenders/store.mjs` — `matchForClient`
- `GET /api/read/lender-matches` — `api/read/lender-matches.mjs`

Rules it already has: active only, client state vs `eligible_states`, skip lenders that pull a hot inquiry bureau, rank by tier / bureau rotation.

The **Apply door on Client Control Panel** already calls this (`public/app/client-control-panel.html` → `/api/read/lender-matches`). Generate Apps refreshes that same list.

The **Lenders desk** does **not**. `public/app/lenders.html` loads `/api/read/lenders` (the whole book, up to 500). When you open it with a client, it still paints every row and says 307.

### Why staff still see “307 fit”

Three reasons. Not “no filter.”

1. **Wrong screen.** Lenders.html lists everyone. The word “fit” on that desk is a count of the book, not a match.
2. **Wrong input on the real match.** `matchForClient` reads state from `clients.custom_fields` (`business_state` / `state` / `home_state`) only. The company state lives on `businesses.entity_data.state`. T3 already taught **Apply proxy** to use the company city/state. The **match** still does not. If state is empty, the code **lets every lender through** on purpose (“do not invent a block”).
3. **Empty lender states.** If a lender row says nothing, or “All States,” it stays in. A book of 307 with blank / all-states rows will still look like 307 even after we pass Texas.

So: the filter exists. It is not wired to the Lenders desk. The match often has no company state. That is why “307 fit” includes out-of-state banks.

### What we change (smallest wire, not a new engine)

Reuse `matchForClient`. Do not port the 15-name UWIQ sample list onto Apply.

1. When Lenders.html is opened with a `client_id`, load `/api/read/lender-matches` and show that list (and the real match count). Keep the full book only when no client is open.
2. In `matchForClient`, read company state the same way the file already stores it: `businesses.entity_data.state`, then the old custom-field keys. Same idea T3 used for Apply. Do not change 5.5× math.

Do not add a new scoring engine. Do not copy Chase Ink / OnDeck from the sample matrix onto the live book.

### Prove

Agent, twice, on Sim Fund Horse (Texas companies on file):

1. Client Control Panel → Generate Apps. The number is **not** 307 if the book has out-of-state-only rows. The line names a real fit count.
2. Lenders desk with that client open. Same count. A bank that only serves another state is not in the Apply list.

Do not ask Chris to click.

### Risk

If almost every live lender row is blank or “All States,” the number stays high. That is data, not a missing engine. Say so in the prove note. Do not invent state rules on blank rows.

### Wait-on

None.

### Auditor prove (2026-08-25) — twice — PASS

**Status: PASS.** Not not-live. PR #157 is merged (`cc0e5e06`). Walked the Netlify deploy-preview (code on the URL). Live `fundhub.ai` HTML also has the same `/api/read/lender-matches` wire.

**URL:** `https://deploy-preview-157--transcendent-wisp-888771.netlify.app`  
**Client:** Sim Fund Horse `614927f7-95a9-4623-86e8-cd85420d9716` (three Texas companies on the file).  
**No bank submit. No card charge. No live credit pull.**

| Check | Pass 1 | Pass 2 |
|---|---|---|
| CCP Apply door before Generate Apps | `21 fit. Click Apply…` | same |
| Generate Apps click → `/api/read/lender-matches` | `match_count: 21` | `match_count: 21` |
| Lenders desk `?client_id=` | `21 fit` · 21 rows | `21 fit` · 21 rows |
| Other-state-only bank on the list | 0 | 0 |

**Book vs match (data, not a missing engine):**

- Active book: **307**
- Other-state-only (skipped): **286** — examples: 1st Source Bank `IN`, Alpine Bank `CO`, Altabank `UT`
- Texas-specific kept: **17**
- All States kept: **3** (American Express, Capital One, Goldman Sachs)
- Blank kept: **1** (Verify Bank)
- Fit: **21** = 17 + 3 + 1

The number is **not** high because almost every row is All States. Most of the book is other-state-only and those rows are out.

**Note (not a FAIL of the filter):** After Generate Apps, the on-screen line becomes `Apps ready — use Apply on each lender` and drops the “21 fit” words. The API and the apply list stay at 21. Lenders desk still says `21 fit`.

**Evidence**

- `docs/workflows/four-plus-pulse-2026-08-25-evidence/p2-prove.json`
- Marked: `docs/workflows/four-plus-pulse-2026-08-25-evidence/shots/P2-PASS1-CCP-BEFORE-MARKED.png`
- Marked: `docs/workflows/four-plus-pulse-2026-08-25-evidence/shots/P2-PASS1-CCP-AFTER-MARKED.png`
- Marked: `docs/workflows/four-plus-pulse-2026-08-25-evidence/shots/P2-PASS1-LENDERS-MARKED.png`
- Marked: `docs/workflows/four-plus-pulse-2026-08-25-evidence/shots/P2-PASS2-CCP-BEFORE-MARKED.png`
- Marked: `docs/workflows/four-plus-pulse-2026-08-25-evidence/shots/P2-PASS2-CCP-AFTER-MARKED.png`
- Marked: `docs/workflows/four-plus-pulse-2026-08-25-evidence/shots/P2-PASS2-LENDERS-MARKED.png`

Did not fix. Stop.

---

## P3 — Apply bank page / proxy login

### What already exists

T3 (PR #152) is **CONFIRMED-FIXED**: Apply now uses the company city/state. Harvest used Austin / TX twice. The leftover hole is **`oxylabs_credentials_missing`** — the bank page still does not open.

The login check is in `src/adapters/oxylabs.mjs` (`oxylabsConfigFromEnv`). It needs two names:

- `OXYLABS_USERNAME`
- `OXYLABS_PASSWORD`

Apply launch: `src/proxy/launch.mjs` → `POST /api/proxy/launch`. Desk button: `public/app/proxy-apply.js`.

### What is in the house (names only — no values)

Implement-time check (2026-08-25, worktree `fix/oxylabs-apply` at `fundhub-eight-oxy`):

- Local `.env`: **no** `OXYLABS_*` names. No proxy / residential names either.
- Netlify (names only, CLI linked): production, deploy-preview, and branch-deploy all have **no** `OXYLABS_USERNAME`, **no** `OXYLABS_PASSWORD`, **no** `OXYLABS_PROXY_PASSWORD`.
- `.env.example` lists `OXYLABS_USERNAME` and `OXYLABS_PASSWORD`.
- Code already reads those two names. Apply → `POST /api/proxy/launch` → `src/proxy/launch.mjs` → `src/adapters/oxylabs.mjs` (`oxylabsConfigFromEnv`). No extra env wire. No allow-list to add. No PR.

Chris has not pasted a login yet. We did not invent one. We did not ask him to rotate. We did not deploy. Prove is parked until the two names are set.

### What we change

At implement time only:

1. Check Netlify production names again (names only). If the two names are there, copy them into the run that Apply uses. One deploy after the set, not one deploy per name.
2. If they are still missing, **stop**. Tell Chris: the Oxylabs login is not in local `.env` and not on Netlify. We cannot mint it. We will not ask him to rotate. We only need the **existing** login from wherever he already keeps it (Oxylabs dashboard / password box). That is a wait-on, not a new product.

No new proxy engine. No ClickFunnels. Do not submit a real bank form.

### Prove

Only after the two names are set. Agent, twice, on Sim Fund Horse → Apply on 1st Source Bank:

1. No `oxylabs_credentials_missing`.
2. The bank page / proxy door opens. Do not file a real application.

If the names are still missing, prove is “the 503 still names the two missing settings” — and we stop.

### Risk

A bad existing password would still fail live. That is “this exact login is broken,” not a rotation lecture. Try the existing names first.

### Wait-on

**set.** `OXYLABS_USERNAME` and `OXYLABS_PASSWORD` are on local `.env` and Netlify (production / deploy-preview / branch-deploy, `--secret`). One prod deploy. **waiting** on Apply prove (stopped — no more Oxylabs HTTP). **proved:** no.

---

## P4 — Park Lendflow / Alt-Fin

### What already exists

We are **not** sending files to Lendflow from the desk.

- `src/adapters/lendflow.mjs` can submit. **Nothing on the desk calls it.** Only tests do.
- Webhook `/api/webhooks/lendflow` is registered. Cards on that rail would move only if Lendflow pinged us.
- Full End-To-End Audit already scored the Alt-Fin rail **not-live** — no send button.

What staff still **see**:

- Pipeline tab **R-03** “Funding: Alt-Fin (Lendflow)” — `public/app/pipeline.html`
- MOVE dest “Alt-Fin (Lendflow)” — same file
- Partner Galaxy / Galaxy labels — `public/app/partner-galaxy.html`, `public/app/galaxy.html`
- Journeys page copy — `public/app/journeys.html`

### What we change (fence, do not delete)

Hide / label off the desk send path:

- Hide or mark **off** the R-03 rail tab and the MOVE dest
- Change Galaxy labels to “Alt-Fin (off)” or hide that rail
- Leave the adapter, webhook, and tests in place

Do not delete `src/adapters/lendflow.mjs`. Do not drop the webhook. A fence is enough.

### Prove

Agent, twice:

1. Pipeline: no live “send to Lendflow” / Alt-Fin rail that looks like a job.
2. MOVE: no dest that puts a file on Lendflow.
3. A funding file can still use Card Stacking Apply Now.

Do not ask Chris to click.

### Risk

A file already sitting on `funding_altfin` could look stuck. Leave those cards; do not wipe. Staff use Card Stacking.

### Wait-on

None.

### Auditor (2026-08-25) — PR #155 / worktree `fundhub-eight-lendflow`

**COMPLIANCE REVIEW REQUIRED** stays on this hide (funding copy next to a parked rail).

Ground truth for this prove is this P4 list + the named checks. `docs/journeys/role-funding-advisor-intended.md` does not name Lendflow / Alt-Fin.

Proved on the **built worktree pages** (commit `2e080077`), twice, JS off so login bounce does not hide the markup. Live `fundhub.ai` is **not-shipped-yet**, not a FAIL of the PR.

| # | Check | Score | Evidence |
|---|---|---|---|
| 1 | Pipeline rail: no live R-03 / “Funding: Alt-Fin (Lendflow)” tab | **PASS** | Pass 1 + 2 DOM on `http://127.0.0.1:8765/app/pipeline.html`: rails are R-01, R-02, R-04…R-09. No `data-rail="R-03"`. No “Alt-Fin (Lendflow)” in body. Shot: `docs/workflows/four-plus-pulse-2026-08-25-evidence/shots/p4-pipeline-rails-pass1-MARKED.png` (1 = rail skip R-02→R-04). Unit test `R-03 Alt-Fin (Lendflow) is parked off the desk` pass. |
| 2 | MOVE dest: no dest that puts a file on Lendflow / `funding_altfin` | **PASS** | Pass 1 + 2: MOVE dests are Card Stacking · Apply Now, Repair, Inquiry, Lost, AR. No `data-pipeline-key="funding_altfin"`. Same unit test. |
| 3 | Galaxy / Partner Galaxy: no “Alt-Fin (Lendflow)” rail label | **PASS** | Pass 1 + 2 body text on built `galaxy.html` + `partner-galaxy.html`: no “Alt-Fin (Lendflow)”. Built `RAILS` names: Sales, Card Stacking, Optimization Rounds, Inquiry Removal, AR + Collections, Affiliates + Hiring. Unit test `Galaxy rails do not paint Alt-Fin (Lendflow)` pass. |
| 4 | Card Stacking Apply Now still present | **PASS** | Pass 1 + 2: MOVE dest `Funding: Card Stacking · Apply Now` + rail `R-02 Funding: Card Stacking`. |
| 5 | Adapter + webhook still exist (not deleted) | **PASS** | `src/adapters/lendflow.mjs` present (23587 bytes), still exports `submitApplication` + `handleLendflowWebhook`. `src/http/router.mjs` still has `lendflow: { fn: handleLendflowWebhook }`. Netlify still maps `/api/webhooks/:provider`. Desk HTML does not call `submitApplication` (tests only). Did **not** submit Lendflow. |

Live `https://fundhub.ai/app/pipeline.html` (HTTP 200, 2026-08-26): still has R-03 “Funding: Alt-Fin (Lendflow)” tab and MOVE dest `funding_altfin`. Galaxy + Partner Galaxy still label `Alt-Fin (Lendflow)`. **not-shipped-yet** until merge.

**Leftover (not a named-check FAIL):** `public/app/journeys.html` `PIPES` still lists `Funding: Alt-Fin (Lendflow)`. That page was in “what staff still see,” not in the named five. Wireframes still say Alt-Fin; they are not the live desk.

Dump: `docs/workflows/four-plus-pulse-2026-08-25-evidence/p4-dom-shots.json`.

No fixer work from this pass.

---

## P5 — Heartbeat / pulse + tripwire

### Pulse — what already exists (wrong tool for this ask)

`src/ops/pulse.mjs` + `GET /api/read/ops-pulse` is the **AI COO money pulse** (deposits, funded files, ads). It is not a full-system audit. Do not stretch it into e2e.

Draft agents **OP-01 Heartbeat** and **OP-03 Daily Brief** exist in the agent table and are **draft**. They do not run a 7:00 a.m. live walk.

### Tripwire — what already exists (do not invent a second one)

Chris said we already know it. The repo has these, not a new invention:

1. **Recon (AG-07)** — now live on Inngest `daily-pulse` (migration 260). Old GHL-RECON stays retired. Prompt says: triage, do not fix, text the owner on a real break.
2. **Gate-relay watchdog** — `scripts/gate-relay/index.mjs`. Local Mac messenger. Writes `heartbeat.json`. Texts if the messenger dies. This is the “silence is not the same as fine” tripwire for the phone relay.
3. Test “tripwires” (assertions in tests) — not a live alarm.

**Plan:** turn these **on / wire them**. Do not build a third watchdog.

- Daily **pulse** = Inngest cron `daily-pulse` at `0 13 * * *` (7:00 a.m. Denver during daylight time). Audit only. Cursor Automation is a draft only — Chris finishes that in Agents Window if he wants the extra copy. Repo cron does not wait.
- **Tripwire** = existing Recon + gate-relay watchdog. Pulse FAILs text Chris. If the daily run does not fire, that is a tripwire FAIL too.

### What the 7:00 a.m. pulse does

Every day at **7:00 a.m. America/Denver** (he said MST; Denver keeps daylight time honest):

1. Audit only. Suggested fixes + proof. **Do not auto-fix.**
2. Walk live paths the same way the Full End-To-End door does, at a daily size: health, login, one funding Apply door, one suggestion read, outbound lane (Twilio accepted to the agent number), prove Gmail search. Do not live-pull credit. Do not charge a card. Do not mail paper.
3. Write a scorecard under `docs/workflows/pulse-YYYY-MM-DD.md`.
4. **Text Chris** on his personal cell via `PULSE_SMS_TO` (last four `0865`) using the company send-from already in the product. Do not print secrets. Pulse texts Chris personal cell; Darwin skipped.
5. **Ticket Darwin** with the FAIL list and suggested fixes. WhatsApp only when `DARWIN_WHATSAPP` is set. Left unset. **Do not invent a WhatsApp number.**

Cursor cron has **no timezone field**. 7:00 a.m. Denver is `13:00 UTC` while daylight time is on (now), and `14:00 UTC` after the fall-back. Set `0 13 * * *` now. Note the flip in the automation prompt.

This is a Cursor Automation **because Chris named the schedule**. Draft it after the four product rows, or docs-only in parallel. Do not open the Automations editor until he approves this board.

### Prove (2026-08-26 dry-run)

Ran `node scripts/daily-pulse.mjs --dry-run --start-relay` in `fundhub-eight-pulse`. Scratch-safe: no live DB write, no `verify:e2e`, no client texts.

1. Scorecard: `docs/workflows/pulse-2026-08-26.md` — **This run does not auto-fix.** 6 PASS / 0 FAIL / 1 skip (Recon skipped — no DB in dry-run).
2. Chris SMS: dest is `PULSE_SMS_TO` (personal cell, last four `0865`). No live send tonight. Darwin WhatsApp: **not sent** (`DARWIN_WHATSAPP unset`). Ticket text is on the scorecard. Pulse texts Chris personal cell; Darwin skipped.
3. Gate-relay: existing `watch` started. `heartbeat.json` updated (pid 925). No second tripwire.

### Cursor Automation draft (optional copy — do not block repo cron)

Chris must finish this in Agents Window if he wants the Cursor copy.

| Draft field | What will open in the editor |
|-------------|------------------------------|
| Name / description | Fundhub daily pulse — 7:00 a.m. Denver audit |
| Trigger | Every day. Cron `0 13 * * *` (7:00 a.m. America/Denver while daylight time). After the fall-back, change to `0 14 * * *` or it fires at 6:00 a.m. Denver. |
| Tools | None required. Live schedule is the Inngest cron in the repo. |
| Instructions | Audit only. Do not auto-fix. Do not live-pull credit. Do not charge a card. Do not mail paper. Write `docs/workflows/pulse-YYYY-MM-DD.md`. One SMS to Chris on `PULSE_SMS_TO` (personal cell) only on the live repo cron. Darwin skipped while `DARWIN_WHATSAPP` is unset. |
| Resolved settings | This repo, after merge to main. Schedule `0 13 * * *`. |
| To finish in editor | Schedule picker + any Cloud Agent checkout. Repo cron does not wait. |

### Risk

A daily full walk can send extra SMS if someone treats it like “run everything.” Cap the pulse to **audit + one prove SMS to Chris**. No extra client texts. No live CRS. No card charge.

### Wait-on

**Darwin skipped.** `DARWIN_WHATSAPP` left unset. Pulse texts Chris personal cell via `PULSE_SMS_TO`. Ticket stays on the board until Darwin’s WhatsApp exists.

---

## What we will not do

- New lender engine
- Change UnderwriteIQ 5.5× / age-band dollars
- Touch ClickFunnels apply
- Live credit pull, card charge, paper mail
- Delete the Lendflow adapter
- Ask Chris to rotate a key
- Invent Oxylabs or WhatsApp values
- Auto-fix from the pulse
- Ask Chris to click to prove

---

## Copy-paste prompts (after Chris says go)

Use one chat per row. Cap two writers.

### P1

```
You are Fundhub Fixer. Board: docs/workflows/four-plus-pulse-2026-08-25.md row P1.
Claim P1. Smallest diff: pass hasLLC + llcAgeMonths from businesses into buildSuggestions in api/read/underwrite.mjs (and adapter missing map). Do not change dollar math. Prove twice on Sim Fund Horse suggestions. Do not ask Chris to click.
```

### P2

```
You are Fundhub Fixer. Board: docs/workflows/four-plus-pulse-2026-08-25.md row P2.
Claim P2. Reuse matchForClient. Do not recreate UnderwriteIQ lender-matrix. Feed company state from businesses.entity_data.state. Lenders.html with client_id must show lender-matches, not the whole book. Prove twice on Sim Fund Horse. Do not ask Chris to click.
```

### P3

```
You are Fundhub Fixer. Board: docs/workflows/four-plus-pulse-2026-08-25.md row P3.
Claim P3. oxylabs_credentials_missing needs OXYLABS_USERNAME and OXYLABS_PASSWORD. Read .env and Netlify names only. Set existing secret if present. Do not invent. Do not ask Chris to rotate. Prove Apply twice on Sim Fund Horse only if names are set. Do not submit a bank form.
```

### P4

```
You are Fundhub Fixer. Board: docs/workflows/four-plus-pulse-2026-08-25.md row P4.
Claim P4. Hide/label off Alt-Fin (Lendflow) desk path: pipeline R-03, MOVE dest, Galaxy labels. Do not delete src/adapters/lendflow.mjs or the webhook. Prove twice. Do not ask Chris to click.
```

### P5

```
Pulse texts Chris personal cell; Darwin skipped. Board: docs/workflows/four-plus-pulse-2026-08-25.md row P5.
Daily Cursor Automation 7:00 a.m. America/Denver (cron 0 13 * * * while daylight time). Audit only. No auto-fix. Scorecard + SMS Chris via PULSE_SMS_TO + ticket Darwin (WhatsApp skipped). Wire existing Recon / gate-relay watchdog. Do not invent a second tripwire. Do not invent a WhatsApp number.
```

---

## Change manifest (empty until implement)

| Row | Files | Journeys | Status |
|---|---|---|---|
| P1 | `api/read/underwrite.mjs`, `src/underwrite/adapter.mjs` (+ tests, CHANGELOG) | role-funding-advisor, client | CONFIRMED-FIXED PR #156 merged — P1 live after deploy |
| P2 | `src/lenders/match.mjs` (`resolveMatchState`), `src/lenders/store.mjs` (`matchForClient` reads `businesses.entity_data.state`), `public/app/lenders.html` (client_id → `/api/read/lender-matches`), tests + CHANGELOG. PR #157 **merged** 2026-08-26 (`cc0e5e06`). | role-funding-advisor | CONFIRMED-FIXED (auditor prove twice PASS) |
| P3 | none (env-only; code already reads `OXYLABS_USERNAME` + `OXYLABS_PASSWORD`) | role-funding-advisor | set; prove waiting |
| P4 | public/app/pipeline.html, public/app/galaxy.html, public/app/partner-galaxy.html, src/http/pipeline-screen.test.mjs, src/http/crm-html.test.mjs, docs/journeys/CHANGELOG.md | role-funding-advisor | PR #155 **merged** 2026-08-26 (`2230751c`). Journeys page not edited. Adapter not deleted. Leftover: journeys.html PIPES still names Alt-Fin. **COMPLIANCE REVIEW REQUIRED** on the hide. |
| P5 | `src/pulse/notify.mjs` reads `PULSE_SMS_TO` / `CHRIS_PULSE_SMS`; `.env.example` names only; Darwin still `DARWIN_WHATSAPP` unset. Prior: PR #158 / #160. | (ops / gate-relay, not a Fundhub screen) | pulse texts Chris personal cell; Darwin skipped |

---

## FYI note (2026-08-25) — bank stealth / email router / comms (read-only find)

Did not turn anything on. Did not touch `OXYLABS_*`.

**Bank stealth:** Already built = residential IP near the client (`src/proxy/launch.mjs`, `src/adapters/oxylabs.mjs`, Chrome ext `extension/`). Bank form is the bank’s own URL — no Fundhub chrome on that page. Missing = no user-agent fake, no auto-fill of the client’s email. Live leftover: `extension/manifest.json` content scripts match localhost / `*.netlify.app` only — **not** `https://fundhub.ai`.

**Email router:** Not forgotten as code. `src/workflows/f-11-bank-email-event-router.mjs` is registered. Door is `POST /api/webhooks/mailgun`. Off until mail hits Mailgun. F-10 writes `monitor+<id>@fundhub.ai`. Mailgun catch-all is `mg.fundhub.ai`. `fundhub.ai` mail goes to Cloudflare. Local `.env` has **no** `RESEND_REPLY_TO_DOMAIN` (name only).

**Comms:** `https://fundhub.ai/app/messaging.html` is wired (not stub). Bank mail is Client Control Panel → Open Bank Inbox. Test without live: `src/adapters/mailgun.test.mjs`, `src/workflows/f-11-bank-email-event-router.test.mjs`, `e2e/messaging-inbox.spec.mjs` (fake API). Do not send real mail.

**One leftover (broken, not just off):** the mail pipe. The router is waiting. Mail to `@fundhub.ai` never reaches the webhook.
