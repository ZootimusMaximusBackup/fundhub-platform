# The repair letter floor — what a credit-repair customer always gets

Owner decision, 2026-09-03, final.

> On **every** customer on the credit-repair path, on **every** round, clean file
> or not, always run personal-information cleanup: consolidate to exactly 1 name,
> consolidate to exactly 1 address, and dispute every credit inquiry that has no
> matching open account. That is the **floor** — it happens even when the file is
> completely clean and there is nothing else to dispute.

Letters about bad accounts sit **on top** of that floor. A customer who is not on
a repair path gets none of it, whatever their file holds.

Traced from the code in `src/repair/analyze.mjs` and
`src/metro2/diy/personal-info-floor.mjs`, not from the spec.

## What happens when staff press Generate

```mermaid
flowchart TD
    A[Staff press Generate on the Repair desk] --> B{Signed repair agreement,<br/>or staff dispute authorization?}
    B -->|No| B1[Stop: no_authorization]
    B -->|Yes| C{Letters for this round<br/>already made?}
    C -->|Yes| C1[Stop: already_generated<br/>nothing is made twice]
    C -->|No| D{Round allowed by<br/>the customer's program?}
    D -->|No| D1[Stop: round_cap_exceeded]
    D -->|Yes| E{Any credit file on record?}
    E -->|No| E1[Stop: no_credit_file]
    E -->|Yes| F{Round 2 or later, and the<br/>newest pull is older than<br/>the last round's letters?}
    F -->|Yes| F1[Stop: credit_file_stale_for_round<br/>one fresh pull clears it]
    F -->|No| G{Is the customer on<br/>the repair path?}
    G -->|No| H[Only what the Metro 2 engine<br/>found in the file]
    G -->|Yes| I[Metro 2 findings<br/>+ a claim per bad account<br/>+ THE FLOOR]
    H --> J{Anything at all to say?}
    I --> J
    J -->|No| J1[Stop: no_violations]
    J -->|Yes| K[One letter per bureau, stored<br/>as generated. Nothing is mailed.]
```

**On the repair path** means either a signed credit-repair agreement, or an
outcome tier of `REPAIR_ONLY` or `FUNDING_PLUS_REPAIR`. The agreement counts
first: somebody who bought repair is on the repair path whatever the analyzer
last stamped on their record.

## What the floor puts in the letter

```mermaid
flowchart TD
    S[The newest credit pull] --> N{How many different names<br/>does the file report?}
    N -->|Two or more| N2[PI-NAME-CONSOLIDATE<br/>lists the names that really are<br/>on the file, keeps one, asks for<br/>the rest to be deleted]
    N -->|Exactly one| N1[PI-NAME-CONFIRM<br/>quotes that one name and asks<br/>the bureau to hold the file to it]
    N -->|None visible| N0[PI-NAME-CONFIRM<br/>says nothing about what the file<br/>holds, names the one name to use]

    S --> D{How many different addresses<br/>does the file report?}
    D -->|Two or more| D2[PI-ADDRESS-CONSOLIDATE]
    D -->|One or none| D1[PI-ADDRESS-CONFIRM]

    S --> Q[Each inquiry on the file]
    Q --> Q1{Does any account anywhere<br/>on the pull come from<br/>that same company?}
    Q1 -->|Yes, or the name is unreadable| Q2[No claim.<br/>An uncertain match counts as a match.]
    Q1 -->|No| Q3[PI-INQUIRY-UNMATCHED<br/>asks for the permissible purpose<br/>or deletion]
```

### The rule that makes this safe

A dispute letter is a statement of fact mailed to a credit bureau in the
customer's name. So:

* A **consolidation** claim is only made when the file genuinely carries two or
  more different names, or two or more different addresses. The names it quotes
  as being on the file are read off the file itself.
* A file that carries **one** name gets a claim confirming that one name should
  stay. It is never told it carries a second name that was never there. Bureau
  files routinely carry a middle initial that the customer record does not, and
  treating that difference as a duplicate would put a false statement in a mailed
  letter and demand deletion of the customer's own correctly reported name.
* The name to keep comes from the customer's own record. That is the customer
  speaking about themselves. It is never used to decide what the bureau reported.
* The inquiry claim never says the customer failed to authorise the inquiry.
  Nothing in a credit report carries that fact, so the letter asks for the
  permissible purpose instead of asserting there was none.

### Rounds

Every claim is built from the newest stored pull, so an item a bureau deleted is
simply not in the next round's letter. The re-pull itself is not automatic, so
Round 2 and later refuse until a newer pull is on record. Round 1 has no earlier
round to be stale against, and the furnisher letters are not a rung on the
bureau ladder, so both are exempt.

## Where this lives

| What | File |
|---|---|
| The floor's claims and the rule that they never invent a variant | `src/metro2/diy/personal-info-floor.mjs` |
| Claims for bad accounts (collections, charge-offs, lates) | `src/metro2/diy/derogatory.mjs` |
| The Metro 2 engine's own findings | `src/metro2/diy/from-crs.mjs` |
| Where the three are merged, the repair-path gate, the re-pull gate | `src/repair/analyze.mjs` |
| The endpoint staff press | `api/repair/generate.mjs` (POST `/api/repair/generate`) |
| Simulated credit files for a walkthrough | `scripts/sim/push-credit.mjs` |

Nothing in this flow mails anything. Handing a stored letter to a mail provider
is a separate, human step.
