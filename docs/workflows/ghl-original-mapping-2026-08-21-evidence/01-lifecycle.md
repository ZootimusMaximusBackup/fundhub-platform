# 01 — Lifecycle (05/30 Part A)

**Source:** `/tmp/ghl_0530.txt` lines 1–203.  
**All stage bullets below are CONFIRMED** unless marked otherwise.

## Governing truths (CONFIRMED)

1. Soft pull happens **on the call** — not before.  
2. **No pre-call Analyzer** in the live model.  
3. **In-house repair is outsourced** to a downsell (dispute-letter referral / DIY).  
4. Part A **supersedes** old LOCKS that still describe pre-call Analyzer.  
5. Truth lives in **fields**, not tags.

---

## Stage 0 — Traffic and First Touch

**Intent:** Know where the person came from, once, forever.

| What | Detail |
|---|---|
| Happens | Customer lands on VSL / starts application |
| Workflows | AT-01 / S-02 capture attribution one time only |
| Data write | First Touch Date, First Touch URL, UTM, Lead Magnet Type (immutable once set) |
| Affiliate | AF-02 locks a1/a2 ownership at first touch; never overwritten |

---

## Stage 1 — Application and Survey

**Intent:** Create the person and capture survey answers. **No credit pull.**

| What | Detail |
|---|---|
| Workflows | S-01 create/merge by email/phone |
| Gate | Email + Phone must exist or nothing downstream runs |
| Survey fields | `cf_svy_self_reported_fico`, `cf_svy_planned_use`, `cf_svy_funding_target_amount`, `cf_svy_your_why`, pending `cf_svy_has_negatives` |
| Explicit | No credit pulled. No pre-call credit data. |
| State | Lifecycle Status = New Lead, tag `lead:new`, survey fields |

---

## Stage 2 — Survey Qualification Gate (two gates)

**Intent:** Only book a **funding** call if survey says they look fundable. Fail → **outsourced** repair downsell (not in-house).

| Gate | Pass rule |
|---|---|
| 1 | `cf_svy_self_reported_fico` is `700-749` or `750+` |
| 2 | `cf_svy_has_negatives` = `No` |

- FAIL either → application-stage credit repair downsell (outsourced, automated dispute-letter referral).  
- No pre-call prequal. Qualification is **survey-only**.  
- **OPEN ITEM (CONFIRMED in Part A):** `cf_svy_has_negatives` key pending from DirectROAS — gate “not enforceable until it exists.”

---

## Stage 3 — Booking and Setter Confirm

**Intent:** Book the call. Setter confirms. Setter has **application answers only** — never a score or approval.

| What | Detail |
|---|---|
| Workflows | S-04 / S-04B: Sales opp at S2 Call Booked, tag `call:booked`, confirmation + reminders |
| AI | AI-SET-01 Josh Setter (voice) on booking — frames call as where Advisor pulls credit **live** |
| State | `cf_call_outcome` = booked, tag `call:booked`, Sales stage S2 |

---

## Stage 4 — The Call (live soft pull)

**Intent:** Credit decision happens **during** the advisor call.

| What | Detail |
|---|---|
| Money / consent | C-00: soft-pull invoice (~$32), `cf_crs_softpull_consent`, CRS Paid |
| Pull | After paid + consented → CRS pull request (AX01B in GHL era) |
| Sync | U-03 syncs CRS snapshot; U-04 promotes CRS as Primary Snapshot Source |
| Decision field | CRS result → `cf_analyzer_recommendation` = funding / repair / disqualified (C-06 branches on this) |
| State | CRS Status = Complete, Primary Snapshot Source = CRS, recommendation field set |

---

## Stage 5 — C-06 CRS Results Router (the fork)

**Intent:** Three business outcomes off the live pull.

### FUNDING (qualifies on the call)

- Close: ~$3,000 deposit + 10% success fee on capital secured.  
- S-06 on paid outcome → Funding opportunity F1, Lifecycle = Funding Client, tag `client:funding`, Product Path = Funding.  
- C-06 FUNDING also fires deliver-letters webhook (funding letter set: Personal Info Cleanup + Inquiry Cleanup, EX/EQ/TU).

### REPAIR / not qualified (on-call downsell)

Rep offers one of two paths → Sales Outcome → DS-series:

| Sales Outcome | Workflow | Intent |
|---|---|---|
| Repair Referral Sent | **DS-01** | Outsourced fire-and-forget. Partner intro + link. Tag `client:repair-referral`. Product Path = Referred. Opp → S5 Closed Referred. **No payment, no letters, no webhook on our side.** |
| DIY Letters Purchased | **DS-02** | ~$1,000 (adjustable). Invoice + paid gate. Deliver-letters webhook (repair letter set). Deliverables email. `cf_diy_status` = Fulfilled. Tag `client:diy-letters`. Opp → S5 Closed Fulfilled. **No re-pull** — CRS already ran on the call. |

### DECLINE (hard: OFAC, fraud, severe public record)

- Tag HOLD Declined, decline email + SMS, opportunity closed.

---

## Stage 6 — Funding Fulfillment Onboarding (funding clients only)

**Intent:** Collect ID/docs and set up bank inbox before rounds.

- F-01 intake; F-02 Portal/ID; F-06 Doc Request; F-10 Client Funding Inbox; F-12A Remote Install (Zoho).  
- POD-01B assigns funding pod/advisor.  
- Document Check agent + Agent 5 (Onboarding) chase missing items.  
- State: `client:funding`, `docs:missing` while incomplete, Employee Next Action = Collect Documents.

---

## Stage 7 — Funding Rounds Loop

**Intent:** Submit rounds; clear new inquiries between rounds; hold on fraud/stale CRS.

- F-03 submitted, F-04 approvals.  
- Between rounds: F-05 inquiry cleanup → C-02 assign removal → C-03 resume/hold on fraud → C-04 blocks stale CRS before next submission.  
- AX-02 / AX-05 mirror to Airtable (GHL-era).  
- State: Funding Round Number, Round Hold Reason, Ready For Next Round, Inquiry Status.

---

## Stage 8 — Funding Locked

**Intent:** Lock fee; hand balance to collections.

- F-07 (F22): Funding Fee locked (immutable), commission/balance calculated, invoice opp → AR.  
- State: Funding Locked Date, Fee Locked = true, Balance Due, Invoice Status = Sent.

---

## Stage 9 — Accounts Receivable

**Intent:** Collect while money is owed. Agents stop on dispute/legal.

- AR-01..AR-04 only while Balance Due > 0.  
- Agent 2 (Billing text) + Josh AR (voice).  
- Dispute/hardship/legal → `ai:stop-contact` → AR-04 collections.  
- State: Invoice Status, `ar:collections`, `ai:stop-contact`.

---

## Stage 10 — Post-Funding and Lifetime

**Intent:** Stay in touch; renew; (old model) upgrade repair grads — see uncertainty on S-10.

- F-08 starts N-04. N-06 re-engages after 6 months.  
- S-10 “routes a repair graduate to a funding upgrade call” — **tension with Part A outsourced repair** (see gaps).  
- SYS-01-LTV on each payment.

---

## Always-on layers (across stages)

| Layer | Workflows | Intent |
|---|---|---|
| Attribution | AT-01, AF-02 | First-touch + affiliate ownership immutable |
| Affiliate pay | AF-04 | Commission only on true paid outcomes, capped 50%, written to affiliate contact not buyer |
| Behavioral | BC-01, BC-02, BC-03 | Responsiveness / friction / motivation for agent tone |
| Decision / progress | DPC-02, DPC-03, DPC-04, DPC-05 | Call outcomes, replies, decisions, 72h no-progress escalation |
| Health | HX-01..HX-05, Recon | Tags/lifecycle/Airtable sync; technical breaks to Chris |

---

## Part B — State contract (fields that define “where they are”)

CONFIRMED identity gate: Email, Phone.  
Lifecycle: New Lead / Funding Client / Repair Client / Churned.  
Product Path: Funding / Repair / **Referred**.  
Sales Outcome includes: Funding Purchased, Repair Purchased, Funding Didn't Buy, Repair Didn't Buy, **Repair Referral Sent**, **DIY Letters Purchased**.

**UNCERTAIN for live ops:** Part A still lists Product Path = Repair and Sales Outcome = Repair Purchased, while also saying in-house repair is outsourced. See `05-gaps-and-uncertainties.md`.

---

## Part C — Task router (Employee Next Action)

CONFIRMED actions: Pull CRS, Collect Documents, Remove Inquiries, Clear Fraud Alert, Review Funding File, Prepare Next Funding Round, Apply for Funding.  
Safety nets: DPC-05 (72h), Recon (tech breaks → Chris only).
