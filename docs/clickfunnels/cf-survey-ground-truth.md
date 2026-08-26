# ClickFunnels survey — ground truth

**Source:** live ClickFunnels survey editor for `https://apply.fundhub.ai/apply` (owner dump 2026-08-12).  
**This file is the only survey source of truth.** Do not invent, paraphrase, reorder, or “improve” options. Every future session reads this before touching survey code.

**Attribute keys:** `docs/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md` Parts A–B (titles → `cf_svy_*`).  
`src/survey/cf-question-map.mjs` stores those keys as `payloadKey`.

**Homepage extra (owner 2026-08-25):** `fundhub.ai` `#apply` asks “Any negatives on your credit report?” (Yes/No → `cf_svy_has_negatives`) after Current Score so a 750+ / no-negatives person can book a call. **ClickFunnels `apply.fundhub.ai/apply` still has no negatives question.** Do not invent a CF login or add this to CF from this repo.

---

## Homepage vs CF order

| Surface | Contact step |
|---|---|
| CF (`apply.fundhub.ai/apply`) | **First** — “Let’s Start With Your Info” |
| Homepage (`fundhub.ai` `#apply`) | **Last** — same fields; after Available Capital |

All other questions, options, and the business/personal branch are identical, except the homepage-only negatives question (owner 2026-08-25).

---

## Flow (linear + one branch)

1. **Let’s Start With Your Info** — Contact Info (name, email, phone). Required.  
   *(Homepage: this step runs last, not first.)*
2. **Set Your Target Amount** — 5 options
3. **Planned Use** — 6 options + Other enabled
4. **What Would This Money Change Right Now?** — 5 options, **MULTI-SELECT**
5. **Your Current Score** — 6 options
5b. **Any negatives on your credit report?** — Yes/No *(homepage only, owner 2026-08-25)*
6. **Do You Have a Business?** — 6 options ← **BRANCH POINT**
   - Any **Yes…** tenure → **7a. Annual Business Revenue** → **8a. Can You Verify Revenue?**
   - **No, personal funding only** → **7b. Annual Personal Income** → **8b. Can You Verify Income?**
7. Both paths **rejoin** at **Available Capital** — 5 options  
8. End of Survey

---

## Exact options (verbatim)

### Set Your Target Amount

- Less than $50k
- $50k - $100k
- $100k - $200k
- $200k - $400k
- $400k+

### Planned Use (Other enabled)

- Growth (marketing, inventory, hiring)
- Equipment or buildout
- Debt consolidation
- Payroll or rent
- Covering a shortfall right now
- Not sure yet

*(Other is enabled in CF — free/other entry. Homepage may expose an explicit “Other” choice that mirrors that.)*

### What Would This Money Change Right Now? (multi-select)

- Peace of mind (stop stressing about cash)
- Grow faster (more customers / more reach)
- Pay off pressure (wipe out high-interest debt)
- Stability (cover bills / buffer slow weeks)
- Fresh start (new business / startup launch)

### Your Current Score

- 500-579
- 580-649
- 650-699
- 700-749
- 750+
- Not sure

### Do You Have a Business?

- Yes, less than 6 months old
- Yes, 6-12 months
- Yes, 1-2 years
- Yes, 2-5 years
- Yes, 5+ years
- No, personal funding only

### Annual Business Revenue (Yes path)

- Under $100k
- $100k - $249k
- $250k - $499k
- $500k - $999k
- $1M+

### Can You Verify Revenue? (Yes path)

- Yes, bank statements
- Yes, tax returns
- Yes, both
- Not right now

### Annual Personal Income (No / personal path)

- Less than $50k
- $50k-$99k
- $100k-$199k
- $200k-$499k
- $500k+

### Can You Verify Income? (No / personal path)

- Yes, pay stubs
- Yes, W-2 or tax returns
- Yes, both
- Not right now

### Available Capital (rejoin)

- Less than $1k
- $1k - $5k
- $5k - $25k
- $25k - $100k
- $100k+

---

## Homepage-only (owner 2026-08-25)

After **Your Current Score**, the homepage widget asks:

### Any negatives on your credit report?

- Yes
- No

Saves as `cf_svy_has_negatives`. Not on live ClickFunnels `apply.fundhub.ai/apply`.

## Not in ClickFunnels (owner 2026-08-12 dump; still true)

The CF apply survey has no negatives Yes/No question. Do **not** add it to CF from this repo. Homepage already asks it.
