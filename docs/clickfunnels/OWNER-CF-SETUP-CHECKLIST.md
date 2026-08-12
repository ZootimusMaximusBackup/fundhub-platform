# ClickFunnels setup — Chris checklist (plain English)

**Goal:** Make every survey answer land in FundHub under the `cf_svy_*` keys we already built.  
**Live survey copy:** `docs/clickfunnels/cf-survey-ground-truth.md` (apply.fundhub.ai).  
**Keys we use in the database / homepage:** same list as RUN5 board.

**Already done on our side:** migration `163` on prod · typed columns exist · `src/survey/cf-question-map.mjs` + homepage widget use these `cf_svy_*` keys.  
**Still on you in ClickFunnels:** Contact Attributes + webhook + negatives question (Part C).

When finished, reply in chat: **`attributes set`**

---

## Part A — Create / confirm Contact Attributes

In ClickFunnels → Contacts → Custom attributes (or Fields), create these if they do not exist.  
Names must match **exactly** (copy-paste):

| # | Attribute key (exact) | What it stores |
|---|----------------------|----------------|
| 1 | `cf_svy_funding_target_amount` | Target funding amount |
| 2 | `cf_svy_planned_use` | Planned use |
| 3 | `cf_svy_money_change_now` | What money would change (multi) |
| 4 | `cf_svy_self_reported_fico` | Credit score band |
| 5 | `cf_svy_has_business` | Business? (your CF options) |
| 6 | `cf_svy_business_revenue` | Annual business revenue |
| 7 | `cf_svy_revenue_verifiable` | Can verify business revenue? |
| 8 | `cf_svy_annual_income_range` | Annual personal income |
| 9 | `cf_svy_income_verifiable` | Can verify personal income? |
| 10 | `cf_svy_available_capital` | Available capital |
| 11 | `cf_svy_has_negatives` | Credit negatives Yes/No (**new**) |

Built-in contact fields (do **not** rename): First Name, Last Name, Email, Phone.

---

## Part B — Map each survey question (apply page)

Open the survey on **`https://apply.fundhub.ai/apply`** in the CF editor.  
Today every question shows **Contact Attribute = None**. Fix that.

| Survey question (live CF title) | Set Contact Attribute to |
|--------------------------------|--------------------------|
| Set Your Target Amount | `cf_svy_funding_target_amount` |
| Planned Use | `cf_svy_planned_use` |
| What Would This Money Change Right Now? | `cf_svy_money_change_now` |
| Your Current Score | `cf_svy_self_reported_fico` |
| Do You Have a Business? | `cf_svy_has_business` |
| Annual Business Revenue | `cf_svy_business_revenue` |
| Can You Verify Revenue? | `cf_svy_revenue_verifiable` |
| Annual Personal Income | `cf_svy_annual_income_range` |
| Can You Verify Income? | `cf_svy_income_verifiable` |
| Available Capital | `cf_svy_available_capital` |

Leave option text alone. Only change the attribute mapping.

---

## Part C — Add the negatives question (required for routing)

Add a new single-choice question **before** the end of survey (after Available Capital is fine):

- **Title:** `Any negatives on your credit report? (collections, charge-offs, late payments)`
- **Options:** `Yes` · `No`
- **Contact Attribute:** `cf_svy_has_negatives`

Without this, FundHub treats the lead as **manual review** (not a clear pass/fail).

---

## Part D — Webhook (so leads reach FundHub)

1. CF workspace → **Webhooks** / Automations → webhook endpoint.  
2. URL: `https://fundhub.ai/api/webhooks/clickfunnels`  
3. Method: **POST**  
4. Signing secret must match Netlify `CLICKFUNNELS_WEBHOOK_SECRET` (already set — do not rotate).  
5. Fire on: contact / survey submit **and** appointment booked (whatever CF calls those events).  
6. Save. After one test lead, deliveries should show **success**, not fail.

Opening that URL in a browser will say “Method not allowed.” That is normal (browser = GET).

---

## Part E — Quick test

1. Use a fresh email: `Bakerskater987+test.cfsetup@gmail.com`  
2. Complete survey + book a call.  
3. Tell the agent the exact email.  
4. Agent confirms: capture → client row → `cf_svy_*` answers.

---

## Paste this to another agent (if you want)

```
Repo: fundhub-platform. Help Chris in ClickFunnels only (no code).

Source of truth for question titles/options: docs/clickfunnels/cf-survey-ground-truth.md
Attribute keys (exact): docs/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md Parts A–C
Webhook: https://fundhub.ai/api/webhooks/clickfunnels (POST). Secret already on Netlify as CLICKFUNNELS_WEBHOOK_SECRET — do not rotate.

Walk Chris click-by-click through: create attributes → map each survey question → add has_negatives Yes/No → verify webhook. Stop when he can reply "attributes set".
```
