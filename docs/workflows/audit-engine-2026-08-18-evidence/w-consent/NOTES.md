# W-CONSENT findings

Ground truth: Chris 2026-08-18 order. Intended journeys only say the consent **route** is reachable for client, closer, funding-advisor, and owner. No intended file names the pull-gate shape. That absence is MISSING, not a license to invent “should.”

**COMPLIANCE REVIEW REQUIRED** — consent capture and pull gate.

## What the capture call needs

`POST /api/consent/capture` grant for a soft pull needs:

- `client_id` (uuid)
- `capture_method`: typed, checkbox, or signature
- `granted_name` only if typed or signature
- `kind` may be omitted; it defaults to `soft_pull_consent`

The words are never taken from the body. The server stores its own `soft-pull-v1` text. Org and who granted come from the session.

Evidence: `handler-required.json`

## Live capture on this simulated file

`POST` on `https://fundhub.ai` with checkbox, this client.

- Status **200**
- New row id `7057e732-9411-4512-98b9-23a7a1fe7d77`
- Kind `soft_pull_consent`, version `soft-pull-v1`, valid

Evidence: `capture-response.json`

## Row vs pull gate — match, with one trap

The gate is `requestSoftPull()` in `src/finance/soft-pulls.mjs`. It asks `consentStatus()` on table **`client_consents`**, org + client + kind **`soft_pull_consent`**, and these columns: not revoked, not expired, already started. Newest valid row wins.

Capture writes that same table and those same fields. **Match.**

What the gate does **not** read:

- `clients.consent_sms` (simulate sets this to true)
- custom-field soft-pull columns (none on this file)
- a signed soft-pull **document** (none on this file)

Read-compare file `8556bedc-…` has a valid `dispute_authorization` row only. That kind does not open the pull gate.

Evidence: `consent-row.json`, `consent-row-before.json`, `consent-row-after.json`

## Button: refuse, then accept-ready

**Before capture**

- Pull TransUnion is on the Client Control Panel and looks enabled.
- Pressed once. Live answer: **403** `consent_required` — “no soft-pull consent on file for this client — capture consent before requesting a pull.”
- No bureau call. No `soft_pull_requests` row.

**After capture**

- Same button still looks enabled. The screen does not lock or unlock it.
- `GET /api/consent/capture` says `valid`. That is accept at the gate.
- Did **not** press pull.

Evidence: `ccp-before-consent.png`, `ccp-before-pull-refuse.png`, `pull-refuse-before.json`, `ccp-after-consent.png`, `ccp-after-actions.png`, `consent-get-after.json`

## Stopped before a bureau call

Next hop if anyone presses pull: `POST /api/finance/crs-pull` → `requestSoftPull` (would now accept) → `runCrsPull` → CRS order.

Sandbox mode exists in code (sandbox host + canned people). On the **live** site the host class is **production**, `CRS_ALLOW_LIVE` is on, and the outbound fence is down. Pressing pull would start a **live** bureau order, not sandbox.

`CRS_ACTIVE_BUREAUS` on live is Experian + Equifax. The TransUnion button still sends bureau `TU`.

This simulated client has **no** identity row. A press would still enter the live path and would likely fail later with “no identity on file.” Not pressed.

CRS names confirmed (no values): `CRS_API_HOST`, `CRS_API_USERNAME`, `CRS_API_PASSWORD`, `CRS_ALLOW_LIVE`, `CRS_ACTIVE_BUREAUS`, `CRS_LIVE_API_HOST`, `CRS_LIVE_API_USERNAME`, `CRS_LIVE_API_PASSWORD`, `ADAPTERS_DRY_RUN`.

Evidence: `stop-at-gate.json`, `live-env-class.json`, `crs-env-names.json`

## Simulate stamp

**Before:** `consent_sms=true`, `client_consents` empty.  
**After:** `consent_sms` still true. One new `client_consents` row from this capture. Simulate never wrote a consent row.

Evidence: `consent-row-before.json`, `consent-row-after.json`

## Did not touch

Live credit file `9af65808-…`. Compare file `8556bedc-…` read only. No deploy. No teardown. No `CRS_ALLOW_LIVE` change.
