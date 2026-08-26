# Overnight e2e learn — 2026-08-26

**Door:** TEST + notes. No product fixes.  
**People:** the five existing horsemen only. No remint. No ClickFunnels. No card charge. No live CRS. No paper mail. No unused Josh / AG-09 scripts. Agent phone `+16616054248` only.  
**PASS rule:** full event list in order + a real talk for a live voice agent. Desk load, one field, or a hang-up under 5 seconds is FAIL. No talk order in intended = **UNVERIFIED**, never PASS.  
**Never 100%** unless every intended event on all five was walked twice.

---

## Morning brief (working — night not done)

**Proven (do not re-open):**
- Owner KPI **Funded = 2** on screen and in the DB. Cash **$375.96**. `/start?ref=AFF-000001` wrote a click.
- Repair Horse desk **What is next** is on live (R1 Written, R2 Held, EX · BENEFICIAL). Did not Send.
- AR/calls lane: talk **FAIL** (0.13s / no-answer). Book order is live fire, **not** in intended files. Fund Horse never booked. AR first notice already sent; next sleeps 7 days. Present Invoice does not start AR.
- AG-04 / AG-09 live prompts are 169-letter stubs. **FAIL**.
- **B2 PASS** — expected vs actual on Specialist, Sim Fund Horse, stored + reload.
- **B4 FAIL** — Apply twice: “Could not start Apply,” no nearby exit 422. Bank page never opened. **Do not click Apply again tonight. Do not touch Oxylabs.**
- White-label drips **not-live** (no templates). Do not rebuild.

**Not proven / do not claim:**
- Any of the five horsemen as a full event-list PASS.
- A real Josh or AG-09 talk. **Do not retry Bland tonight.**
- Book sequence on these five (no `booking.created`).
- AR-02 / AR-03 / AR-04 (sleeping).
- Paper mail, live CRS, card charge (not run).
- CCP opened with `?id=` in the browser this hour (Playwright aborted; stuck rule — used one dash read per file instead).
- B1 play box after reload (wait for **#176** on live, then one check).
- Aff Forgot / AF1 (wait for **#177** on live, then one `e2e+aff-*` Forgot click).

**Chris quality-check later (existing PDFs, not new work):**
- UnderwriteIQ pack on disk: `docs/workflows/four-plus-pulse-2026-08-25-evidence/deliverables/fund-*.pdf`
- Repair letters on disk: `…/repair-EQ-R1-bureau.pdf`, `…/repair-EX-R1-bureau.pdf`

**Not 100%.**

---

## The five files

| Lane | Name | client_id | Plus-tag |
|---|---|---|---|
| Funding | Sim Fund Horse | `614927f7-95a9-4623-86e8-cd85420d9716` | `+sim-fund-20260825h` |
| Repair | Sim Repair Horse | `5ce80871-0b70-4d2d-89e0-efdd62aa2e2f` | `+sim-repair-20260825h` |
| Combo | Sim Combo Horse | `f2bc2425-8360-428c-98e7-c7fab4029c03` | `+sim-combo-20260825h` |
| Inquiry | Sim Inquiry Horse | `a792442a-8644-4c6d-9b12-d004be1840d2` | `+sim-inquiry-20260825h` |
| Course | Sim Course Horse | `2492c2a0-4af0-48ca-9566-1f9b52e69cee` | `+sim-course-20260825h` |

Live-fire list (system map, not intended doors):  
`entry.captured` → S-00 welcome → S-01 intake → survey/book → Josh → closer/Present → mint (no pay) → docs → advisor / repair / inquiry / course as that file’s path.

---

## Hour 0 — start (~1:00 a.m. Pacific)

**What I already know (do not pretend it is new):**

- Intended files are almost all **doors**. The event list lives in `docs/workflows/system-map-2026-08-26.md`.
- AG-04 and AG-09 live prompts are the **same 169-letter stub**. Unused long scripts stay unused. Roleplay overall **FAIL**. Sequence **UNVERIFIED**.
- OpenAI `callModel` path is 429 / no credits tonight. Empty talk is FAIL, not a pass.
- PR #170 “What is next” is **on live**. Repair Horse click 1 showed R1 Written, R2 Held, EX · BENEFICIAL, EQ/EX letters. Did not Send.
- Owner KPI funded tile is **PASS** (locked): screen and DB both **2**. Cash **$375.96**. Do not re-litigate.
- `/start?ref=AFF-000001` **wrote a click**.
- Mint on Fund Horse: `purpose: custom` $1 created, **not sent** (`5110efb4-…`). `custom_invoice` 400s.
- CCP `?contact=` did **not** open a file. Real door is `?id=`.

**AR / calls facts (other lane — ingested, not re-run):** see `docs/workflows/journeys-ar-calls-2026-08-26.md`.

- Talk **FAIL**. Do **not** retry Bland tonight. Do **not** merge #174. Voice URL stays on the 120s twimlet.
- Book sequence (live fire): confirm + Josh + 24h + 2h + 15-min handoff. No-answer: now, +30m, +2h. **Not** in intended files. **UNVERIFIED** vs intended.
- Fund Horse: **no** `booking.created`. Book sequence never started. Staff Josh went out. No book texts.
- AR: two unpaid success-fee invoices. First notice sent. Next sleeps 7 days. New pay link minted unpaid. Present Invoice does **not** start AR.
- Repair: trial 2 / full 6. R2 holds on trial. 30-day bureau wait.
- FAIL left alone: no-answer texts 2 and 3 almost never leave.

**This hour’s job:** open all five with `?id=`. Score each file’s event list. No Bland. No API spray.

---

## Hour 1 — ~1:15 a.m. Pacific

**Did:** one login + one `GET /api/dashboard/client?id=` per horseman (five reads). No Bland. No send. No remint. Playwright CCP `?id=` aborted once — did not retry the same goto.

**What I learned**

- The five horsemen **all have** welcome email + welcome SMS keys, and **all have** nobook email + nobook SMS. None booked. That matches the AR/calls fact: Fund Horse has **no** `booking.created`, so confirm/Josh/24h/2h/15-min **never started**.
- Staff Josh can go out **without** a book (AR/calls fact). That is not the book sequence.
- Fund Horse next action is **Apply for Funding** (card already on Apply Now). Repair and Inquiry next action is **Remove Inquiries**. Combo and Course returned **no** next action.
- Fund Horse already has **AR-01** email+SMS twice (two unpaid success-fee invoices). Next AR sleeps 7 days. Do not poke it.
- Fund Horse also has **four** `SMS-DOC-02-REQUEST-MORE` rows. Extra doc-chase texts. That is a **FAIL** (extra SMS), not a freebie.
- Repair Horse next action says Remove Inquiries even though letters are ready to send. Possible lie. Did not Send.
- Dashboard `businesses` count is **0** on all five here. Earlier horsemen boards said extra companies were added. I do not invent which store is true. **UNVERIFIED**.
- All five `funded=false`. The owner tile of **2** is other files. Locked. Do not mix them.

**What I still fake if I call this e2e**

- Reading stored template keys is **not** walking the event as it fires.
- I did not open all five CCP screens this hour.
- I did not talk to Josh or AG-09 (forbidden retry).
- I did not MOVE / Apply / send letters / pay.

### Five-file event score (inventory, not a fire)

| Event | Funding | Repair | Combo | Inquiry | Course |
|---|---|---|---|---|---|
| S-00 welcome email key present | yes | yes | yes | yes | yes |
| S-00 welcome SMS key present | yes | yes | yes | yes | yes |
| Booked / `booking.created` | **no** | **no** | **no** | **no** | **no** |
| Book texts (24h / 2h / 15-min) | **never started** | same | same | same | same |
| Josh real talk | **FAIL** (lane fact) | — | — | — | — |
| Nobook chase keys | yes | yes | yes | yes | yes |
| AR-01 | **yes** (2) | no | no | no | no |
| AR-02–04 | sleeping / not due | — | — | — | — |
| Extra SMS | **FAIL** (DOC-02 ×4) | DOC-02 ×2 | none seen | none seen | none seen |
| Full list walked twice | **no** | **no** | **no** | **no** | **no** |
| File PASS | **FAIL** | **FAIL** | **FAIL** | **FAIL** | **FAIL** |

Intended files still have **no** book/talk order → those rows stay **UNVERIFIED**, not PASS.

---

## Hour 2 — ~1:03 a.m. Pacific

**Ingested (do not redo):**

| ID | Result | Rule tonight |
|---|---|---|
| B2 expected vs actual (Specialist, Sim Fund Horse) | **PASS** stored + reload | Leave it. |
| B1 play name | **FAIL** live — saved in DB, box empty on reload. PR **#176** merge in flight. | After #176 is **on live**, **one** reload check only. Not on `origin/main` yet (`da539689`). Did **not** check. |
| B3 mail pipe | **code-only** — 45 tests, no DNS | Not a live inbound sequence. |
| B4 bank / Apply | **FAIL** twice. Could not start Apply. Bank never opened. | **Do not click Apply again.** Do not touch Oxylabs. |
| Aff reset + AF1 welcome | PR **#177** merge in flight | Do not rebuild drips/reset. After live: **one** Forgot click on `e2e+aff-*` only. If live cannot load `pg`, **FAIL** that row — no third try. |
| White-label drips | **not-live** (no templates) | Do not rebuild. |

**Still true:** no Bland. no API spray. no new fixes. Five horsemen still not a full event PASS.

**What I learned:** B-walk is a desk path, not the five-sim event list. A B2 PASS does not make Funding Horse e2e PASS. B4 FAIL means funding Apply motion stays FAIL; I will not burn another Apply click.

**What I still fake if I stop here:** claiming advisor “done” without Apply. Claiming B1 fixed before #176 is live. Claiming aff reset before #177 is live.

---


