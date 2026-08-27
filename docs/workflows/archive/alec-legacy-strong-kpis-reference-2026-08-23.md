# Legacy Strong KPIs — reference only (not Fundhub law)

**Source:** Alec Delpuech / Legacy Strong LLC — Notion scrape (`credentials/notion-scrape/output/`).  
**Extracted:** 2026-08-23 (owner paste into Ops KPI thread).  
**Not Fundhub product docs.** Coaching math from another shop. Do not copy prices, CAC, or round counts into `staff_targets` until Chris locks **our** numbers.

Primary scrape pages named in the extract: `kpi-s-money-math--6c4ddd69`, `tracking-scaling--345c3aa7`, `managing-commandos-1--345c3aa7`, `hiring-funnel-build-your-commando-team--3b8c3aa7`, `collecting-funding-success-fees--345c3aa7`, `hard-inquiries-bureau-stacking--f3a39877`, `crafting-the-perfect-funding-sequence--acf9a724`.

Durable Fundhub belt lives in **5B.7** and [`fundhub-conveyor-kpis-2026-08-23.md`](fundhub-conveyor-kpis-2026-08-23.md). Fundhub mail is **expedited**, not overnight.

---

## Tools (Alec’s shop)

Marketing Master Tracker, Money Math Calculator, Credit Commando Dashboard, Funding Tracker, Company Payment Tracker, Candidate Tracker, 5-Day Training Camp Tracker, Slack opt-in webhooks, ads tracker.

**No REST APIs in that stack.** Notion + Google Sheets + Slack + GHL. Fundhub does **not** make Sheets the book.

---

## 1. Company revenue & money math (Alec)

| Metric | His example |
|--------|-------------|
| Upfront fee | $8K–$10K per client |
| Success fee | 10% of funded (also $2K start + $6K after $50K funded) |
| Total value per client | $16K–$18K (upfront + success) |
| vs credit repair | ~$500/mo × 6 mo = $3K — one funding client ≈ 5–6 CR clients |
| Base month | 5 clients × $10K = $50K |
| With success fees | + $40K–$75K |
| CAC | Below $800 |
| Cash collected per client (video) | ~$3K upfront |
| Total revenue per client (video) | $6K+ |

**Fundhub prices are not these.** Ours live in [`src/config/offers.mjs`](../../src/config/offers.mjs) (e.g. Funding DFY deposit $3,000 + 10% success fee). CEO money math uses **our** offers after Chris locks.

### Public LinkedIn KPI list (Aug 2026) — fix worst first

1. Cost per booked call  
2. Show rate  
3. Close rate  
4. Average funding per client  
5. Renewal rate  
6. Cost to acquire a client  
7. Time to funding readiness  

---

## 2. Marketing funnel (Alec)

Ad spend is the driver. Organic is extra.

| Metric | Good | Problem |
|--------|------|---------|
| Cost per follower | &lt; $5 | &gt; $10 |
| Cost per opt-in | &lt; $7 (he ~$4) | &gt; $15 |
| Cost per booked call | &lt; $100 | &gt; $200 |
| Show rate | &gt; 90% ideal, &gt; 80% fine | — |
| Close rate | Track | — |

Pre-call: each minute of real contact ≈ +20% show (his rule).

Master tracker: ad spend → clicks/CPC → followers → opt-ins → booked → qualified → show → close → revenue/CAC.

---

## 3. Ad scaling (Alec)

Opt-in ads &lt; $4 / opt-in. VSL &lt; $1 click. YouTube ads &lt; $0.80 click. Wait $20–$40 spend before judging.

| vs target | Action |
|-----------|--------|
| &gt; 50% worse | KILL |
| ~ at target | KEEP |
| better | SCALE ~20% after 3–5 days, then 10 days |

---

## 4. Fulfillment (Alec)

| Metric | Good | Problem |
|--------|------|---------|
| Time to fund (onboarding → funded) | ~30 days | &gt; 60 days = bottleneck |
| Funding $ per client | niche-dependent (coaches ~$100K; RE ~$200K+) | Track average |
| Sequence projection | ~$295K if perfect (5-round example) | — |

Track **days stuck** on optimization (AU, balances, CreditStrong, inquiry removal).

### Five-round sequence (scrape / screenshot 2026-08-23)

Prep (not a round): season Chase $5K / 10 days; US Bank and First Citizens $1K / 30 days each.

| Round | His timing | Example banks | Target |
|-------|------------|---------------|--------|
| 1 | ~2 weeks | Amex, FNBO, GM, Elan, First Arkansas, Truist | ~$95K |
| 2 | ~4 weeks | Chase (double tap after card arrives) | ~$80K |
| 3 | ~2 weeks | BofA, First Citizens, PNC, BMO | ~$65K |
| 4 | ~2 weeks | Citizens, BHG, Valley | ~$25K |
| 5 | ~1 month | US Bank ×2 + locals | ~$30K+ |

Wipe inquiries between rounds. **Fundhub owner later named prep ≤30 days and 3–4 rounds** (faster with AI / expedited inquiry). That lock, if kept, belongs on 5B.7 — not this file.

---

## Still missing from the owner paste

Credit Commando **employee** rows, hiring-tracker KPIs, full “days stuck” list. Pull from scrape pages above when needed. **Do not invent those rows.**
