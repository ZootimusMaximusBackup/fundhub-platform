# T16 — Database and security. What I found and what I fixed.

Written for a reader who does not read code.

Branch `fix/T16-db-security`, cut from `origin/main` at `d3fb2c7`.

---

## The short version

Two real things were broken. Both are fixed.

1. **The credit-dispute feature had nowhere to read or write.** Six tables
   were locked shut against the app. Not slow, not buggy — shut. And the lock
   is silent: a locked-out read looks exactly like an empty table, so nothing
   ever complained.
2. **Deleting a demo client failed and left the client behind** — after
   destroying that client's own emails, credit results and bank rows first.

Four more findings turned out to be **not what the audit thought**, and I have
corrected them below rather than "fixing" something that was never wrong.

One finding is real, large, and **deliberately left alone** because it is your
call, not mine: 147 tables let any app connection read every client's file.

---

## What I changed

| File | What it does |
|---|---|
| `db/migrations/200_dispute_rls_policies.sql` | Unlocks the six credit-dispute tables, and writes the intended lock state down so a test database and the live one finally describe the same thing |
| `db/migrations/201_no_bare_rls_sweep.sql` | The standing net. Runs at every deploy and repairs any table that gets locked shut the same way |
| `db/migrations/202_client_fk_indexes.sql` | Indexes 23 columns that point at a client and had no index. This is what made deleting a client slow enough to time out |
| `src/demo/simulate-client.mjs` | The delete now asks the database which tables can block it, does the whole job in one go, and says which table refused if one does |
| `api/demo/simulate.mjs` | When a delete fails, the answer now names the table that refused |
| `src/security/rls-shape.test.mjs` | New guard: no table may be locked shut |
| `src/demo/simulate-client.pg.test.mjs` | New test: a demo client that has been *used* must delete completely |
| `src/http/demo-simulate.pg.test.mjs` | New test: the delete button itself, end to end |
| `db/expected-migrations.mjs` | Regenerated, not hand-edited |

---

## Item by item

Key: **FIXED** · **CONFIRMED WORKS** (was already fine, left alone) ·
**CORRECTED** (the audit's description was wrong) · **YOURS TO DECIDE** ·
**REPORTED** (real, but not mine to fix)

### T16-02 · Deleting a demo client failed and left 14 rows behind — **FIXED**

Proof: `db/teardown-old-vs-new.json`

I built the same situation the live client was in — a demo client that had been
used, carrying five activity records (three queued messages, a contract sent, a
contract signed) — and ran the old code and the new code against it.

* **Old code:** error, 28ms. Left behind: the client, and its 5 activity
  records. Already destroyed: its credit results, its 4 credit lines, its bank
  account. That is the whole bug in one line — *the client survives, the
  client's data does not.*
* **New code:** clean, 24ms. Nothing left anywhere.

Why it happened: 67 things in the database point at a client. 16 of them refuse
to let a client be deleted while they still hold a row. The old delete list was
typed out by hand and named 3 of those 16. It also hid the error on every step
except the last, so the only thing that ever complained was the client itself —
the one table that was not the problem.

The new version asks the database which tables can block it, instead of relying
on a list someone has to remember to update. This is the third time that list
had drifted behind the schema.

### T16-04 · Six credit-dispute tables were locked shut — **FIXED**

Proof: `db/dispute-lock-before-after.json`, `db/sandbox-migration-proof.json`

Measured three ways in a copy of the real schema:

| State | What the owner sees | What the app sees | Can the app write? |
|---|---|---|---|
| Fixed (migration 200) | 5 rows | **5 rows** | yes |
| Broken (live today) | 6 rows | **0 rows** | **no — refused** |
| After the standing sweep repaired it unaided | 6 rows | **6 rows** | yes |

The middle row is live right now. Note the app sees *zero*, not an error. That
is why this sat undetected: it is indistinguishable from an empty table.

Why no test caught it: the lock was switched on from the Supabase dashboard, not
in a migration file. The test database is built from the migration files, so in
testing those tables come up unlocked and every check passes. The fix writes the
intended state into a file, so the two finally match.

### T16-05 · 147 tables let one login read every client — **YOURS TO DECIDE**

Confirmed exactly: of 175 tables, 147 have an "allow all" rule, 21 have a real
partner check, 6 were locked shut (now fixed), 1 is read-only.

I did **not** change this, on purpose. It is not a defect — it is how the
product was built. Client separation is done in the app, not the database. And
locking down six tables while client files, documents and credit reports stay
open would buy nothing.

What it means in plain terms: if the single app password leaked, whoever had it
could read every client row. Changing that is a decision about the product, and
it is yours.

### T16-06 · 18 bank rows point at nobody — **CORRECTED. Not a defect.**

Proof: `db/bank_transactions.json`

The audit read this as data loss. It is the opposite — it is the safety net
working. Those rows belonged to demo clients that were deleted. The database is
built to detach such a row rather than delete it, so it detached them. A second
column on the same rows still records who they belonged to, so nothing was
actually lost.

Nothing to fix. Related improvement: the new delete now removes these rows for
demo clients instead of leaving them detached, so demo cleanup will not add to
this pile again.

### T16-07 · Four marketing tables refuse the app — **REPORTED, correctly closed**

Proof: `db/marketing_schema.json`

Confirmed, but the reason is different from the audit's. The app is not blocked
by a row lock — it has no access to that whole area at all. That is a stronger,
cleaner boundary. No screen reads these tables. Nothing to fix; opening them up
would be a new decision, not a repair.

### T16-08 · Sign-in and file-storage areas never checked — **NOW CHECKED. Safe.**

Proof: `db/other_schemas.json`

This was the one item nobody had ever looked at. I looked. There are 23 sign-in
tables and 8 file-storage tables. **The app cannot reach any of them** — all 31
attempts were refused at the door. No row data was read. Zero exposure.

### T16-09 · True row counts behind the lock — **STILL UNKNOWN, on purpose**

Reading behind the lock needs the database owner account. The app account is
deliberately not an owner and must never be. I did not try to get around that.
Once migration 200 is live the counts are simply readable — no special access
needed. That is a better answer than a workaround.

### T16-10 · Two migration records with no file — **CORRECTED. Harmless.**

Both are renames from earlier work. Nothing is unapplied.

One correction worth having: **162 migrations have been applied, not 176.** 176
is the highest file *number*, which was being read as a count.

### T16-11 · Eleven unused tables — **CONFIRMED, nothing to do**

Nine of the eleven are never touched by the running site; six are both empty and
unreferenced. They are harmless. Removing tables is a data-deleting change and
therefore yours to approve, not mine to make.

### T16-01, T16-12, T16-13 · **CONFIRMED WORKS** — verified, not broken

* An older deleted demo client left nothing behind anywhere.
* The site connects with a limited account that cannot skip row locks.
* No record points at a parent that no longer exists — **483** foreign keys
  checked, every one, zero orphans, nothing timed out. (The audit said 486; the
  real number is 483.)

### T16-22 · 300 legacy fields, 17 used — **CONFIRMED, and worse than reported**

Proof: `db/custom_fields.json`

It is a table with one column per field, not a list. 305 fields defined, and
only **11 have ever been filled in** — 294 have never held a value.

Two things the audit did not mention:

* There are **two** parallel custom-field systems. The other one holds 84
  different keys and is used on 40 of 46 clients.
* Two of the unused columns are named for a **Social Security number** and an
  employer ID number. Both are empty today. I counted them and did not read
  them. You should know they exist.

### T16-23 · Demo work not marked as demo — **CORRECTED, and broader**

The specific record the audit named does not exist. But the underlying problem
is real and bigger: **61 records across 7 tables** are work done on demo clients
without being marked demo — 29 activity records, 21 tasks, 4 credit lines, 2
documents and 5 others.

Not mine to fix (the code that writes them belongs to other threads), but the
new delete handles them correctly on the way out.

---

## What is not proven yet, and why

**The three migrations are not on the live database yet.** They apply
themselves the moment you merge — the deploy runs them automatically.

I could not apply them early. The admin database password is stored as a secret
on Netlify, which means it is masked when read back, so I cannot get at it. I
did not try to work around that. Instead I proved all three in a full copy of
the real schema, built by the same script the deploy uses.

**One live client is still stuck.** `cb6f5839-…`, a demo client, is still
sitting there with 13 leftover records. Removing it means deleting rows from the
live database, which I am not permitted to do without your say-so. Once the fix
deploys, pressing delete on it will simply work.

---

## The live-site items (re-walked on fundhub.ai today)

### T16-14 · No data door for a stranger — **CONFIRMED WORKS**

Proof: `http/07-unsigned-sweep.json`

171 routes probed with no login at all. Four came back with anything: the login
page, the health check, and the two climate pages. Everything else refused —
113 said "not signed in", 51 said "wrong method", the rest errored cleanly.
**Zero routes handed out data.**

### T16-16 · No live keys in the code or in the pages — **CONFIRMED WORKS**

Proof: `http/11-secrets-live.json`, `http/12-repo-visibility.json`

Every page script the browser downloads was fetched and scanned for 15 shapes of
password and key. **Nothing found.** One match on the *name* `DATABASE_URL`
turned out to be a word in a comment explaining what the setting does — the name,
never a value. 4,324 tracked files in the repository were scanned the same way.
No matched value was recorded anywhere, by design.

### T16-17 · The code repository is public — **CONFIRMED. Your call.**

`github.com/ZootimusMaximusBackup/fundhub-platform` is **PUBLIC**. Anyone on the
internet can read every file.

The good news from the item above: no key, password or customer record is sitting
in those files. So this is not an emergency. But every business rule, every table
name and every screen is readable by anyone who looks. Making it private is one
click and breaks nothing. It is your decision, and I have not touched it.

### T16-18, 19, 20, 21 · Doors left open behind deleted screens — **CONFIRMED STILL BROKEN**

Proof: `http/09-targeted-four.json`

All four reproduce today. Three screens were deleted but their back doors are
still live:

* a **closer** can still pull the company finance figures
* a **sales** person can still ask for a client's billing
* a **closer** can still read the AI bureau settings
* an **affiliate** hitting a staff screen is told "you are signed out" instead of
  "you do not have permission" — no data leaks, but it will be reported as a
  broken login

None of these files belong to this thread. Each is a one-line permission fix, and
I have written all four up on the fix board with the exact route and role.

### T16-03 · Documents shows the wrong client — **CONFIRMED, and worse than reported**

Proof: `http/04-documents-test-client.json`, `05-documents-demo-client.json`,
`04b-documents-api-filter-check.json`

The audit said the screen shows "a different client's file". It is broader than
that. **The screen never asks for a client at all.** Whichever client you open it
for, it asks for every document in the company and shows all of them — the same
11 rows both times, the real customer's paperwork included.

The back end is fine; it does filter by client when asked. **The screen just
never asks.** That is a one-line fix in the page, and I have written it up for the
thread that owns that file.

### T16-15 · Client portal cross-file check — **COULD NOT TEST. Honest gap.**

Proof: `http/10-portal-idor.json`

To test whether a signed-in client can peek at another client's file, you must
first sign in as a client. **The `client@fundhub.ai` test account does not work on
the live site** — it is refused with "invalid credentials" using the same password
that signs in all six staff roles. The other way in is an emailed sign-in link,
which this batch forbids.

This is not new: a verification run on 2026-08-16 already recorded the same
failure. **The client test account has been unusable on production for at least
three days**, which means nobody has been able to test anything from a client's
point of view in that time. That is worth fixing on its own.

I did not guess at a result. The item stays open.
