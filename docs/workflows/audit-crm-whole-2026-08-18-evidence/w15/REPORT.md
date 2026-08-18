# W15 — GoHighLevel side (read-only)

**Date:** 2026-08-18  
**Live GHL list:** refused (401). Repo + database used for the rest. Those parts are **UNVERIFIED** for what GHL is doing right now.

## Answer first: leftover box

GoHighLevel is a leftover box. It is not driving the live site.

Owner already cut it off (2026-08-14). Texts now go to Twilio. Email now goes to Resend. The old GHL text sender is a dead stub. The live site has no door for GHL to talk back. A live post to `https://fundhub.ai/api/webhooks/ghl` gets **404** (`unknown provider: ghl`). The capture table has **418** ClickFunnels rows and **zero** GHL rows.

What is still true: some old GHL “catch a post” doors still answer on GHL’s side. They want a body. I did not send one. I cannot see if any GHL workflow behind those doors is still on.

## Workflows table

I asked GHL for every workflow. GHL said no.

| Key used | What GHL said |
|---|---|
| `GHL_RELAY_API_KEY` (local + Netlify) | **401** “The token is not authorized for this scope.” |
| `GHL_API_KEY` (Netlify only; not in local `.env`) | **401** “Invalid JWT” |
| `GHL_PRIVATE_API_KEY` (Netlify only) | **401** “Invalid JWT” |

So there is **no live list** of GHL names, triggers, or on/off. I will not invent that list.

The map people cite is missing:

- `fundhub-docs/sources/ghl-crm-source-of-truth.md` — **not in the repo**
- `GHL-System-Map.md` — **not in the repo**

What we do have is an old port table (`workflow-migration-table.md`) that says GHL once had about **140** workflows. Code comments still name **18** GHL ids. Live on/off for every one of those is **UNVERIFIED**.

| Code name | Old GHL id (from a comment) | What the comment says it did | On GHL now |
|---|---|---|---|
| N-01 cold nurture | `c1172aa2-9a44-4eef-a439-8347457f60bd` | Long cold follow-up | UNVERIFIED |
| N-02 warm nurture | `d7e27768-7c48-4329-80f4-f0b6a77980a1` | Warm follow-up | UNVERIFIED |
| N-03 hot nurture | `831135dd-175d-4854-b555-1d7582a30249` | Hot follow-up | UNVERIFIED |
| N-04 post-funding nurture | `e7607d09-4882-470a-ac56-8ed216c573a8` | After funded | UNVERIFIED |
| N-06 renewal second wave | `61b70897-fbf8-47e2-ae09-ea51a4af0279` | Later funding wave | UNVERIFIED |
| AF-02 referral ownership | `0c561c0b-6216-4068-844d-35f307285ca6` | Who owns the referral | UNVERIFIED |
| F-01 funding intake | `2cc2c234-c7ff-4889-9501-b5f75c67b3c9` | Funding start | UNVERIFIED |
| F-02 portal / id missing | `4deadbb0-4749-45e5-a1b7-59ccb3d46f4a` | Missing portal id | UNVERIFIED |
| F-03 round submitted | `40fc2df8-ac2c-4c75-ae75-5ac598ecb95e` | Round sent in | UNVERIFIED |
| F-04 round approvals | `79c4a7b9-5875-40b6-bfc4-fbbd5f740410` | Round approved | UNVERIFIED |
| F-05 inquiry cleanup gate | `51d0d34f-7750-4f1e-a3e6-8a0bfb0ce282` | Inquiry gate | UNVERIFIED |
| F-06 missing docs | `6e296a07-a758-49cb-ac71-686b1ec1da54` | Hold for docs | UNVERIFIED |
| F-07 funding locked | `992e1734-3d5b-4d51-91cb-7b665650f407` | Funding locked | UNVERIFIED |
| F-08 post-funding monitor | `b1dae8c5-8cca-4b0d-a29f-dcedaff796a8` | After funded watch | UNVERIFIED |
| F-09 declined / no path | `2af6ed68-3661-4b3b-821f-5b4e49c0e52a` | No funding path | UNVERIFIED |
| F-10 inbox provisioner | `b76f38d2-057f-481b-a0e4-13d88fe8ab19` | Make a bank inbox | UNVERIFIED |
| F-11 bank email router | `f4a6d38d-7717-4f3c-96f6-84c81e885022` | Bank mail events | UNVERIFIED |
| C-03 inquiry removed | **no GHL id in code** | Resume or hold after inquiries | UNVERIFIED — see C-03 below |

C-03, C-00, C-02, S-01, S-04, U-02, and others only say “GHL-System-Map.md”. That file is gone. No trigger. No on/off.

## A2P 10DLC status

**Live proof: none. Status is UNVERIFIED.**

| Side | What I could check | Result |
|---|---|---|
| GHL | Phone / 10DLC APIs | Same 401 as workflows. No GHL A2P status. |
| Twilio (local `.env`) | Names only | `TWILIO_ACCOUNT_SID`, `TWILIO_SEND_ACCOUNT_SID`, `TWILIO_SEND_FROM`, `TWILIO_TRUSTHUB_BUNDLE_SID` are set. `TWILIO_AUTH_TOKEN` and `TWILIO_SEND_AUTH_TOKEN` are **missing**. Cannot ask Twilio. |
| Twilio (Netlify names) | Names are set | The CLI values I got for the secrets look cut short. Twilio then said **401 invalid username**. That is not a clean “approved / pending / rejected”. |
| Last written note | `docs/workflows/ghl-out-crs-today.md` | Brand submitted **2026-08-14**. Campaign submitted **2026-08-14 ~10:43 PDT** (Low Volume Mixed). From number ready. **Not proven approved.** Owner law: do not treat SMS as live until that prove. |

GHL approval does **not** carry to Twilio. That is already written in the cutover note.

## Custom fields

**Live GHL field list: refused (401).** What follows is the platform copy.

| Fact | Proven |
|---|---|
| Old GHL location used to generate the table | `ORh91GeY4acceSASSnLR` — 300 fields written into `db/schema/005_client_custom_fields.sql` |
| Live GHL: which fields exist now | UNVERIFIED (401) |
| Live GHL: which are empty on GHL contacts | UNVERIFIED (401). I did not open contacts. |
| Platform write target | Local only. `mergeCustomFields` updates `clients.custom_fields` in our database. It does **not** write to GHL. |
| Typed copy table | `client_custom_fields` has **17** rows. Most of the 300 columns are unused. |
| Clients | **38** clients. **28** still have an old `ghl_contact_id`. **10** have none. **5** have an empty field bag. **11** are marked `ghl_link_missing` (6 = not set up, 5 = GHL upsert **401**). |

Fields the **platform** still writes (to our database, not to GHL):

`lifecycle_status`, `call_outcome`, `employee_next_action`, `round_hold_reason`, `ready_for_next_round`, `run_inquiry_removal`, `analyzer_status`, `funding_delivery_sent`, `product_path`, `decision_status`, `last_progress_timestamp`, `last_progress_action`, `bs_email_last_sent_ts`, `bs_sms_last_sent_ts`, `bs_precall_start_ts`, `diy_status`, `funding_locked_date`, `funding_email_forwarding_address`, `first_touch_date`, `lead_magnet_type`, plus LTV / CRS / analyzer keys on those paths.

Most used keys on live clients (count of clients that have the key): `lifecycle_status` 27, survey `cf_svy_*` 17, `call_outcome` 15, `ghl_link_missing` 11, `round_hold_reason` 8. The other ~270 GHL-era names do not show up on live rows.

The site still tries to link a new client to GHL when a key is present. That is leftover. Five live rows already show that poke failed with **401**.

## Webhooks in vs out

### GHL → platform (in)

**Not configured on the platform. Not proven on GHL.**

- Live `POST /api/webhooks/ghl` → **404** `unknown provider: ghl` (W6, 2026-08-18).
- Capture table: **0** GHL rows. Only ClickFunnels (418, last 2026-08-18).
- Router known doors: ClickFunnels, Commas, Bland, Cal.com, Lendflow, inquiry-removal, Twilio, Mailgun, PostGrid. **No `ghl`.**
- I could not list GHL’s outgoing webhook subscriptions. Those list URLs **404** or **401**.

### Platform → GHL (out)

**Live product path: nothing lands.**

- `ghl_relay` send is a no-op. It logs and refuses. Texts are routed to **Twilio**.
- Field writes stay in our database.
- Old vendor files still hard-code GHL catch-URLs (UnderwriteIQ U-01/U-02/U-03, inquiry F-10R, old DisputeFox). Those are not the live CRM send path.

I only **GET**-checked five of those old catch-URLs. All five answered **200** with “send a body.” So the GHL location still has leftover catch-doors. I did **not** POST. I do not know if a workflow still runs behind them.

## C-03 on GHL side: exists or not

**Not proven. Most likely there is no live GHL copy we can see.**

| Check | Result |
|---|---|
| Live GHL workflow named C-03 | UNVERIFIED — list refused |
| GHL id in our C-03 file | **None.** Comment only says `GHL-System-Map.md` Credit Ops. That file is missing. |
| String `inquiry_removal_complete` anywhere in the repo | **Zero hits** |
| Platform C-03 | Exists. File `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs`. Listens for `inquiry.removed`. Writes local fields / tags / a task. |
| Live `inquiry.removed` events | **0**. C-03 has never run on live data. Closest event is `inquiry.gate.clear` (4). |

So: the platform has C-03. GHL’s copy was not found. The name the brief used (`inquiry_removal_complete`) is not in this repo.

## Pipelines vs platform

**Live GHL pipelines: refused (401). Cannot match boards.**

Platform boards in the live database (names only):

| Board | Stages (in order) |
|---|---|
| Sales | New Lead → Survey Complete → Booked → Confirmed → Showed → Diagnostic Paid → Decision Rendered → Closed Won (deposit) → Downsell → Lost |
| Funding: Card Stacking | Apply Now → Round Submitted → Approved → Action Required → Funded → Closed |
| Funding: Alt-Fin (Lendflow) | App Created → Docs/Stips → Underwriting → Offers → Offer Accepted → Funded → Closed |
| Optimization (Repair) | Intake → Awaiting Documents → Analysis → Letters Generated → Ready to Send → In Transit → Awaiting Response → Response Received → Round Complete → Program Complete, plus On Hold / Stalled / Cancelled, plus four old hidden stages |
| Inquiry Removal | Requested → Specialist Assigned → Awaiting Documents → Letters Sent → Calls In Progress → Removed → Resume Funding → Hold |
| AR / Collections | Invoice Sent → Reminder → Escalation → Paid → Written Off |
| Hiring | Applied → Screening → Group Interview → 1:1 → Offer → Hired → Onboarding → Ramp → Performing → Not Moving Forward → Withdrawn |
| Affiliates + White Label | Recruiting → Invited → Agreement Signed → Active → Paused |

The seed file says those sales / funding / inquiry names were copied from **old** GHL stages. That is history, not a live match. Inquiry Removal in the live database has two extra stages vs the first seed (`Awaiting Documents`, `Letters Sent`).

## Fires the platform never hears

If GHL still runs anything, the platform does not hear it.

- No inbound GHL door (404).
- No GHL rows in captures.
- No events whose name contains `ghl`.
- `inquiry.removed` has never landed, so C-03 has never run live.
- Agent picker skips runtime `ghl` (owner 2026-08-15).
- SMS routing is Twilio, not GHL.
- Old GHL catch-doors still exist. If something still posts to them, GHL might move a contact and we would never know.

## Failures (capped)

1. **Journey:** GHL side / list every workflow  
   **Step:** GET workflows  
   **Expected:** name, trigger, on/off  
   **Observed:** 401 scope / Invalid JWT  
   **Evidence:** `w15/probe.json`, `w15/netlify-probe.json`, `w15/pit-probe.json`

2. **Journey:** GHL side / A2P 10DLC  
   **Step:** Read approved / pending / rejected and since when  
   **Expected:** live status  
   **Observed:** GHL 401. Twilio auth missing or refused. Last note is “submitted 2026-08-14,” not proven.  
   **Evidence:** `w15/netlify-probe.json`, `docs/workflows/ghl-out-crs-today.md`

3. **Journey:** GHL → platform webhook  
   **Step:** GHL posts in  
   **Expected:** a door that stores the post  
   **Observed:** 404 unknown provider; 0 GHL captures  
   **Evidence:** `w6/hooks-probe.json`, live `webhook_captures` in `w15/probe.json`

4. **Journey:** C-03 on GHL  
   **Step:** Find GHL copy of inquiry-removed  
   **Expected:** a GHL workflow for `inquiry_removal_complete`  
   **Observed:** no id, no source file, no string in repo; live list refused  
   **Evidence:** `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs`, this folder

## Stop line

No changes on either side. I did not edit GHL. I did not edit the app. I did not edit the board. I did not commit.
