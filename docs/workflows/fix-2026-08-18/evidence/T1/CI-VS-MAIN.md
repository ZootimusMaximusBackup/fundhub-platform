# T1 — is this branch worse than main? No. Compared job by job, name by name.

CI on `main` is already red. So "red" is not the question — the question is whether this
branch fails *anything main does not*. It does not. Every failure below appears on both,
with the same name.

Compared: **main @ `c860b8ce`** (run `32221519465`) — the exact commit this branch was cut
from — against **`fix/T1-client-portal-video`** (run `32249256937`).

| Job | main @ c860b8c | this branch | verdict |
|---|---|---|---|
| suite (no database) | 5843 tests · 5838 pass · **2 fail** | 5864 tests · 5859 pass · **2 fail** | **same two.** 21 tests added, all passing |
| suite (real Postgres — reports, does not block) | partner-isolation set fails | same set, same names | **same** |
| screens (real browser) | **22 failed · 192 passed** | **22 failed · 192 passed** | **identical** |
| Netlify deploy preview | — | **pass** | — |

## The two no-database failures, on both

1. `*** no route's gate is left unverified ***` — `scripts/journeys/generate.test.mjs`
   Same two entries on both, and **no third was added by this branch**:
   - `finance/crs-pull: a gate is referenced but its shape was not recognised`
   - `gifts/message-blaster: a gate is referenced but its shape was not recognised`
   This mattered: the new route's gate had to be written in a shape the journey extractor
   recognises, or it would have become a third entry.
2. `an endpoint excused from the org filter still passes the session's org to its store`
   — `src/http/read-endpoints-org-scope.test.mjs`, `company-brain-affiliate.mjs`. Untouched here.

## The browser job, on both

22 failed / 192 passed, same names — messaging inbox (3), closer dashboard (1), sidebar roles (2)
and the rest. None is a screen this branch changed.

## One gate that cannot pass, and never could

`npx tsc --noEmit` exits 1 because **there is no `tsconfig.json` anywhere in this repo**. With no
project and no file arguments it prints its own help text and exits 1, having type-checked nothing.
It is listed in CLAUDE.md §6 and has presumably never actually run. Not caused here and not fixable
from inside this thread — adding a tsconfig is a repo-wide change.
