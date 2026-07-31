# role-owner — ACTUAL

Generated from code, not from a spec and not from memory. Every box below was
traced to a file and a function; anything that could not be traced is marked
`UNVERIFIED` and is drawn as such rather than assumed.

**Scope of this file, stated plainly.** This documents ONE flow inside the owner
journey: opening the **Money Map** for a client. It is the only flow this
workflow built or read end to end. The rest of the owner journey — sign-in,
pipeline, campaigns, hiring, commissions — is **not documented here**, because
tracing it was not part of this unit and drawing it from assumption would be
worse than leaving it out.

**There is no `role-owner-intended.md`.** `docs/journeys/` did not exist before
this file. That means there is no hand-authored statement of what *should*
happen to check this against, so no gap between intended and actual can be
reported — the intended side is simply absent. Per CLAUDE.md §4 the intended
file is hand-authored and agents do not write it, so this workflow did not
create one.

---

## Money Map — opening a client's money picture

```mermaid
flowchart TD
    A[Owner clicks Money Map in the sidebar] --> B[public/app/money-map.html loads]
    B --> C{shell.js gate:<br/>is money-map.html in ALL<br/>and allowed for this role?}
    C -->|no| C1[Bounced to the role's home screen]
    C -->|yes| D{Is client_id in the address bar?}

    D -->|no| D1[Page prints: open this with a client<br/>NO sample numbers are drawn]
    D -->|yes| E[FHData.read money-map<br/>public/app/data.js]

    E --> F{localStorage fh_demo = 1?}
    F -->|yes| F1[data.js refuses the read<br/>source: demo<br/>Page prints how to clear the flag]
    F -->|no| G[GET /api/read/money-map<br/>client_id, days, amount]

    G --> H[netlify/functions/api.mjs<br/>ROUTES read/money-map]
    H --> I{requireAuth<br/>valid session?}
    I -->|no| I1[401 unauthorized<br/>Page prints: not signed in]
    I -->|auth check itself failed| I2[503 db down<br/>Page prints: database did not answer]
    I -->|yes| J{requireRole ROLE_SETS.STAFF}

    J -->|no| J1[403 forbidden<br/>no query is run]
    J -->|yes| K{staff.org_id present?}
    K -->|no| K1[403 no_org_scope<br/>FAILS CLOSED<br/>no query is run]
    K -->|yes| L{client_id a uuid?<br/>days 1..365?<br/>amount >= 0?}

    L -->|no| L1[400 with the reason<br/>no query is run]
    L -->|yes| M[SELECT clients<br/>WHERE id AND org_id]

    M -->|no row| M1[404 no_such_client<br/>another org's client is<br/>indistinguishable from none]
    M -->|row| N[Five reads in parallel,<br/>each filtered on client_id AND org_id]

    N --> N1[tradelines]
    N --> N2[card_liabilities]
    N --> N3[bank_accounts]
    N --> N4[recurring_bills<br/>medium+high confidence only]
    N --> N5[cashflow_reminders<br/>due, unacknowledged]

    N1 & N2 & N3 & N4 & N5 --> O[moneyMap<br/>src/finance/money-map.mjs]
    O --> P[200 with the payload]
    P --> Q[money-map.html renders]
```

### What the assembler does, and which module owns each answer

```mermaid
flowchart TD
    O[moneyMap<br/>src/finance/money-map.mjs] --> S1[Payment due dates]
    O --> S2[Repeating bills]
    O --> S3[Cash flow]
    O --> S4[Bank balances]
    O --> S5[Utilization]
    O --> S6[What needs attention]
    O --> S7[Funding]

    S1 --> S1a[card_liabilities joined to tradelines<br/>on tradeline_id]
    S1a --> S1b{Card has a liability row?}
    S1b -->|no| S1c[Shown, counted, marked<br/>no statement on file]
    S1b -->|yes| S1d{payment_due_date reported?}
    S1d -->|no| S1e[Em dash + the file did not report one]
    S1d -->|yes| S1f[Date + days until due<br/>past date raises an overdue alert]
    S1a --> S1g[Total minimums via sumKnown<br/>a card with no minimum makes it a FLOOR]

    S2 --> S2a[billRowToDetected per row]
    S2a --> S2b[toCashflowBills<br/>src/banking/cashflow-seam.mjs]
    S2b --> S2c{next_expected_on set?}
    S2c -->|no| S2d[Zero occurrences<br/>the detector's reason string is printed]
    S2c -->|yes| S2e[Dated occurrences inside the window]

    S3 --> S3a{Any OPEN depository account?}
    S3a -->|no| S3b[Refused: NO_DEPOSITORY_ACCOUNTS<br/>a credit line is not cash]
    S3a -->|yes| S3c{Every balance known?}
    S3c -->|no| S3d[Refused: UNKNOWN_BALANCE<br/>an unknown balance is not zero]
    S3c -->|yes| S3e[project<br/>src/banking/cashflow.mjs]
    S3e --> S3f[Day by day: in, out committed,<br/>out unconfirmed, closing, worst case]
    S3e --> S3g[Blind spots: a card due with<br/>no minimum reported]

    S4 --> S4a[bankingSurface<br/>src/finance/banking-surface.mjs]
    S4a --> S4b[Personal / Business / Unclassified<br/>NO combined total, by construction]

    S5 --> S5a[evaluateUtilization<br/>src/alerts/evaluate.mjs]
    S5 --> S5b[financeOsGrid utilization row<br/>src/finance/os-grid.mjs]
    S5 --> S5c[calcFunding guardrail<br/>only when an amount was asked for]
    S5a & S5b & S5c --> S5d[Each line carries engine + engine_label<br/>the screen prints which one said what]

    S6 --> S6a[Stored rows from cashflow_reminders]
    S6 --> S6b[Outflows the projection placed on days]
    S6 --> S6c[Cards past their due date]
    S6 --> S6d[The alerts engine's over-threshold verdict]
    S6a & S6b & S6c & S6d --> S6e[One list, every row naming its engine]

    S7 --> S7a[toCalculatorCards → calcFunding<br/>src/calculators/deal-funding.mjs]
    S7a --> S7b{Any card with an unknown balance?}
    S7b -->|yes| S7c[Caveat printed: headroom is OVERSTATED,<br/>calcFunding reads unknown as zero]
    S7a --> S7d[Grid's conservative available shown alongside]
```

### Refusals, in one place

Every one of these is a real branch in the code, not a defensive comment.

| where | condition | what the person sees |
|---|---|---|
| `public/app/shell.js` | screen not in `ALL`, or not allowed for the role | bounced to the role's home |
| `public/app/money-map.html` | no `client_id` in the URL | a sentence asking for one. **No sample numbers.** |
| `public/app/data.js` | `localStorage.fh_demo === "1"` | "you are in demo mode", with the command to clear it |
| `api/read/money-map.mjs` | method is not GET | 405 + `allow: GET` |
| `src/http/middleware/requireAuth.mjs` | no or bad session | 401 |
| `src/http/middleware/requireAuth.mjs` | the auth check itself failed | 503 `db: down` |
| `src/http/read-api.mjs` `requireRole` | role outside `ROLE_SETS.STAFF` | 403, no query run |
| `api/read/money-map.mjs` | session has no `org_id` | 403 `no_org_scope`, no query run |
| `api/read/money-map.mjs` | `client_id` not a uuid / bad `days` / bad `amount` | 400, no query run |
| `api/read/money-map.mjs` | client not in the session's org | 404 `no_such_client` |
| `src/finance/money-map.mjs` | no open depository account | cash-flow section says why; other sections still render |
| `src/banking/cashflow.mjs` `project()` | any supplied balance unknown | cash-flow section says why; other sections still render |
| `src/banking/cashflow-seam.mjs` | a bill has no confident next date | bill listed, not placed on the calendar, reason printed |

### Not traced by this workflow — UNVERIFIED

```mermaid
flowchart LR
    U1[Owner sign-in] -.->|UNVERIFIED| U2[Command Center]
    U2 -.->|UNVERIFIED| U3[Pipeline]
    U2 -.->|UNVERIFIED| U4[Client Control Panel]
    U4 --> M[Money Map — traced above]
    U2 -.->|UNVERIFIED| U5[Campaigns / Hiring / Commissions]
```

These paths exist as screens and links in `public/app/`, but this workflow did
not read the code behind them, so they are drawn as unverified rather than
described. Do not treat the dotted edges as documentation.

### Nothing on this flow transmits

The Money Map is read-only. It runs `SELECT` statements and nothing else — no
`INSERT`, no `UPDATE`, no outbound `fetch`. Reading a reminder does not mark it
delivered; there is no `surfaced_at` stamp anywhere in this path.
