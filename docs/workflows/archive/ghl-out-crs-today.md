# GHL out · CRS today — 2026-08-14

**Owner laws (2026-08-14):**
- GoHighLevel is OUT. Do not call or debug GHL.
- SMS = Twilio (prove Monday — not approved until then).
- Email = Resend (keys pending from owner).
- Voice = Bland (unchanged).
- CRS sandbox = today's #1.
- Do not dump the paused outbound queue.
- Never print secrets. Never nag key rotation.

## Parallel units

| Unit | Owner | Status |
|------|-------|--------|
| W1 Send path (kill GHL, Twilio + Resend, cutover doc) | this chat | **done** (docs portion) — cutover rewritten; RESEND_* in .env.example; providers + live-fence 83/83 pass. Remaining: Twilio Monday prove, Resend domain SPF/DKIM, keep outbox paused. |
| W2 CRS sandbox e2e + routing | this thread | **claimed** |
| W3 Dispute letters (DIRTY / REPAIR_ONLY only) | other chat | blocked on W2 dirty contact |
| W4 Manual SOPs | this chat | **claimed** |
| Demo CRM wipe (`is_demo=true` only) | this thread | claimed — list before delete |

## W2 notes

- Real path: sandbox CRS → UnderwriteIQ engine → tier / route.
- Sim path: known — sandbox JSON fixtures + `simulate-client` / `routeOutcome`. Use for routing proof when wire is fenced; prefer live sandbox login when `ADAPTERS_DRY_RUN` allows.
- Live CRS host stays off (`CRS_ALLOW_LIVE=0`).

## Evidence

### Resend (2026-08-14) — PASS
Provider `send()` to `stanbridgejchris@gmail.com` → `status=sent`, provider message id set (len 36). From: onboarding@resend.dev (free tier). Prod still needs deploy + migration 164 for CRM compose path.

### CRS sandbox login (2026-08-14) — PASS
`createCrsClient().login()` against `api-sandbox.stitchcredit.com` → OK. Soft-pull order + tier next. Live creds stored as `CRS_LIVE_*` only; `CRS_ALLOW_LIVE=0`.

### Sim routing (earlier) — PASS (engine only)
Fixtures → `runCRSEngine` → `MANUAL_REVIEW` (median 636).

### Twilio Business Profile (2026-08-14)

Owner email: Business Profile **Approved**.
- Account SID set (`TWILIO_ACCOUNT_SID` / `TWILIO_SEND_ACCOUNT_SID`)
- TrustHub Bundle SID set (`TWILIO_TRUSTHUB_BUNDLE_SID`)
- Still need: SMS-capable **from number** (`TWILIO_SEND_FROM`) + working send auth; A2P campaign if required for US 10DLC.

### Twilio from-number (2026-08-14)
- Number purchased: `+15613048368` (West Palm Beach, FL) → `TWILIO_SEND_FROM` set locally + Netlify.
- Compliance: pick **Messaging** first (Voice later). A2P/registration still required for US SMS.

### Twilio A2P Brand submitted (2026-08-14)
- Low Volume Standard Brand submitted on Twilio (standalone — GHL approval does **not** carry over).
- Waiting on TCR/Twilio Brand review before campaign + reliable US SMS.
- From number ready: `+15613048368`.

### Twilio A2P Campaign submitted (2026-08-14 ~10:43 PDT)
- Use case: Low Volume Mixed / LOW_VOLUME
- Web form opt-in, fundhub.ai privacy/terms, lending + links + phone numbers declared
- Sample #4 includes three-way intro with `[phone]`
- Owner expects quick approval; typical is minutes–days. When approved: probe SMS to `+16616180865` via Twilio provider.

### CRM demo wipe — DONE (2026-08-14 via Supabase MCP)

- Was: 60 clients (15 `is_demo` + many `+test`/gauntlet).
- Now: **18** clients, **0** `is_demo`.
- Removed: demo roster, `+test`/gauntlet/sim/w3/w4, `@example.com` probes, TEST role client, joke probe.
- Demo lenders deleted. Demo staff **suspended** (cannot hard-delete — journey FKs).
- Org `demo_mode_enabled` = **false**.
- Left are mostly ClickFunnels leads + your emails. CCP “Derek Owusu” with no `?id=` is still UI sample filler, not a DB row.
- Pipeline board may show empty until cards exist for remaining clients (demo cards were wiped with clients).
