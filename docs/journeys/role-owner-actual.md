# Role: Owner — what the code actually does

**Generated from code, not from a spec.** Every box below was traced by reading the
files named beside it. Anything that could not be traced is marked `UNVERIFIED`.

> **This file covers ONE flow: adding bank accounts and credit cards by hand.**
> The rest of the owner's journey is not traced yet. An absent box means nobody has
> read that code and written it down — it does NOT mean the step does not exist.
>
> There is no `role-owner-intended.md` to compare against. `docs/journeys/` did not
> exist before this commit, so there is nothing to report a gap against. The intended
> file is the owner's to author.

---

## Adding a bank account or credit card

```mermaid
flowchart TD
    A[Owner opens banking-entry.html] --> B{shell.js: is this page<br/>in ALL and allowed<br/>for my role?}
    B -->|no| B1[Bounced to role home]
    B -->|yes| C{client_id in<br/>the address bar?}

    C -->|no| C1["Screen says: pick a client first<br/>Links to Client Control Panel<br/>NO form shown"]
    C -->|yes| D{fh_demo = 1<br/>in localStorage?}

    D -->|yes| D1["Screen REFUSES and explains<br/>Forms stay hidden<br/>(fh.js demo flag would swallow the write)"]
    D -->|no| E[GET /api/banking/accounts]

    E --> F{requireAuth}
    F -->|no session| F1[401 unauthorized]
    F -->|db unreachable| F2["503 db:down<br/>screen says backend unavailable"]
    F -->|ok| G{requireRole<br/>ROLE_SETS.STAFF}
    G -->|not in set| G1[403 forbidden]
    G -->|ok| H{staff.org_id present?}
    H -->|no| H1[403 no_org_on_session]
    H -->|yes| I["listBankAccounts + listStatementCycles + listHoldings<br/>all filtered WHERE org_id = session org"]

    I --> J[nextDueDate computed SERVER-side<br/>src/banking/statement-cycles.mjs]
    J --> K{any accounts?}
    K -->|none| K1["Screen prints a sentence:<br/>no accounts on file yet<br/>NO sample rows"]
    K -->|some| K2[Rows rendered<br/>NULL money shows as em dash]
```

**Traced in:** `public/app/banking-entry.html`, `public/app/shell.js:16-25`,
`api/banking/accounts.mjs`, `src/banking/accounts.mjs`,
`src/http/middleware/requireAuth.mjs`.

---

## Saving one account by hand

```mermaid
flowchart TD
    A[Owner fills the form and submits] --> B{Account type<br/>= credit card?}
    B -->|yes| B1[Card billing fields<br/>are visible]
    B -->|no| B2[Card billing fields hidden<br/>credit limit hidden]

    B1 --> C[POST action=create_account]
    B2 --> C

    C --> D{requireRole<br/>ROLE_SETS.FINANCE<br/>owner + admin only}
    D -->|not in set| D1[403 forbidden]
    D -->|ok| E[dollarsToCentsOrNull per amount]

    E --> E1{box left empty?}
    E1 -->|yes| E2["stays NULL<br/>NEVER becomes 0"]
    E1 -->|no| E3[toCents]

    E2 --> F[createManualBankAccount]
    E3 --> F

    F --> G{account_type in<br/>081's allowed set?}
    G -->|no| G1[400 with the field named]
    G -->|yes| H[mask TRUNCATED to last 4 digits]
    H --> I["INSERT bank_accounts<br/>org_id from SESSION<br/>plaid_item_id NULL = hand-entered"]

    I --> J{entity_kind stated?}
    J -->|no or unknown| J1["left at 082 default 'unknown'<br/>no provenance written"]
    J -->|personal / business| J2["UPDATE entity_kind<br/>source = staff_reviewed<br/>set_at = now()"]

    J1 --> K{credit card AND<br/>any billing field filled?}
    J2 --> K
    K -->|no| L[Done — list reloads]
    K -->|yes| M[POST action=set_cycle]

    M --> N{account belongs to<br/>this org and client?}
    N -->|no| N1["404 no such account<br/>(NOT 403 — must not reveal it exists)"]
    N -->|yes| O{account_type = credit?}
    O -->|no| O1[400 — a fake payment due<br/>on savings is money nobody owes]
    O -->|yes| P["readApr converts 24.99 to 0.2499<br/>ONE conversion, in the store"]
    P --> Q["UPSERT account_statement_cycles<br/>ON CONFLICT bank_account_id"]
    Q --> L
```

**Traced in:** `api/banking/accounts.mjs:135-215`, `src/banking/accounts.mjs`,
`src/tradelines/index.mjs:51` (`readApr`), `db/migrations/096_account_statement_cycles.sql`.

---

## Filling the screen with test accounts

```mermaid
flowchart TD
    A[Owner presses Add test accounts] --> B[POST action=import]
    B --> C{requireRole FINANCE}
    C -->|no| C1[403]
    C -->|yes| D[bankingProviderName from env]

    D --> E{BANKING_PROVIDER}
    E -->|unset or 'mock'| F[mock provider]
    E -->|'plaid'| G[plaid provider]
    E -->|anything else| E1["503 unknown_provider<br/>FAILS CLOSED — does NOT fall back to mock"]

    G --> G1["returns not_implemented<br/>DELIBERATE empty seam<br/>gated on SOC 2 + compliance + a human"]

    F --> H[ensureItem: find or create<br/>plaid_items row<br/>consent_granted_at LEFT NULL]
    H --> I["getAccounts seeded from the item id<br/>same id, byte-identical accounts, forever"]
    I --> J[7 accounts: 2 business, 2 personal,<br/>2 cards, 1 brokerage]

    J --> K["UPSERT bank_accounts<br/>ON CONFLICT plaid_item_id, plaid_account_id"]
    K --> K1["entity_kind NEVER written<br/>every row stays 'unknown'"]
    K1 --> L[UPSERT statement cycles for the 2 cards]
    L --> M[DELETE then INSERT holdings]
    M --> N{per transaction}
    N -->|amount = 0 or no posted date| N1["DROPPED and COUNTED<br/>085's CHECKs would reject it"]
    N -->|ok| N2["UPSERT bank_transactions<br/>NEGATIVE = money out"]
    N2 --> O[Counts returned, list reloads]
    N1 --> O
```

**Traced in:** `src/banking/import.mjs`, `src/banking/provider.mjs`,
`src/banking/mock.mjs`, `db/migrations/085_bank_transactions.sql`.

---

## Gaps found while tracing

These are facts about the code, not opinions about it.

1. **`bank_transactions` has no foreign key to `bank_accounts`.** The column comment
   says the table "does not exist in this repo", but `081_bank_accounts.sql` created
   it. Combined with `client_id ON DELETE SET NULL`, a deleted client leaves
   transactions with no route back to the person and no route to the account. Assigned
   to W4.

2. **`api/read/banking-surface.mjs` is not org-scoped.** It filters on `client_id`
   only. The new endpoint added here IS org-scoped; the older one next to it is not.

3. **Going live is an env change for the SEAM, not for Plaid itself.** Setting
   `BANKING_PROVIDER=plaid` switches which module answers in zero lines of code.
   `plaid.mjs`'s `linkAccount()` and `getAccounts()` still return `not_implemented` by
   design, gated on a SOC 2 review, a compliance-approved consent flow and a human
   decision. The seam is free to switch; the thing it switches to is unbuilt on purpose.

4. `UNVERIFIED` — how the owner reaches a client's `client_id` in the first place. The
   screen links to the Client Control Panel, but the path from that screen to a
   copyable id was not traced.
