# Status batch: Mailgun / SMS / CT / Closer

Status only. No fixes. Verified 2026-08-10.

## Task list

| Unit | Owner | Status |
|------|-------|--------|
| 1. Mailgun signing key + webhook verify | session | done |
| 2. Outbound SMS drain vs GHL | session | done |
| 3. CT-series contracts | session | done |
| 4. Closer Dashboard read-only panel | session | done |

## Verdicts

| # | Item | Verdict |
|---|------|---------|
| 1 | Mailgun signing key + webhook signature verification | **DONE** |
| 2 | Outbound SMS drain (actual send vs GHL-only) | **DONE — GHL relay only; prod dry-run blocks transmit** |
| 3 | CT-series contracts ported | **NOT DONE** |
| 4 | Closer Dashboard read-only panel | **DONE** (hybrid; see notes) |

## Evidence brief

### 1. Mailgun
- Prod env: `MAILGUN_SIGNING_KEY` SET (len 32). Confirm by name only.
- Verify: `verifyMailgunSignature` in `src/adapters/mailgun.mjs` — HMAC-SHA256, fail-closed.
- Wired on live routes: `/api/webhooks/mailgun`, `/api/webhooks/mailgun-events`.
- Unit tests: `src/adapters/mailgun.test.mjs` green.
- Prod-key crypto dry-check: valid sig true, bad/null false. Did not prove Mailgun dashboard key equals Netlify value via a live Mailgun POST.

### 2. Outbound SMS
- Seeded route: `sms → ghl_relay` (`db/migrations/110_messages_outbound.sql`).
- Twilio cutover migration `121_sms_routing_twilio.sql` is a deliberate no-op.
- Transmit path: `ghl-relay.mjs` → GHL conversations SMS API.
- Drain paths: staff compose immediate; Netlify `staff-message-sweeper` every 5m; Inngest `messageDispatchSweeper` registered; `INNGEST_EVENT_KEY` SET in prod.
- **Prod fence:** `MESSAGING_DRY_RUN=1` → messaging blocked. Nothing actually transmits until fence off.
- Twilio provider file exists; not routed for outbound.

### 3. CT-series
- CT-00…CT-03 all **DEFERRED** in `workflow-migration-table.md`. No `src/workflows/ct-*.mjs`.
- Separate CRM contracts engine wired; seeds: `SOFT-PULL-CONSENT`, `FUNDING-AGREEMENT` (real starter copy, not lawyer-approved). No repair body. Not CT checkout automation.

### 4. Closer Dashboard
- CRM: `/app/closer-dashboard.html` mounts — stats (static), CD-01 pipeline (empty), CD-02 calculators (funding live with `?client_id=`, deal math sample).
- Legacy read-only dossier: `/dashboard.html` → live `/api/dashboard/clients` + `/api/dashboard/client` detail pane.

## Blockers / open questions

- Mailgun: live inbound POST from Mailgun not exercised.
- SMS: owner must flip `MESSAGING_DRY_RUN` for real sends (ask before enabling Inngest-adjacent live behavior if needed — key already present).
- CT: deferred by design (payment + unfinished GHL source).
