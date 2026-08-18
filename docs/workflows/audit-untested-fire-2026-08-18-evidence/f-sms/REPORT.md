# F-SMS — One SMS to FUNDHUB_TEST_PHONE

**Result: PASS — Twilio accepted (transmit proof)**

Chris’s claim: send one short SMS to `FUNDHUB_TEST_PHONE`. If Twilio accepts, that is transmit proof. Device photo is bonus.

Ground truth: **MISSING** from `docs/journeys/*-intended.md`. No intended journey names “SMS lands on the test phone.” Expected here is what Chris named on the fire board.

`FUNDHUB_TEST_PHONE` set: **yes.** Number not printed.

Did not open or write `9af65808-…`. Did not deploy. Did not commit. Did not edit app code.

---

## Send path

Staff Messaging → `POST /api/messages` → `composeAndSend` → dispatcher → Twilio.

The screen has **no To box**. Destination is the stored client phone. Same API the screen uses.

CRM sender context: TEST client `8556bedc-…` only.

---

## Env names (local `.env`, values not printed)

| Name | Set |
|---|---|
| `TWILIO_ACCOUNT_SID` | yes |
| `TWILIO_AUTH_TOKEN` | **no** |
| `TWILIO_SEND_FROM` | yes |
| `TWILIO_SEND_ACCOUNT_SID` | yes |
| `TWILIO_SEND_AUTH_TOKEN` | **no** |
| `MESSAGING_DRY_RUN` | **no** (local) |

Live send still reached Twilio, so the live box has send auth even though the two token names are unset locally.

**Evidence:** `00-env-names.json`

---

## 1. One send

**Expected:** One SMS, body `Fundhub e2e ping — ignore.`, To = `FUNDHUB_TEST_PHONE`.

**Observed:** TEST had no phone. Screen has no To box. Set TEST phone to `FUNDHUB_TEST_PHONE` (TEST only). Logged in as staff (`chris@`, owner). One `POST /api/messages` → **200**, `outcome=sent`. Did not send a second time.

**Result:** Sent once.

**Evidence:** `02-test-phone.json`, `03-login.json`, `04-send.json`

---

## 2. Messages row

**Expected:** status, provider, error, provider id.

**Observed:**

| Field | Value |
|---|---|
| id | `8755f790-64d1-4cf5-b3bf-e12a113601de` |
| test client | yes |
| live file | no |
| channel | sms |
| status | **sent** |
| provider | **twilio** |
| error | none |
| provider id | SM… (34 chars) |
| To = `FUNDHUB_TEST_PHONE` | yes |
| body is ping | yes |
| created | 2026-08-18T21:42:25.653Z |

**Result:** Twilio accepted. Transmit proof.

**Evidence:** `05-message-row.json`, `04-send.json`

---

## 3. Phone / device

**Expected:** Device shot is bonus. Do not fail the unit without it.

**Observed:** No device photo. Messaging screen opened on TEST only. No To box. Did not click Send again.

**Result:** Device landing **UNVERIFIED**. Does not fail this unit.

**Evidence:** `06-screen.json`, `shots/01-messaging-after-send.png`

---

## Findings

1. Intended journey does not name SMS landing.
2. One send to `FUNDHUB_TEST_PHONE` via TEST client. Twilio accepted. Row `8755f790-…` status `sent`, provider `twilio`, no error, provider id SM….
3. Local `TWILIO_AUTH_TOKEN` / `TWILIO_SEND_AUTH_TOKEN` unset. Live send still worked.
4. Device landing not proven.
