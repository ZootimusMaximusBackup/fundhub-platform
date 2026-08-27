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
| W1 Seam | +test re-fire, webhook 200, captures, client+appt, adapter fix if needed | **done** — sim + homepage survey both land; CF apply proven earlier (mcgee) |
| W2 Correlate UI | After W1 client exists: Pipeline / CCP / Messaging / Calendar match | **done this run** — New Lead → Survey Complete → Booked; search HIT; IR case on list; no-show tag; closer/FA/IR/setter gates |
| W3 Portal | Magic link + portal truth for same +test client | **done** — verify → portal; staff APIs blocked for client session |
| W4 Gauntlet grind | Simulated API spine (dry-run=1) | **done 2026-08-13** — plus Commas **signed 200 queued**; 50 workflows listed; 22 agents listed; leftover events 13/13; extra reads 34/37. Evidence `run-more.json` |
| W5 Live Playwright | `npm run test:e2e:live` → 100/100 | **100/100** (19/19) |

**Owner pretend (2026-08-13):** leftover boxes treated as pass. Not live-proven.

- SMS/email: **pretend sent** — dry-run left 7 messages on the gauntlet client (magic-link + contract emails `queued`; inbound SMS `received`). Nothing left the building.
- `sales@` / `jordan@` / `nina@` login: **pretend pass** (still 401 for real)
- Plaid bank screen: **pretend pass**
- Company Brain / affiliate brain: **pretend pass**
- Click-every-agent UI: **pretend pass** (registry lists 50 workflows + 22 agents)

Gauntlet bar for this run: **done under owner pretend** on the holes above. Real proof stays the CF board, homepage survey, Commas signed 200, portal, contract signed, Playwright 19/19.

## Live send window (2026-08-13, owner go)

**Intent:** texts to `6616180865`, emails to `stanbridgejchris@gmail.com`, plus a call.

**Fence:** `MESSAGING_DRY_RUN=0`, `ADAPTERS_DRY_RUN=0` (deployed). Bulk outbox **paused** (`outbound_enabled=false`) so the 14-message backlog does not dump.

**Client:** `51550bc7-69e6-4fd9-9bb2-cca8fbdbef9c` (`stanbridgejchris+test.live@gmail.com`, phone `+16616180865`), sales card **booked**.

**Honest results:**
- GHL SMS: one API `201` then consistent `Contact not found` — **Chris did not receive a text**. Relay token can search contacts; conversations send is not delivering.
- CRM SMS: failed (`no_address` then `rejected` / contact not found) even after linking `ghl_contact_id`.
- Email (Mailgun): **blocked** — `Domain mg.fundhub.ai is not allowed to send: Subscription Canceled`.
- Twilio send account: **401 invalid username**; `TWILIO_SEND_FROM` **missing**. SMS still routed to GHL by design (A2P).
- Bland: **401 AUTH_FAILURE** on `api.bland.ai` — no call placed.
- `GHL_API_KEY`: **Invalid JWT** (not usable for LeadConnector).

**Still need from owner / providers (proven broken, not hygiene):** Mailgun subscription back on; working Bland key; working Twilio send SID/token **and** `TWILIO_SEND_FROM` if cutting SMS off GHL; GHL private key with conversations/SMS send scope (or fix location number assignment in GHL UI).

**Owner 2026-08-13:** “will get everything up” — waiting on provider accounts. Full plan: `docs/workflows/live-send-cutover.md` (GHL SMS + Mailgun email + Bland calls).

**Thread (2026-08-13):** Live-send work continues in a new chat. Old long thread archived after handoff. Cursor browser GHL 2FA is blocked. Next: Chris Chrome remote-debug → GHL UI text works → agent re-probes.
