# 02 — Workflow catalog (05/30)

Grouped by series. Status is relative to **05/30 Part A + explicit DECOMMISSIONED lines**, not “still printed later in the PDF.”

Legend:

- **LIVE** — Part A (or sticky “live”) expects this path.  
- **DECOMMISSIONED** — Explicit “DECOMMISSIONED / No wiring” or under PDF `DECOMMISSIONED` section.  
- **OUTDATED-PAGE** — Still printed in PDF body; Part A supersedes (pre-call Analyzer / in-house repair assumptions).  
- **UNCERTAIN** — Conflict or incomplete definition.

Triggers / purpose are CONFIRMED from Part A or named sticky lines when cited; canvas detail is STRUCTURE-INFERRED.

---

## S — Sales

| ID | Status | Trigger (GHL era) | Business purpose | Data R/W (high level) | Deps |
|---|---|---|---|---|---|
| S-01 | LIVE | New lead / identity | Create/merge contact; identity gate | Email, Phone, Lifecycle=New Lead | — |
| S-02 (attribution) | LIVE | First touch | One-time attribution (with AT-01) | First Touch*, UTM | AT-01 |
| S-02 (incomplete survey) | LIVE | Incomplete app | Nudge unfinished survey | Survey fields | S-01 |
| S-03 Analyzer Authority | OUTDATED-PAGE | Analyzer complete | Old “book after analyzer” sales unlock | recommendation | Conflicts Part A Stage 3–4 |
| S-04 / S-04B | LIVE | Booking | Opp → Call Booked; confirm + remind | `call:booked`, reminders | Stage 3 |
| S-05 / S-05a | LIVE | No-show | Recover no-shows | call outcome | DPC-02 overlap |
| S-06 | LIVE | Funding purchased | Open Funding Client path | Product Path=Funding, F1 | Stage 5 FUNDING |
| S-07 Repair Purchased | OUTDATED-PAGE / UNCERTAIN | Repair purchased | Start **in-house** repair client | Product Path=Repair, client:repair | Conflicts Part A outsource |
| S-08 | LIVE | Funding didn't buy | Follow-up when funding offered, not bought | tags, tasks | Stage 5 |
| S-09 Repair Didn't Buy | OUTDATED-PAGE / UNCERTAIN | Repair didn't buy | Follow-up on repair offer decline | tags | Conflicts outsource |
| S-10 Upgrade | UNCERTAIN | Repair complete → funding | Graduate repair → funding call | upgrade:ready | Part A mentions it; repair track decommissioned |

---

## BS — Back-end selling (pre-call content)

| ID | Status | Trigger | Purpose | Notes |
|---|---|---|---|---|
| BS-01 | LIVE intent / OUTDATED gates | `call:booked` | Pre-call SMS/email launcher | Part A does **not** require Analyzer recommendation before call. Canvas still gates on `cf_analyzer_recommendation` (OUTDATED-PAGE). |
| BS-EMAIL-FUNDING-72HR | LIVE (sticky) | Enrolled by BS-01 | 72h funding drip | — |
| BS-EMAIL-REPAIR-72HR | **DECOMMISSIONED** | — | Repair drip | Sticky: “DECOMMISSIONED. No wiring.” CONFIRMED |
| BS-ADS / BS-CLICK-* | OFF / empty / UNCERTAIN | clicks | Ad audiences / video clicks | Secondary; many empty |

---

## AI-SET — Setter

| ID | Status | Trigger | Purpose |
|---|---|---|---|
| AI-SET-01 Josh | LIVE | Booking | Voice confirm; frame live soft pull; **no score** |
| AI-SET-03 No-answer | LIVE | Missed setter | SMS cadence |
| AI-SET-04 3-way handoff | LIVE | T-15 before call | Text handoff to advisor |

---

## C — Credit / CRS / inquiry

| ID | Status | Trigger | Purpose | Data |
|---|---|---|---|---|
| C-00 | LIVE | Consent + soft-pull pay on call | Request CRS soft pull | consent, charge, CRS Paid → pull |
| C-02 | LIVE | New inquiries between rounds | Assign inquiry removal | Inquiry Status, tasks |
| C-02B | LIVE | Inquiry removal requested | Kick removal work | — |
| C-03 | LIVE | Inquiry removed | Resume funding or hold on fraud | Round Hold Reason |
| C-04 | LIVE (Part A) | Before next submit | Block stale CRS snapshot | Ready For Next Round |
| C-05 | LIVE | Pre-funding | Review / refresh CRS | Employee Next Action = Pull CRS |
| C-06 | LIVE | CRS complete | Fork: Funding / Repair-downsell / Decline | recommendation, letters webhook, decline msgs |

---

## U — UnderwriteIQ

| ID | Status | Trigger | Purpose | Notes |
|---|---|---|---|---|
| U-01 Analyzer Start gate | OUTDATED-PAGE | Analyzer start | 30-day anti-abuse | Pre-call Analyzer model |
| U-02 Analyzer Complete delivery | OUTDATED-PAGE vs LIVE fork | Analyzer complete | Map + letter delivery | Part A: recommendation comes from **CRS on call**; funding letters also from C-06 FUNDING branch |
| U-03 CRS Snapshot Sync | LIVE | Soft pull complete | Sync CRS fields | Stage 4 |
| U-04 Promote CRS primary | LIVE | CRS complete | Primary Snapshot Source = CRS | Stage 4 |
| U-05 Data health | LIVE support | Incomplete payloads | Health flag | Always-on health |
| U-06 Analyzer follow-up | OUTDATED-PAGE | Re-submit Analyzer | — | Under DECOMMISSIONED area / old model |

---

## F — Funding

| ID | Status | Purpose |
|---|---|---|
| F-01 | LIVE | Funding intake |
| F-02 | LIVE | Portal / ID missing nudge |
| F-03 | LIVE | Round submitted notify |
| F-04 | LIVE | Round approvals |
| F-05 | LIVE | Inquiry cleanup gate between rounds |
| F-06 | LIVE | Missing docs / conditions |
| F-07 | LIVE | Funding locked → AR handoff |
| F-08 | LIVE | Post-funding → N-04 |
| F-09 | LIVE | Declined / no path review |
| F-10 / F-10R | LIVE | Client bank inbox provision + verified |
| F-11 | LIVE | Bank email event router |
| F-12A | LIVE (Part A) | Zoho remote install |
| POD-01B | LIVE (Part A) | Funding pod assignment |

---

## DS — Downsell (repair outsource)

| ID | Status | Purpose | Data |
|---|---|---|---|
| DS-01 | LIVE | Partner referral; fire-and-forget | Product Path=Referred; no payment/letters |
| DS-02 | LIVE | Paid DIY letters (~$1k) | diy paid/status; deliver-letters webhook |

---

## R — In-house repair fulfillment

| ID | Status | Purpose |
|---|---|---|
| R-01..R-12, POD-01C, RW-06 | **DECOMMISSIONED** | DisputeFox / round-sent / legal / repair complete / upgrade | Under PDF `DECOMMISSIONED` (~11752+). Matches Part A “in-house repair outsourced.” CONFIRMED for document placement. |

DisputeFox Zaps DF-01..DF-06 also sit in that DECOMMISSIONED section.

---

## N — Nurture

| ID | Status | Purpose |
|---|---|---|
| N-01 Cold | LIVE | Long-term cold |
| N-02 Warm | LIVE | Long-term warm |
| N-03 Hot | LIVE | Long-term hot |
| N-04 Post-funding | LIVE | After F-08 |
| N-05 Repair-Complete | **DECOMMISSIONED** | Sticky: “DECOMMISSIONED. No wiring.” CONFIRMED |
| N-06 Renewal | LIVE | ~6 month second wave |
| N-07 Re-engagement | LIVE sticky / incomplete def | Inactive leads — threshold deferred in sources |
| N-08 Analyzer Re-Run | **DECOMMISSIONED** | Sticky: “DECOMMISSIONED. No wiring.” CONFIRMED |

Agent prompt note (CONFIRMED): “in-house repair fulfillment is decommissioned (outsourced). Repair lane stays only to the extent repair downsell is still sold.”

---

## AR — Accounts receivable

| ID | Status | Purpose |
|---|---|---|
| AR-01 Invoice Sent | LIVE (Part A Stage 9) | First notice while Balance Due > 0 |
| AR-02 Reminder | LIVE | Reminder |
| AR-03 Escalation | LIVE | Escalation |
| AR-04 Collections | LIVE | Handoff when `ai:stop-contact` / collections |

---

## AF — Affiliate

| ID | Status | Purpose |
|---|---|---|
| AF-02 | LIVE | Lock ownership at first touch |
| AF-04 | LIVE | Commission on true paid outcomes, 50% cap |
| AF-01 / AF-03* / AF-05.. | Mixed / deferred / no wiring | Sticky AF-01: “no wiring”; others secondary |

---

## DPC — Decision / progress control

| ID | Status | Purpose | Notes |
|---|---|---|---|
| DPC-01 Analyzer Lock | OUTDATED-PAGE | Lock Analyzer recommendation | Part A locks recommendation from **CRS**, not pre-call Analyzer |
| DPC-02 | LIVE | Enforce call outcomes | Always-on |
| DPC-03 | LIVE | Route inbound replies | Always-on |
| DPC-04 | LIVE | Finalize decisions | Always-on |
| DPC-05 | LIVE | 72h no-progress escalation | Always-on |

---

## BC — Behavioral classifiers

| ID | Status | Purpose |
|---|---|---|
| BC-01 Responsiveness | LIVE | Fast/Normal/Slow |
| BC-02 Friction | LIVE | High/Medium/Low |
| BC-03 Motivation | LIVE | Primary motivation for tone |

---

## AT / HX / AX / Agents / CT / WH

| Series | Status vs Part A | Purpose |
|---|---|---|
| AT-01 | LIVE | First-touch capture |
| AT-02 | Support | Attribution normalizer |
| HX-01..05 | LIVE in Part A always-on | Health; many retired in custom CRM because Airtable mirror gone |
| AX-* | GHL↔Airtable | Part A still names them; custom CRM dissolves Airtable mirror — **NO LONGER NECESSARY** as GHL zaps (STRUCTURE-INFERRED from migration + one-DB architecture) |
| POD-01A | LIVE intent | Lead/setter assignment |
| Document Check / Recon / Context Loader | LIVE intent | Internal agents |
| CT-00..03 | Draft / UNCERTAIN | Contract + payment links — unfinished in source |
| WH-01..04 | Support | Microcourse / qualification webhooks |

---

## Explicit DECOMMISSIONED stickies (CONFIRMED)

- N-05 Repair-Complete — No wiring  
- N-08 Analyzer Re-Run — No wiring  
- BS-EMAIL-REPAIR-72HR — No wiring  
- R-series + DisputeFox block under `DECOMMISSIONED` heading  
- Agent copy: in-house repair fulfillment decommissioned (outsourced)
