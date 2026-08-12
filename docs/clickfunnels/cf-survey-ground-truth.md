# ClickFunnels survey — ground truth

**Source:** live ClickFunnels survey editor for `https://apply.fundhub.ai/apply` (owner dump 2026-08-12).  
**This file is the only survey source of truth.** Do not invent, paraphrase, reorder, or “improve” options. Every future session reads this before touching survey code.

**Known gap (cleared for keys):** Contact Attribute mapping is the owner checklist  
`docs/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md` — titles → `cf_svy_*`.  
`src/survey/cf-question-map.mjs` stores those keys as `payloadKey`.

**Routing question (Part C):** after Available Capital, CF (and homepage) include  
“Any negatives on your credit report? …” → `cf_svy_has_negatives` (Yes/No).

---

## Homepage vs CF order

| Surface | Contact step |
|---|---|
| CF (`apply.fundhub.ai/apply`) | **First** — “Let’s Start With Your Info” |
| Homepage (`fundhub.ai` `#apply`) | **Last** — same fields; after Available Capital |

All other questions, options, and the business/personal branch are identical.

---

## Flow (linear + one branch)

1. **Let’s Start With Your Info** — Contact Info (name, email, phone). Required.  
   *(Homepage: this step runs last, not first.)*
2. **Set Your Target Amount** — 5 options
3. **Planned Use** — 6 options + Other enabled
4. **What Would This Money Change Right Now?** — 5 options, **MULTI-SELECT**
5. **Your Current Score** — 6 options
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

### Any negatives on your credit report? (collections, charge-offs, late payments)

- Yes
- No

Attribute: `cf_svy_has_negatives` (OWNER checklist Part C — required for PASS/DOWNSELL routing).

---

## Not invented here

Option strings for steps 2–Available Capital come only from the CF editor dump above.  
`has_negatives` is owner-required for Stage-2 routing (checklist Part C); add it in CF if missing.
