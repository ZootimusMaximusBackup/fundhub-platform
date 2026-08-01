# Switching the app to a limited database user

> ## ✅ THIS IS ALREADY DONE ON PRODUCTION — 1 August 2026
>
> You do **not** need to run this. It has been run. On production right now:
>
> * the limited user `fundhub_app` exists and has a password
> * Netlify's `DATABASE_URL` points at it
> * Netlify's `MIGRATION_DATABASE_URL` holds the old admin connection, which is
>   what database updates use now
> * the safety check passes against the new user
>
> **So what is this page for now?** Three things:
>
> 1. **Putting it back.** If something breaks and you need the old setup
>    returned, that is [Step 15](#step-15--if-something-goes-wrong-put-it-back).
>    Start there and ignore the rest.
> 2. **Doing the same thing to a second database** — a staging or test copy.
>    Then follow it from the top as written.
> 3. **Understanding what was changed**, without reading any code.
>
> One thing worth knowing even if you never touch this page again: database
> updates now need `MIGRATION_DATABASE_URL` to be set. If someone reports that a
> database update failed saying "permission denied", that is the cause, and
> [Step 10](#step-10--terminal) is where it is explained.

Follow these in order. Do not skip one.

**Time:** about 20 minutes.
**You need:** a terminal window, and a web browser.
**Your site stays up** through step 12. Step 15 puts everything back if it goes wrong.

Two places you will work:

* **Terminal** — the black window where you type commands.
* **A website** — either supabase.com or app.netlify.com. Each step says which.

Keep the same terminal window open the whole way through. Step 2 puts something
in its memory that later steps use.

---

## Part 1 — Get the code and make the new user

### Step 1 — Terminal

This work is now merged into `main`, so there is no special branch to fetch.

```
cd ~/fundhub-platform
git checkout main
git pull origin main
npm install
```

**You should see:** `Switched to branch 'main'`, then npm ending with
`added ... packages` or `up to date`.

**If it says** `error: pathspec ... did not match` — you are not in the right
folder. Check the `cd` line above.

---

### Step 2 — Terminal

This copies your current database connection into the terminal's memory. It does
not show it on screen.

```
export MIGRATION_DATABASE_URL="$(netlify env:get DATABASE_URL --context production)"
echo "loaded ${#MIGRATION_DATABASE_URL} characters"
```

**You should see:** `loaded 120 characters`, or some number near that.

**If it says `loaded 0 characters`** — nothing was copied. Stop. Do not continue,
because step 3 would do nothing and step 15 could not put things back.

---

### Step 3 — Terminal

This creates the new limited user inside your database.

```
node db/migrate.mjs
```

**You should see:** a first line reading
`→ connecting with MIGRATION_DATABASE_URL (admin/owner identity)`,
then many lines starting with `· skip`,
then **`✔ applied migrations/104_app_role.sql`**,
then `Done. 1 migration(s) applied.`

**If it says** `FATAL: permission denied` — the connection from step 2 is not the
admin one. Stop and tell Claude.

---

### Step 4 — Terminal

Make a password for the new user.

```
openssl rand -hex 24
```

**You should see:** 48 characters, only numbers and the letters a through f.
Example shape: `3f9a1c...`

**Copy it somewhere safe for the next ten minutes.** You will paste it twice
(steps 5 and 8). After that you never need it again — it lives in Netlify.

Do not invent your own password. This kind has no symbols in it, and symbols
break database connections in a way that is very hard to spot.

---

## Part 2 — Turn the new user on (supabase.com)

### Step 5 — Website: supabase.com

Go to **supabase.com** → sign in → open the project **oqpnlusrotpxfenysfxz** →
click **SQL Editor** in the left sidebar → click **New query**.

Paste this, and replace `PUT_PASSWORD_HERE` with the password from step 4.
Keep the single quotes around it.

```sql
ALTER ROLE fundhub_app LOGIN PASSWORD 'PUT_PASSWORD_HERE';
```

Click **Run**.

**You should see:** `Success. No rows returned`.

**If it says** `role "fundhub_app" does not exist` — step 3 did not actually
finish. Go back to step 3.

---

### Step 6 — Website: supabase.com

Check the new user can read. Click **New query**, paste this, click **Run**:

```sql
SET ROLE fundhub_app;
SELECT count(*) AS clients_visible FROM clients;
RESET ROLE;
```

**You should see:** a table with one number in it. **Any** number is fine,
including 0.

**If it says** `permission denied for table clients` — stop and tell Claude. Do
not continue; the app would not be able to read your data.

---

### Step 7 — Website: supabase.com

Go back to the step 5 query tab. Select all the text and delete it, then close
the tab. This keeps your new password out of Supabase's saved query history.

---

## Part 3 — Point the app at the new user (terminal)

### Step 8 — Terminal

Show your current connection so you can copy from it:

```
netlify env:get DATABASE_URL --context production
```

**You should see** one long line that looks roughly like this:

```
postgresql://postgres.oqpnlusrotpxfenysfxz:OLDPASSWORD@aws-0-us-west-2.pooler.supabase.com:5432/postgres
```

Now build the new one by changing **exactly two things**:

1. The name right after `//`. Change **`postgres.`** to **`fundhub_app.`**
   So `postgres.oqpnlusrotpxfenysfxz` becomes `fundhub_app.oqpnlusrotpxfenysfxz`.
   Leave the long code after the dot exactly as it is.
2. The password. That is everything between the **first `:` after the name** and
   the **`@`**. Replace it with your password from step 4.

Everything else — the `@`, the address, the `:5432`, the `/postgres` — stays
exactly the same.

Write the finished line down. The next step tests it.

---

### Step 9 — Terminal

Test the new connection **before** anything starts using it. Put your new line
inside the quotes:

```
DATABASE_URL="PUT_YOUR_NEW_LINE_HERE" npm run guard:db
```

**You should see:**

```
✔ superuser guard: connected as "fundhub_app" on "postgres" — no superuser, ...
# pass 3
# fail 0
```

**If you see `# fail 1`** — do not go on. Read the message:

* *"password authentication failed"* — the password does not match step 4/5.
  Redo step 5 with the password you actually copied.
* *"role ... does not exist"* — the name is wrong. Check you wrote
  `fundhub_app.` including the dot, and kept the long project code after it.
* *"The app is connected to Postgres as a privileged role"* — you did not change
  the name; it is still connecting as `postgres`.

Do not continue until this says `fail 0`.

---

### Step 10 — Terminal

Save the admin connection in Netlify under its new name. Migrations use this
from now on.

```
netlify env:set MIGRATION_DATABASE_URL "$MIGRATION_DATABASE_URL" --context production --context deploy-preview --context branch-deploy --secret
```

**You should see:** `Set environment variable MIGRATION_DATABASE_URL` and a list
of the three contexts.

**If it says `loaded 0 characters` back in step 2** — you cannot run this. Stop.

---

### Step 11 — Terminal

Point the app at the new limited user:

```
netlify env:set DATABASE_URL "PUT_YOUR_NEW_LINE_HERE" --context production --context deploy-preview --context branch-deploy --secret
```

**You should see:** `Set environment variable DATABASE_URL`.

Nothing has changed on your live site yet. The switch happens at step 13.

---

## Part 4 — Check the settings (app.netlify.com)

### Step 12 — Website: app.netlify.com

This step prevents the most likely problem. Do not skip it.

Go to **app.netlify.com** → team **zootimusmaximusbackup** → site
**transcendent-wisp-888771** → **Site configuration** → **Environment variables**.

Find **DATABASE_URL** in the list. Look at its **Scopes** column.

* If it says **All scopes** — good, nothing to do.
* If it does **not** mention **Builds** — click **Options** → **Edit** → tick
  **All scopes** (or at least **Builds** and **Functions**) → **Save**.

Do the same for **MIGRATION_DATABASE_URL**.

**Why:** the safety check runs while your site is being built. If it cannot see
the connection, every deploy fails until you fix it here.

---

## Part 5 — Go live (terminal)

### Step 13 — Terminal

```
netlify deploy --build --prod
```

**You should see**, partway through the build log:

```
✔ superuser guard: connected as "fundhub_app" ...
```

and at the end, `Deploy is live` with a **Website URL**.

**If the build stops** with *"The app is connected to Postgres as a privileged
role"* — that is the safety check working correctly. Your site is untouched and
still running the old version. Go back to step 8.

**If the build stops** with *"DATABASE_URL is not set in a deployed
environment"* — go back to step 12; the scope is wrong.

---

### Step 14 — Your site

Open your site. Log in. Open a client record. Click into a couple of screens.

**You should see:** everything working exactly as before.

That is the whole job. Nothing about how the site looks or behaves changes —
the difference is invisible and lives underneath.

---

## Step 15 — If something goes wrong, put it back

Two things have to go back, not one. Doing only the first will leave you unable
to deploy at all.

**15a. Point the app at the old connection.** Terminal:

```
netlify env:set DATABASE_URL "$(netlify env:get MIGRATION_DATABASE_URL --context production)" --context production --context deploy-preview --context branch-deploy --secret
```

**15b. Turn off the safety check**, because it will now correctly refuse to let
you deploy. Open `netlify.toml` in the project folder, find this line:

```
  command = "npm run guard:db"
```

change it to:

```
  command = "echo 'no build step — static public/ + bundled functions'"
```

save the file, then in the terminal:

```
git add netlify.toml
git commit -m "temporarily disable db privilege guard"
git push -u origin claude/postgres-superuser-migration-lzm6xt
netlify deploy --build --prod
```

**You should see:** the deploy finish normally, and your site back to how it was.

Then tell Claude what the error said.

---

## One thing that changes afterwards

**Applying future database changes.** The old command in `CLAUDE.md` section 11
used `DATABASE_URL`. That is now the limited user and cannot change tables. Use
this instead:

```
MIGRATION_DATABASE_URL="$(netlify env:get MIGRATION_DATABASE_URL --context production)" node db/migrate.mjs
```

**Running the tests on your own computer.** If your local `DATABASE_URL` points
at an admin connection, the safety check will stop the test run. That is
correct — about 14 test files need admin powers to do their job. Put
`ALLOW_SUPERUSER_DB=1` in front to say "I know, this is my own machine":

```
ALLOW_SUPERUSER_DB=1 npm test
```

That word only works on your own computer. If it is ever set on Netlify, the
build fails on purpose.
