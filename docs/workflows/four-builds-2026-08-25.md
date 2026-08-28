# Four builds — plan only (2026-08-25)

**Door:** plan only. Do not write product code until Chris answers the four questions and says go.  
**Shared board:** this file.  
**Prove later:** the agent clicks the live path twice. Do not ask Chris to click.  
**Leave alone:** UnderwriteIQ dollar math (5.5×). Live credit pull. Card charge. ClickFunnels apply. Paper mail. Live send / “turn on” mail unless Chris names it.

This is **not** the leftover four on `docs/workflows/four-plus-pulse-2026-08-25.md` (LLC line, lender filter, Apply proxy login, hide Lendflow). Those are a different batch.

**COMPLIANCE REVIEW REQUIRED** on B2 (inquiry names sit next to credit-file / removal work).

---

## Pulse (ops, not a fifth build)

- **Darwin:** skipped this batch. Do not invent a WhatsApp number. Do not ticket him here.
- **Pulse text:** goes to Chris’s personal cell (already used). **Do not print that number on this board.**
- **Registry:** any **new live door** (new page, new button path, new inbound mail that staff use) must be added to the 7:00 a.m. pulse path list in the **same** change. That list is the daily pulse from PR #160 (`src/pulse/` / daily-pulse). Stamping a field on a door we already walk is not a new door — still say so on the row.

---

## In one page

Four leftover jobs. Reuse what is already there. No machine-learning train loop.

| ID | Job | V1 in one line | Status |
|---|---|---|---|
| B1 | Funding plays from bank yes/no | Stamp a play name on the yes/no row we already save | plan — blocked on Q1 |
| B2 | Inquiry expected vs actual name | Save expected name + bureau string on each pull | plan — blocked on Q2 |
| B3 | Mail pipe into the email router | Get bank mail to the Mailgun door that already exists | plan — blocked on Q3 |
| B4 | Auto-fill client email on bank form | Put the right email on Apply so the bank does not see Fundhub | plan — blocked on Q4 |

No dependencies between the four once the answers land. Cap two writers at a time. One writer per row.

---

## Shared “we will not do”

On every row:

- No ML train loop. No play “brain” that learns from wins and losses.
- No live CRS / bureau pull to prove.
- No card charge.
- No ClickFunnels apply (do not score, nag, or touch).
- Do not change lite dollar math (5.5× / age bands).
- Do not plug C-02 `newInquiries` as a one-liner (that would dump the whole file into removal).
- Do not send live mail or flip mail “on” unless Chris said so in that message.
- Do not ask Chris to click. Agent proves twice.

---

## B1 — Funding plays / learn from wins and losses

**What is true today**

- Bank yes/no is already saved on `application_decisions` when status changes (`src/applications/status.mjs`, table from `db/migrations/139_funding_ops.sql`).
- There is no ML learner. There is no play mold (no saved “this is the play we ran”).
- Old CRS findings list is built under `vendor/underwriteiq-full/api/lite/crs/` and then thrown away.
- Lite math stays. Do not change it.

### V1 (smallest)

Add a **play name** stamp on the yes/no row we already write. Staff (or an empty box) can name the play when the bank says yes or no.

That is the hook. Later we can keep the CRS findings list and match plays to wins. Not in V1.

### What we reuse

- `application_decisions` (yes/no already there).
- Existing status write in `src/applications/status.mjs`.
- Existing funding desk / application status UI. No new “ML lab” screen.

### What we will not do

- Train a model. Score “best play” with math we do not have.
- Change 5.5× or any UnderwriteIQ dollar rule.
- Keep / rewrite the thrown-away CRS findings list in V1 (that is a later hook).
- Live CRS. Card charge. ClickFunnels.

### Prove (after go)

Agent, twice, on a sim funding file (reuse Sim Fund Horse if still on the file):

1. Open the live funding / application path on `https://fundhub.ai`.
2. Log a bank yes or no the same way staff do.
3. See the play name on that yes/no row (or the empty slot if Q1 is “empty only”).
4. Confirm the dollar guess on the file did not change.

Do not ask Chris.

### Pulse registry

Not a new door if we only stamp the existing yes/no row. Write that on the change. If we add a new “plays” page, list that page on the 7am pulse in the same change.

---

## B2 — Inquiry expected vs actual name

**What is true today**

- Soft pull already saves the bureau’s `creditorName` on `crs_results`.
- Nothing compares that string to the lender name we expected.
- No alias table (no “CHASE / JPMC / JPMORGAN = same bank” list).
- Lenders **Bureau mismatch** tab (`public/app/lenders.html`) is about bureau **letters** (EX / EQ / TU), not names. Staff do that by hand (`lender_bureau_observations`).
- C-02 (`src/workflows/c-02-inquiry-created.mjs`) reads `newInquiries`. Do **not** feed the whole pull into that as a one-liner.

**COMPLIANCE REVIEW REQUIRED** — names on a credit file sit next to inquiry removal.

### V1 (smallest)

On each pull, store two strings:

1. **Expected** name (the lender we thought we would see).
2. **Actual** bureau string (already on the pull).

No auto-match. No auto-remove. No alias table.

### What we reuse

- Soft pull write to `crs_results` (`src/finance/soft-pulls.mjs`).
- Bureau `creditorName` already on the saved result.
- Lenders mismatch tab stays letters + hand review. Do not reuse it as the name loop.

### What we will not do

- Plug C-02 `newInquiries` as a one-liner.
- Build an alias table in V1.
- Auto-open inquiry removal from a name mismatch.
- Live CRS to prove. Use a saved / sim pull only.
- Card charge. ClickFunnels.

### Prove (after go)

Agent, twice, on a sim inquiry / funding file with a **saved** pull (no new live bureau pull):

1. Open the live soft-pull / file path on `https://fundhub.ai`.
2. Confirm expected name + actual bureau string are stored on that pull.
3. Confirm the Lenders mismatch tab still only talks bureau letters.
4. Confirm no new inquiry-removal case was opened from this store.

Do not ask Chris.

### Pulse registry

Store-only on the existing pull is not a new door. If we add a “name match” tab, list it on the 7am pulse in the same change.

---

## B3 — Mail pipe into the email router

**What is true today**

- F-11 already exists: `src/workflows/f-11-bank-email-event-router.mjs`. It waits on `mail.response`.
- Mailgun webhook already exists: `POST /api/webhooks/mailgun`.
- F-10 already mints `monitor+<client id>@fundhub.ai`.
- Mail to `@fundhub.ai` goes to **Cloudflare**, not Mailgun. So the router sits empty.
- Tests already fake signed Mailgun posts (`src/adapters/mailgun.test.mjs`, `src/workflows/f-11-bank-email-event-router.test.mjs`).

### V1 (smallest)

Fill the pipe so a bank reply to the monitor address can hit the webhook we already have. **Receive only.** Do not start a live mail blast.

The exact pipe is Q3. Do not change DNS or mint a new domain until he picks.

### What we reuse

- F-10 mint of `monitor+<id>@fundhub.ai`.
- F-11 router + task titles (approved / denied / docs / and so on).
- Mailgun webhook + signed-post tests.
- Bank Inbox on Client Control Panel (already the staff door).

### What we will not do

- Send live mail or “turn on” outbound because we touched the pipe.
- Rewrite F-11 or invent a second router.
- Paper mail / PostGrid.
- Live CRS. Card charge. ClickFunnels.

### Prove (after go)

**If Q3 is “do not touch live mail”:** no live send. Run the existing fake signed Mailgun tests twice. Open Bank Inbox on `https://fundhub.ai` twice and confirm it still loads. Stop.

**If Q3 is a live receive pipe:** agent, twice, with a **test** inbound to the chosen monitor address (not a client blast):

1. Confirm Mailgun webhook accepts the signed post.
2. Confirm F-11 makes the matching staff task.
3. Confirm Bank Inbox shows the note on the sim file.
4. Confirm we did **not** send a new outbound.

Do not ask Chris.

### Pulse registry

The day receive is live, Bank Inbox / inbound mail must be on the 7am pulse list in that same change. Fake-test-only V1 does not add a new live door.

---

## B4 — Auto-fill client email on the bank form

**What is true today**

- Apply opens the **bank’s own page** through the proxy + Chrome add-on (`extension/`, PR #159).
- Staff type the email by hand.
- If they type a `fundhub.ai` address, the bank sees Fundhub.
- No auto-fill is built. The add-on can inject later.

Two different emails (do not mix them):

- **Bank form email** = what the bank sees on Apply (this job).
- **Monitor address** = `monitor+<id>@fundhub.ai` (F-10 / F-11). That one is for bank *replies*, and it does show Fundhub.

### V1 (smallest)

On Apply, put the **chosen** email (Q4) where staff can use it without typing `fundhub.ai` on the bank form.

Smallest ship: show / copy the right email on the Fundhub Apply launch. Inject on the bank page is later (add-on), not required for V1 unless he picks inject as the V1.

### What we reuse

- Apply launch + proxy (`src/proxy/launch.mjs`, `api/proxy/launch.mjs`).
- Chrome add-on (`extension/`). Do not rebuild it.
- Client email already on the file.
- F-10 monitor address stays for replies — do not put that on the bank form unless Q4 says so.

### What we will not do

- Submit a live bank application to prove.
- Type or inject `fundhub.ai` as the “helpful default.”
- Live CRS. Card charge. ClickFunnels.
- Rebuild the add-on.

### Prove (after go)

Agent, twice, on Sim Fund Horse Apply on `https://fundhub.ai`:

1. Open Apply (do not submit the bank form).
2. Confirm the chosen email is shown / filled / copy-ready.
3. Confirm a `fundhub.ai` address is not the thing we put on the form (unless Q4 is the monitor address).
4. End the proxy session.

Do not ask Chris.

### Pulse registry

Apply is already a live door. Same change: add one pulse check — “Apply shows the client email, not a Fundhub address” — unless Q4 picks the monitor address.

---

## Questions (one per job — answer these, then we can build)

Reply with **B1 / B2 / B3 / B4** and the letter.

**B1 — Who writes the play name on the first ship?**  
A) Staff type a short name when they log bank yes/no  
B) Empty slot only — add the box, nobody has to fill it yet  
C) Do not add a box yet — keep yes/no as-is

**B2 — Where does “expected name” come from on the first ship?**  
A) The bank we just applied to (the apply row)  
B) Staff type it before the pull  
C) Save the bureau string only — expected can wait

**B3 — How do we fill the empty mail router?**  
A) Point `@fundhub.ai` **receive** at Mailgun (DNS). No outbound blast.  
B) Keep Cloudflare. Mint `monitor+id@mg.fundhub.ai` instead.  
C) Do not touch live mail this batch — tests only

**B4 — Which email goes on the bank form?**  
A) The client’s own email on the file  
B) The monitor address (`monitor+id@fundhub.ai`) — bank will see Fundhub  
C) Do not fill. Only warn if staff type `fundhub.ai`

---

## After he answers

Status: `pending` → `claimed` → `fixer-done` → `CONFIRMED-FIXED`.

One chat per row. Claim before edit. Smallest diff. Agent proves twice. New live doors go on the pulse list in the same change.

Change manifest stays empty until implement.
