# C — Timing audit

Read-only. Every registered workflow from `src/workflows/` (excluding helpers).

Count: 55 workflow files audited.

| Id | Kind | Trigger | Sleeps | Template keys |
|---|---|---|---|---|
| af-02-referral-ownership-capture | non-agentic | event:entry.captured, event:diagnostic.paid, event:analysis.completed | — | — |
| ai-set-01-josh-setter | agentic | event:booking.created | — | — |
| ai-set-03-no-answer-cadence | non-agentic | event:call.completed | wait-30-min="30m"; wait-2-hr="2h" | SMS-AISET03-MSG1, SMS-AISET03-MSG2, SMS-AISET03-MSG3 |
| ai-set-04-3way-handoff | non-agentic | event:booking.created | wait-until-t-minus-15=target | SMS-AISET04-HANDOFF |
| at-01-first-touch-capture | non-agentic | event:entry.captured | — | — |
| bc-01-customer-responsiveness | non-agentic | event:round.started | wait-24h="24h"; wait-48h="48h" | — |
| bc-02-customer-friction | non-agentic | event:round.started | — | — |
| bs-01-precall-launcher | non-agentic | event:booking.created | wait-sms-precall=SMS_PRECALL_WAIT; wait-sms-dayof=target | SMS-BS01-01-BOOKED, SMS-BS01-02-PRECALL, SMS-BS01-03-DAYOF, 24h, BS-FUND, BS-REPAIR |
| c-00-crs-soft-pull-request | non-agentic | event:diagnostic.paid | — | — |
| c-02-inquiry-created | non-agentic | event:analysis.completed | — | — |
| c-02b-inquiry-removal-requested | non-agentic | event:deposit.paid | — | — |
| c-03-inquiry-removed-resume-or-hold | non-agentic | event:inquiry.removed | — | — |
| c-05-pre-funding-review | non-agentic | event:round.started | — | — |
| c-06-crs-results-router | non-agentic | event:analysis.completed | — | EMAIL-C06-DECLINE, SMS-C06-DECLINE |
| contract-chaser | non-agentic | ? | — | — |
| dpc-01-analyzer-lock | non-agentic | event:analysis.completed | — | — |
| dpc-02-call-outcome-enforcement | non-agentic | event:booking.created | wait-until-5-min-after-end=wakeAt | — |
| dpc-03-inbound-reply-router | non-agentic | event:message.inbound | — | SMS-DPC04-RESCHEDULE-REBOOKING |
| dpc-05-no-progress-escalation | non-agentic | event:booking.created | wait-72h="72h" | EMAIL-DPC05-NO-PROGRESS-72H, SMS-DPC05-NO-PROGRESS-72H |
| ds-01-repair-referral | non-agentic | event:call.completed | — | SMS-DS01-REPAIR-REFERRAL, EMAIL-DS01-REPAIR-REFERRAL |
| ds-02-diy-letters | non-agentic | event:payment.received | — | EMAIL-DS02-DIY-LETTERS-READY |
| f-01-funding-intake | non-agentic | event:round.started | — | — |
| f-02-portal-id-missing | non-agentic | event:round.started | wait-initial="3h"; wait-followup="2d" | EMAIL-F02-ID-PORTAL-NEEDED, SMS-F02-ID-PORTAL-NEEDED, EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP |
| f-03-round-submitted | non-agentic | event:round.submitted | — | EMAIL-F03-ROUND-SUBMITTED, SMS-F03-ROUND-SUBMITTED |
| f-04-round-approvals | non-agentic | event:round.approved | — | EMAIL-F04-ROUND-APPROVALS, SMS-F04-ROUND-APPROVALS |
| f-05-inquiry-cleanup-gate | non-agentic | event:round.approved | — | — |
| f-06-funding-conditions-missing-docs | non-agentic | event:mail.response, event:docs.received | — | EMAIL-F06-MISSING-DOCS, SMS-F06-MISSING-DOCS |
| f-07-funding-locked | non-agentic | event:round.funded | — | EMAIL-F07-FUNDING-LOCKED, SMS-F07-FUNDING-LOCKED |
| f-08-post-funding-monitoring | non-agentic | event:round.funded | — | — |
| f-09-funding-declined-no-path | non-agentic | event:mail.response | — | — |
| f-10-client-funding-inbox-provisioner | non-agentic | event:round.started | — | EMAIL-F10-INBOX-SETUP, SMS-F10-INBOX-SETUP |
| f-11-bank-email-event-router | non-agentic | event:mail.response | — | — |
| inquiry-call-sweeper | agentic | cron:*/15 * * * * | — | — |
| message-dispatch-sweeper | non-agentic | ? | — | — |
| n-01-cold-nurture | non-agentic | event:entry.captured | — | EMAIL-N01-COLD-NURTURE, SMS-N01-COLD-NURTURE |
| n-02-warm-nurture | non-agentic | event:survey.submitted | — | EMAIL-N02-WARM-NURTURE, SMS-N02-WARM-NURTURE |
| n-03-hot-nurture | non-agentic | event:booking.created, event:call.completed | — | EMAIL-N03-HOT-NURTURE, SMS-N03-HOT-NURTURE |
| n-04-post-funding-nurture | non-agentic | event:round.funded | — | EMAIL-N04-POST-FUNDING, SMS-N04-POST-FUNDING |
| n-06-renewal-second-wave | non-agentic | event:round.funded | wait-6-months="180d" | EMAIL-N06-RENEWAL, SMS-N06-RENEWAL |
| repair-bureau-response-reader | agentic | event:docs.received | — | — |
| round-started-client-notify | non-agentic | event:round.started | — | SMS-ROUND-STARTED-NOTIFY |
| s-01-new-lead-intake | non-agentic | event:entry.captured | — | — |
| s-02-incomplete-survey-nudge | non-agentic | event:entry.captured | wait-20-min="20m" | EMAIL-S02-FINISH-APPLICATION |
| s-04-call-booked | non-agentic | event:booking.created | — | — |
| s-04b-booking-reminders | non-agentic | event:booking.created | wait-t-minus-24h=t24; wait-t-minus-2h=t2 | SMS-S04-01-CONFIRM, SMS-S04-02-REMIND-24H, SMS-S04-03-REMIND-2H |
| s-05a-no-show-recovery | non-agentic | event:booking.noshow | — | EMAIL-S05A-NOSHOW-RECOVERY, SMS-S05A-NOSHOW-RECOVERY |
| s-06-post-call-funding-purchased | non-agentic | event:deposit.paid | — | — |
| s-08-post-call-funding-declined | non-agentic | event:call.completed | — | — |
| s-nobook-chase | non-agentic | event:survey.submitted | wait-2h="2h"; wait-24h="24h"; wait-72h="72h" | SMS-NOBOOK-01, SMS-NOBOOK-02, SMS-NOBOOK-03 |
| sys-01-client-value-calculator | non-agentic | event:round.approved | — | — |
| sys-01-ltv-calculator | non-agentic | event:round.funded | — | — |
| u-02-analyzer-complete-delivery | non-agentic | event:analysis.completed | — | EMAIL-U02-ANALYZER-FUNDING-DELIVERY, EMAIL-U02-ANALYZER-REPAIR-DELIVERY |
| u-03-crs-snapshot-sync | non-agentic | event:analysis.completed | — | — |
| u-04-promote-crs-primary | non-agentic | event:analysis.completed | — | — |
| u-05-data-health-monitor | non-agentic | event:analysis.completed | — | — |

## Per-workflow detail

### af-02-referral-ownership-capture

- File: `src/workflows/af-02-referral-ownership-capture.mjs`
- Name: AF-02 — Referral Ownership Capture
- Kind: **non-agentic**
- Triggers: entry.captured, diagnostic.paid, analysis.completed
- Header skim: // AF-02 — Referral Ownership Capture. // Source: GHL workflow 0c561c0b-6216-4068-844d-35f307285ca6 (ghl-crm-source-of-truth.md). // // Original triggers were "Tag Added: lead:new / analyzer:started / analyzer:complete" // — all three map cleanly onto canonical events already in 

### ai-set-01-josh-setter

- File: `src/workflows/ai-set-01-josh-setter.mjs`
- Name: Setter Josh
- Kind: **agentic**
- Triggers: booking.created
- Header skim: // AI-SET-01 — Josh Setter. // Source: GHL-System-Map.md AI SETTER section / vendor setter-prompt.js. // Trigger: booking.created. Dials Josh to confirm the Strategy Session. // // THE SCRIPT IS NOT REWRITTEN HERE. Prefer the live AG-04 row (Agent Editor). // If that row is missi

### ai-set-03-no-answer-cadence

- File: `src/workflows/ai-set-03-no-answer-cadence.mjs`
- Name: AI-SET-03 — No-Answer SMS Cadence
- Kind: **non-agentic**
- Triggers: call.completed
- Sleeps: `wait-30-min` → "30m"; `wait-2-hr` → "2h"
- Keys: `SMS-AISET03-MSG1`, `SMS-AISET03-MSG2`, `SMS-AISET03-MSG3`
- Header skim: // AI-SET-03 — No-Answer SMS Cadence. // Source: GHL-System-Map.md AI SETTER section. // Audit fix applied (workflow-coherence-audit.md: "all 3 waits = 1 min → triple- // texts client in ~2 min. Change to 30 min / 2 hr / 24 hr") — done below. Real, // compliance-scrubbed copy see

### ai-set-04-3way-handoff

- File: `src/workflows/ai-set-04-3way-handoff.mjs`
- Name: AI-SET-04 — 3-Way Text Handoff
- Kind: **non-agentic**
- Triggers: booking.created
- Sleeps: `wait-until-t-minus-15` → target
- Keys: `SMS-AISET04-HANDOFF`
- Header skim: // AI-SET-04 — 3-Way Text Handoff. // Source: GHL-System-Map.md AI SETTER section. // Audit fix applied (Spec §6 + workflow-coherence-audit.md: "draft, never fires, no // trigger, no advisor follow-up. Publish, wire into DPC-03, add advisor message") — // this file IS that publis

### at-01-first-touch-capture

- File: `src/workflows/at-01-first-touch-capture.mjs`
- Name: AT-01 — First Touch Capture
- Kind: **non-agentic**
- Triggers: entry.captured
- Header skim: // AT-01 — First Touch Capture. // Source: GHL-System-Map.md ATTRIBUTION WORKFLOWS section. // AT-02 (Attribution Normalizer) is a defensive re-check of the same "don't // overwrite First Touch Date once set" rule this file already enforces via its own // gate — merged in rather 

### bc-01-customer-responsiveness

- File: `src/workflows/bc-01-customer-responsiveness.mjs`
- Name: BC-01 — Customer Responsiveness Classifier
- Kind: **non-agentic**
- Triggers: round.started
- Sleeps: `wait-24h` → "24h"; `wait-48h` → "48h"
- Header skim: // BC-01 — Customer Responsiveness Classifier. // Source: GHL-System-Map.md BEHAVIORAL COMPLIANCE section. // Writes to behavior_scores.responsiveness (numeric) — the schema's nightly-scoring // column already anticipated this. GHL's categorical Fast/Normal/Slow is mapped to // 1

### bc-02-customer-friction

- File: `src/workflows/bc-02-customer-friction.mjs`
- Name: BC-02 — Customer Friction Level Detector
- Kind: **non-agentic**
- Triggers: round.started
- Header skim: // BC-02 — Customer Friction Level Detector. // Source: GHL-System-Map.md BEHAVIORAL COMPLIANCE section. // Writes to behavior_scores.friction (numeric). GHL's High/Medium/Low mapped to // 1.0/0.5/0.0 (same mapping convention as BC-01's responsiveness). // // Trigger: round.start

### bs-01-precall-launcher

- File: `src/workflows/bs-01-precall-launcher.mjs`
- Name: kickoff
- Kind: **non-agentic**
- Triggers: booking.created
- Sleeps: `wait-sms-precall` → SMS_PRECALL_WAIT; `wait-sms-dayof` → target
- Keys: `SMS-BS01-01-BOOKED`, `SMS-BS01-02-PRECALL`, `SMS-BS01-03-DAYOF`, `24h`, `BS-FUND`, `BS-REPAIR`
- Header skim: // BS-01 — Pre-Call Backend Launcher. // Source: GHL-System-Map.md BACK-END SELLING section. // Merges in BS-EMAIL-FUNDING-72HR (live) and BS-EMAIL-REPAIR-72HR (live): both are // "Add to workflow" targets BS-01 enrolls into, not independently-triggered // workflows, so they're o

### c-00-crs-soft-pull-request

- File: `src/workflows/c-00-crs-soft-pull-request.mjs`
- Name: C-00 — CRS Soft Pull Request
- Kind: **non-agentic**
- Triggers: diagnostic.paid
- Header skim: // C-00 — CRS Soft Pull Request (Invoice/Consent -> Paid Gate -> Request -> Pull). // Source: GHL-System-Map.md CREDIT OPS WORKFLOWS section. // The original's Airtable webhook calls are NOT ported — Spec §6: the AX series // (GHL<->Airtable mirroring) dissolves entirely with one

### c-02-inquiry-created

- File: `src/workflows/c-02-inquiry-created.mjs`
- Name: C-02 — Inquiry Created
- Kind: **non-agentic**
- Triggers: analysis.completed
- Header skim: // C-02 — Inquiry Created -> Assign Inquiry Specialist. // Source: GHL-System-Map.md CREDIT OPS WORKFLOWS section. // Trigger: analysis.completed, gated on the payload carrying newly found inquiries // (payload.newInquiries — an array of { bureau, inquiry } pairs). Logs each into

### c-02b-inquiry-removal-requested

- File: `src/workflows/c-02b-inquiry-removal-requested.mjs`
- Name: C-02B — Inquiry Removal Requested
- Kind: **non-agentic**
- Triggers: deposit.paid
- Header skim: // C-02B — Inquiry Removal Requested. // Source: GHL-System-Map.md CREDIT OPS WORKFLOWS section (single-step workflow). // Trigger: deposit.paid — Spec §4.2's explicit auto-trigger: "deposit.paid -> set // run_inquiry_removal -> IRA schedule-call flow". This is that trigger, port

### c-03-inquiry-removed-resume-or-hold

- File: `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs`
- Name: C-03 — Inquiry Removed
- Kind: **non-agentic**
- Triggers: inquiry.removed
- Header skim: // C-03 — Inquiry Removed -> Resume or Hold (Fraud Alert Gate). // Source: GHL-System-Map.md CREDIT OPS WORKFLOWS section. // Trigger: inquiry.removed (exact canonical match). Gate: fraud alert present in // the payload (from whatever fraud-screening step runs during removal). im

### c-05-pre-funding-review

- File: `src/workflows/c-05-pre-funding-review.mjs`
- Name: C-05 — Pre-Funding Review Logic
- Kind: **non-agentic**
- Triggers: round.started
- Header skim: // C-05 — Pre-Funding Review Logic. // Source: GHL-System-Map.md CREDIT OPS WORKFLOWS section. // Trigger: round.started. If CRS is already complete, raises the pre-funding review // task; otherwise flags that CRS still needs to be pulled before funding can start. import { innges

### c-06-crs-results-router

- File: `src/workflows/c-06-crs-results-router.mjs`
- Name: C-06 — CRS Results Router
- Kind: **non-agentic**
- Triggers: analysis.completed
- Keys: `EMAIL-C06-DECLINE`, `SMS-C06-DECLINE`
- Header skim: // C-06 — CRS Results Router. // Source: GHL-System-Map.md CREDIT OPS WORKFLOWS section. // Trigger: analysis.completed, gated on source === "crs" (same gate as U-03/U-04 — // this reacts to the CRS pull specifically, not the analyzer estimate). Missing // results (no scores at a

### contract-chaser

- File: `src/workflows/contract-chaser.mjs`
- Name: Contracts — chase unsigned
- Kind: **non-agentic**
- Triggers: see file
- Header skim: // The contract chaser — remind the person holding up a contract, and put it on // somebody's list. // // ═══════════════════════════════════════════════════════════════════════════ // THIS ONE IS REGISTERED, UNLIKE THE DISPATCH SWEEPER NEXT DOOR — and the // difference is worth 

### dpc-01-analyzer-lock

- File: `src/workflows/dpc-01-analyzer-lock.mjs`
- Name: DPC-01 — Analyzer Lock
- Kind: **non-agentic**
- Triggers: analysis.completed
- Header skim: // DPC-01 — Analyzer Lock. // Source: GHL-System-Map.md DECISION & PROGRESS CONTROL section. // Trigger: analysis.completed. Locks in the analyzer path + progress markers. import { inngest } from "./client.mjs"; import { db } from "../db.mjs"; import { resolveClient } from "../ha

### dpc-02-call-outcome-enforcement

- File: `src/workflows/dpc-02-call-outcome-enforcement.mjs`
- Name: DPC-02 — Call Outcome Enforcement
- Kind: **non-agentic**
- Triggers: booking.created
- Sleeps: `wait-until-5-min-after-end` → wakeAt
- Header skim: // DPC-02 — Call Outcome Enforcement + Call Held. // Source: GHL-System-Map.md DECISION & PROGRESS CONTROL section. // Trigger: booking.created. Waits until 5 minutes after the appointment's end time, // then checks whether the call actually happened (call.completed fired for thi

### dpc-03-inbound-reply-router

- File: `src/workflows/dpc-03-inbound-reply-router.mjs`
- Name: DPC-03 — Inbound Reply Router
- Kind: **non-agentic**
- Triggers: message.inbound
- Keys: `SMS-DPC04-RESCHEDULE-REBOOKING`
- Header skim: // DPC-03 — Inbound Reply Router (merges in DPC-04 — Decision Finalizer, AND the // separate "DPC-04 — Reschedule Rebooking" workflow filed under the AS-Series // heading in the map — same key, unrelated content: a 2-step SMS + tag reacting to // the identical "reschedule" reply 

### dpc-05-no-progress-escalation

- File: `src/workflows/dpc-05-no-progress-escalation.mjs`
- Name: DPC-05 — 72-Hour No-Progress Escalation
- Kind: **non-agentic**
- Triggers: booking.created
- Sleeps: `wait-72h` → "72h"
- Keys: `EMAIL-DPC05-NO-PROGRESS-72H`, `SMS-DPC05-NO-PROGRESS-72H`
- Header skim: // DPC-05 — 72-Hour No-Progress Escalation. // Source: GHL-System-Map.md DECISION & PROGRESS CONTROL section. // Audit fix applied (workflow-coherence-audit.md: "{{booking_link}} renders blank — // use {{contact.calendar_booking_link}}") — real copy below uses the corrected // me

### ds-01-repair-referral

- File: `src/workflows/ds-01-repair-referral.mjs`
- Name: DS-01 — Repair Referral
- Kind: **non-agentic**
- Triggers: call.completed
- Keys: `SMS-DS01-REPAIR-REFERRAL`, `EMAIL-DS01-REPAIR-REFERRAL`
- Header skim: // DS-01 — Repair Referral. // Source: GHL DOWNSELL WORKFLOWS section (draft status). // Audit fix: real, compliance-scrubbed SMS copy exists (Workflow-SMS-Fixes-Ready-to- // Paste.md), but needs the real partner referral link filled in before activation // (spec §6: "DS-01: part

### ds-02-diy-letters

- File: `src/workflows/ds-02-diy-letters.mjs`
- Name: DS-02 — DIY Letters
- Kind: **non-agentic**
- Triggers: payment.received
- Keys: `EMAIL-DS02-DIY-LETTERS-READY`
- Header skim: // DS-02 — DIY Letters. // Source: GHL workflow (GHL-System-Map.md DOWNSELL WORKFLOWS section). // // HARD RULE 1 — the reason this file exists in this exact shape: dispute letters // fire ONLY on the not-qualified downsell path, never on the funding route. The // product-name ga

### f-01-funding-intake

- File: `src/workflows/f-01-funding-intake.mjs`
- Name: F-01 — Funding Intake
- Kind: **non-agentic**
- Triggers: round.started
- Header skim: // F-01 — Funding Intake (F1). // Source: GHL workflow 2cc2c234-c7ff-4889-9501-b5f75c67b3c9 (ghl-crm-source-of-truth.md). // // Original trigger: "Opportunity Stage changes to Funding Pipeline -> F1 Funding // Intake", gated on "Product Path = Funding". round.started is the canon

### f-02-portal-id-missing

- File: `src/workflows/f-02-portal-id-missing.mjs`
- Name: F-02 — Portal / ID Missing
- Kind: **non-agentic**
- Triggers: round.started
- Sleeps: `wait-initial` → "3h"; `wait-followup` → "2d"
- Keys: `EMAIL-F02-ID-PORTAL-NEEDED`, `SMS-F02-ID-PORTAL-NEEDED`, `EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP`
- Header skim: // F-02 — Portal / ID Missing (Onboarding Nudge). // Source: GHL workflow 4deadbb0-4749-45e5-a1b7-59ccb3d46f4a (ghl-crm-source-of-truth.md). // Ports the live [AGENT DRAFT] definition (the F-02 in GHL's DECOMMISSIONED folder is // the DECOM copy per the skip list; this is the oth

### f-03-round-submitted

- File: `src/workflows/f-03-round-submitted.mjs`
- Name: F-03 — Round Submitted
- Kind: **non-agentic**
- Triggers: round.submitted
- Keys: `EMAIL-F03-ROUND-SUBMITTED`, `SMS-F03-ROUND-SUBMITTED`
- Header skim: // F-03 — Round Submitted (F2/F4/F6...F20). // Source: GHL workflow 40fc2df8-ac2c-4c75-ae75-5ac598ecb95e (ghl-crm-source-of-truth.md). // Audit fix applied (Spec §6 + workflow-coherence-audit.md "Ready-to-paste copy"): // real, compliance-scrubbed SMS + email copy, not the blank/

### f-04-round-approvals

- File: `src/workflows/f-04-round-approvals.mjs`
- Name: F-04 — Round Approvals
- Kind: **non-agentic**
- Triggers: round.approved
- Keys: `EMAIL-F04-ROUND-APPROVALS`, `SMS-F04-ROUND-APPROVALS`
- Header skim: // F-04 — Round Approvals (F3/F5/F7...F21). // Source: GHL workflow 79c4a7b9-5875-40b6-bfc4-fbbd5f740410 (ghl-crm-source-of-truth.md). // Audit fix applied: real ready-to-paste SMS/email copy (workflow-coherence-audit.md), // seeded via src/workflows/templates-seed.mjs — not the 

### f-05-inquiry-cleanup-gate

- File: `src/workflows/f-05-inquiry-cleanup-gate.mjs`
- Name: F-05 — Inquiry Cleanup Gate
- Kind: **non-agentic**
- Triggers: round.approved
- Header skim: // F-05 — Inquiry Cleanup Gate (Between Rounds). // Source: GHL workflow 51d0d34f-7750-4f1e-a3e6-8a0bfb0ce282 (ghl-crm-source-of-truth.md). // // Trigger: round.approved (same trigger stage as F-04 — "Stage = Round Approvals"). // Gate: "new inquiries exist" — checked directly ag

### f-06-funding-conditions-missing-docs

- File: `src/workflows/f-06-funding-conditions-missing-docs.mjs`
- Name: F-06 — Funding Conditions / Missing Docs
- Kind: **non-agentic**
- Triggers: mail.response, docs.received
- Keys: `EMAIL-F06-MISSING-DOCS`, `SMS-F06-MISSING-DOCS`
- Header skim: // F-06 — Funding Conditions / Missing Docs. // Source: GHL workflow 6e296a07-a758-49cb-ac71-686b1ec1da54 (ghl-crm-source-of-truth.md). // Ports the live [AGENT DRAFT] definition. // // Original trigger was "Custom Field: Funding Condition Required = true" — a // downstream conse

### f-07-funding-locked

- File: `src/workflows/f-07-funding-locked.mjs`
- Name: F-07 — Funding Locked
- Kind: **non-agentic**
- Triggers: round.funded
- Keys: `EMAIL-F07-FUNDING-LOCKED`, `SMS-F07-FUNDING-LOCKED`
- Header skim: // F-07 — Funding Locked (F22). // Source: GHL workflow 992e1734-3d5b-4d51-91cb-7b665650f407 (ghl-crm-source-of-truth.md). // Audit fix applied: real ready-to-paste SMS + email-subject copy (the FR22 "Total // Funding Locked" body from EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md, grepped 

### f-08-post-funding-monitoring

- File: `src/workflows/f-08-post-funding-monitoring.mjs`
- Name: F-08 — Post-Funding Monitoring
- Kind: **non-agentic**
- Triggers: round.funded
- Header skim: // F-08 — Post-Funding Monitoring (F23). // Source: GHL workflow b1dae8c5-8cca-4b0d-a29f-dcedaff796a8 (ghl-crm-source-of-truth.md). // Audit fix applied (workflow-coherence-audit.md: "dangling wait with nothing after // it. Remove or add follow-up") — the trailing no-op wait is s

### f-09-funding-declined-no-path

- File: `src/workflows/f-09-funding-declined-no-path.mjs`
- Name: F-09 — Funding Declined / No Path
- Kind: **non-agentic**
- Triggers: mail.response
- Header skim: // F-09 — Funding Declined / No Path. // Source: GHL workflow 2af6ed68-3661-4b3b-821f-5b4e49c0e52a (ghl-crm-source-of-truth.md). // // Original trigger was "Tag Added: funding:no-path" — an undocumented upstream // assigner, same shape as N-01/02/03's tag problem. Here there's an

### f-10-client-funding-inbox-provisioner

- File: `src/workflows/f-10-client-funding-inbox-provisioner.mjs`
- Name: F-10 — Client Funding Inbox Provisioner
- Kind: **non-agentic**
- Triggers: round.started
- Keys: `EMAIL-F10-INBOX-SETUP`, `SMS-F10-INBOX-SETUP`
- Header skim: // F-10 — Client Funding Inbox Provisioner. // Source: GHL workflow b76f38d2-057f-481b-a0e4-13d88fe8ab19 (ghl-crm-source-of-truth.md). // Ports the live [AGENT DRAFT] definition. // // Original action #1 was "Send Webhook -> provision_client_funding_inbox" — an // external inbox-

### f-11-bank-email-event-router

- File: `src/workflows/f-11-bank-email-event-router.mjs`
- Name: F-11 — Bank Email Event Router
- Kind: **non-agentic**
- Triggers: mail.response
- Header skim: // F-11 — Bank Email Event Router (Inbound). // Source: GHL workflow f4a6d38d-7717-4f3c-96f6-84c81e885022 (ghl-crm-source-of-truth.md). // Spec §4 adapter note: "Mailgun adapter: unchanged inbox classification, now writing // bank_inbox + events directly (F-11 becomes a handler)"

### inquiry-call-sweeper

- File: `src/workflows/inquiry-call-sweeper.mjs`
- Name: Inquiry call sweeper (delivery + configured wait)
- Kind: **agentic**
- Triggers: */15 * * * *
- Header skim: // Sweeper — fire AI bureau calls when call_due_at elapses. // // SERVED SINCE 2026-08-19, owner decision. It was previously switched off by // being left out of src/workflows/index.mjs, which nothing counted and no // screen showed — see src/workflows/index.test.mjs, which now f

### message-dispatch-sweeper

- File: `src/workflows/message-dispatch-sweeper.mjs`
- Name: Message dispatch sweeper
- Kind: **non-agentic**
- Triggers: see file
- Header skim: // The message dispatch sweeper — the thing that calls the dispatcher on a // schedule. // // ═══════════════════════════════════════════════════════════════════════════ // IT IS NOW REGISTERED. WHAT CHANGED, AND WHY — 2026-08-02 // // This file used to open by explaining at leng

### n-01-cold-nurture

- File: `src/workflows/n-01-cold-nurture.mjs`
- Name: N-01 — Long-Term Cold Nurture
- Kind: **non-agentic**
- Triggers: entry.captured
- Keys: `EMAIL-N01-COLD-NURTURE`, `SMS-N01-COLD-NURTURE`
- Header skim: // N-01 — Long-Term Cold Nurture. // Source: GHL workflow c1172aa2-9a44-4eef-a439-8347457f60bd (ghl-crm-source-of-truth.md). // Filed in GHL under the "DECOMMISSIONED WORKFLOWS" folder alongside its own true // DECOM duplicate — the folder name is misleading (see workflow-migrati

### n-02-warm-nurture

- File: `src/workflows/n-02-warm-nurture.mjs`
- Name: N-02 — Long-Term Warm Nurture
- Kind: **non-agentic**
- Triggers: survey.submitted
- Keys: `EMAIL-N02-WARM-NURTURE`, `SMS-N02-WARM-NURTURE`
- Header skim: // N-02 — Long-Term Warm Nurture. // Source: GHL workflow d7e27768-7c48-4329-80f4-f0b6a77980a1 (ghl-crm-source-of-truth.md). // Same folder-name discrepancy as N-01 (see workflow-migration-table.md); ports the // live definition, not the [AGENT DRAFT] copy. // // Original GHL tri

### n-03-hot-nurture

- File: `src/workflows/n-03-hot-nurture.mjs`
- Name: N-03 — Long-Term Hot Nurture
- Kind: **non-agentic**
- Triggers: booking.created, call.completed
- Keys: `EMAIL-N03-HOT-NURTURE`, `SMS-N03-HOT-NURTURE`
- Header skim: // N-03 — Long-Term Hot Nurture. // Source: GHL workflow 831135dd-175d-4854-b555-1d7582a30249 (ghl-crm-source-of-truth.md). // Same folder-name discrepancy as N-01/N-02; ports the live definition, not the // [AGENT DRAFT] copy. // // Original GHL trigger was "Tag Added: nurture:h

### n-04-post-funding-nurture

- File: `src/workflows/n-04-post-funding-nurture.mjs`
- Name: N-04 — Post-Funding Nurture
- Kind: **non-agentic**
- Triggers: round.funded
- Keys: `EMAIL-N04-POST-FUNDING`, `SMS-N04-POST-FUNDING`
- Header skim: // N-04 — Post-Funding Nurture. // Source: GHL workflow e7607d09-4882-470a-ac56-8ed216c573a8 (ghl-crm-source-of-truth.md). // Ports the live [AGENT DRAFT] definition (the sole draft copy for this key; nothing // to dedupe against). // // Original GHL trigger: "Pipeline Stage Chan

### n-06-renewal-second-wave

- File: `src/workflows/n-06-renewal-second-wave.mjs`
- Name: N-06 — Renewal / Second-Wave Funding
- Kind: **non-agentic**
- Triggers: round.funded
- Sleeps: `wait-6-months` → "180d"
- Keys: `EMAIL-N06-RENEWAL`, `SMS-N06-RENEWAL`
- Header skim: // N-06 — Renewal / Second-Wave Funding. // Source: GHL workflow 61b70897-fbf8-47e2-ae09-ea51a4af0279 (ghl-crm-source-of-truth.md). // Ports the live definition. Audit fix applied (workflow-coherence-audit.md: "N-06 / // AR-03 (AGENT DRAFT) — SMS step dropped vs the DECOM version

### repair-bureau-response-reader

- File: `src/workflows/repair-bureau-response.mjs`
- Name: Repair — Bureau Response Reader
- Kind: **agentic**
- Triggers: docs.received
- Header skim: import { inngest } from "./client.mjs"; import { db } from "../db.mjs"; import { onBureauResponseDocsReceived } from "../repair/response-agent.mjs"; export async function handle({ event, db: database }) { return onBureauResponseDocsReceived(database || db, event); } export const 

### round-started-client-notify

- File: `src/workflows/round-started-client-notify.mjs`
- Name: Round Started — Client Notify
- Kind: **non-agentic**
- Triggers: round.started
- Keys: `SMS-ROUND-STARTED-NOTIFY`
- Header skim: // Round Started — Client Notify. // Source: GHL (root)-level workflow, no folder, 1 step (GHL-System-Map.md line 32-34). // Audit fix (workflow-coherence-audit.md): "orphaned root-level 1-step SMS, no // folder. Move into Funding folder" — this file IS that move; it lives alongs

### s-01-new-lead-intake

- File: `src/workflows/s-01-new-lead-intake.mjs`
- Name: S-01 — New Lead / Intake
- Kind: **non-agentic**
- Triggers: entry.captured
- Header skim: // S-01 — New Lead / Intake. // Trigger: entry.captured. Creates lifecycle status + lead tag and places a // Sales board card on new_lead so the client is visible on pipeline.html. import { inngest } from "./client.mjs"; import { db } from "../db.mjs"; import { resolveClient } fr

### s-02-incomplete-survey-nudge

- File: `src/workflows/s-02-incomplete-survey-nudge.mjs`
- Name: S-02 — Incomplete App (Survey)
- Kind: **non-agentic**
- Triggers: entry.captured
- Sleeps: `wait-20-min` → "20m"
- Keys: `EMAIL-S02-FINISH-APPLICATION`
- Header skim: // S-02 — Incomplete App (Survey). // Source: GHL-System-Map.md SALES WORKFLOWS section. // Audit fix applied (workflow-coherence-audit.md: "S-02 — 2-min wait before // survey-complete check; too short. Bump to 15-30 min") — 20 min picked (midpoint // of the given range, a timing

### s-04-call-booked

- File: `src/workflows/s-04-call-booked.mjs`
- Name: S-04 — Call Booked
- Kind: **non-agentic**
- Triggers: booking.created
- Header skim: // S-04 — Call Booked -> Move to S2. // Source: GHL-System-Map.md SALES WORKFLOWS section. // Trigger: booking.created (exact canonical match). Tags call:booked, sets // cf_call_outcome=booked, moves the sales card to the "booked" stage // (db/seed/002_pipelines.sql: sales.booked

### s-04b-booking-reminders

- File: `src/workflows/s-04b-booking-reminders.mjs`
- Name: S-04B — Booking Confirm + Reminders
- Kind: **non-agentic**
- Triggers: booking.created
- Sleeps: `wait-t-minus-24h` → t24; `wait-t-minus-2h` → t2
- Keys: `SMS-S04-01-CONFIRM`, `SMS-S04-02-REMIND-24H`, `SMS-S04-03-REMIND-2H`
- Header skim: // S-04B — Booking confirmation + reminders. // Source: GHL S-04B (confirm / T-24h / T-2h). Owner 2026-08-15: port SMS leg // only — no video links. Stops if the call is already held before a reminder. // // Trigger: booking.created. import { inngest } from "./client.mjs"; import

### s-05a-no-show-recovery

- File: `src/workflows/s-05a-no-show-recovery.mjs`
- Name: S-05a — No-Show Recovery
- Kind: **non-agentic**
- Triggers: booking.noshow
- Keys: `EMAIL-S05A-NOSHOW-RECOVERY`, `SMS-S05A-NOSHOW-RECOVERY`
- Header skim: // S-05a — No-Show Recovery. // Source: GHL sticky "S-05a No-Show Recovery". Trigger: booking.noshow // (Cal.com BOOKING_NO_SHOW / MEETING_NO_SHOW). Tags, templates, recovery task. import { inngest } from "./client.mjs"; import { db } from "../db.mjs"; import { resolveClient } fr

### s-06-post-call-funding-purchased

- File: `src/workflows/s-06-post-call-funding-purchased.mjs`
- Name: S-06 — Post-Call Outcome: Funding Purchased
- Kind: **non-agentic**
- Triggers: deposit.paid
- Header skim: // S-06 — Post-Call Outcome: Funding Purchased. // Source: GHL-System-Map.md SALES WORKFLOWS section. // Trigger: deposit.paid — the real funding-deposit signal (Chris-confirmed 2026-07-27; // sale.closed is the DIY downsell, not funding). Gated on the funding path (outcome_tier 

### s-08-post-call-funding-declined

- File: `src/workflows/s-08-post-call-funding-declined.mjs`
- Name: S-08 — Post-Call: Funding Didn
- Kind: **non-agentic**
- Triggers: call.completed
- Header skim: // S-08 — Post-Call: Funding Didn't Buy. // Source: GHL-System-Map.md SALES WORKFLOWS section. // Trigger: call.completed, gated on payload.outcome === "declined" (the same // underlying signal DS-01/DS-02 react to independently — this file's job is // strictly the sales-side tag

### s-nobook-chase

- File: `src/workflows/s-nobook-chase.mjs`
- Name: S-NOBOOK — Never Booked Chase
- Kind: **non-agentic**
- Triggers: survey.submitted
- Sleeps: `wait-2h` → "2h"; `wait-24h` → "24h"; `wait-72h` → "72h"
- Keys: `SMS-NOBOOK-01`, `SMS-NOBOOK-02`, `SMS-NOBOOK-03`
- Header skim: // S-NOBOOK — Fall-off chase when survey is done but they never booked. // Owner 2026-08-15: three SMS, rebook link, no video / meme assets required. // Text can mention "results" in plain language; MMS media is optional later. // // Trigger: survey.submitted. Exits when booking.

### sys-01-client-value-calculator

- File: `src/workflows/sys-01-client-value-calculator.mjs`
- Name: SYS-01 — Client Value Calculator
- Kind: **non-agentic**
- Triggers: round.approved
- Header skim: // SYS-01 — Client Value Calculator. // Source: GHL-System-Map.md DECISION & PROGRESS CONTROL section (counted as part of // the DPC-Series' 7). // An internal projection metric (not a real invoice/payment — Rule about touching // money is about real dollar amounts reaching a cli

### sys-01-ltv-calculator

- File: `src/workflows/sys-01-ltv-calculator.mjs`
- Name: SYS-01-LTV — Lifetime Value Calculator
- Kind: **non-agentic**
- Triggers: round.funded
- Header skim: // SYS-01-LTV — Lifetime Value Calculator. // Source: GHL-System-Map.md DECISION & PROGRESS CONTROL section. // Trigger: round.funded. Accumulates each round's funded amount into a running // lifetime-value total — an explicit, unambiguous running sum (not an invented // formula)

### u-02-analyzer-complete-delivery

- File: `src/workflows/u-02-analyzer-complete-delivery.mjs`
- Name: U-02 — Analyzer Complete Delivery
- Kind: **non-agentic**
- Triggers: analysis.completed
- Keys: `EMAIL-U02-ANALYZER-FUNDING-DELIVERY`, `EMAIL-U02-ANALYZER-REPAIR-DELIVERY`
- Header skim: // U-02 — Analyzer Complete -> Map + Letters + Delivery Email. // Source: GHL-System-Map.md UNDERWRITEIQ WORKFLOWS section. // Real copy exists (EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md: "U-02 Analyzer Funding // Delivery" / "U-02 Analyzer Repair Delivery") — not seeded here (this port

### u-03-crs-snapshot-sync

- File: `src/workflows/u-03-crs-snapshot-sync.mjs`
- Name: U-03 — CRS Snapshot Sync
- Kind: **non-agentic**
- Triggers: analysis.completed
- Header skim: // U-03 — CRS Snapshot Sync (Soft Pull Complete). // Source: GHL-System-Map.md UNDERWRITEIQ WORKFLOWS section. // Trigger: analysis.completed, gated on source === "crs" (the CRS adapter always // tags its analysis.completed events this way — src/adapters/crs.mjs). import { innges

### u-04-promote-crs-primary

- File: `src/workflows/u-04-promote-crs-primary.mjs`
- Name: U-04 — Promote CRS as Primary Snapshot
- Kind: **non-agentic**
- Triggers: analysis.completed
- Header skim: // U-04 — Promote CRS as Primary Snapshot. // Source: GHL-System-Map.md UNDERWRITEIQ WORKFLOWS section. // Trigger: analysis.completed, gated on source === "crs" (same gate as U-03 — the // Primary Snapshot rule is "CRS always wins over the Analyzer estimate once it // lands"). i

### u-05-data-health-monitor

- File: `src/workflows/u-05-data-health-monitor.mjs`
- Name: U-05 — UnderwriteIQ Data Health Monitor
- Kind: **non-agentic**
- Triggers: analysis.completed
- Header skim: // U-05 — UnderwriteIQ Data Health Monitor (CRS-free). // Source: GHL-System-Map.md UNDERWRITEIQ WORKFLOWS section. // Trigger: analysis.completed. Checks the payload for the critical fields the // analyzer is expected to have populated (scores + utilization); missing any of // t

## Non-workflow senders

| Path | Keys / notes |
|---|---|
| src/auth/magic-link.mjs | EMAIL-PORTAL-MAGIC-LINK |
| src/repair/notify.mjs | EMAIL-REPAIR-* |
| src/contracts/notify.mjs | CONTRACT-SEND-EMAIL, CONTRACT-REMIND-EMAIL |
| src/invoices/notify.mjs | INVOICE-SENT-EMAIL |
| src/sales/closer-deck.mjs | INLINE SMS/email |
| src/handlers/inquiry-docs.mjs | EMAIL-F06 / SMS-F06 |
| api/payment-links.mjs | payment_link_notice |
| src/auth/staff-mail.mjs | INLINE Resend |

## Findings (timing / delivery — no fixes)

1. **Compliance gate blocks most copy:** Live dump 165/237 with compliance_passed=false. sendTemplated refuses unapproved templates → client never gets the message even when workflow timing is correct.
2. **booking.created fan-out:** Same event starts S-04, S-04B (confirm+T-24h+T-2h SMS), BS-01 (72h email grid + 3 SMS), AI-SET-01 (Bland), AI-SET-04 (T-15 SMS), DPC-05 (72h), N-03 (if also subscribed). High overlap / “wrong time” risk.
3. **survey.submitted fan-out:** N-02 warm nurture + S-NOBOOK (2h/24h/72h) fire together.
4. **round.started fan-out:** round-started SMS + F-02 (3h/+2d) + F-10 inbox + F-01 intake.
5. **BS-01 SMS vs S-04B:** Both send around booking and near appointment (BS-01 DAYOF at −2h; S-04B remind at −2h) — duplicate day-of texts possible.
6. **Dispatch sweeper is the only drain:** Queued messages sit until cron + outbound_enabled + provider creds. Failure here looks like “SMS/email never came.”
7. **AX-07** keys exist in seed/refs but no workflow caller found.
8. **ai-set-03** is non-agentic templated SMS despite “AI” name — timing 30m/2h/24h after no-answer.
9. **Alias body trap:** 9 live duplicate SMS keys (e.g. `SMS-F02-01-PORTAL-ID`) differ in body + `compliance_passed` from the wired keys workflows actually send. Pack now shows wired body first; duplicates live in Appendix A2 for KILL.
10. **Incomplete BS-REPAIR grid:** 6 expected BS-REPAIR slots absent from live dump (Appendix A3) — not reviewable until seeded.
