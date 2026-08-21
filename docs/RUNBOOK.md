# Runbook — what to do when something looks broken

This page is for the moment something is wrong and you need to know what.
It does not assume you read code. Read it top to bottom, or jump to the part
that matches what you are seeing.

One thing to know before you start. Almost nothing in this system watches
itself. If the database stops answering at 2am, nothing sends an email, a text,
or a phone alert on its own. Someone finds out when they open the CRM in the
morning. [Monitoring](#monitoring) and [Alerting](#alerting) explain the one
check you can turn on in about five minutes. [What nobody is
watching](#what-nobody-is-watching) is the honest list of everything still
uncovered.

---

## The one check

Open this address in a browser:

```
https://transcendent-wisp-888771.netlify.app/api/health
```

(If the site has moved to its own web address, use that address and put
`/api/health` on the end.)

You get back a short block of text like this:

```
{"ok":true,"db":"up","state":"up","migrations":69,"expected":69,"pending":0,"error":null,"checkedAt":"..."}
```

Two words in there tell you almost everything: **`state`** and **`error`**.

---

## What the answer means

Find your `state` in this table.

| `state` says | What that means in plain words | Is the site usable? | Go to |
|---|---|---|---|
| `up` | Everything is fine. The site is running and the database has everything it needs. | Yes | — |
| `behind` | The site is running. The database is answering. But the database is **missing pieces** the new code needs. Screens will look broken even though nothing is "down". | Partly — some screens fail | [The database is behind](#the-database-is-behind) |
| `unreachable` | The site is running, but **the database is not answering**. Nothing that needs saved information will work. | No | [The database is not answering](#the-database-is-not-answering) |
| `unconfigured` | The site is running, but it was never told **where** the database is. Usually a setting got wiped, or a new deploy lost it. | No | [The site does not know where the database is](#the-site-does-not-know-where-the-database-is) |
| `error` | The database answered, but the answer was an error. Usually a permissions problem, or the very first setup never ran. | No | [The database is not answering](#the-database-is-not-answering) |
| *(a 404 page, or nothing loads at all)* | The site itself is not there, or the part that answers requests never deployed. | No | [The site is down](#the-site-is-down) |

`ok` is the same information in one word. `ok: true` means "trust this".
`ok: false` means "do not trust this" — it does **not** mean your request failed.

---

## Incident response

Start here during an outage. First work out **which** of three different
problems you have, then follow that one section. They feel identical from the
outside — screens look wrong — and the fixes have nothing in common.

**"The site is down."**
The web address does not load at all, or `/api/health` gives a 404 page instead
of the block of text above. Nothing was deployed, or the deploy broke.
→ [The site is down](#the-site-is-down)

**"The database is down."**
`/api/health` loads fine and says `unreachable`, `unconfigured`, or `error`.
The site is up. The place it keeps information is not reachable.
→ [The database is not answering](#the-database-is-not-answering)

**"The schema is behind."**
"Schema" means the shape of the database — its tables and columns.
`/api/health` says `behind`. This is the sneaky one. Every normal check passes.
The site is up. The database is up. But new code expects tables that were never
created, so any screen touching them fails while everything else works fine.
→ [The database is behind](#the-database-is-behind)

### A note on the coloured chip in the CRM

The CRM shows a small chip in the corner: **LIVE**, **NO DB**, or **NO API**.
It is useful but it is coarse. Today a `behind` database draws **NO DB**, even
though the database is answering perfectly. The words next to the chip say the
real thing — "database is behind: 51 of 69 migrations applied, 18 pending".
**When the chip and this page disagree, believe this page.**

---

### The database is behind

#### Why this happens

Changes to the database's shape are kept in numbered files. There are 69 of them
today. Each one has to be applied to the database once, in order.

**Nothing applies them automatically.** Not the deploy. There is no automated
build or test step in this project at all. Applying them is something a person
does by hand, every time new ones are added. If the code goes out and nobody
runs the command, the code is ahead of the database and screens break.

#### How to see exactly which pieces are missing

Put `?strict=1` on the end of the health address:

```
https://transcendent-wisp-888771.netlify.app/api/health?strict=1
```

The answer now includes a list called `missingMigrations` with the real file
names in it — for example `migrations/090_soft_pull_one_open_per_client.sql`.
That list is the answer to "behind by what". You do not need to do anything with
the names; the fix below applies all of them. They are there so you can tell
someone precisely what is missing.

#### The fix

A person with access to the project runs this from inside the project folder:

```
DATABASE_URL="$(netlify env:get DATABASE_URL --context production)" node db/migrate.mjs
```

It prints one line per file — `skip` for the ones already applied, a tick for
each one it applies — and ends with a count. It is safe to run more than once.
It will not redo work that is already done.

Then reload `/api/health`. It should say `up`.

**Claude cannot run this for you.** The company network blocks
`api.netlify.com` and `api.supabase.com` from the agent environment. Any attempt
fails immediately with a "403" refusal before it even connects. That is a policy
block, not a bug, and there is no way around it from there. A human on a normal
machine runs it.

#### What this does not do

It only adds. This project is **forward-only**: there is no command that undoes
a database change and no "down" files to run. That matters for
[Rollback](#rollback).

---

### The database is not answering

`state` says `unreachable` or `error`.

Try these in order. Stop when the health check goes green.

1. **Wait two minutes and reload the health address.** Hosted databases restart
   and briefly refuse connections. A blip fixes itself.
2. **Check the database provider's own status page.** This project uses Supabase
   (project `oqpnlusrotpxfenysfxz`, Postgres, us-west-2). If they are having an
   outage there is nothing to do but wait — and now you know that.
3. **Check the database is not paused or over its limit.** Free and low tiers
   pause after inactivity or when storage fills. The provider's dashboard says so
   on the front page.
4. **If `state` says `error` and the message mentions "permission denied" or
   "does not exist"** — the login the site uses lost its access, or the very
   first setup never ran. Run the command in
   [The database is behind](#the-database-is-behind). If it still fails, the
   database password was rotated and the site is holding an old one. See
   [the next section](#the-site-does-not-know-where-the-database-is).

The health page will never show you the database's address, name, or password.
That is deliberate — anyone on the internet can open that page.

---

### The site does not know where the database is

`state` says `unconfigured`. The site is running but the setting that tells it
where the database lives is empty.

A person with access sets it and redeploys:

```
netlify env:set DATABASE_URL "postgres://…the real value…" --context production --secret
netlify deploy --build --prod
```

Two rules, both important:

- `--secret` goes on anything holding a password. Always.
- Never paste that value into a chat, a ticket, or a document. Confirm it by name
  only — "DATABASE_URL is set" — never by showing it.

Same network note as above: a human runs this, not Claude.

---

### The site is down

The address does not load, or `/api/health` returns a 404 page rather than text.

1. **Open the Netlify dashboard** — team `zootimusmaximusbackup`, site
   `transcendent-wisp-888771` — and look at the newest deploy. If it is red, the
   deploy failed and the last good version is probably still live. If it is green
   and the site is still broken, go to step 2.
2. **Roll back.** See [Rollback](#rollback).

---

## Rollback

Rolling back means putting the previous version of the site back.

**The fast way, no code needed:**

1. Open the Netlify dashboard → team `zootimusmaximusbackup` → site
   `transcendent-wisp-888771` → **Deploys**.
2. Find the last deploy that was working. The list shows the time and the
   description of each one.
3. Click it, then click **Publish deploy**.

That is it. The old version is live again within seconds.

**Read this before you do it.** Rolling back moves the *code* backwards. It does
**not** move the *database* backwards. Database changes in this project are
forward-only — there is no command that undoes one. So:

- If the new code only **read** things, rolling back is safe and clean.
- If the new code **added tables or columns**, rolling back is still safe. The
  old code simply ignores them.
- If the new code **changed how existing information is stored**, rolling back
  can leave the old code reading information it does not understand. In that case
  ask whoever made the change before you roll back. This is the one situation
  where rolling back can make things worse instead of better.

After rolling back, open `/api/health` again. Because the code went backwards it
may now report `up` even though the database still holds newer changes. That
combination is fine and expected.

---

## Monitoring

Right now nothing checks the site on a schedule. Any uptime service — there are
free ones — can do it, and setting one up takes about five minutes.

Point it at this exact address, **including the `?strict=1` part**:

```
https://transcendent-wisp-888771.netlify.app/api/health?strict=1
```

Have it check every five minutes. Tell it that a **503** means failure.

**The `?strict=1` part is not optional, and here is why.** Uptime services decide
"up or down" from a hidden number the page sends back, called a status code.
Without `?strict=1` this page always sends back **200**, which means "fine" — on
purpose, because the CRM screens depend on it. A monitor pointed at the plain
address would report the site as healthy straight through a complete database
outage, forever. Adding `?strict=1` tells the page to send back **503** — which
means "not fine" — whenever anything is wrong: database down, database behind, or
setting missing.

That one address covers all five states in [What the answer
means](#what-the-answer-means). `up` gives 200. `behind`, `unreachable`,
`unconfigured` and `error` all give 503.

---

## Alerting

A check that nobody sees is not monitoring. When the monitor above goes red it
has to reach a person.

- Send the alert somewhere **a phone will buzz** — text message or a phone push.
  An email nobody reads at 2am is the same as no monitor at all.
- Send it to **at least two people**. One person is on a plane eventually.
- Have the alert message include the health address itself, so whoever gets it
  can open it and read `state` without hunting for the link.
- Put a link to this page in the alert message too. The point of a page at 2am is
  that it lands somewhere with instructions.

Nothing else in this system alerts on anything. There is no error reporting and
no metrics. This one check is the whole of it, and it is not switched on yet.

---

## On-call

There is no rota today and no agreed response time. The honest current answer to
"who gets called at 2am" is **nobody**.

If you want that to change, three decisions are enough to start:

1. **Who is first.** One named person who gets the alert, and one named backup.
2. **How fast.** A response time you actually mean — "within an hour during the
   day, next morning overnight" is a real answer and is better than an unwritten
   one.
3. **What they are allowed to do without asking.** Rolling back a deploy and
   running the migrate command should both be on that list; they are safe and
   they are reversible or additive. Two things must always wait for you, per
   the project's own rules: anything that **deletes data**, and anything that
   **points the site at a different database**. `INNGEST_EVENT_KEY` stays **ON
   permanently** (owner-set 2026-08-20) — never disable it.

Write those three answers down here when you have them.

---

## What nobody is watching

Stated plainly, because a gap you know about is manageable and a gap you assume
is covered is not.

**There is no monitoring and no alerting running today.** None. If something
breaks, the way it gets found is that a person opens the CRM and notices.

Specifically, none of this exists:

- **No alarms.** Nothing sends an email, a text, or a phone alert when anything
  fails. [Monitoring](#monitoring) and [Alerting](#alerting) are how you would
  add the first one.
- **No error collection.** When a screen fails for a user, nothing records it
  anywhere you can look later. You only learn about it if that person tells
  someone.
- **No speed or usage tracking.** Nobody can answer "was it slow this week" or
  "how many people used it". There is no data to answer from.
- **No automatic checks before a deploy.** Code goes live without anything
  verifying it first. There is no automated build or test step at all.
- **No automatic database updates.** Covered in [The database is
  behind](#the-database-is-behind). This is the single most likely thing to bite
  you, because everything looks fine when it happens.
- **Nobody on call.** See [On-call](#on-call).

**One more, and it is easy to misread.** This system does not send anything out.
No emails, no texts, no letters — not because something is broken, but by design.
Messages are written into a list and wait there. So "the emails stopped going
out" is not an outage you can fix from this page. Nothing was ever going out. Ask
before treating it as a fault.

---

## Quick reference

| I see | It means | Do this |
|---|---|---|
| `state: "up"` | All good | Nothing |
| `state: "behind"` | Database missing pieces | [Run the migrate command](#the-database-is-behind) |
| `state: "unreachable"` | Database not answering | [Wait, then check the provider](#the-database-is-not-answering) |
| `state: "unconfigured"` | Setting is empty | [Set `DATABASE_URL`, redeploy](#the-site-does-not-know-where-the-database-is) |
| `state: "error"` | Database answered with an error | [Same as unreachable](#the-database-is-not-answering) |
| A 404 page, or nothing loads | Site is down | [Check the deploy](#the-site-is-down), then [Rollback](#rollback) |
| Monitor sent a 503 | Something is wrong — open the health address and read `state` | [What the answer means](#what-the-answer-means) |
| Chip says NO DB but health says `behind` | Believe health | [Run the migrate command](#the-database-is-behind) |
