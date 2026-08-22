# Fix-firing board — journey order (2026-08-21)

**Method:** First touch → end. No random workflow piles.  
**Code changes this pass:** none (booked-stage mapped only).

---

## Where the old journey-editor truth lives

| Artifact | What it is | Use tonight |
|---|---|---|
| **`public/app/journeys.html`** | Live **Journey Editor** UI (Client / Setter / Closer / … trees) | **Primary spine** |
| **`src/journeys/seed-journeys.mjs`** | Server copy of those trees (test-locked to the HTML) | Same spine when DB empty |
| Editor stages | New Lead → Survey Complete → **Booked** → … → Diagnostic Paid → Decision → … → **Round Submitted** → Approved → Funded | Stage names below |
| `docs/journeys/client-intended.md` | Route reachability for role `client` — **not** the sales funnel | Do **not** use as funnel |
| GHL 05/30 Part A | Secondary **guide** (stages 0–10) | Align labels only; owner: **in-house repair ON** |

Note: production `journeys` table may have **0 saved rows** — runner falls back to the seed. The editor seed is still the authored intent.

---

## Booked stage — Chris’s intended beats (plain)

After the ClickFunnels “you’re booked” page:

1. **Text** — one “you’re booked / confirmed” text, right away  
2. **Josh call** — AI setter dials right away  
3. **Email** — one booking confirm email, right away  

(“The logical text and email.” Later day-before / day-of reminds are separate.)

| Beat | Event | Workflow | Template key |
|---|---|---|---|
| 1 Text | `booking.created` | booking confirm SMS owner | Prefer **`SMS-S04-01-CONFIRM`** (GHL confirm). Live today used **`SMS-BS01-01-BOOKED`** (same job, other track). |
| 2 Josh | `booking.created` | `ai-set-01-josh-setter` | Bland agent **AG-04** |
| 3 Email | `booking.created` | GHL says confirm email on book | **`S-04`** (“Appointment Confirmation”). **Not wired** in code. Long pre-call drip (`BS-FUND-…`) is not this beat. |

**Order:** text → Josh → email (all immediate).  
**How the event gets there:** ClickFunnels calendar form / appointment webhook → `src/adapters/clickfunnels.mjs` → `booking.created`.

Journey editor today only draws a **day-before** remind SMS — thinner than Chris + GHL.

---

## What fires today on `booking.created`

| Piece | Status |
|---|---|
| CRM move / tag (`s-04-call-booked`) | Wired (card → Booked) |
| Booked text | **Two owners in code** (confirm track + precall SMS track). Live B1 book (~08-21): **`SMS-BS01-01-BOOKED` queued**; **`SMS-S04-01-CONFIRM` silent** |
| Josh dial (`ai-set-01-josh-setter`) | Registered + AG-04 live on paper — **no clear live dial trail** on that book |
| Confirm email (`S-04`) | **Missing** — template exists, `compliance_passed=false`, nothing sends it |
| Long pre-call email drip | Separate BS path; often skipped if funding/repair path not set yet |

---

## Journey wire status (Client tree → funding)

| # | Journey stage (editor) | Event that should fire | Workflow(s) that should listen | Current code / live | Status |
|---|---|---|---|---|---|
| 1 | Form submit / New Lead | `entry.captured` | `s-01-new-lead-intake`, `at-01-first-touch-capture`, `af-02-referral-ownership-capture` | Registered | **WIRED** (not re-proved tonight) |
| 2 | Survey done | `survey.submitted` | `s-nobook-chase` (and related) | Exists; not tonight’s fire | leave |
| 3 | **Booked** | `booking.created` | see **Booked stage** section above | Dual SMS; email missing; Josh unproven | **MAPPED — wait Chris yes/no** |
| 3a | **CHECKPOINT — Josh dial** | `booking.created` | `ai-set-01-josh-setter` → Bland | Registered; **not live-proven** | **UNCERTAIN — no code change** |
| 4 | Closer handoff / showed | `call.completed` | assorted call workflows | Present; not tonight | leave |
| 5 | $32 diagnostic | `diagnostic.paid` | `c-00-crs-soft-pull-request` | Registered | leave |
| 6 | UnderwriteIQ / decision | `analysis.completed` | `c-06-crs-results-router` | Registered | leave |
| 7 | Fork: funding vs repair | after decision / call | funding close vs repair | Owner: repair **ON** | leave |
| 8 | Funding start | `round.started` | `round-started-client-notify`, F-01/F-02/… | Registered | leave |
| 9 | **CHECKPOINT — round submitted** | `round.submitted` | `f-03-round-submitted` | EMAIL+SMS **delivered** (~08-21) | **WORKING** |
| 10 | **CHECKPOINT — round approved** | `round.approved` | `f-04-round-approvals` | Same — **delivered** | **WORKING** |

---

## Safe fix proposal (not applied — not ~200% certain)

**Proposed tiny shape (for a later Fixer pass):**  
Keep **one** immediate booked text (the live one that already queues), keep Josh dial as-is, add **one** confirm email once a clean compliant template is ready, and stop the second booked-text track so people are not double-texted. Do **not** turn off Josh or the whole pre-call drip in the same change.

**Confidence gate:** No company-breaking change tonight. Email template `S-04` still fails compliance and has old Analyzer copy — wiring it blind would be unsafe.

---

## Decision board for Chris

### Already works
- **Funding round notify (journey #9–10):** send when round submitted / approved fire.

### Needs your yes / no (blocks any booked wire)

**On a new booking, should we do exactly: one confirm text + Josh call right away + one confirm email — and stop the second booked text?**  
(Yes / No)

### Still need a live prove (read-only)
- Book **one** test call on a phone you own → we only **read** whether Josh actually dialed.

---

## One question

**Yes or no:** one confirm text + Josh right away + one confirm email (and kill the second booked text)?
