# RULES.md — the ad SOP

This is the one file a writer has to obey before an ad script is worth reading.

Chris: *"We really just have to get our SOPs down for creating ads. And then we'll refine the SOPs
as we find what works."* This file is the SOP. `VOICE.md` is the refinement.

**Who reads this.** The script generator reads it as input before it writes a word. The checker
reads it to fail a script before Chris ever sees it. Chris reads it to change a rule.

**Audience for every ad here: service-based businesses.**

**How it is laid out.**

| Part | What is in it |
|---|---|
| **Part 1** | The hard no's. Same for every ad type. Break one and the script does not ship. |
| **Part 2** | The two measurements — how many words, and does the hook lead with the cause. |
| **Part 3** | Three sections, one per ad type, because the format is not one format. |
| **Part 4** | What a machine can check and what only a person can. |

**Where the rules came from.** Almost nothing here is new. Most of it already lived somewhere else
in the repo and nobody could find it. Every block says its source file. **If you change a rule,
change it in the source file too, or the two will drift and the older one will win.**

---
---

# PART 1 — THE HARD NO'S

Applies to all three ad types.

## 1.1 Never say these

Source: `docs/company-resources/closer-playbook-2026-08-24.md` (the block at the top, and the pocket
card in section 10) and `docs/company-resources/sales-manager-objections-and-funding-2026-09-01.md`
("The five lines that get people fired", and the Never say table).

Those two files were written for people on the phone. Not every line there is about ads. These are
the ones that are.

| Never say | Why |
|---|---|
| "Your score will go up." | We cannot know that. It is a banned claim for us. |
| "We'll get you funded." / "We will get you funded." | We are not the lender. Lenders decide. |
| Any dollar amount a bank **will** give them | Same reason. "Up to", with the conditions said out loud, is the only safe shape. |
| A bad item **will** come off | Nobody can promise a deletion. Concept 3 makes the honest refusal the whole ad — do that instead. |
| "0% interest" / "0% interest business credit" | A competitor's line. Not our offer. |
| "No damage to credit" / "We protect your score" | A promise we cannot keep. |
| "1–2 inquiries max" | Same. A number we do not control. |
| "$50K–$250K" as what they get | A competitor's range. Not a Fundhub promise. |
| "$8,000" or "$10,000" as our price | Not our offer. Do not sell it, do not say it. |
| "Negatives off in five days" | A competitor's claim. |
| "Overnight letters" | We send **expedited** US mail. Never say overnight, UPS or FedEx to a bureau. |
| "No denials." | A guarantee. See the compliance rules below. |
| "We won't touch personal credit." | False for the funding path. |
| "You need an LLC / aged corp / DUNS first." | Not our rule. Concept 7 says the opposite on purpose. |
| A made-up win, client count, or story | A lie, and it is also a compliance block. Use only wins Chris has given in writing — today that is **$25 million secured** and **Koi Poke**. |

**The one that trips writers up.** "This will not affect you at all" is banned as a blanket promise
about the whole engagement. It is **not** banned to say the soft pull does not touch the score —
that is true, and all five running ads say it. Keep the promise attached to the soft pull:

> Right: *"No hard inquiry. Soft pull only. Zero impact on your score."*
> Wrong: *"Working with us will not affect your credit at all."*

**Left out on purpose.** Some never-say lines in those two files are about a live phone call and
cannot appear in an ad — "just checking in", "I can finance the deposit", "the deposit is extra on
top of the 10%", taking an incorporation date as fact. They still bind closers. They are not checked
here.

## 1.2 Banned words

Source: `.claude/workflows/copy.js` lines 33–47, copied there verbatim from the humanizer skill.
These are the words that make copy read like a machine wrote it. Copied again here so an ad writer
has one file to open. **If this list changes, change it in `copy.js` too.**

**Words — 34.** Any form of the word counts (plural, past tense, -ing).

```
delve · tapestry · leverage · utilize · robust · seamless · realm · testament · beacon ·
underscore · showcase · pivotal · crucial · foster · elevate · embark · unleash · navigate ·
landscape · boast · myriad · plethora · intricate · vibrant · enhance · streamline · optimize ·
comprehensive · empower · holistic · cultivate · resonate · align · nestled
```

**Phrases — 20.**

```
in today's fast-paced world · when it comes to · it's important to note ·
plays a crucial role in · at the end of the day · the world of · more than just ·
unlock the power of · elevate your · take it to the next level · supercharge ·
move the needle · deep dive · low-hanging fruit · circle back · best-in-class ·
in conclusion · a journey · treasure trove · the possibilities are endless
```

**Openers — 11.** An ad may not start with any of these.

```
imagine a world where · have you ever wondered · picture this · so there you have it ·
let's dive in · here's the thing · here's the kicker · but here's where it gets interesting ·
let that sink in · plot twist · trust me
```

## 1.3 Avoid these — the market has poisoned them

Source: `docs/ads/ASSET-BANK.md` section 8.

- "lenders compete for you" — sounds like the spam swarm
- "get matched with 75 lenders" as a headline — the audience has a bad memory of it
- "fast and easy" — invisible, everyone says it
- "cash advance" used as a good thing — merchant-advance tainted
- "unlimited offers"
- "apply now to get calls from our partners"
- **anything that hints several companies will phone them**
- "secret sauce"
- "guaranteed approval"

**Speed is demoted, not dropped.** "Funded in 24 hours" is table stakes now, not a difference. Lead
with trust, earn the speed claim second, and when you use it use the real number — about **7 days
against an industry 30–45** — not an adjective.

**Words that do work** (same source): "no spam calls" · "we don't sell your number" · "soft pull" ·
"won't touch your credit score" · "see your real offers" · "one honest application" · "no equity" ·
"no daily payments" · "know the real cost" · "judged on your business, not just your FICO" ·
"owners the banks ignore" · "bridge the gap" · "before anyone pulls your credit".

## 1.4 Two more, from `docs/ads/README.md`

- **Never name the tech stack.** No vendor names, ever. It is "our system", or the name we gave it.
- **Never lead with white-label.** Two concepts maximum, and only as a door mentioned at the end.

## 1.5 The twelve compliance rules — what gets an ad blocked

Source: `db/migrations/047_compliance_rules.sql`, run by `src/compliance/screen.mjs`.

These are not style notes. They are patterns in the database that stop an ad automatically. Nothing
asks a model — it is a plain pattern match, so it either fires or it does not. Six of them only fire
on **credit-repair** ads. Four fire on **every** ad. One is a thing that must be **present**. One
kills a whole platform.

**The offer type decides which rules fire.** A funding ad is not screened under the credit-repair
rules. So the $3,000 funding deposit is fine to talk about; the same words on a repair ad are an
advance-fee block. If the offer type on the campaign is wrong, the screening is wrong.

### Credit-repair ads only

| # | Rule | In plain English |
|---|---|---|
| 1 | Guaranteed score increase | Do not promise points, a jump, a boost, or any score movement. Say what the work is, not what the score will do. |
| 2 | Promise to remove accurate information | Do not say we remove negative, accurate or verifiable items. Only wrong or unprovable items can be disputed. |
| 3 | Remove late payments and collections | Do not name late payments, collections, charge-offs, bankruptcies, repossessions, foreclosures, judgments or tax liens as things that come off. |
| 4 | Advance fee | Do not advertise money paid "upfront", "in advance", "before we start" or "to get started" on repair. |
| 5 | File segregation and CPNs | Never mention a CPN, credit privacy number, file segregation, a new credit file or identity, a second social, or using an EIN instead of an SSN. This one is federal fraud, not a wording problem. |
| 6 | Guaranteed timeline | Do not guarantee results in any number of days, weeks or months. |

### Every ad, every offer

| # | Rule | In plain English |
|---|---|---|
| 7 | Guaranteed approval | No "guaranteed", "100%", "assured" or "everyone is approved" next to approve, accept or qualify. |
| 8 | Guaranteed funding amount | Do not guarantee a dollar figure. "Up to", with the conditions said, is the only allowed shape. |
| 9 | Fabricated testimonial | Testimonials must be real people saying real things. The phrase "results are typical" is itself a block. |
| 10 | Income and distress targeting | No "are you broke", "bad credit? no problem", "low-income families only", "if you make less than $…". This one catches ordinary-sounding ad lines, so read it twice. |

### One thing that must be there

| # | Rule | In plain English |
|---|---|---|
| 11 | Consumer Credit File Rights disclosure | A credit-repair funnel must carry the words "Consumer Credit File Rights Under State and Federal Law", and the disclosure has to be **linked to the campaign**, not just sitting in the library. The database refuses to set that campaign live without it. |

### One whole platform

| # | Rule | In plain English |
|---|---|---|
| 12 | TikTok and credit repair | TikTok bans credit repair and debt relief outright. No account, no wording, no creative gets around it. Do not write repair ads for TikTok. |

**COMPLIANCE REVIEW REQUIRED** goes at the top of any summary for a script that touches dispute
logic, credit-repair messaging, fee timing, refunds, payment rails, consent, or the type of credit
pull. That is `CLAUDE.md` §7 and it is a label Chris asked for, not advice.

## 1.6 What kills a concept

Source: `docs/ads/ANGLE-GENERATOR.md`, last section. Run all seven before a concept goes on a sheet.

1. It fails the mechanism test (see 3.1).
2. It is a duplicate of another concept in **argument**, not just in wording.
3. It sounds like an AI wrote it. Read it out loud. If Chris would not say it, rewrite it.
4. It uses a banned word from 1.2 or 1.3.
5. It names the tech stack.
6. It leads with white-label.
7. It asks for something in the hook. The hook indicts the alternative. The CTA asks.

---
---

# PART 2 — THE TWO MEASUREMENTS

These two rules did not exist anywhere in the repo before this file. Chris named both on
**2026-09-06**. Everything below is written so a checker can measure it on the text alone.

## 2.1 Word count per runtime band

**The floor first: minimum 60 seconds. No exceptions.** (owner-set 2026-09-01,
`docs/ads/ANGLE-GENERATOR.md`.) A short hook is fine. A short *ad* is not. If a concept only has 30
seconds of substance in it, it is not finished — go back and give it the mechanism in full.

**The speaking rate is an assumption. Chris can change it and every number below moves with it.**

> **Rate used: 150 words per minute.**

That is an ordinary talking-to-camera pace with pauses. It is a choice, not a measurement — nobody
has timed a filmed ad with a stopwatch and written the number down. If Chris says he reads slower,
drop it to 130 and the bands get shorter; faster, raise it and they get longer. Change it here, in
one place.

| Band | Seconds | Words at 150 wpm | Allow |
|---|---|---|---|
| **Short form — default** | 60–90s | **150–225** | ±10% → 135–248 |
| **Long form** | 90–120s | **225–300** | ±10% → 203–330 |
| **Full DR / founder story** | 2 min+ | **300 and up** | no ceiling; see the VSL band |
| **VSL** | 5–6 min | **700–900** | this is where the founder VSL sits |

**A checker counts words, not seconds.** Under the low number for the band = fail. Over the high
number = fail for the two bounded bands only.

### The honest cross-check

The five filmed and running assets were counted. Body copy only, headings stripped:

| Asset | Words | Runtime at 150 wpm |
|---|---|---|
| Ad 1 — Denial | 376 | ~2:30 |
| Ad 2 — Broker Burn | 412 | ~2:45 |
| Ad 3 — Competitor | 432 | ~2:53 |
| Ad 4 — Blind Application | 472 | ~3:09 |
| The Founder VSL | 841 | ~5:36 |

**What that tells us, and it is worth knowing.** Every ad that is actually filmed, running, and
booking calls at $32–36 sits in the **2 min+** band. Nothing in the 60–90s band has ever been
filmed. So the 60–90s and 90–120s word ranges above are derived from the rate, not proven by a
working ad. The 2 min+ band is the only one with evidence behind it.

Read that as a bias, not a ban: when a concept could go either way, the longer cut is the one that
matches everything we know works.

## 2.2 The cause-first hook test

Chris's words: **"hook is cause-first."**

**What it means.** The first thing out of Chris's mouth names the **reason** their problem happened
— a person, a company, or a broken process that did it to them. Not the symptom. Not the offer. Not
his credentials. Not a question. The cause.

This is the same idea as the mechanism test, one step earlier. The mechanism test asks whether the
ad is ownable. Cause-first asks whether the first three seconds hand the viewer an explanation they
did not have.

### The four checks

A hook is the first **two sentences**. All four must pass.

1. **A cause is named by the end of sentence two.** Somebody or something did this, or failed to do
   it: "the guy who got you funded", "nobody cleaned the file", "your broker", "the last company",
   "applications going in on a file nobody cleaned first". A passive sentence with no actor —
   "owners never get shown" — does not count. Who is not showing them?
2. **No ask.** The hook contains no click, book, call, apply, tap, watch, stop, sign up, comment or
   DM. The hook indicts the alternative; the CTA asks.
3. **No question mark in sentence one.** A question defers the point. Make the statement instead.
4. **The subject of sentence one is not us.** Not the price, not the product, not the founder's
   record, not the brand. Those all belong in the body, and they belong there quickly — just not
   first.

### Three that pass

| Source | Hook | Why it passes |
|---|---|---|
| **Ad 1 — Denial** (`CONTROLS.md`) | *"If your business got denied for funding, you didn't lose because of your credit. You lost because nobody looked at your file the way a bank actually looks at it."* | Rules out the cause they blame themselves for, then names the real one, inside two sentences. |
| **Concept 1 — Who Takes Them Off** (`CONCEPTS.md`) | *"The guy who got you funded left a pile of hard inquiries on your credit. Ask him when he's taking them off. He's not, because he has no way to."* | A named actor doing a named thing, in sentence one. |
| **Concept 28 — Round Two** (`CONCEPTS.md`) | *"Round one funded. Round two came back no. That wasn't your credit slipping — that was the inquiries round one just created, still sitting on your file when the next batch went out."* | Effect first, then the cause arrives and corrects the one they assumed. |

### Three that fail

None of these are bad ads. They open the wrong way, and the fix is one line.

| Source | Hook | Which check it fails | The fix |
|---|---|---|---|
| **Script 8 — Stop Before You Apply Again** (`CONTROLS.md`) | *"Stop. Before you fill out another funding application… watch this."* | **Check 2 — it asks.** Two asks in twelve words, and no cause anywhere in the hook. | Lead with why the last application failed, then earn the "stop". |
| **Script 7 — Insider Access** (`CONTROLS.md`) | *"There's a version of business funding most owners never get shown. The one lenders actually use to decide who gets approved."* | **Check 1 — no actor.** "Never get shown" by whom? The real cause does not arrive until sentence three. | Name who is not showing them, in sentence one. |
| **Concept 44 — Thirty-Two Dollars** (`CONCEPTS.md`) | *"Thirty-two dollars. That's what a soft read of all three bureaus costs here. Everywhere else it's free — and free is how they end up with your phone number."* | **Check 4 — it opens with our price.** The cause is in there and it is a good one, it is just third. | Open on "free is how they end up with your phone number", then land the $32. |

Concept 44 is one of the five Chris said he would bet on, so that reorder is worth doing rather than
worth arguing about.

### One allowed exception

**Disqualification openers.** `ANGLE-GENERATOR.md` calls telling someone this is not for them a
legitimate hook device, and it is. A hook that opens on the gate — *"If you're under a 600, this one
isn't for you"* — passes check 4, as long as a real cause lands by the end of sentence two.

---
---

# PART 3 — THE THREE AD TYPES

The format is not one format. Take the type as an input before writing anything.

---

## Section 1 — Cold direct-response ads

**The main lane.** The 48 concepts in `CONCEPTS.md` and the five running assets in `CONTROLS.md`.
Highest volume, most rewriting, most split-testing. This is where most of the spend goes.

### 3.1 The angle formula

Source: `docs/ads/ANGLE-GENERATOR.md`.

> **ANGLE = one ENEMY × one MECHANISM × one AUDIENCE**
>
> **HOOK = [Experience or Behavior] + [Emotion] + [Desire Frustration]**
>
> **BODY = [Validate the experience] → [Reveal the mechanism] → [Connect to the desire] → [Proof]**

One enemy. One mechanism. One audience. An ad that argues two things argues nothing.

**The mechanism test — the one rule that matters:**

> Delete the mechanism from the hook. Does the hook still make sense?
> If yes, throw it out. The mechanism name has to be doing the work, or a competitor can run the
> same ad word for word.

Second half of the same rule: end the hook by indicting the alternative, not by asking for anything.

### 3.2 The script format — locked

```
HOOK    0–3s          The concept's hook, verbatim. Must pass cause-first (2.2).
BODY    10–60s        Validate → Reveal mechanism → Connect to desire → Proof
CTA     last 10–30s   Two-minute application. Book the call.
CLOSE                 No hard inquiry. No obligation. Nothing moves until you say so.

RUNTIME 60–90s | 90–120s | 2min+     (60 seconds is the floor, always)
WORDS   see 2.1
SHOOT   Outfit + location note
TAG     origin_angle value for CRM message match
```

**`origin_angle` is not optional.** The setter and closer scripts mirror the angle the lead came in
on. A lead from the broker-burn ad gets opened differently from a speed lead. The CRM carries the
field. Fill it in.

### 3.3 Hook shapes to rotate

Five that work. Rotate them so forty concepts do not all open the same way.

| Shape | How it opens |
|---|---|
| Dated authority + number | A real figure, stated flat |
| Declare the promise dead | Kill the industry's claim |
| Absolve, blame the system | Take it off their shoulders |
| Insider says the opposite | Contradict what they expect |
| Short mechanism line | State the machine, plainly |

Two reusable stems: *"Not another ___, but the first one that…"* and *"Not another ___, but for
people who…"*

### 3.4 Match the hook to what they already know

| They are | Open with |
|---|---|
| Unaware | Story, identity, pattern interrupt |
| Problem-aware | Agitation — name the pain out loud |
| Solution-aware | Why most solutions fail |
| Product-aware | Proof and comparison |
| Most aware | Direct CTA and offer specifics |

### 3.5 The gate mix

Every concept gets a gate. Default is 600.

| Gate | Share of the set |
|---|---|
| 600+ | ~55% |
| 700+, clean file | ~20% |
| Premium / strict | ~15% |
| Open, no gate | ~10% |

### 3.6 The close never changes

Every cold ad ends the same way. Do not reword it, do not improve it, do not vary it for freshness.
It is the trust line and it is the same in all five running ads:

> **No hard inquiry. No obligation. Nothing moves until you say so.**

Where a soft pull is named, "Soft pull only. Zero impact on your score." goes with it.

### 3.7 Proof, and the limit on it

We have two proof assets and they must not be embroidered:

- **Close to a decade in business funding.**
- **Over $25 million secured for our clients.**
- **Koi Poke** — one restaurant, already turned away once, now a franchise with multiple locations.

That is the list. Anything else is a made-up win, which is both a never-say and a compliance block.
**Koi Poke carries all five running ads**, which is a known weakness — if a second real case study
ever exists in writing, it goes here first.

---

## Section 2 — VSLs

**Long form.** `docs/ads/CONTROLS.md` holds the Founder VSL as the one worked example, and it is
841 words. Everything in this section is derived from that script, not invented.

Everything in Part 1 still applies. Everything in Section 1 still applies except runtime and shape.

### 3.8 Length

**700–900 words, 5–6 minutes at 150 wpm.** The Founder VSL is 841. Under 700 and it is a long ad,
not a VSL — which is fine, but then write it to Section 1's rules.

### 3.9 The spine — sixteen beats, in this order

Read straight off the Founder VSL. Keep the order. Beats can be short; none can be skipped.

1. **Call out who it is for**, and ask for a couple of minutes.
2. **Who I am** — name, founder, close to a decade.
3. **What I keep seeing** — good owners with solid credit, blocked from money they should have.
4. **Why I built it** — "I got tired of watching that happen."
5. **The three ways it usually goes** — the bank denies with no reason; the consultant burns them;
   they DIY and stack inquiries.
6. **The check-in** — "Does any of that sound familiar?" The one place a question belongs.
7. **The absolution** — none of that happened because they were not qualified.
8. **What it really cost** — the plan behind the money. Ads, team, the trip, the debt, the family.
9. **The near-miss** — "you feel like you're right there. Like it's literally one thing away."
10. **"That's not on you."** Then name where it is on.
11. **Proof** — decade, $25 million, Koi Poke.
12. **The mechanism, in full, step by step** — soft pull, zero impact, the read, the lender fit, the
    order. This is the only place the mechanism gets explained at length.
13. **What happens when you click** — application, analysis, the call, what he will say on it.
14. **The safety close** — no hard inquiry, no obligation, nothing moves, costs nothing.
15. **The refusal** — "a lot of people in this space will tell you whatever you want to hear to get
    you on a call. We're not going to do that." Then the honest alternative: if the credit needs
    work first, we say so.
16. **CTA and the cost of waiting.**

### 3.10 VSL-only rules

- **Cause-first still governs the first fifteen seconds.** Beats 1–4 have to land the cause before
  the founder story earns its place.
- **The mechanism is explained once.** Beat 12. Not sprinkled through.
- **The refusal is mandatory.** Beat 15 is the single line Chris named as "the voice". A VSL without
  it is not our VSL.
- **Never promise the call outcome.** Beat 13 says what he will *show* them, never what they will
  *get*.
- **One case study minimum, real.** Today that is Koi Poke.

---

## Section 3 — Evergreen backend-selling ads

**Content-first.** Chris: *"really simple, but you don't have to do a lot of those. Maybe just swap
out variations every now and then. Those ads are really going to be evergreen forever."*

So the rule here is **consistency and variation, not novelty.** Everything in Part 1 still applies.
The rest of this section replaces Section 1.

### 3.11 What these are

Teach one useful thing. Earn the right to sell at the end. No urgency, no pressure, no countdown.
The job is to be true for a year, not to win this week.

### 3.12 Volume

**Low. Deliberately.** A handful of these, then variations. Do not generate forty. If a new one is
being written, the question to answer first is: which existing evergreen ad is this replacing, and
why is that one no longer true?

### 3.13 The spine — five beats, fixed

The spine is the thing that does not change. Only the example inside it changes.

1. **The mistake** — one specific thing owners do, named plainly. This is the cause, so cause-first
   applies here exactly as it does everywhere else.
2. **Why it happens** — the reason it is a reasonable mistake to make. No mocking.
3. **The one thing to do instead** — real, usable, works whether or not they ever call us.
4. **The proof it works** — the mechanism named once, briefly. Not the full walkthrough.
5. **The soft door** — "if you want us to run it for you, the link is below." One sentence.

### 3.14 What makes it evergreen — the no-stale rule

An evergreen ad may not contain anything that expires. A checker can look for all of these:

- **No dates, no months, no years, no seasons.** No "this year", "in 2026", "going into Q4".
- **No "right now", "today only", "this week", "limited spots", "before the deadline".** No scarcity
  of any kind.
- **No rate, spend or market conditions.** Interest rates move; the ad should not.
- **No client count or revenue figure that will change.** "$25 million secured" grows. Say "millions
  secured for our clients" in an evergreen piece, or leave the number to the cold ads where it gets
  refreshed.
- **No reference to another ad, a launch, a promotion, or a price.**

### 3.15 Variation rules

A variation is a new opening line and a new example. It is not a new ad.

- **Never change the spine.** The five beats stay in that order.
- **Never change the close.** Same close as everywhere else.
- **Change one of three things**: the mistake in beat 1, the example in beat 3, or the visual.
  Changing two at once means you cannot tell what moved the number.
- **Keep the same `origin_angle` tag across a family of variations**, so the CRM still knows what
  the lead heard.

### 3.16 Length

**60–90 seconds, 150–225 words.** The 60-second floor still holds. These are the one place the short
band is the right band, because a single teaching beat does not need three minutes.

---
---

# PART 4 — WHAT A CHECKER CAN CHECK

Keeping these two lists apart matters. A machine that claims to have judged the voice is lying; a
person who claims to have counted 34 banned words is guessing.

## 4.1 A machine can check these

Fail the script, rewrite it, do not show Chris.

1. Word count inside the band for its runtime (2.1).
2. No banned word, phrase or opener (1.2).
3. No avoid-list phrase (1.3).
4. No never-say line (1.1).
5. The cause-first checks 2, 3 and 4 — no ask in the hook, no opening question, no self-referential
   opening subject (2.2).
6. The close is present, word for word (3.6).
7. `origin_angle` is filled in (3.2).
8. The twelve compliance patterns, by calling the rules that already run in
   `src/compliance/screen.mjs` rather than re-implementing them (1.5).
9. Evergreen only: no date, season, scarcity or moving number (3.14).

## 4.2 Only a person can check these

Bring these to Chris. Do not claim them as passed.

1. Cause-first check 1 — is the thing named actually the cause, or just words that look like one.
2. The mechanism test. A machine cannot tell whether a competitor could run the same ad.
3. Whether it sounds like Chris. That is what `VOICE.md` is for, and it is a judgement, not a regex.
4. Whether the angle duplicates another concept's argument.
5. Whether the proof used is a proof we actually have in writing.

---

## Changing this file

- A rule copied from somewhere else says where it came from. Change both, or they drift.
- A rule Chris sets gets `(owner-set YYYY-MM-DD)` next to it and is not re-litigated.
- The speaking rate in 2.1 is the one number here that is a guess. It is in one place so it is cheap
  to change.
