# Journey changelog

Newest at top. One line per journey change:

```
YYYY-MM-DD | <journey> | <what changed> | <why> | <commit>
```

2026-07-31 | client | Added the soft-pull consent segment to a NEW client-actual.md — capture, revoke, and the gate on requestSoftPull | Migration 099 made consent a real record instead of a CRM text field; the flow had no diagram because docs/journeys/ did not exist | (this commit)

---

## Standing finding — the tracked journeys have no files

This changelog and `client-actual.md` are the first files in `docs/journeys/`.
Before this commit the directory did not exist.

None of the eight tracked journeys — `client`, `role-owner`,
`role-sales-manager`, `role-closer`, `role-funding-advisor`,
`role-inquiry-remover`, `affiliate`, `white-label` — has an `-intended.md`.

CLAUDE.md §4 says agents do not author intended journeys, so none was written.
The consequence is that `client-actual.md` has nothing to be diffed against:
**for every flow in this system, the gap between what should happen and what
does happen is currently unmeasured.** Closing that needs a human to write the
intended files.
