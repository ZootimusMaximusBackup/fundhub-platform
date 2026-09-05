# repair letter send — actual

What the code **does** today when a staff member presses send on a repair
dispute letter, and what now stops the same letter going out twice. Traced from
`src/repair/send.mjs`, `src/metro2/delivery/send.mjs`,
`src/messaging/providers/mail-letter.mjs` and `db/migrations/332` on branch
`feat/portal-schema` — not from a spec.

**A human still presses send.** `src/metro2/delivery/send.mjs:3` and
`api/repair/send.mjs:3` both forbid mailing from `payment.received`. Nothing in
this change touches that.

## The send loop

```mermaid
flowchart TD
    POST([Staff presses send<br/>api/repair/send.mjs]) --> GATE{"mail = true?"}
    GATE -->|No| REF1["refused: no_channel<br/>a human must press send"]
    GATE -->|Yes| EACH["for each letter in the payload"]

    EACH --> ROUTE["resolve the destination<br/>bureau / furnisher / CFPB / state AG"]
    ROUTE --> ADDR{"Is there an address?"}
    ADDR -->|"no state AG address on file"| REF2["refused: ag_postal_address_unknown<br/>no send, no filing row"]
    ADDR -->|Yes| CLAIM

    CLAIM{"CLAIM the letter<br/>UPDATE dispute_letters<br/>SET status='sending', mailed_at=now()<br/>WHERE mailed_at IS NULL<br/>AND status NOT IN (sending, sent, delivered)"}

    CLAIM -->|"0 rows, and the row says it is<br/>already claimed or already sent"| REF3["refused: already_mailed"]
    CLAIM -->|"unique violation on<br/>uq_dispute_letters_one_mailing"| REF4["refused: already_mailed_duplicate_letter<br/>a different row for the same case,<br/>bureau, round and target already went"]
    CLAIM -->|"0 rows and no such letter row exists"| SEND
    CLAIM -->|"claimed"| SEND

    SEND["mailBureauLetter → sendLetter<br/>POST PostGrid /letters"]

    SEND -->|"ok"| MARK["status = 'sent'<br/>postgrid_letter_id = provider id"]
    SEND -->|"refused BEFORE the request left us<br/>(no API key, no return address,<br/>no destination, no PDF or HTML,<br/>private carrier to a PO box)"| REL["RELEASE the claim<br/>status back to what it was<br/>mailed_at = NULL"]
    SEND -->|"anything else<br/>(HTTP error, no response)"| STUCK["claim KEPT, status stays 'sending'<br/>we do not know whether it went,<br/>so nothing auto-retries it"]

    MARK --> CLOCK["dispute_cases.response_due_at = now() + 30 days<br/>only when it was NULL"]
    CLOCK --> EV[["event: repair.letters.sent"]]
    STUCK --> HUMAN["a human reconciles against<br/>GET /payments — a support ticket"]
```

## Why the claim happens before the provider call

`src/repair/send.mjs` used to set `status = 'sent'` after the mailer returned,
with no check of the current status, and `dispute_letters` carried no unique
index of any kind. Re-POSTing the same payload therefore mailed the same letters
again: two envelopes to the consumer, two to the bureau, two PostGrid bills. The
only thing in the way was a disabled button in a browser, which a retry, a
second tab or `curl` walks straight past.

Claiming after the call would not fix it, because two callers can both finish a
`SELECT` before either reaches its `UPDATE`. The claim is one statement, it runs
before anything is transmitted, and Postgres decides who wins.

## What NULL means here

* `dispute_letters.mailed_at` **NULL** — never claimed for mailing, or the row
  predates `db/migrations/332`. Never backfilled, so the partial unique index
  covers everything from that migration forward without rewriting one historic
  row.
* `dispute_letters.mail_cost_cents` **NULL** — UNKNOWN. It is not "free".
  **Nothing writes this column yet**; reading a price off the provider response
  is a later change.

## Still unguarded, on purpose

A letter posted with **no `letterId`** has no row in `dispute_letters` to claim,
so nothing stops a second one. That is unchanged behaviour, not a new hole:
`src/repair/send.mjs` has always accepted an ad-hoc `{bureau, html}` letter with
no stored row. The guard covers every letter the system generated.

## The schema behind the portal's paid round

`db/migrations/330` and `331` add the two tables the self-serve round sits on.
No endpoint reads them yet.

```mermaid
flowchart LR
    W["client_waypoints<br/>ordered checklist per client<br/>owner_kind: client | fundhub<br/>state, due_at, completed_at<br/>paid_alternative_price_cents"]
    P["paid_service_requests<br/>one row per 'do it for me'<br/>priced line items + total<br/>idempotency_key<br/>round_no"]
    R["repair_programs.rounds_cap<br/>rounds the client BOUGHT<br/>with their program"]

    W -->|"waypoint_id"| P
    P -. "no column, no join, deliberately" .- R
```

* **Overdue is a computed fact**: `due_at < now() AND state NOT IN (done,
  skipped)`. A NULL `due_at` means nobody set a deadline, and is never overdue.
* **`paid_alternative_price_cents` NULL** means no paid alternative exists. A
  CHECK refuses `0` outright, so nothing can read a zero and call it free.
* **A paid round does not consume a purchased round.** `round_no` on
  `paid_service_requests` is the self-serve counter;
  `repair_programs.rounds_cap` is the program counter. There is no column
  joining them, which is the enforcement.
* **A double press is one row**, adjudicated by
  `uq_paid_service_requests_idem (org_id, idempotency_key)` — the same partial
  unique index `events` and `soft_pull_requests` already use.

## Proven by

* `src/repair/send-double-mail.pg.test.mjs` — the same payload twice, one mailer
  call, one letter row; a duplicate row refused; a pre-transmission refusal
  released; a possibly-transmitted call kept.
* `src/waypoints/store.pg.test.mjs` — NULL price survives, `0` is refused, a
  receipt that does not add up is refused, a double press is one row, the
  program cap does not move.
* `src/waypoints/pricing.test.mjs` — $100 / +$10 / +$20 in integer cents.
