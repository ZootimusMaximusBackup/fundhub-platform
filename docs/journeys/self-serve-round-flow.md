# The paid round — press to posted, end to end

**What the code does today.** Hand-written, traced from the code on 2026-09-05. Not generated:
`npm run journeys` builds nine pages from the routing table and this is not a routing change.

Every step below names the file and line it was read from. **Five steps in the middle of this flow
have no code joining them yet** — the tables and the pricing exist, the analyser and the send loop
exist, and the wiring between them is the endpoint lane's work. Those steps are drawn with a dashed
line and marked `UNVERIFIED`, and §7 lists every one with the reason. Drawing them solid would tell
a non-coder the money path works today. It does not.

**Corrected 2026-09-05.** An earlier version of this page drew the two checkout hops
(`priced → payment page` and `payment page → the client`) as **solid**, while §7 of the same page
admitted nothing mints a payment page for one of these rows. Both are now dashed, which is what the
page's own convention requires. The same pass moved "this round was already written" out of the
refusal list, because it is a **success** — see §7a.

Language note (owner-set): no repair wording appears in anything a client reads here. This is a
funding optimisation round.

---

## THE ONE LINE THAT MATTERS

```mermaid
flowchart LR
    subgraph MONEY["Money side — a machine may do all of this"]
        PAY["Client pays"] --> PREP["We prepare the round"]
    end
    subgraph HUMAN["Post side — only a person may do this"]
        SEND["A staff member presses send"] --> POST["Envelopes go in the post"]
    end
    PREP ==>|"PAYMENT DOES NOT POST ANYTHING. A round sits at 'ready' until a person sends it."| SEND
```

**Paying prepares the round. A person still posts it.** This is written into the code twice, as the
first thing a reader sees in each file:

* `src/metro2/delivery/send.mjs:3` — "Human still presses send; callers must not invoke this from
  payment.received."
* `api/repair/send.mjs:3` — "Never auto-mails."

Do not route around it.

---

## 1. The whole flow

```mermaid
flowchart TD
    PRESS(["Client presses 'do this for me'"])

    DUP{"Same press already recorded?"}
    QUOTED["Priced — nothing owed yet"]
    LINK{"Can we make a payment page?"}
    AWAIT["Payment page sent to the client"]
    PAID["Money recorded"]
    PULL{"Fresh credit pull"}
    ANALYSE{"Anything to dispute?"}
    STAGED["Round written and waiting — READY TO POST"]
    CLAIM{"Is this envelope already claimed or posted?"}
    MAIL{"Did the post company take it?"}
    POSTED["In the post"]
    CLOCK(["The 30 day clock starts"])

    FAILED(["Stopped — the client is told why"])
    SAMEROW(["The first request is handed back — one row, one charge"])
    HANDBACK(["Handed back — the round was ALREADY written, and its letters come back ready to post"])

    PRESS --> DUP
    DUP -->|"yes — same press key"| SAMEROW
    DUP -->|"no"| QUOTED
    QUOTED -.->|"UNVERIFIED — nothing mints a payment page for one of these rows"| LINK
    LINK -->|"payments not set up / page would not open"| FAILED
    LINK -.->|"UNVERIFIED — no code writes the awaiting_payment status"| AWAIT
    AWAIT -.->|"UNVERIFIED — nothing joins the payment to this row yet"| PAID
    AWAIT -->|"client never pays"| FAILED
    PAID -.->|"UNVERIFIED — nothing triggers a pull from this row yet"| PULL
    PULL -->|"no consent / no account / a pull is already running / the bureaus refused"| FAILED
    PULL -.->|"UNVERIFIED — report came back, but nothing hands it to the analyser for a paid round"| ANALYSE
    ANALYSE -->|"no signed authorisation on file"| FAILED
    ANALYSE -->|"no report stored"| FAILED
    ANALYSE -->|"nothing wrong found"| FAILED
    ANALYSE -->|"this round is past the plan's limit"| FAILED
    ANALYSE -->|"we could not find the client record"| FAILED
    ANALYSE -->|"we do not have the client's full legal name"| FAILED
    ANALYSE -->|"this round was already written — NOT a refusal"| HANDBACK
    HANDBACK --> STAGED
    ANALYSE -->|"yes"| STAGED

    STAGED ==>|"A PERSON PRESSES SEND. Nothing automatic crosses this line."| CLAIM

    CLAIM -->|"already posted"| FAILED
    CLAIM -->|"another send is holding it"| FAILED
    CLAIM -->|"a duplicate letter already holds the claim"| FAILED
    CLAIM -->|"free"| MAIL
    MAIL -->|"no — and provably nothing left the building"| STAGED
    MAIL -->|"no — and we cannot prove nothing left"| FAILED
    MAIL -->|"yes"| POSTED
    POSTED --> CLOCK
```

---

## 2. The press, and why a double press is one charge

`requestPaidService()`, `src/waypoints/store.mjs:151-207`.

A press writes one row in `paid_service_requests` with status `quoted`
(`db/migrations/331_paid_service_requests.sql:161`).

**The double-press guard is the press key, and only the press key.** The insert carries
`ON CONFLICT (org_id, idempotency_key) DO NOTHING` (`store.mjs:186`), backed by a partial unique
index in the database (`db/migrations/331:303-305`). The loser of a race is handed the winner's row
with `created: false` (`store.mjs:205`) — the same answer a second press gets. Two people cannot
both pass a check and both insert, because the database decides, not the application.

**What that guard does NOT cover, stated plainly.** Nothing stops a second *open* request for the
same client under a *different* press key. There is an index for finding open requests
(`db/migrations/331:292-294`) but no constraint refusing one. So "a request is already in flight"
is something the screen must ask for and honour — it is not enforced by the database. That is why
the read contract carries `paidServices[].inFlight` as a fact rather than relying on a greyed-out
button.

---

## 3. The price

`priceDisputeRound()`, `src/waypoints/pricing.mjs:56-69`. Owner-set, integer cents, no floats:

| Line | Cents | When |
|---|---|---|
| Round — all three bureaus | 10,000 (`pricing.mjs:22`) | always |
| Creditor letter | 1,000 (`pricing.mjs:23`) | only when one is needed |
| Regulator and attorney general filings | 2,000 (`pricing.mjs:24`) | only when they are needed |

The receipt is stored as **line items, not a total** (`db/migrations/331:176-181`), so a receipt can
be itemised six months later and a future price change cannot silently restate what somebody already
paid. The database checks the lines add up to the total (`db/migrations/331:239-243`), and a total of
zero is refused outright (`:178-179`).

**A missing price is not a free one.** `price_total_cents` NULL means "not priced yet"
(`db/migrations/331:316-317`), and `requestPaidService` refuses a priced request that totals zero or
less (`store.mjs:176-178`).

**A paid round does not use up a round from the plan.** The two counters are deliberately kept
apart: `nextSelfServeRoundNo()` counts only paid requests and never reads the plan's limit — the
function is `src/waypoints/store.mjs:229-238` and the owner's reasoning is in the comment directly
above it at `:221-228`. Two separate things back this up, and this page cites both rather than
picking one: a test asserts the table has no column joining the counters
(`src/waypoints/store.pg.test.mjs:327-337`), and the table's own comment in the database says the
same (`db/migrations/331_paid_service_requests.sql:321`).

---

## 4. The payment page

Nothing in this repository can charge a card that is already on file. Every purchase mints a
**hosted payment page** the client visits themselves.

`createCheckoutSession()`, `src/payments/commas-api.mjs:260-380`. **Five** ways it refuses. The
diagram above collapses all five into one edge, `payments not set up / page would not open`, to keep
it readable — this table is the full list, and it is the authority:

| Refusal | Line |
|---|---|
| Payments are not configured at all | `checkoutConfig()`, `src/payments/commas-api.mjs:198`; the caller turns that into a 503 at `src/payment-links/index.mjs:246-250` |
| The payment company answered with something unreadable | `:351` |
| The payment company answered with an error | `:357` |
| It answered fine but gave us no page to send anyone to | `:364` |
| We could not reach the payment company at all | `:378` |

A refused page means **no row moves to `awaiting_payment`**. The client is told, and nothing is
prepared.

**And nothing moves a row to `awaiting_payment` when it succeeds either.** Corrected 2026-09-05:
`awaiting_payment` is a value in the status CHECK list
(`db/migrations/331_paid_service_requests.sql:165`) and nowhere else. A search of `src/`, `api/`
and `netlify/` for the string returns **nothing**, and a search for `UPDATE paid_service_requests`
returns **nothing** — `src/waypoints/store.mjs` only ever INSERTs (`:180-194`) and SELECTs (`:200`,
`:213`, `:230`). A row written by a press is stuck at `quoted` forever, because no code in this
repository can move it. That is why the two checkout hops in the diagram are dashed.

---

## 5. The staging boundary — the hard line in the middle

`paid_service_requests.status` runs `quoted → awaiting_payment → paid → staged → fulfilled`, with
`failed`, `cancelled` and `refunded` as endings (`db/migrations/331:161-173`).

**`staged` means: the work is prepared and it is waiting on a human.** That is the state the whole
flow bends around, and the database will not let a row claim it dishonestly:

* a row at `paid` or beyond must carry a payment time (`db/migrations/331:258-261`);
* a row claiming to be finished must say what it produced (`:272-274`);
* a finished, failed, cancelled or refunded row must have an end time, and an open one must not
  (`:264-267`).

Between `staged` and the post there is exactly one door: a member of staff pressing send. It is
`POST /api/repair/send`, and it is staff-only — `auth()` then `requireRole(res, staff,
ROLE_SETS.STAFF)` (`api/repair/send.mjs:23-26`) — and it will not post anything unless the request
explicitly says `mail: true` (`:34`).

---

## 6. The send, and the guard against a second envelope

`claimLetterForMailing()`, `src/repair/send.mjs:155-219`. Before any letter is handed to the post
company, the send **claims** it with a single conditional update (`:161-174`). Four refusals, each
one a labelled edge in the diagram:

| Refusal | What it means to a person | Line |
|---|---|---|
| `already_mailed` | This envelope has already gone. Nothing releases this and nothing ever will. | `:210` |
| `send_claim_held` | Another send is holding it right now, or one was and never came back. A person can clear it. | `:217` |
| `already_mailed_duplicate_letter` | A different letter row for the same case, bureau, round and destination already holds the claim. | `:180` |
| `claim_failed` | The database would not answer, so we do not know if it is safe. It is not sent. | `:186` |

A letter is only given back when the failure **provably** happened before anything left the building
— `releaseLetterClaim()` at `src/repair/send.mjs:224-240` carries `mailed_at IS NULL` in its WHERE
clause, so a release can never un-post a letter that really went. When the post company refuses in a
way we cannot prove was pre-transmission, the letter keeps its claim and a person has to release it.

Only when at least one letter actually went does `repair.letters.sent` fire
(`src/repair/send.mjs:593-597`), which is what moves the client's file to "in the post" and starts
the bureau's 30 day clock.

---

## 7. Every step marked UNVERIFIED, and why

| Step | Why it could not be traced |
|---|---|
| Priced → a payment page is minted | **Nothing mints one for a paid service request.** `requestPaidService` accepts a `checkoutUrl` (`store.mjs:161`) and stores it, but nothing calls `createCheckoutSession()` for one of these rows and nothing writes the URL back. |
| Payment page → the client is waiting on it | **No code writes the `awaiting_payment` status.** It exists only in the CHECK list at `db/migrations/331:165`. There is no `UPDATE paid_service_requests` anywhere in `src/`, `api/` or `netlify/`. |
| Payment page → money recorded on the request row | A search of `src/` and `api/` finds `paid_service_requests` referenced only in `src/waypoints/store.mjs` and its test. The payment webhook path exists and emits `payment.received` (`src/adapters/commas.mjs:523`) — but **nothing marks one of these rows paid.** |
| Money recorded → fresh credit pull | The only thing in the repository that triggers a pull from a payment is `diagnostic.paid` → workflow C-00 (`src/handlers/diagnostic-soft-pull.mjs:21-31`). Nothing connects a paid service request to it. The owner's plan requires every paid round to re-pull first; that wiring is not written. |
| Fresh pull → the analyser | Same absence. C-00 ends by returning its result (`src/workflows/c-00-crs-soft-pull-request.mjs:125-134`); nothing reads that and calls the analyser for a paid round. |

The pull's own refusals **are** traced, from `src/workflows/c-00-crs-soft-pull-request.mjs`: no
client (`:60`), no account to attribute the pull to (`:79`), consent refused (`:102`), a pull
already outstanding (`:111-115`), and the pull itself failing (`:132`). **Five refusals, drawn above
as one edge** naming four of them. This table is the full list.

The analyser's **six** refusals are all traced, from `src/repair/analyze.mjs`, and each one now has
its own labelled edge in the diagram:

| Refusal | Line |
|---|---|
| No signed authorisation on file | `:311` |
| Past the plan's round limit | `:328-337` (`round_cap_exceeded` at `:333`) |
| No stored credit report | `:341` |
| Nothing wrong found | `:360` |
| The client record could not be found | `:363` — **this one had no edge before 2026-09-05 and now does** |
| No full legal name on file | `:364` |

Per bureau it also skips a bureau with no rule-backed claims (`:378`) and one already written
(`:384`). A skip is a `skipped.push()` and a `continue`, not a stop.

### 7a. "This round was already written" is a SUCCESS, not a refusal

Corrected 2026-09-05. An earlier version of this page drew this as an edge into "Stopped — the
client is told why", and listed it among the analyser's refusals. **It is neither.**

`src/repair/analyze.mjs:314-326` returns `ok: true`, with `already_generated: true`, the round, the
case ids, and **`letters: existingLetters` — the letters themselves, handed straight back**. Nothing
stops. The round is already staged and ready to post.

This matters because of who is reading the screen. A client who has just paid for a round would
have been told their round **stopped**, when the round was in fact finished and waiting. That is the
worst direction for this particular error to point.

---

## 8. One conflict this page found and did not fix

**The plan's round limit still refuses a paid round.** Owner-set: a paid round must not consume a
round from the plan, and the table honours that — there is no column joining the two counters
(`db/migrations/331_paid_service_requests.sql:321` table comment;
`src/waypoints/store.mjs:221-238`).

But the analyser does not know that. `analyzeAndGenerate` reads `repair_programs.rounds_cap` and
returns `round_cap_exceeded` for any round past it (`src/repair/analyze.mjs:328-337`). A trial client
whose plan covers two rounds, who then buys a third round with their own money, would be refused
there today.

That is a finding, reported and not reconciled (CLAUDE.md §4). It belongs to whoever builds the
endpoint that calls the analyser for a paid round.

---

## 9. Rounds 4 and 5 carry three states, and a paid round cannot reach the third

Carried over from `docs/journeys/client-progress-flow.md` because it applies to anything a client
buys as well. **Owner-set, 2026-09-05:** rounds 4 and 5 move through **prepared → sent → filed**,
and **only the client telling us moves anything to filed**.

```mermaid
flowchart LR
    PREP["PREPARED<br/>the complaint exists as a document"]
    SENT["SENT<br/>the pack went to the client"]
    FILED["FILED<br/>the client submitted it"]

    PREP -->|"the pack is built and stored"| SENT
    SENT -.->|"UNVERIFIED — NOTHING IN THIS REPOSITORY CAN RECORD THIS.<br/>Buying a round does not change that."| FILED
```

**Nothing in this repository records whether a federal regulator complaint or a state attorney
general complaint was actually submitted** (`src/metro2/letters/catalog.mjs:56-68`). A search of
`src/`, `api/` and `db/migrations` for `complaint_filed`, `filed_at`, `ag_filed` and
`complaint_sent` returns no results at all.

The documents are produced (`src/metro2/diy/package.mjs:396` and `:402`) and handed to the client to
sign and file personally. A paid round may produce them. **Paying does not move the flag, because
there is no flag.** Neither this flow nor any screen may say either one was filed.

---

## 10. Compliance

`COMPLIANCE REVIEW REQUIRED` — fee timing and dispute logic. This page describes what a client is
asked to pay for a dispute round and when, and the human gate between payment and posting. It
changes no code; the two modules it draws from carry the same label already
(`src/waypoints/pricing.mjs:1`, `db/migrations/331:3`).

---

## 11. What was re-checked on 2026-09-05, and what changed

Every claim on this page has been re-checked against **the branch it ships on**, not `origin/main`.

**Found wrong and corrected:**

| Claim | What was wrong |
|---|---|
| `priced → payment page → the client` drawn as solid arrows | Nothing mints a payment page for one of these rows and no code writes `awaiting_payment`. The page's own §7 already said so. **Both are now dashed** |
| "this round was already written" drawn as an edge into "Stopped" | It is a **success** returning the existing letters (`analyze.mjs:314-326`, `ok: true`). Now drawn as a hand-back into "ready to post" — see §7a |
| "Four ways it refuses, each its own labelled edge above" | There are **five**, and they are **one** collapsed edge. Both halves of the sentence were wrong; the count is fixed and the collapsing is now stated |
| the analyser's refusals described as seven, drawn as six | There are **six** refusals plus two per-bureau skips. `client_not_found` (`:363`) had no edge and now has one |
| `nextSelfServeRoundNo()` cited as `:222-238` here and `:222-231` in the changelog | The function is `:229-238`, its comment `:221-228`. Both places now say `:221-238` |
| `already_generated` and the round cap cited together as `:313-330` / `:330-338` | Two unrelated blocks. Now `:314-326` and `:328-337` |
| `catalog.mjs:57-65` | The comment block runs `:56-68` |

**Re-checked and confirmed still exact** — every citation in §2, §3, §5 and §6: the press guard and
its partial unique index, the three price constants as integer cents, the status list and the four
database CHECKs, the staff gate on `POST /api/repair/send` and its `mail: true` requirement, all
four send refusals, the `mailed_at IS NULL` release guard, and all five checkout and five pull
refusal lines.

**Still not done:** the Mermaid blocks on this page have not been rendered. No Mermaid renderer is
installed in this repository and no dependency was added to get one. They were checked for balanced
quotes, brackets and `subgraph`/`end` pairs only.
