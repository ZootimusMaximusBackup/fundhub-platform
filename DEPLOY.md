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
- Dashboard: `https://<deployment>/dashboard.html?key=<DASHBOARD_SECRET>`
  - Click **“+ Sample data”** a few times → sample clients populate the table.
  - Or run the scripted single-client demo: `DATABASE_URL='…' node scripts/demo-journey.mjs`
- Send Chris the dashboard URL **with `?key=…`** (the key is the auth).

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

## Notes
- No `DASHBOARD_SECRET` set + `NODE_ENV=production` → dashboard endpoints return 401 (fail-closed). Always set the secret.
- Webhook endpoints live at `POST /api/webhooks/{commas|twilio|mailgun|calcom|bland|clickfunnels}`.
- This runs ALONGSIDE the live GHL system — nothing here touches production GHL/Airtable.
