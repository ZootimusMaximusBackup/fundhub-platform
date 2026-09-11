# The six files the aborted run changed

Read-only assessment. Written 2026-09-07 for Chris.

On 2026-09-06 a build was started by mistake and stopped part way. Nothing it wrote was
checked. Commit `eec40ef6` then swept it all into the branch, so it is committed and it
looks finished. It is not.

**The one line that matters: five of the six files are good work. One test was never
updated, and the test suite is RED because of it. And the words the whole job was about
still do not show on the screen.**

---

## Score card

| File | Verdict | Why in one line |
|---|---|---|
| `public/app/shell.js` | **KEEP** | The menu change is correct and complete. |
| `public/app/crm-sidebar.css` | **KEEP** | Same change, correctly matched. |
| `src/http/app-nav-reachability.test.mjs` | **FIX — NOT TOUCHED, AND IT IS RED** | The fixture list was never updated. One test fails. |
| `public/app/creative-factory.html` | **FIX** | The offer question is right. The company picker was already there. |
| `src/creative/generate.mjs` | **KEEP** | Exactly what the plan asked for, including for blocked ads. |
| `api/creative/library.mjs` | **FIX** | Sends the words. The screen throws them away. |
| `db/expected-migrations.mjs` | **KEEP** | Matches the folder exactly. Verified. |

---

## 1. The Marketing menu — `public/app/shell.js` (+18) and `public/app/crm-sidebar.css` (+30)

**Verdict: KEEP both files. FIX the test that goes with them.**

### Did it change all three rules? Yes. All three.

There were three separate places hiding the Marketing menu. The run found all three.

1. `shell.js` `NAV_HIDDEN` — the four addresses removed (shell.js lines 275-281).
2. `crm-sidebar.css` — the same four addresses removed from the `.navitem:is(...)` block
   (crm-sidebar.css lines 305-327).
3. The rule that hid the whole box. It used to sit at crm-sidebar.css line 329 and read:

   `.navgroup[data-fh-section="marketing"] { display: none !important; }`

   It is gone, replaced by a note explaining why. I searched every stylesheet in
   `public/app/` — nothing else hides that section. It is really gone.

### Does the row actually appear?

I traced it by hand, role by role.

* **Owner.** Sees the Marketing heading and all four rows: Campaigns, Social Studio,
  Creative Factory, Content. This is the change working.
* **Admin.** Same four rows.
* **Every other staff role** (setter, closer, sales manager, funding advisor, inquiry
  specialist, CSM). Sees nothing. All four screens are still on the `OWNER_ADMIN_ONLY`
  list at shell.js line 137, so the gate hides every row, and the code at shell.js line
  1323 then hides the empty heading on its own. No lonely "Marketing" word left behind.
* **Partner.** Sees Marketing with two rows: Social Studio and Creative Factory. That
  matches `ROLE_TABS.partner` at shell.js line 409 and it matches what the $10,000
  package spec says a partner buys. This is new — the old box rule was hiding these from
  partners too. It is a gain, not a leak.

**So the role gating is untouched and correct.** The run was right to say this list only
ever answered "does the row paint", never "who may open it". No screen was opened up to
anyone new.

### The one thing that is broken

`src/http/app-nav-reachability.test.mjs` line 171 holds a hand-written copy of the
`NAV_HIDDEN` list. The run changed the code and never changed that copy. **The test
fails right now.** I ran it:

```
✖ the shell still declares its lists and screens on disk back them
  expected the list to still contain campaign-manager.html, content-admin.html,
  creative-factory.html and social-studio.html
```

The fix is four lines: delete those four entries from the fixture at
`src/http/app-nav-reachability.test.mjs:171-196`, and leave a dated note beside them the
way the `company-brain.html` entry already does. Nothing else in that file needs to move
— the two-way check between the code list and the stylesheet list passes cleanly, which
is the check that actually protects this change.

### One small thing a person would notice

The rows are hidden before sign-in resolves by `.navitem{visibility:hidden}` (shell.js
line 798). `visibility:hidden` keeps the space. The old box rule used `display:none`,
which did not. So a staff member on a cold load now sees the word "Marketing" and a
four-row-tall blank gap for a moment before it collapses. It is brief, it is not new
behaviour for other sections (Automation does the same), and it corrects itself. Worth
one line in the spec, not worth blocking on.

**Would a person get further? Yes.** Chris can now click Creative Factory instead of
typing its address. He stops at nothing here.

---

## 2. The Creative Factory screen — `public/app/creative-factory.html` (+42)

**Verdict: FIX.** The offer control is right. The picker was not this run's work. One
thing on this screen is now a lie.

### Was the company picker added? No — it was already there.

This is worth saying plainly so nobody rebuilds it. I checked the file as it stood
*before* the commit (`eec40ef6^`) and it already had:

* the dropdown markup, `<select id="partnerSel">`, at line 389
* `loadPartnerPicker()` at line 1000, reading the list from `/api/read/partners`
* the address bar's `?partner_id=` used to preselect a row rather than being the only
  way in

The aborted run only rewrote the stale comment above `var PARTNERS` (lines 677-684) that
still claimed there was no picker. That comment was wrong and now it is right. Good, but
it is a comment.

**So: the picker task is DONE. Do not respec it.** What is still missing is a check that
it works, because there is no test and nobody clicked it.

### Was the offer type control added? Yes, and it is wired correctly.

The dropdown is at lines 441-449, offering Funding, Credit cards, Credit repair. Those
are exactly the three values `src/compliance/screen.mjs` line 118 accepts. I checked the
set against the code; they match.

**Is it actually in the request?** Yes. I followed it the whole way:

* the form reads it: `var offer = document.getElementById('genOffer').value;`
* it refuses to send without it: `if (!offer) { msg.textContent = 'Say what is being sold first.'; return; }`
* it goes inside `spec`, not beside it:
  `spec: { prompt: prompt, formats: ['1x1'], variants: 1, assetKind: kind, offerType: offer }`

That placement is correct, and the note explaining it is correct too. `api/creative/generate.mjs`
line 111 passes `body.spec` straight through to `enqueue()`, `enqueue` stores it on the
job, and `src/creative/generate.mjs` line 257 reads `spec.offerType` back off the stored
job. A copy at the top of the body would have been dropped. The run got this right.

**This is the fix that unblocks the screen.** Before it, every single creative made here
came back stopped with "offer_type must be one of funding, credit_cards, credit_repair".

### Was "resize" removed from the Kind dropdown? Yes.

Line 435 now offers `static`, `copy`, `video` only. The reason given checks out: I read
`src/creative/providers/resize.mjs` line 25 and it throws `resize requires a parentAsset
with an id`. This form has no way to name a parent picture, so a resize job could only
ever fail. Removing it is right.

### What is still wrong on this screen

**The screen tells the user a lie, in writing.** Line 2008, in the detail panel:

> "This is written copy, so there is no file at all — and the words themselves are not
> sent here either."

That was true yesterday. It is not true now — `api/creative/library.mjs` sends the words.
Nothing on this screen reads them. I searched: `copy_text` appears nowhere in
`public/app/creative-factory.html`.

So Chris can now generate a script, and the words are saved, and the API hands them over,
and the screen prints a sentence saying they were not sent. **That is where he stops.**

The spec needs to say: show `copy_text` in the detail panel and on the card, and delete
that sentence.

**Would a person get further? Yes, much further** — a generated script is no longer
auto-blocked. **They stop at reading it.**

---

## 3. `src/creative/generate.mjs` (+23)

**Verdict: KEEP. This is the best work in the batch.**

It does write the words into `copy_text`, and it writes them in the right place.

The insert at line 217 now names `copy_text` and passes `copyTextFor(a)`. That insert
runs **before** the compliance check, which starts at line 251. The state is only decided
afterwards, at line 271. So the words are saved first and judged second.

**Does it save blocked scripts too? Yes.** This is the thing the plan cared about most and
the run got it. A stopped script keeps its text exactly like a clean one, because nothing
in the block path touches `copy_text` — line 272 only updates `compliance_state` and
`blocked_reasons`. Chris can rewrite what was stopped.

`copyTextFor()` at line 311 turns blank and whitespace into NULL. That matches the guard
in migration 301 (`creative_assets_copy_text_ck`), which rejects an empty string. And
`a.text` is real: `src/creative/providers/copy.mjs` line 77 sets it on every asset it
returns.

The migration itself, `db/migrations/301_creative_copy_text.sql`, is one nullable column
plus one guard. **No `filmed_at`.** The rejected column is not in the file. The run
respected the decision.

**Would a person get further? Yes.** The words now exist in the database instead of being
thrown away. **Nothing stops here.** The only gap is that no test proves it — there is no
`copy_text` anywhere in `src/creative/*.test.mjs`.

---

## 4. `api/creative/library.mjs` (+7)

**Verdict: FIX — but the fix is on the screen, not in this file.**

It does return the new column: `a.copy_text,` added at line 44.

**Would the redactor strip it? No.** I read the list. `src/http/read-api.mjs` line 18
strips any field name containing `ssn`, `social_security`, `storage_key`, `storage_path`,
`s3_key`, `object_key`, `password`, `password_hash` or `token_hash`. `copy_text` contains
none of them. It passes through. The naming note in migration 301 was right and it was
worth writing down — this is the trap that already eats `has_storage_key` today.

So this file is correct and complete on its own. It is marked FIX only because the thing
it feeds — the Creative Factory library screen — ignores what it sends. See item 2.

**Would a person get further? Not yet.** The data reaches the browser and dies there.

---

## 5. `db/expected-migrations.mjs` (+3)

**Verdict: KEEP. Verified, not eyeballed.**

Three entries added: 299, 300, 301. I compared the whole list against the folder on disk
by script:

* in the folder but missing from the list: none
* in the list but missing from the folder: none
* order matches sorted order: yes

`migrations/301_creative_copy_text.sql` is the exact filename. It matches.

**Would a person get further? Yes** — without this line the migration check would refuse
to run and the column would never land on the live database.

---

## What has to happen before any of this can be called done

1. **Fix the red test.** `src/http/app-nav-reachability.test.mjs:171` — remove the four
   Marketing entries. Until this is done the suite is failing, which breaks
   `CLAUDE.md` §6 rule 3.
2. **Show the words.** Read `copy_text` in `assetCard()` and in the detail panel of
   `public/app/creative-factory.html`, and delete the sentence at line 2008 that says the
   words are not sent.
3. **Add the tests nobody wrote.** Nothing proves `copy_text` is saved for a blocked
   asset. Nothing proves the offer dropdown blocks an empty send. Endpoint tests belong at
   `src/http/<name>.pg.test.mjs` per `CLAUDE.md` §12.
4. **Click it once.** No Playwright run, no screenshot, no live check exists for any of
   this.

`npm run lint` passes on all six files — 1808 files parse clean. `npx tsc --noEmit` is a
no-op here (no tsconfig), so it proves nothing either way.

## What NOT to redo

* The three-rule menu change. It is complete and correct.
* The `copy_text` write in `storeAsset`, including for blocked assets.
* The `offerType` placement inside `spec`.
* Removing `resize` from the Kind dropdown.
* The company picker on Creative Factory — it already existed before this run.
* Migration 301. One column, one guard, no `filmed_at`.
