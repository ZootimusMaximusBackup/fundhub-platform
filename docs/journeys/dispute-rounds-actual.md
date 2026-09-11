# dispute-rounds — actual

What the code **does** today when a staff member asks for a client's dispute letters.
Traced from `src/repair/analyze.mjs`, `src/metro2/**` and `src/metro2/letters/prompts.mjs`.
Not from a spec, and not from memory.

COMPLIANCE REVIEW REQUIRED — dispute logic and credit-repair messaging.

## The one picture

```mermaid
flowchart TD
    START([Staff asks for this client's letters, round R1-R6]) --> AUTH{Signed repair agreement,<br/>or a live dispute authorization?}
    AUTH -->|No| STOP1[Refused — no_authorization]
    AUTH -->|Yes| EXIST{Letters for this round<br/>already written?}
    EXIST -->|Yes| DONE1[Returns them — already_generated]
    EXIST -->|No| CAP{Round allowed<br/>by the program cap?}
    CAP -->|No| STOP2[Refused — round_cap_exceeded]
    CAP -->|Yes| FILE{A stored credit pull<br/>on this client?}
    FILE -->|No| STOP3[Refused — no_credit_file]
    FILE -->|Yes| FRESH{"Round 2 or later:<br/>is the newest pull newer<br/>than the last round's letters?"}
    FRESH -->|No| STOP4[Refused — credit_file_stale_for_round<br/>Pull the report again]
    FRESH -->|Yes| ID[Read the VERIFIED identity]

    ID --> IDQ{Documents read?<br/>src/identity/}
    IDQ -->|"No — module absent,<br/>or nothing verified"| NOID[legalName = null<br/>address = null<br/>consumer context = empty]
    IDQ -->|Yes| YESID[legalName + address from the<br/>government ID and proof of address]

    NOID --> ENGINE
    YESID --> ENGINE[Metro 2 engine over the newest pull]

    ENGINE --> PATH{On the repair path?}
    PATH -->|No| CLAIMS1[Engine findings only]
    PATH -->|Yes| CLAIMS2[Engine findings<br/>+ derogatory-item claims<br/>+ the personal-information floor]

    CLAIMS1 --> WRITE
    CLAIMS2 --> WRITE[Write one letter per bureau]

    WRITE --> SHAPE{What do this letter's<br/>claims actually say?}
    SHAPE -->|Every claim confirms the file| CONF["Confirmation wording.<br/>No method-of-verification demand,<br/>no furnisher demand,<br/>no deletion of the listed items.<br/>Subject line says 'confirmation', not 'dispute'."]
    SHAPE -->|Some confirm, some dispute| MIX["Mixed wording.<br/>Demands scoped to 'each DISPUTED item';<br/>confirmations asked for separately."]
    SHAPE -->|Every claim disputes| DISP[Dispute wording, unchanged]

    CONF --> GATE
    MIX --> GATE
    DISP --> GATE[Variance gate — under 35% similar to<br/>the last 5 letters to this bureau]
    GATE -->|Pass| SAVE[Saved status 'generated'. NOTHING IS MAILED.]
    GATE -->|Six attempts, all too similar| SKIP[Skipped — variance_gate_exhausted]
```

## Where the one name and the one address come from

`src/repair/analyze.mjs` `loadVerifiedIdentity()` loads `src/identity/` dynamically and
takes `{ legalName, address, dateOfBirth, source, verifiedAt }` from it. That module is
built from the government ID and the proof of address the client uploaded, after an agent
has read both images and confirmed the two addresses match.

Nothing else may supply it. Not `clients.first_name`, not `pii_identity.addresses[0]`, not
the letterhead's company-address fallback. A missing module, a missing export, a throw or a
malformed answer all resolve to **null**, and null means unknown:

| | With a verified identity | Without one |
|---|---|---|
| Name claim in the letter | Yes — keep this one name | **None at all** |
| Address claim | Yes — keep this one address | **None at all** |
| M2-032 name variants | Can fire | Cannot fire |
| M2-033 date of birth | Can fire, but never on an ambiguous date | Cannot fire |
| M2-034 employment | Can fire when a source supplies employers | Cannot fire |
| The name on the letterhead and signature | The legal name off the ID | No letter is written |
| A clean file on the repair path | Produces a confirmation letter | Produces nothing — `identity_not_verified` |
| A file with real findings, on the repair path | Produces the letters | Produces nothing — `identity_not_verified` |

CHANGED 2026-09-06, last two rows and the row above them. Two things moved.

First, the refusal used to answer `no_violations`, which the Repair desk prints as "the
credit file looks clean — nothing to dispute". On a client whose ID has not been read that
sentence is false in the way that matters: the file may be spotless or a wreck, and what is
missing is the identity read. `identity_not_verified` says so, and the desk copy tells the
Specialist to get the ID. Only clients ON the repair path get this answer — off it there is
no floor to be missing an input for, and `no_violations` is still the honest word.

Second, and this is the row that was WRONG until 2026-09-06: the refusal only ever ran on
the "nothing to dispute" branch. A repair client with an unread ID and any real finding
still got all three letters — the personal-information claims merely absent from them — and
the name printed at the top and signed at the bottom came from `clients.first_name` /
`clients.last_name`, a typed form field. Measured by running `analyzeAndGenerate` against a
client with one collection account. The check now runs ahead of every letter, and the
printed name comes off the ID. It is gated on the NAME, not on both: a client with a
verified name and no accepted proof of address still gets letters, with no address claim in
them. The return address on the envelope is unchanged and may still fall back to the
client's company address — that is routing, not a claim about where anybody lives.

ALSO 2026-09-06: `src/repair/analyze.mjs` was looking for the identity module at three
paths that do not exist. `src/identity/verified.mjs` is where it landed, and every import
threw, so on EVERY real client the whole right-hand column above was what actually
happened — no name claim, no address claim, three engine rules dark — while the left-hand
column was what the tests showed, because every test injected the module by hand. Proved by
running it, fixed by naming the real path, and pinned by a test that uses no override.

Before 2026-09-04 the three rules in the last block could not fire **at all**, for anybody:
`src/metro2/normalize.mjs` marks every `context.consumer` field not-visible because nothing
in a credit report carries it, and `src/metro2/diy/from-crs.mjs` never overrode that. So the
only personal-information rule that ever ran was M2-031, "delete addresses older than two
reporting cycles" — age-based cleanup, not the identity-based cleanup the product sells.
`src/metro2/diy/consumer-context.mjs` is the piece that was missing.

## One name claim per bureau, never two

M2-032 (`src/metro2/checks/personal-info.mjs`) and the floor's own name claim
(`src/metro2/diy/personal-info-floor.mjs`) say the same thing. Where M2-032 fires for a
bureau, the floor's name claim stands down for that bureau —
`mergePersonalInfoClaims()`. The address and inquiry halves are untouched: M2-031 is an
age rule about former addresses and asserts something different.

### A date of birth that could be read two ways makes no claim

FIXED 2026-09-06. **COMPLIANCE REVIEW REQUIRED — dispute logic.**

M2-033 tells a credit bureau that a wrong date of birth is one of the strongest signs
another person's records have been merged into this file. It is an accusation, and it was
being made out of a formatting difference.

The bureau file writes a date of birth as `1985-03-02`. A government ID writes whatever was
printed on it, commonly `02/03/1985`. Those are the same day — 2 March 1985 — written two
ways, and nothing on either side says which half is the month. The code resolved it
month-first by choice and fired the claim. Measured by running the real function on exactly
that pair.

Now an ambiguous date is UNKNOWN and makes no claim. The check lists every day a string
could mean and speaks only when **no** reading of the file's date can be the same day as
**any** reading of the consumer's. A date that is wrong however you read it — a different
year, or two readings that both miss — still fires, and a date where one half cannot be a
month (`03/22/1985`) is not ambiguous and is read normally.

This path is newly reachable: it is the fix directly above, naming the real identity module,
that supplies the consumer side of M2-033 for the first time.

## The six rounds

| Round | Document | Bureau-letter prose |
|---|---|---|
| R1 | First dispute | Own pool — 30-day reinvestigation |
| R2 | Method-of-verification demand | Own pool — MOV + furnisher contacts |
| R3 | Final notice | Own pool — 15-day deletion demand |
| R4 | CFPB complaint (separate document) | Own pool, **R3's authority** |
| R5 | State AG complaint (separate document) | Own pool, **R3's authority** |
| R6 | Final notice reissued | Own pool, **R3's authority** |

`promptPoolRound()` still answers "which of the three letter SHAPES is this" and still says
R4, R5 and R6 are all final notices — `src/underwrite/prior-outcome.mjs` and
`src/repair/round-plan.mjs` read that answer and it has not moved. What is new is
`prosePoolRound()`, which answers the narrower question of which six openings and six
closings the writer draws from.

**Why they needed their own words.** Until 2026-09-04 R4, R5 and R6 returned R3's pool
outright, so a Round 4 letter was a Round 3 letter word for word, and the variance gate
refused it. Measured on origin/main, real Postgres, the production sim seed, a repair
client with a damaged file, rounds run in order:

```
R1 -> 5 letters   R2 -> 3 letters   R3 -> 3 letters
R4 -> 0 letters   R5 -> 0 letters   R6 -> 0 letters
```

Every bureau `variance_gate_exhausted`. The ladder stopped at three, silently, for every
client and every file shape. After: **R1 through R6 all write three bureau letters**, for a
spotless file, a clean file and a damaged file alike.

### Only Round 6 may call itself the last letter

FIXED 2026-09-06. **COMPLIANCE REVIEW REQUIRED — dispute logic.**

Four lines in the Round 3 pool call the letter the last one the bureau will get: "This is
my last letter to your bureau on these items before I file with the CFPB and my state
attorney general", "This Round 3 letter is the last bureau notice on these Metro 2
defects", and two variants. While rounds 4, 5 and 6 produced nothing that was TRUE. The
moment those rounds started writing letters — the fix directly above — it became a false
statement mailed to a credit bureau in a real person's name.

The stripper for exactly this already existed and was gated on rounds 4, 5 and 6, which is
every round except the one where the claim newly bit. Measured by rendering, before the
fix: **972 letters built** — six rounds x three bureaus x eighteen regeneration attempts x
three claim mixes — of which **90 of the 162 Round 3 letters carried one of these lines**.
R1, R2, R4 and R5 carried none.

Now every round with another bureau round after it has the claim stripped: R1, R2, R3, R4,
R5 and the furnisher letter. **R6 is the last rung of the ladder, so R6 is the one letter
allowed to say so**, and it says it in its own words.

Re-measured after the fix, on a WIDER sweep than the one that found it — **1,890 letters**,
seven rounds (the six plus the furnisher letter) x three bureaus x eighteen attempts x five
claim mixes, and eleven phrase patterns rather than three: **zero letters outside Round 6
carry a finality claim.** Round 6's 270 all carry its own wording, which is true of Round 6.

Two more checks, because a rendered sample is not a proof of a pool:

* Every sentence the writer can draw was listed **out of the source**, across all seven
  rounds — 112 distinct lines. Exactly 13 contain finality wording: 4 in Round 3 (the ones
  fixed), 7 in Round 6 (all true), and 2 in Round 1 that say the letter is *not* a final
  notice, which is honest. Rounds 2, 4, 5 and the furnisher letter contain none.
* Rounds 4, 5, 6 and the furnisher letters were compared **byte for byte** against the same
  letters built from the commit before this fix: 1,134 letters compared, and the only text
  that moved anywhere is Round 3's 90.

### What a round may say about a complaint HAVING been filed

CORRECTED 2026-09-06. **COMPLIANCE REVIEW REQUIRED — dispute logic.**

**The sentence that stood here was wrong.** It said "Nothing in any round says a CFPB or
state attorney general complaint HAS been filed." A reviewer rendered Round 6 with two
records in hand and got exactly that, in a letter to a credit bureau:

```
COMPLAINTS ALREADY FILED (evidence):
On 2026-08-01 a complaint about this file was mailed to the Consumer Financial Protection Bureau.
On 2026-08-15 a complaint about this file was mailed to my state attorney general.
```

So here is the true, narrower claim, traced through the code rather than remembered.

**Round 6, and only Round 6, can print it.** `src/metro2/letters/generate.mjs:816` calls
`formatComplaintFilings` only when the round is R6. Rounds 1 to 5 print nothing about a
filing whatever records exist — they name the two offices in the future tense only.

**One sentence per record, and no record means no sentence.**
`src/metro2/rounds/complaint-filing.mjs` `formatComplaintFilings` walks the rows it is
given, keeps only those whose target is `cfpb` or `state_ag` AND whose status is `sent` or
`delivered`, and de-duplicates by target. A row with no usable date says "A complaint about
this file was mailed to …" without inventing a day. Nothing is hedged and nothing is
assumed.

**Where a record can come from — the whole set, read off the code.** Rows are read by
`loadComplaintFilings` out of `dispute_letters`. Two functions insert into that table:

* `src/metro2/rounds/store.mjs` `saveLetter`, whose only callers are `src/repair/analyze.mjs`
  (twice) — and both write `target: "bureau"` or `target: "furnisher"` with
  `status: "generated"`. Neither can produce a row this sentence would read.
* `src/metro2/rounds/complaint-filing.mjs` `recordComplaintFiling`, which is the only
  writer that can. Its one caller in the product is `src/repair/send.mjs:565`, inside the
  block that runs **after the mail provider returned**, gated on the letter's target being
  a complaint target.

**And it now takes a receipt, not our word.** `recordComplaintFiling` requires
`providerId` — the mail provider's own identifier for the piece it accepted. Without one it
writes nothing and answers `no_provider_receipt`. So the sentence cannot be opened by
intending to send, by generating a complaint, or by a staff member marking something done:
only by a provider having taken the piece and handed back an id for it.

**What that costs, stated rather than hidden.** `src/repair/send.mjs:441` reads the id as
`sent?.providerId || sent?.id || null`, and its own note at :449 records that a provider can
accept a piece and return no identifier. When that happens the complaint really was mailed
and no record is written, so **Round 6 stays silent about it**. That is the intended
direction: a true sentence lost can be recovered, a false one mailed to a credit bureau
cannot.

**What is NOT claimed here.** Whether the live database holds any `cfpb` or `state_ag` row
today was not checked and is not asserted — this page is written from the code, and the live
data was not read. What the code says is the whole of the above: one writer, one caller, and
that caller only after a mail provider handed back a receipt.

## Gaps between this and the intended journey

* No `-intended.md` file describes the dispute rounds. This page therefore reports what the
  code does and invents no target for it.
* `src/identity/` does not exist in this branch. Every path above that depends on it is
  written, guarded and tested against a stand-in; the live behaviour today is the
  "without one" column of the table above.
* **Still not fixed.** A letter carrying nothing but Metro 2 claims — no
  personal-information claims at all, which is what a client with no verified identity and
  no unmatched inquiries gets — loses Round 5 or Round 6 to the variance gate about half
  the time. Measured 2026-09-04: 169 of 180 rounds written across ten clients and three
  claim shapes, with all eleven losses in that one shape. Pinned in
  `src/metro2/letters/letter-honesty.test.mjs`.
* **Still not fixed.** Stored letters carry no date line: `src/repair/analyze.mjs` passes
  neither `date` nor `undated` to the writer, so `buildLetterText` prints an empty first
  line. Pre-existing on `origin/main` and out of this lane's scope.
