# Fix the owner login — runbook

**Your password was never wrong. `demo1234` cannot work, and it never could.**

Do these three things, in order. Total time: about two minutes.

---

## Step 1 — Run the SQL (this is the fix)

Open **Supabase Dashboard → SQL Editor → New query**. Paste the entire contents of
[`scripts/fix-owner-login.sql`](./fix-owner-login.sql) and hit **Run**.

**Expected output — exactly one row:**

| id | email | role | status | org_slug | hash_len | hash_clean |
|----|-------|------|--------|----------|----------|------------|
| `<uuid>` | `chris@fundhub.ai` | `owner` | `active` | `fundhub` | `90` | `t` |

- `hash_len` must be **90** and `hash_clean` must be **t**. Anything else means the paste
  was mangled — re-run the file, it is safe to run as many times as you like.
- **Zero rows returned?** Your `DEFAULT_ORG_SLUG` env var in Netlify is not `fundhub`.
  Find-and-replace `fundhub` throughout the SQL file with its real value and re-run.

---

## Step 2 — Clear the browser's demo mode

On the login page, open the browser console (F12) and run:

```js
localStorage.clear()
```

Then reload the page. **Do not skip this.** `public/fh.js` keeps a client-side demo mode
in `localStorage`. Once it engages, every future login is answered from a hardcoded table
inside the page and never reaches your server at all — so the new password would be
rejected without a single request leaving the browser.

---

## Step 3 — Sign in

**Clear the pre-filled password box first.** It contains `demo1234`.

```
email:    chris@fundhub.ai
password: j32edOAlODrrRfT4H3GZ
```

You are in. Everything below is explanation and follow-up.

---
---

## Why this happened

Two independent faults, and only the first one blocked you.

### 1. `demo1234` is structurally impossible

`src/auth/hash.mjs` enforces a 12-character minimum in `hashPassword()`. `demo1234` is
8 characters. No code path in this repo — not the seeder, not the invite flow, not account
creation — can ever produce a stored hash for it. The login form pre-fills a password that
is guaranteed to fail, and advertises it as working.

The backend was answering **HTTP 401 `invalid_credentials`** — correctly. It was telling
the truth the whole time.

### 2. The error message hid everything else

`public/login.html` collapsed every non-429/403 response into `"Wrong email or password."`,
so a missing table or a dead function would have read as a credential error. That is fixed
in this commit — real statuses now surface, and a 5xx says explicitly *"this is not your
password."*

### How we know it was a 401 and not a 500

This is worth recording, because the obvious hypothesis was wrong.

The site could not be reached from the diagnostic sandbox (egress policy returns
`403` on `CONNECT` to `fundhub.ai`, `*.netlify.app` and `*.supabase.co`), so we never got a
live status code. We proved it from the client code instead, by running the **pre-fix**
`fh.js` against a stubbed backend for every possible status.

The old `fh.js` fell through to demo mode on any status that was `404`, `>=500`, or any 4xx
other than 401 — and the demo table accepts `chris@fundhub.ai` / `demo1234`. So:

| Backend returned | What you would have seen |
|---|---|
| 400, 403, 404, 429, 500, 502, network failure | **Logged in** (silently, into demo mode) |
| **401** | **"Wrong email or password."** |

You saw the error message. Therefore the backend returned exactly 401, with a JSON body.
That single fact rules out — without needing to reach the site — a missing table, an
unapplied migration, a bad `DATABASE_URL`, an unreachable database, a missing `orgs` row,
a rate-limit lockout, and a suspended account. All of those would have logged you in.

> **Caveat, stated honestly:** this proof holds because you submitted the *pre-filled*
> `demo1234`. If you had typed the intended password instead, demo mode would have rejected
> it too and every backend fault would look identical. If you were not using the pre-fill,
> re-check with Step 4.

### Verification actually performed

Not assumed — executed, against a real PostgreSQL 16 cluster built for the purpose:

- All 66 migrations applied cleanly (10 schema + 54 migrations + 2 seed).
- `fix-owner-login.sql` ran with `ON_ERROR_STOP=1`: inserts on first run, updates on
  second, always exactly one row.
- It repairs a deliberately damaged row (`status='invited'`, `password_hash=NULL`,
  `active=false`, `role='Owner'`) back to a working login.
- It is a clean no-op when the `active` column does not exist.
- The repo's own `login()` was then called against that database:
  - `j32edOAlODrrRfT4H3GZ` → **OK 200**, `role=owner`, session token issued
  - `demo1234` → **401 invalid_credentials** ← reproduces your exact symptom

---

## Step 4 — If it still fails after Step 3

The error message is now honest (once this commit deploys). Read it literally:

| Message | Meaning | Action |
|---|---|---|
| *Wrong email or password.* | Genuine 401 | Step 1's SELECT returned no row, or the org slug is wrong |
| *Account not active — ask an admin.* | 403 | `status` or `active` is wrong — re-run Step 1 |
| *Too many attempts* | 429 | Wait 15 min, or re-run Step 1 (it clears the counter) |
| *Server error (HTTP 5xx)* | Backend fault | Check `/api/health` below — **not** a password problem |
| *Could not reach the server.* | 404 / network | The function is not deployed |

Confirm the backend independently — this is unauthenticated, always returns 200, and costs
no rate limit:

```
curl -s https://fundhub.ai/api/health
```

Read `migrations` in the response:

- **`66`** — schema fully current.
- **`51`** — migrations 075–089 are missing (see below).
- `"state":"unreachable"` / `"unconfigured"` — `DATABASE_URL` problem, not a password problem.

---

## Step 5 — Separately: apply migrations 075–089

**This did not break your login** — verified: the login path touches only `orgs`, `staff`,
`auth_attempts`, `sessions`, `accounts` and `account_sessions`, and nothing in 075–089
alters any of them. But those 15 migrations are very likely missing from production,
because **nothing applies migrations automatically**: `netlify.toml`'s build command is a
literal `echo`, and there is no `.github/workflows/` directory. The ten PRs merged overnight
shipped *code*, not *schema*.

Until you run this, the **Finance OS** and **Banking** screens will 500 — 14 tables they
query do not exist.

From your own machine, in the repo root:

```bash
DATABASE_URL="postgresql://postgres.oqpnlusrotpxfenysfxz:<YOUR_DB_PASSWORD>@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require" \
  node db/migrate.mjs
```

- Replace `<YOUR_DB_PASSWORD>` with your Supabase database password (Dashboard →
  Settings → Database). It is deliberately not stored in this repo.
- Keep `?sslmode=require`. `src/db.mjs` passes no `ssl` option, so TLS comes entirely from
  the connection string.
- The runner is idempotent — it skips anything already applied. Expect
  `✔ applied migrations/075_…` through `089`, then `Done. 15 migration(s) applied.`

**Order does not matter here.** Step 1 does not depend on 075–089, so you can log in first
and migrate afterwards.

---

## Recommendations (not done — they need your call)

1. **Change the login form's pre-filled password.** `public/login.html` still pre-fills
   `demo1234` and advertises it in the copy. It cannot ever work. Left alone deliberately:
   commit `3ca41a1` reverted an earlier attempt to change it, so this looks like a product
   decision rather than a bug.
2. **Reconsider client-side demo mode in a live CRM.** `fh.js` falls back to a hardcoded
   user table when the backend 404s or is unreachable, and once engaged it sticks in
   `localStorage`. It is why a broken backend looked like a working login for months.
3. **Make deploys apply migrations,** or at least fail loudly when the ledger is behind the
   repo. Not changed here: editing `netlify.toml`'s build command to touch the database
   risks breaking every deploy, which is a worse failure than the one being fixed.
4. **`shell.js:248` and `crm.html:317`** still redirect to the login page on *any*
   `/api/auth/session` failure, including 500s — so a broken backend still presents as
   "you are signed out". Fixing it needs a banner UI, not an error-branch rewrite.
