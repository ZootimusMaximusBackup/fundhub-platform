# Apply notes — live v0 on Netlify (Jul 28)

Everything below was tested live in a sandbox: real Postgres, all 25 migrations
applied clean, real login → session → clients → client detail → tasks →
mark-done, role gates (closer blocked from inquiry, owner passes), 404s.
Phone inquiry is on hold. `/api/inquiry` does not call an external host.

## 1. Commit both deltas

**fundhub-platform** — unzip `fundhub-platform-live-v0.zip` into the repo root.
All files are NEW — zero edits to existing files, so it can't conflict with
anything the wave sessions merged:

```
netlify.toml
netlify/functions/api.mjs        ← runs the existing api/ handlers on Netlify
api/auth/login.mjs  logout.mjs  session.mjs
api/tasks.mjs
api/inquiry.mjs
scripts/create-staff.mjs
public/fh.css  fh.js  login.html  index.html
public/closer.html  ops.html  tasks.html  inquiry.html
```

## 2. Netlify site (one time, ~5 min)

Netlify → **Add new site → Import an existing project → GitHub →
ZootimusMaximusBackup/fundhub-platform**.
- Build command: leave as detected (netlify.toml supplies it)
- Publish directory: `public` (netlify.toml supplies it)
- Deploy. Functions bundle automatically from `netlify/functions/`.

**Site configuration → Environment variables:**

| Key | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string, with `?sslmode=require` |
| `INQUIRY_API_SECRET` | gitignored `.env` / Netlify. Phone inquiry is on hold; this does not turn calls on. |
| `DASHBOARD_SECRET` | optional — keeps the old `dashboard.html?key=` links working |

Redeploy after setting envs.

## 3. Create logins (from your laptop, ~2 min)

```
cd fundhub-platform && npm install
DATABASE_URL="<neon url>" npm run migrate            # no-op if Neon is current
DATABASE_URL="<neon url>" node scripts/create-staff.mjs chris@fundhub.ai  <pw> owner              "Chris Stanbridge"
DATABASE_URL="<neon url>" node scripts/create-staff.mjs sarah@fundhub.ai  <pw> admin              "Sarah Whitfield"
DATABASE_URL="<neon url>" node scripts/create-staff.mjs jordan@fundhub.ai <pw> closer             "Jordan Blake"
DATABASE_URL="<neon url>" node scripts/create-staff.mjs nina@fundhub.ai   <pw> closer             "Nina Castellano"
DATABASE_URL="<neon url>" node scripts/create-staff.mjs marcus@fundhub.ai <pw> funding_advisor    "Marcus Webb"
DATABASE_URL="<neon url>" node scripts/create-staff.mjs alvin@fundhub.ai  <pw> inquiry_specialist "Alvin Torres"
```

Passwords never print; re-running the same email just updates it.

## 4. Smoke checklist (5 min)

1. `https://<site>.netlify.app/login.html` — wrong password → clean error;
   right password → home with role-aware cards.
2. **Closer** — clients render with tier chips. Empty DB? Sign in as owner and
   `curl -X POST https://<site>.netlify.app/api/dashboard/seed -H "authorization: Bearer <token>"`
   for demo data (token = what login returns; owner/admin only).
3. **Ops** — blockers column shows "Never Pulled" reds; open a client, mark a
   task Done, watch the count drop.
4. **Tasks** — the whole queue, filter by series.
5. **Inquiry** (as Alvin or you) — the Inquiry Remover screen uses Fundhub’s
   own case list. Phone launch is on hold. `/api/inquiry` answers not
   configured until a host is set on purpose.
6. Sign in as Jordan → no Ops/Inquiry in the nav; hitting /api/inquiry
   directly → 403. That's the access-levels model, live.

## Known edges (all intentional v0)

- Screens poll (10–15s); SSE comes with the `api/stream.mjs` adapter later.
- Task board is unrouted-by-role until the 19 insert sites are patched
  post-Wave-2 (`assignee` stays null; the board shows everything).
- Ops "Pull TU/EX/EQ" buttons are disabled with a tooltip — the CRS request
  path wires at cutover. Everything enabled is real.
- Webhooks route exists on Netlify too (`/api/webhooks/:provider`) but
  providers still point at the old URLs — repointing is a separate, deliberate
  step.
