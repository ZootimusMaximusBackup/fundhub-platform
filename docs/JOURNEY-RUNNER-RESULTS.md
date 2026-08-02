# Journey Runner — first run against the real database

Run date: 2026-08-02
Database: the live production database (Supabase project `oqpnlusrotpxfenysfxz`), one company in it — `Fundhub`.
Nothing was written or kept. Every check ran inside a database transaction that was undone right after, and a check afterward confirmed zero test records were left behind.

**This is the first time anyone has pointed this tool at the real database.** It found real problems — both in the app and in the checking tool itself.

---

## The headline

**The Journey Runner cannot finish a single check against the real database. It crashes on every single journey it knows about, every time.**

Nobody could have seen this before today, because the checker's own automated tests use a pretend, fake database that doesn't complain the way a real one does.

Below that first, unavoidable crash, we found four more things by working around it enough to look further:

1. A checker inside the tool asks the database for a table that doesn't exist.
2. Because of how the tool is written, that one wrong table name also breaks two other checks that would otherwise be fine.
3. Some of the journeys reference each other by name, and those names don't match — so those handoffs can never be checked.
4. Six of the eight journeys this app is supposed to track are missing their "what should happen" write-up entirely.

Plain detail on each below.

---

## 1. The crash that stops every check

**What happens:** every one of the 6 journeys the tool knows about (`client`, `setter`, `closer`, `advisor`, `affiliate`, `partner`) fails with the same kind of error:

```
error: date/time field value out of range: "1767399600000"
```

**What this means in plain terms:** partway through checking a journey, the tool tries to look at the "messages waiting to be sent" queue. To do that, it hands the database a timestamp — but it hands it over as a raw number (like `1767399600000`) instead of a real date. The database doesn't understand that number as a date and refuses it. This happens on every journey, right after the first message-sending step, so the tool never gets far enough to tell us anything else about that journey.

**Where the bug lives:** `src/journeys/runner/index.mjs`, in the part that drains the message queue, hands off to `src/messaging/dispatch.mjs`. The queue-checking code accepts either a real date or a "clock function" that returns the current time; the journey tool passes it a clock function, but that clock function returns a plain number of milliseconds, not something the database can read as a date.

**Why the automated test suite never caught this:** the tool's own tests (`src/journeys/runner/index.test.mjs`) run against a pretend, in-memory fake database, not a real one. A fake database doesn't check that a date is a real date — a real one does. So this bug has been sitting there, invisible, until today's run against the real thing.

**Impact:** the Journey Runner has never successfully produced a real report against production data. Everything the tool is supposed to tell us — which messages would go out, which automated workflows actually fire, which ones nothing ever reaches — is currently unknowable, because the tool breaks before it gets there.

---

## 2. A checker inside the tool is looking for the wrong database table

Working around the crash above (by skipping the message-queue step) let us run the tool's other checks — the ones that compare what a journey says should happen against what the database actually holds. One of those checks failed instantly:

```
relation "stages" does not exist
```

**What this means:** the checking tool asks the database for a table named `stages`. That table does not exist. The real table is named `pipeline_stages`.

**How we know this is a genuine bug and not a data problem:** every other part of the real app — the hiring pipeline, the sales pipeline dashboard, the card-stacking workflow — already correctly uses `pipeline_stages`. Only this one file, the journey checker itself (`src/journeys/runner/facts.mjs`, line 125), still says `stages`.

**A second, worse effect of this one typo:** the checking tool runs five database questions at once, sharing one open conversation with the database. Once the `stages` question fails, the database refuses to answer any of the other questions asked in that same conversation — even though those other questions are perfectly fine on their own. We proved this by asking the "do our automated agents exist" and "do our message templates exist" questions by themselves: both work fine (22 agents found, 5 message templates found). But run through the tool as written, both come back as "could not check" — not because anything is wrong with agents or templates, but because the `stages` typo poisoned the whole batch of questions.

**Net effect:** roughly half of the tool's "could not check" results (24 out of 46) trace back to this one wrong table name, not to 24 separate real problems.

---

## 3. Journeys refer to each other, and the names don't line up

Some steps say "hand this off to the closer journey" or "hand this off to the setter journey." Most of those resolve correctly. Two do not — they reference something that isn't one of the six journeys the tool tracks at all:

- **Closer journey**, step "Attach the dispute letters" — refers to "Optimization rounds," which is not one of the six journeys.
- **Advisor journey**, step "Mark it funded" — refers to "Owner revenue roll-up," which is not one of the six journeys.

**What this means:** there is no way, with the tool as it exists today, to check whether those two handoffs actually go anywhere in the code. They may be fine, or they may be dead ends — nobody can tell from this tool.

Separately: every handoff between journeys is written as a sentence ("hands to the closer journey at stage 'Call Assigned'; that journey starts 'A booked call is assigned to you'"). The tool cannot match sentences to each other automatically, so it flags all four cross-journey handoffs as "could not check" even where the destination journey is real. That's a limit of the tool, not a sign anything is broken.

---

## 4. The journey key names don't match the journey documentation folder

The checking tool knows six journeys, using these internal names: `client`, `setter`, `closer`, `advisor`, `affiliate`, `partner`.

The documentation folder this company keeps (`docs/journeys/`) tracks **eight** journeys, using different names: `client`, `role-owner`, `role-sales-manager`, `role-closer`, `role-funding-advisor`, `role-inquiry-remover`, `affiliate`, `white-label`.

Only two names match exactly (`client`, `affiliate`). The rest appear to be the same real-world roles under different names (`setter` ≈ `role-sales-manager`, `closer` ≈ `role-closer`, `advisor` ≈ `role-funding-advisor`, `partner` ≈ `white-label`) — but two documented journeys, `role-owner` and `role-inquiry-remover`, have no matching entry in the checking tool at all. The tool cannot check them, ever, as it's currently written.

**Also found:** the documentation folder is supposed to hold two files per journey — a hand-written "what should happen" file and a generated "what actually happens" file. Only the generated files exist. Not one hand-written "what should happen" file exists for any of the eight journeys, tracked or not:

```
docs/journeys/
  CHANGELOG.md
  README.md
  affiliate-actual.md
  client-actual.md
  role-closer-actual.md
  role-funding-advisor-actual.md
  role-inquiry-remover-actual.md
  role-owner-actual.md
  role-sales-manager-actual.md
  white-label-actual.md
```

Without a "what should happen" file, there is nothing to compare "what actually happens" against for any journey — the two-file system this company set up for itself isn't being used the way it was designed.

---

## Other things this run turned up

- **No journey has ever been built in the real editor.** The `journeys` database table has zero rows for this company. Every journey the tool checked came from a hardcoded example built into the code (`src/journeys/seed-journeys.mjs`), not from anything a person configured. This is expected behavior for the tool (it says so plainly when this happens), but it's worth knowing: nobody has used the journey editor in production yet.
- **A payment step depends on a secret that isn't set.** Both the `client` and `closer` journeys have a "take the $32 diagnostic payment" step that routes through the Commas/Payva payment adapter. The adapter code exists, but its required secret (`COMMAS_WEBHOOK_SECRET`) is not set in this environment, so that adapter "fails closed" — meaning it refuses to run rather than doing something unsafe. This may be intentional for a staging-style check, or it may mean this payment step genuinely can't fire right now — only the owner would know which.
- **27 of 31 staff screens are never named by any journey step.** This is not necessarily a bug — plenty of internal tools (admin panels, the journey editor itself, the automations page) aren't meant to be part of a client- or staff-facing journey. Listed here as raw fact, not a finding, per this tool's own rule that "no journey touches this screen" and "this screen is broken" are different things.
- **The `messages` table is empty in production** — zero rows. Matches what the code's own comments say: nothing has ever triggered the message-sending queue in this environment yet.

---

## A caveat on how this run connected to the database

This run connected to the database as the `postgres` superuser — the same connection string given to us to run this check. The real, deployed app connects with a more restricted account (`fundhub_app`) that has row-level security turned on, which limits what any one company can see of another's data. Connecting as the superuser skips that restriction entirely.

**What that means:** nothing found above is about row-level security — this run couldn't have caught a security-permission bug even if one existed, because the connection we used doesn't have that restriction switched on in the first place. Every finding above is about the app's own logic, not about who's allowed to see what.

---

## Full counts, for reference

- Journeys the tool knows about and walked: 6 (all 6 crashed on the message-queue step)
- Automated workflows registered in the code: 49 (all 49 loaded fine — none were "registered but missing")
- Checks the tool could run comparing journeys to the database (after working around the crash): 88 total
  - 14 confirmed working as described
  - 11 confirmed broken/mismatched (see list below)
  - 46 could not be checked (24 of these trace to the single wrong-table-name bug above)
  - 17 are house rules written in plain English on the journeys — not judged, just listed

**The 11 confirmed mismatches:**

| Journey | Step | What's wrong |
|---|---|---|
| client | Give the lead to a setter | No screen in the app answers to "Setter queue" |
| client | Move them to Survey Complete | No screen answers to "Sales board" |
| client | Move them to Booked | No screen answers to "Sales board" |
| client | Hand the call to a closer | No screen answers to "Pre-call panel" |
| client | Take the $32 diagnostic | Payment adapter's secret isn't set (see above) |
| client | Run UnderwriteIQ | No screen answers to "Closer result screen" |
| setter | Move them to Booked | No screen answers to "Sales board" |
| closer | Load the pre-call panel | No screen answers to "Pre-call panel" |
| closer | Take the $32 on the call | Same payment adapter secret issue |
| advisor | Mark it funded | No screen answers to "Client finance dashboard" |
| affiliate | Send their link | Journey step names a screen that says "not built yet" |

---

## What we did NOT do

This was a look-only pass. Nothing was fixed:
- The bad-timestamp crash in the message-queue check
- The wrong table name (`stages` vs `pipeline_stages`)
- The mismatched journey names
- The missing "what should happen" journey files
- The unset payment secret

All five are candidates for follow-up work, in this order of urgency: the crash first (it blocks the tool from ever producing a usable report), then the wrong table name (it's a one-word fix with an outsized effect), then the rest.
