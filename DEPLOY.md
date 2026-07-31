# Deploy to Vercel (staging preview)

Goal: a clickable preview URL with the dashboard on real data. ~15 min.
The repo is zero-config Vercel-ready: `api/*.mjs` → serverless functions, `public/` → static.

## 1. Provision a Postgres (pick one)
- **Neon** (free, fastest): neon.tech → new project → copy the connection string (starts `postgres://…`). That's your `DATABASE_URL`.
- or **Vercel Postgres**: Vercel dashboard → Storage → Create → Postgres → it auto-adds `DATABASE_URL` to the project (skip step 3's DATABASE_URL line if so).

## 2. Run the migrations against that DB (one-time, from this folder)
```
npm install
DATABASE_URL='postgres://…' npm run migrate      # applies db/schema/, db/migrations/, db/seed/ in order
```

## 3. Link + set env vars
```
vercel link                                        # pick/create the project
# use printf (NOT echo) — echo appends a trailing newline that breaks values
printf '%s' 'postgres://…'        | vercel env add DATABASE_URL production
printf '%s' 'pick-a-long-secret'  | vercel env add DASHBOARD_SECRET production
printf '%s' 'production'          | vercel env add NODE_ENV production
printf '%s' 'fundhub'             | vercel env add DEFAULT_ORG_SLUG production
```
(Provider webhook secrets — COMMAS_WEBHOOK_SECRET, TWILIO_AUTH_TOKEN, MAILGUN_SIGNING_KEY, CALCOM_WEBHOOK_SECRET, BLAND_WEBHOOK_SECRET, CLICKFUNNELS_WEBHOOK_SECRET — add later, only when wiring a live source.)

## 4. Deploy
```
vercel --prod
```

## 5. Verify
- Health: `https://<deployment>/api/health` → `{"ok":true,"db":"up",...}`
- Machine check: `https://<deployment>/api/health?strict=1` → same body, but the
  status code is **200 only when the deployment is healthy** and **503** when it
  is not. This is the URL to give an uptime monitor. The plain one above always
  answers 200 on purpose — the CRM status chip reads its body — so a monitor
  pointed at it stays green straight through a database outage.
- Dashboard: `https://<deployment>/dashboard.html` — the page asks for the key on
  first load and keeps it for that browser tab only.
  - Click **“+ Sample data”** a few times → sample clients populate the table.
  - Or run the scripted single-client demo: `DATABASE_URL='…' node scripts/demo-journey.mjs`
- Send Chris the plain dashboard URL and the key **separately**. Never put the key
  in the address bar: the server no longer accepts it there, and a URL-borne key
  ends up in browser history, bookmarks, shared links and `Referer` headers.

## Inngest (workflow automation)

The 47 Inngest workflow functions are served at `/api/inngest`.

```
printf '%s' 'your-inngest-event-key'   | vercel env add INNGEST_EVENT_KEY production
printf '%s' 'your-inngest-signing-key' | vercel env add INNGEST_SIGNING_KEY production
```

- Get both keys from the Inngest dashboard → your app → Manage → Keys.
- `INNGEST_EVENT_KEY` — used by the event bus to forward canonical events to Inngest. Required in production; optional in dev/test (bridge is a no-op without it).
- `INNGEST_SIGNING_KEY` — used by the serve handler to verify requests from Inngest. Required in production.
- After deploy, sync the endpoint in the Inngest dashboard: `https://<deployment>/api/inngest`.

## When it breaks — see [docs/RUNBOOK.md](docs/RUNBOOK.md)

Rollback steps, what each `/api/health` state means and its first action, how to
apply migrations the deploy did not run, how to point an uptime monitor at
`/api/health?strict=1`, and an honest list of what is not monitored. The person
who just deployed is exactly the person who needs it, which is why it is linked
from here rather than duplicated — two copies of a procedure disagree eventually.

Two things worth knowing before the first deploy:
- **The build command is an `echo`.** No deploy has ever run a migration, and
  there is no CI to run them. After shipping a change that adds a `.sql` file
  under `db/`, apply it yourself or `/api/health` will report `state:"behind"`
  and any screen touching the new tables will fail.
- **`/api/health` answers 200 in every state on purpose** — the CRM status chip
  reads it that way. Monitors must use `/api/health?strict=1`, which answers 503
  when the deployment is not trustworthy.

## When something breaks — read `docs/RUNBOOK.md`

Deploying is the easy half. `docs/RUNBOOK.md` is the other half, written for
someone who does not read code:

- **What each `/api/health` answer means**, and the first thing to do for each —
  `up`, `behind`, `unreachable`, `unconfigured`, `error`.
- **How to roll a deploy back** (Netlify → Deploys → Publish deploy), including
  the part people get wrong: rolling the code back does **not** roll the database
  back. Migrations only move forward.
- **How to set up a monitor**, which nobody has done yet. Point it at
  `/api/health?strict=1` and alert on a 503.
- **What nobody is watching.** There is no alerting, no error reporting, no
  metrics and no on-call rota today. The runbook says so plainly rather than
  leaving it to be discovered during an outage.

## Notes
- No `DASHBOARD_SECRET` set + `NODE_ENV=production` → dashboard endpoints return 401 (fail-closed). Always set the secret.
- Webhook endpoints live at `POST /api/webhooks/{commas|twilio|mailgun|calcom|bland|clickfunnels}`.
- This runs ALONGSIDE the live GHL system — nothing here touches production GHL/Airtable.
