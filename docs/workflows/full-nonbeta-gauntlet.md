# Full product gauntlet — 100% usable code

**Owner law (2026-08-12):** Every agent, every workflow, every scenario, **correlated dashboards**, **customer portal**, **every screen** (former beta included). Workflow fire alone = **FAIL** if UI does not update.

**Canvas (check off here):**  
`/Users/zootimusmaximus/.cursor/projects/Users-zootimusmaximus-fundhub-platform/canvases/after-attributes-set-plan.canvas.tsx`

## Pass rule

For each event / workflow:

1. Backend path runs (webhook / Inngest / API).
2. SMS (GHL) and/or email (Mailgun) fire when that path sends.
3. **Correlated staff UI updates** (Pipeline, CCP, Messaging, Calendar, IR, Contracts, etc.).
4. **Client portal** reflects the same truth where the client should see it.
5. No DEAD/STUB controls left on that screen — fix or pull.

## Sections on the canvas

| Section | What |
|---------|------|
| A Gates | CF attrs, Inngest, dry-run, dispatch, GHL, Playwright |
| B Ingress | CF + homepage + Commas webhooks |
| C Correlate UI | Event → dashboard must move / populate |
| D Portal | Magic link, docs, upload, contract, mobile |
| E Employee | **Staff & Teams** (`staff-teams.html`) + Hiring + shifts/telemetry/consent + floor correlation |
| F Workflows | All 50 registered in `src/workflows/index.mjs` |
| G Agents | GHL-A* + AG-* + OP-* |
| H Every screen | Including former `BETA_PAGES` — usable or removed |
| I Roles | Owner/admin/SM/closer/FA/IR/client/partner |
| J Scenarios | PASS / DOWNSELL / no-show / purchase / decline / inquiry / docs / inbound / contract / affiliate |

## Owner gates before real fires

- ~~Reply **`attributes set`** when CF mapping done~~ → **DONE** (owner 2026-08-12: “its all mapped”)
- Explicit go to turn **`INNGEST_EVENT_KEY`** on
- Explicit go to set **`MESSAGING_DRY_RUN=0`** for the +test window (restore after)

## Parallel batch (after attributes)

Shared board: this file + `docs/workflows/cf-funnel-seam.md`

| Workflow | Owns | Status |
|----------|------|--------|
| W1 Seam | +test re-fire, webhook 200, captures, client+appt, adapter fix if needed | **done** — client `704cc907-…` + `booking.created` (sigfix email) |
| W2 Correlate UI | After W1 client exists: Pipeline / CCP / Messaging / Calendar match | **partial** — Pipeline booked card PASS; phone PASS; messaging dry-run empty; survey attrs still absent from CF payloads |
| W3 Portal | Magic link + portal truth for same +test client | **pass** — magic-link issued + verify → client session/account for `704cc907…` (rate-limit hit on re-issue) |
| W4 Gauntlet grind | Simulated API spine (dry-run=1) | **PASS** client `73c8f720…` correlate 19/19 + screens/APIs 32/32 + live PW 100/100. Contract signed, IR Queued, portal session. |
| W5 Live Playwright | `npm run test:e2e:live` → 100/100 | **100/100** (19/19) reconfirmed after pipeline deploy |
