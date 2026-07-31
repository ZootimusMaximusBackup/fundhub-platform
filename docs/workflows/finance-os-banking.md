# finance-os-banking

Shared board for the finance-os-banking batch. Each workflow claims its task
here, writes its manifest here when done, and reads this file before starting.

This file did not exist when W10 ran; W10 created it and wrote the first entry.
Other workflows in this batch should append their own `## W<n>` heading below
rather than editing anyone else's.

## W10

**Task:** the banking surface — tiles for linked accounts, cards, bills and
payment timing. `status: blocked`

**Blocked on:** W5, W6, W7 and W8 have not merged to `main`. Nothing they were
meant to build exists anywhere in this repository.

### Why this workflow stopped instead of starting

W10 was split out precisely so that the screen is built against real columns.
Its own brief says: *"building tiles against tables that do not exist is the
exact failure this workflow was split out to avoid."* The gate check failed, so
W10 stopped at the gate. No code was written.

### What the gate check found

Checked against a freshly fetched `origin/main` (`4830465`). The local
`origin/main` ref was stale at first — it pointed at `e354ebe` — so the check
was re-run after `git fetch origin main`. Both the stale and the fresh ref give
the same answer.

| Expected by the brief | Actually in the repo |
|---|---|
| Migrations `080`–`087` | Absent. Migrations stop at `067_mail_response_idempotency.sql`. 38 files in `db/migrations/`, none numbered `07x` or `08x`. |
| `bank_accounts` (081) | No such table, in any migration, schema, seed or source file. |
| `entity_kind` (082) | No such column anywhere. |
| `card_liabilities` (083) | No such table anywhere. |
| `recurring_bills` (086) | No such table anywhere. |
| `cashflow.paymentWindow()` + reminders (087) | No such module and no such function anywhere. |
| `public/app/finance-os.html` (W9's screen, which W10 extends) | Does not exist. No file matching `*finance-os*` anywhere in the tree. |
| `../fundhub-docs/sources/client-control-panel-wireframe.md` (the approved 7-row layout grammar) | Does not exist. `../fundhub-docs` is not a directory. The in-repo `fundhub-docs/sources/` holds exactly one file, `AIRTABLE-BASE-EXTRACT.md`. |
| `bank-*` branches merged to `main` | None. `git ls-remote --heads origin` returns 8 heads; none is a `bank-*`, `W5`, `W6`, `W7` or `W8` branch. The 20 most recent commits on `main` contain no banking merge. |

Search commands used, so this is reproducible:

```
git fetch origin main && git log --oneline origin/main | head -20
git ls-remote --heads origin
ls db/migrations/ | grep -E '^0[78]'
grep -r 'bank_accounts|card_liabilities|recurring_bills|entity_kind|paymentWindow'
find . -name '*finance-os*' -not -path './node_modules/*'
find . -name '*client-control-panel-wireframe*' -not -path './node_modules/*'
```

`AUDIT-FINDINGS.md` independently agrees: it records 33 migrations applying
clean and 20 app screens driven in Chromium, with no banking screen and no
banking tables among them.

### Assumptions recorded

None. W10 wrote no code, so it made no assumptions. This is deliberate. Every
assumption W10 could have recorded here would have been an invented column
name, and CLAUDE.md §2 is explicit that a missing fact is the finding, not a
gap to fill with something plausible.

The one judgement call worth naming: the brief's three-state rule for
`entity_kind` (personal / business / **unknown**, where unknown never defaults
into personal) is a real product decision and should survive whoever builds
W5–W8. It is written down here so it is not lost between now and then.

### Files touched

| File | Change |
|---|---|
| `docs/workflows/finance-os-banking.md` | New file. This board. |

No source file, migration, screen or test was touched.

### What unblocks this

W5, W6, W7 and W8 merged to `main`, carrying migrations `080`–`087`. W9's
`public/app/finance-os.html` also needs to exist, because W10 extends that
surface rather than replacing it, and the approved wireframe grammar at
`client-control-panel-wireframe.md` needs to be reachable. When those land,
re-run the gate check at the top of the W10 brief and start.
