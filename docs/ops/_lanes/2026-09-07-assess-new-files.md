# The three new files the aborted run wrote

Read-only assessment. Nothing in this lane was changed.

Date: 2026-09-07. Branch: `feat/csm-role-schema`.
Judged against `docs/journeys/ad-script-flow.md` and `docs/ops/2026-09-06-self-analysis.md`.

**The short version.**

| File | Verdict |
|---|---|
| `db/migrations/301_creative_copy_text.sql` | **KEEP.** It does the one thing it was asked to do. |
| `docs/ads/RULES.md` | **FIX.** The rules are real and traced. Two claims are wrong and one whole section was made up. |
| `scripts/ads/check-script.mjs` | **REPLACE.** It runs, and it fails every real ad, including the five that are live. |

---

## 1. `db/migrations/301_creative_copy_text.sql` — KEEP

97 lines. One column. It is the best of the three by a distance.

### It adds the right thing and nothing else

Line 67 is the whole change:

```sql
ALTER TABLE creative_assets ADD COLUMN IF NOT EXISTS copy_text text;
```

**No `filmed_at`.** I searched the file. The word does not appear. Chris said that column was
over-engineering and the file obeys, quietly, without arguing about it. Good.

### The column is nullable

There is no `NOT NULL`. A picture keeps NULL and that is correct. Lines 37 to 45 say why, in plain
words: a picture has no words, and forcing an empty string in would be the "NULL means unknown"
mistake `CLAUDE.md` §12 warns about with money.

The one guard it does add (line 76) is the safe one:

```sql
CHECK (copy_text IS NULL OR btrim(copy_text) <> '')
```

That means: you may leave it empty, but you may not save a blank. A blank would look like a broken
loading bar on the library screen. Sensible.

Lines 48 to 60 name the two stricter rules it did **not** add, and why each would have broken
something. That is the house style working as intended: the reasoning is in the file, so the next
person does not "tidy" it back in.

### It matches 045's style

`db/migrations/045_creative_factory.sql` opens with a long plain-English header explaining the
thinking before any SQL. 301 does the same. It also copies two real habits from 045: the guarded
`DO $$ ... IF NOT EXISTS` block so re-running is safe, and a `COMMENT ON COLUMN` that explains the
column to whoever finds it later. That is a genuine style match, not a coincidence.

### 301 is a free number

I listed every file in `db/migrations/`. There are 217. Six numbers are used twice already (259,
260, 261, 262, 271, 272), so this repo does collide. **301 does not.** It is the only 301 and it is
the highest number in the folder. No other session took it.

### Where it stands: written, listed, not applied

`db/expected-migrations.mjs` line 237 now lists it:

```
"migrations/301_creative_copy_text.sql",
```

I checked the whole manifest against the folder. 217 listed, 217 on disk, nothing missing and
nothing extra. So the manifest is correct.

**What that means in practice.** That file is what `/api/health` compares the live database
against. The database has not run this migration yet. So until this branch merges to `main` and the
production deploy runs, `/api/health` will report **behind**, not up. That is normal and it is what
`CLAUDE.md` §11 says happens. Nobody should read "behind" as a bug.

I did not connect to any database, so I cannot say it has been applied somewhere by hand. Nothing in
the repo claims it has.

### One thing to know, not a fault

Two other files already use the column: `src/creative/generate.mjs` line 219 writes it, and
`api/creative/library.mjs` line 44 reads it. Both were swept in by the same commit. So the column is
not optional any more — those two files break without it. That is a reason to keep 301, not a
reason to worry about it.

---

## 2. `docs/ads/RULES.md` — FIX

562 lines. Most of it is honest work. Three things need changing before a model is pointed at it.

### What is right

**It has the three sections it was asked for.** Part 3 splits into Section 1 (cold direct-response),
Section 2 (VSLs), Section 3 (evergreen backend-selling). That matches what Chris asked for.

**The banned-word lists were copied, not paraphrased.** I compared them to
`.claude/workflows/copy.js` word by word. 34 words, 20 phrases, 11 openers. **All three match
exactly.** Nothing was reworded, nothing was dropped. That matters, because a reworded ban list
quietly stops catching things.

**The never-say lines are real and they came from the right files.** I traced every line back:

- "Your score will go up", "We will get you funded", a dollar amount a bank will give, a bad item
  will come off, "0% interest", "no damage to credit", "we protect your score", a made-up win —
  all in `docs/company-resources/closer-playbook-2026-08-24.md` lines 7-14.
- "1-2 inquiries max", "$50K-$250K", "$8,000"/"$10,000", "Negatives off in five days", "Overnight
  letters" — all in the same file's Never-say table around line 468.
- "No denials" (line 269), "We won't touch personal credit" (line 270), "You need an LLC / aged
  corp / DUNS first" (line 271) — same file.
- The five-line block from `sales-manager-objections-and-funding-2026-09-01.md` line 15.

It also says out loud which never-say lines it left out and why — the phone-call-only ones like
"just checking in". That is the right call, made in the open.

**The twelve compliance rules are summarised correctly.** I read
`db/migrations/047_compliance_rules.sql` lines 205 to 296 and counted: six credit-repair rules,
four that fire on every offer, one that must be present, one that kills TikTok. RULES.md 1.5 gets
all four groups right and the plain-English wording of each rule is accurate.

**The format came from the real source.** RULES.md 3.2's locked format is
`ANGLE-GENERATOR.md` lines 138-151, copied faithfully. The gate mix, the awareness table and the
five hook shapes are all from that file too. The seven "what kills a concept" items in 1.6 match
lines 218-228 word for word in meaning.

**The word counts were actually counted.** RULES.md 2.1 says the five running assets are 376, 412,
432, 472 and 841 words. I counted them myself from `docs/ads/CONTROLS.md` and got 375, 408, 428,
471, 840. Within a few words. **Somebody really did count these.** That is worth saying, because a
lot of numbers in a document like this are guessed.

**The speaking rate is declared, not hidden.** Line 210: "Rate used: 150 words per minute", and
lines 212-215 admit nobody has ever timed a filmed ad with a stopwatch. Then 2.1 goes further and
admits that only the 2-minute band has a real ad behind it. That is the honest way to write a made-
up number down.

**The hook examples are real.** All six quoted hooks (three passing, three failing) are verbatim
from `CONTROLS.md` and `CONCEPTS.md`. I checked each one. The cause-first test in 2.2 is written as
four numbered checks with pass and fail examples, which is close to something a program could
measure — checks 2 and 3 are mechanical, check 1 and check 4 still need a person. RULES.md admits
this itself in Part 4.

### What is wrong

**Wrong claim 1 — the close is not the same in all five ads.** RULES.md 3.6 says:

> Every cold ad ends the same way... It is the trust line and it is the same in all five running ads:
> **No hard inquiry. No obligation. Nothing moves until you say so.**

That is not true. In `docs/ads/CONTROLS.md`, that exact line appears twice, at lines 58 and 166 —
Ad 1 and Ad 3. The others are different:

- Ad 2, line 109: *"Zero score impact. No obligation. Nothing moves until you say so."*
- Ad 4, line 228: *"Soft pull only. Zero impact on your score. Nothing moves until you say so."*
- The Founder VSL, line 386: *"There's no hard inquiry. There's no obligation. Nothing moves on your
  file until you tell us to move it."*

So it is 2 out of 5, not 5 out of 5. And RULES.md then turns this into a machine rule — Part 4.1
item 6, "The close is present, word for word." A checker built to that rule would **reject three of
the five ads that are running right now and booking calls at $32-36.** Fix: say the close carries
the same three promises, and let the wording vary.

**Wrong claim 2 — one line is put in Chris's mouth.** RULES.md 3.10 says the refusal beat is "the
single line Chris named as 'the voice'." The line itself is real (`CONTROLS.md` line 391). Chris
naming it is not written down anywhere I could find. Cut the attribution, keep the rule.

**Invented — the whole evergreen section.** This is the one real invention in the file.

Section 3 (lines 462 to 519) sets out: a five-beat spine that may never change (3.13), a "no-stale"
ban on dates, seasons, scarcity, rates and moving numbers (3.14), variation rules that say change
only one of three things (3.15), and a 60-90 second length (3.16).

**The word "evergreen" does not appear anywhere in `docs/ads/` or `docs/flywheel/`.** I searched.
The only source for any of this is Chris's two-sentence quote in the self-analysis: simple, low
volume, swap variations. Everything else in those six blocks was made up by the run that wrote it.

That does not make it bad. It reads sensibly. But it is presented in the same voice as the rules
that were traced back to a file, and a reader cannot tell the difference. **Every other invented
rule in this document is labelled** — 2.1 and 2.2 both open by saying they are new. Section 3 does
not. Fix: put one line at the top of Section 3 saying it is proposed, not sourced, and get Chris to
say yes or no to the five beats.

**Smaller ones.** The source pointer in 1.2 says `copy.js` "lines 33-47"; the lists actually start
at line 34. The gate table says "700+, clean file" where the source says "700+, no negatives" —
same meaning, different words, and 1.2's own rule says do not paraphrase a source.

---

## 3. `scripts/ads/check-script.mjs` — REPLACE

509 lines. It runs. It is well written. **And it fails every real ad, including the live ones.**

I ran it. Everything below is real output, not a reading of the code.

### The good parts, first

It is Node built-ins only — one import, `node:fs`. No package added. `npm run lint` passes with it
in the tree (1,808 files parse clean). `--help` works and exits 0. The failure messages are genuinely
plain English a non-coder can read: *"em dash in the BODY. Nobody says an em dash out loud."* Exit 0
on clean, 1 on failures, with the line number on every failure. That part of the brief was met.

It does check most of what it was asked to: banned words, banned phrases, banned openers, the em
dash (line 298), the "it's not X, it's Y" shape (line 301), word count against the runtime band
(lines 342-367), and a coarse cause-first test (lines 317-340).

### The proof that it does not work

I retyped **Ad 1 — Denial**, one of the five ads filmed and running, into the locked format and ran
the checker on it. Real output:

```
Rules: the built-in list plus 106 more from docs/ads/RULES.md.

  "Ad 1 — Denial Angle" (starts line 1, 271 words)
    line 4: banned phrase "soft pull" in the BODY. Say it the way a person would.
    line 4: never-say line "here" in the BODY. The rules file says never say it.
    line 6: never-say line "not" in the CLOSE. The rules file says never say it.

1 of 1 script needs work.
```

**It banned the word "not".** Every ad ever written contains "not". Nothing can ever pass.

It also banned **"soft pull"** — a phrase RULES.md 1.3 lists under **"Words that do work"**, and
which the live ads say out loud.

### Why it does that — the rules reader is broken

The checker reads extra rules out of `docs/ads/RULES.md`. I dumped exactly what it pulls out. It
found 106 terms. Most of them are garbage:

- **The 13 "words that do work" are loaded as BANNED phrases.** "soft pull", "no spam calls", "no
  equity", "one honest application", "bridge the gap", "before anyone pulls your credit", "won't
  touch your credit score". The endorsed list becomes the banned list, because the heading above it
  says "Avoid these" and the reader decides everything by the heading.
- **Section labels become banned words.** "words", "phrases" and "openers" are all now banned words.
- **Prose sentences become rules.** "if this list changes, change it in `copy.js` too.",
  "speed is demoted, not dropped.", "left out on purpose.", "source: docs/ads/asset-bankmd
  section 8".
- **Two fragments, "not" and "here", become never-say lines.** That alone makes the tool useless.
- **The required close becomes a never-say line.** "no hard inquiry. soft pull only. zero impact on
  your score." is loaded as banned, while RULES.md 3.6 says it is mandatory.
- **The real never-say list is never read at all.** RULES.md 1.1 puts the 14 never-say lines in a
  markdown table, and the reader skips table rows on purpose (line 163: `if (/^\|/.test(text))
  return out;`). So not one of the lines from `docs/company-resources/` is enforced.
- **Zero openers are loaded.** The 11 banned openers sit under a heading that says "Banned words",
  and the reader picks the bucket from the heading, so they go in the wrong pile.

### A second, separate bug: half the script is not checked

Line 260 ends a section at the first blank line. So a BODY written as two paragraphs — which is how
every ad in `CONTROLS.md` is written — loses everything after the blank line.

I tested it. A script with a banned word ("optimize") in the second paragraph of the BODY:

```
  "Test — paragraph body and a WHO opener" (starts line 1, 57 words)
```

57 words. The second paragraph was not counted and **the banned word was not flagged.** So the tool
reports clean on text it never looked at, and the word count it uses to judge runtime is short.

### A third: the ban list has already drifted

`.claude/workflows/copy.js` has 34 banned words. This file (lines 45-51) has **33**. The word
**"align" is missing.** This is the third hand copy of that list — humanizer skill, then `copy.js`,
then here — and it broke on the first copy. The file's own header (lines 35-41) says never
paraphrase these because a reworded list stops catching things. It then does exactly that.

This is the answer to the question in the brief. **Yes, it holds its own hardcoded copy, and yes,
that is a defect, and it has already happened.** The rules should live in one place.

### What it does not check at all

RULES.md Part 4.1 lists nine things a machine should check. Four are missing:

| Promised in RULES.md 4.1 | Built? |
|---|---|
| 6. The close is present, word for word | No |
| 7. `origin_angle` is filled in | No — the TAG line is read and then ignored |
| 8. The twelve compliance rules | No — the header explains it will not, on purpose |
| 9. Evergreen: no date, season, scarcity or moving number | No |

Item 8 is a fair decision, well argued in the header (lines 18-25): the compliance screen needs a
live database and it runs later. But then RULES.md should not promise it. The other three are just
absent.

Cause-first is also only half built. RULES.md 2.2 has four checks. The code does check 2 (no ask)
and part of check 3. Check 3 is written wrong — it only looks for a question at the **end** of the
hook (line 331), while the rule is about sentence one. Check 4, "the subject of sentence one is not
us", is not implemented at all.

### Two more, smaller

- The default rules path is relative (line 158, `"docs/ads/RULES.md"`). Run the checker from any
  other folder and it silently drops to the built-in list. It does print which rules are in force,
  which is a good habit, but the wrong answer still exits 0.
- Line 219 treats any line beginning WHO, DOOR, ANGLE, CTA or CLOSE as a section label. A body line
  that starts "Who is not showing them?" — which is the exact fix RULES.md 2.2 suggests for Script 7
  — gets read as a label and drops out of the ad.

### Why REPLACE and not FIX

The list drift, the wrong bucket, the table skipping and the "words that do work" inversion all come
from the same decision: a tolerant parser guessing rules out of hand-written English prose, plus a
private copy of the lists as a backstop. Patching each symptom leaves that design in place.

The rebuild is small and the shape is known: put the lists in one machine-readable file that both
`copy.js` and this checker read, keep `RULES.md` as the human page that quotes it, and drop the
prose parser entirely. Roughly 200 lines instead of 509. **Keep the failure messages — they are
the best thing in the file.**

### It is wired to nothing

No `npm` script, no CI step, no test. Nothing imports it. `docs/journeys/ad-script-flow.md` lines 33
and 57 already draw it as the gate the generator must pass, so the diagram is ahead of the code.
Per `CLAUDE.md` §12, a test at `scripts/ads/check-script.test.mjs` **would** run in `npm test`.
There isn't one.

---

## For whoever writes the build spec

1. Keep 301 as it is. Do not add `filmed_at`. Do not add an index.
2. `RULES.md`: fix the close claim in 3.6, cut the "Chris named it" line in 3.10, label Section 3
   as proposed and get a yes or no on the five beats. Leave the rest alone — it was traced properly
   and re-doing it would lose real work.
3. Rewrite the checker around one shared list file. Do not let a second copy of the banned words
   exist anywhere.
4. Whatever replaces the checker has to pass **all five live ads in `CONTROLS.md`** before it is
   called done. That is the test that would have caught every fault above in one run.
