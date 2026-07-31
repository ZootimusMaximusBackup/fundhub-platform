# Journey changelog

One line per journey change, newest at top. Format:

```
YYYY-MM-DD | <journey> | <what changed> | <why> | <commit>
```

This is the human-readable record. It is kept honest — including when a change
made a journey worse.

---

2026-07-31 | banking | New journey. `banking-actual.md` added: connecting a bank, reading balances, classifying an account, who may reach it, and what never leaves the platform. | W5 built bank linking, and `CLAUDE.md` §6 requires the actual-journey diagram in the same commit as the code. This is the first file in `docs/journeys/` — the directory did not exist. | 0c85121+

---

## Two things a reader should know about this file

**It starts here, not at the beginning.** `docs/journeys/` did not exist before
2026-07-31. `CLAUDE.md` §4 describes the whole system — `-intended.md` /
`-actual.md` pairs for eight named journeys, and this changelog — and none of it
was in the repository. The eight journeys named there (client, role-owner,
role-sales-manager, role-closer, role-funding-advisor, role-inquiry-remover,
affiliate, white-label) have no files of either kind. Nothing was back-filled for
them: an `-actual.md` has to be traced out of code, and inventing eight of them
from assumption is exactly what §4 forbids.

**`banking` has no `-intended.md`, so no gap check has been run on it.** The
intended journey is hand-authored and agents do not write those. Until one
exists, `banking-actual.md` describes what the code does with nothing to compare
it against — which means it can be accurate and still be describing the wrong
thing.
