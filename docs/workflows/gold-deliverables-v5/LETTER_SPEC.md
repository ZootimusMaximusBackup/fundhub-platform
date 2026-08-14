# UnderwriteIQ Letter Generation - Spec

**For:** Darwin
**From:** Chris
**Pairs with:** DIAGRAM_SPEC.md

Written without repo access, so treat the field names as descriptions of what is needed, not as literal names. Anything marked CONFIRM needs checking against what the generator actually does today.

---

## 1. What is broken right now

The sample pack ships nine letters. **Six of them have no body.**

| Letter | Status |
|---|---|
| `dispute_experian_bureau` | full body, correct |
| `dispute_equifax_bureau` | full body, correct |
| `dispute_transunion_bureau` | full body, correct |
| `dispute_experian_inquiry_removal` | **empty** |
| `dispute_equifax_inquiry_removal` | **empty** |
| `dispute_transunion_inquiry_removal` | **empty** |
| `dispute_experian_personal_info` | **empty** |
| `dispute_equifax_personal_info` | **empty** |
| `dispute_transunion_personal_info` | **empty** |

The empty ones render sender block, date, recipient, and a Re: line with nothing underneath. The layout is fine; the generator is emitting header fields and no body. This is the highest-priority fix in the pack. For a DIY product the letters *are* the deliverable, and six blank pages read as broken software.

---

## 2. The full matrix

The roadmap sells three rounds. The pack ships one.

**3 bureaus x 3 letter types x 3 rounds = 27 letters.**

Currently generating 9 (Round 1 only), of which 3 are correct.

Round 2 and Round 3 are not optional extras. The roadmap explicitly tells the client to send Round 2 escalation letters in Month 3 and Round 3 plus a CFPB complaint in Month 4. If those letters do not exist in the folder, the client hits day 30, gets a "verified" result back, opens the pack, and finds nothing to send. That is the moment a refund gets requested.

CONFIRM: does the generator already have Round 2 and Round 3 templates that simply are not being emitted, or do they need to be written?

---

## 3. What each letter type disputes

Using the sample file (Jordan Sample) as the worked example so the mapping is concrete.

### 3.1 Bureau dispute letters - negative accounts

Targets every derogatory tradeline on that bureau. Sample file has 7:

| # | Creditor | Bureau | Type |
|---|---|---|---|
| 1 | SIGNET BANK/VIRGINIA | Experian | charge-off, $4,798 |
| 2 | CONNECTICUT CHILD SU | Equifax | 28 x 60-day lates, $17,148 past due |
| 3 | VERMONT OFFICE OF CH | Equifax | 4 x 120-day lates, $521 |
| 4 | Unknown creditor | Equifax | medical charge-off, $194 |
| 5 | SALLIE MAE STUDENT L | Equifax | 1 x 90-day late |
| 6 | JC PENNEY | Equifax | bankruptcy discharged, 14 lates |
| 7 | STUDENT LOAN MARKETI (x2) | Equifax | transferred, flagged derogatory |

The three working letters follow the right pattern: dispute **specific Metro 2 field-level inaccuracies**, not the existence of the debt. Stale Field 24 dates, missing Field 20 compliance condition codes, non-zero balance on a closed account, no dispute notation. That is the correct approach and it is also the more effective one. Keep it.

Note the Experian letter covers one account while the Equifax file has seven. CONFIRM whether the generator emits one letter per bureau covering all items on it, or one letter per item. One per bureau, itemized, is what the working samples do.

### 3.2 Inquiry removal letters

Targets hard inquiries with no matching open account.

Sample file: Experian 23, Equifax 23, TransUnion 0.

Strongest candidates are the duplicates and same-day clusters:
- RESIDENTCHECK/IMT RESI, 4 appearances (May 2024, Sep 2024 x2, May 2025)
- GECS, 3 appearances (Apr 2024, Sep 2024, Jan 2025)
- WASHINGTON MUTUAL FI, 2 appearances
- Equifax cluster of 9 different auto lenders all pulling on May 28, 2024

TransUnion has zero inquiries, so **no TransUnion inquiry letter should generate at all**. Suppress it rather than emit an empty one. That is likely part of what is producing the blank files.

### 3.3 Personal info correction letters

This is the one with the most content and currently produces nothing. Sample file has five distinct problems:

| Problem | Sample data | Correct to |
|---|---|---|
| Name variations | WILLIE L BOOZE (Experian), BARBARA M DOTY (TransUnion) | legal name |
| SSN variations | two different SSNs, one on Equifax, one on TransUnion | one correct SSN |
| Addresses | 5 on file: San Antonio TX x2, Robstown TX, Wahiawa HI, Denton TX | 5815 Knoll Krest St, San Antonio TX 78242 |
| Employers | 5 listed: SPL, ABC, DATAWORKS, HAEMONETICS, HARMONETICS | current employer only |
| DOB | present on Equifax only, missing from Experian and TransUnion | consistent across all three |

Two different names and two different SSNs on one file is the most serious item in the entire pack. It causes application denials and fraud flags. The report flags it as URGENT and then the letter that is supposed to fix it comes out blank.

---

## 4. How rounds escalate

| Round | Basis | What changes |
|---|---|---|
| 1 | FCRA 1681i(a)(1)(A), 30-day reinvestigation | initial itemized dispute of specific field inaccuracies |
| 2 | FCRA 1681i(a)(6)(B)(iii) | method of verification request; demand the furnisher name, address, phone, and documents relied on. State that an automated e-OSCAR match does not satisfy reinvestigation |
| 3 | procedural + regulatory | procedural challenge if any deadline was missed, direct dispute to the original furnisher rather than the bureau, CFPB complaint filed alongside |

Only items returned **verified** escalate. Deleted items drop out of the sequence. So Round 2 and Round 3 letter contents are a function of Round 1 results, which means the generator needs a way to take dispute outcomes back in.

CONFIRM: is there a mechanism to record per-item outcomes (deleted / updated / verified) and regenerate the next round from them? If not, that is the real work item, and the letter templates are the easy half.

---

## 5. Data contract

Per letter the generator needs:

- bureau name and mailing address
- client legal name and current address
- letter type (bureau dispute / inquiry removal / personal info)
- round number
- the item list for that bureau and type, each with the specific field-level inaccuracy being alleged
- prior round outcome per item, for rounds 2 and 3
- enclosure list

**Suppression rule:** if the item list for a given bureau, type, and round is empty, emit no letter. Never emit a letter with a header and no body. That single rule fixes the visible symptom even before the content work is done.

---

## 6. Already handled on the layout side

Letters ship with **zero Fundhub branding**: no wordmark, no tag, no spectrum rule, no page footer, no author metadata. Sender block sits at the top in standard business-letter order so it reads as something the client wrote themselves.

Two reasons that is a hard requirement:

1. A dispute letter that looks broker-generated gets routed to the third-party pile and can be dismissed as a frivolous dispute. The branding lowers the success rate.
2. A logo on a dispute letter is documentary evidence that Fundhub prepared it.

`render_letter()` in `fundhub_pdf_template.py` handles this via `css(plain=True)`. Do not add branding back to letters. Client-facing reports keep it.

---

## 7. Priority order

1. **Suppression rule.** Stop emitting empty letters. One-line fix, removes the worst symptom immediately.
2. **Personal info letter bodies.** Highest-value missing content, and the report already flags it as urgent.
3. **Inquiry removal letter bodies.** Straightforward, mostly a list of the inquiries being challenged.
4. **Round 2 and Round 3 templates.** Needed before any client reaches Month 3.
5. **Outcome capture.** Feeds rounds 2 and 3 with real data instead of a repeat of round 1.
