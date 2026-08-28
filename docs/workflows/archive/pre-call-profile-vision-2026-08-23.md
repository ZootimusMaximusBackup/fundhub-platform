# Pre-Call Lead Profile — product vision (2026-08-23)

**Read-only vision doc.** No build in this file. Chris asked: *“What if closers saw a full profile before they hop on a call?”*

**COMPLIANCE REVIEW REQUIRED** before storing social URLs, running paid people-search on consumer-finance leads, or showing credit data without consent.

Related boards: [`booked-alert-dopamine-2026-08-23.md`](./booked-alert-dopamine-2026-08-23.md) (staff SMS + social research stack).

---

## 1. What we already have today (honest inventory)

This is what the repo actually stores and surfaces **before** a closer dials. Nothing invented.

| Data | Where it lives | Who sees it today | When it exists |
|---|---|---|---|
| Name, email, phone | `clients` | Staff booked SMS, pipeline drawer, call cockpit | At capture / book |
| Full survey Q&A (10 funding questions) | `clients.custom_fields` (`cf_svy_*`) | Staff booked SMS (all answers), pipeline drawer (lazy load), Present deck (`buildCloserDeck`) | At survey submit |
| Self-reported FICO band | `cf_svy_self_reported_fico` (+ `_label`) | Pipeline card chip, drawer, qualification lane | At survey |
| Channel / how they found us | `clients.channel_source`, UTM cols on `client_custom_fields` | Loaded in staff alert job; **not shown in SMS body yet** | At capture |
| Qualification lane (PASS / DOWNSELL / MANUAL_REVIEW) | `src/config/survey-qualification.mjs` | Staff booked SMS play lines | At book (needs FICO + negatives gate) |
| Negatives gate | `cf_svy_has_negatives` | Classifier only | **Usually missing** — not on live CF survey |
| Business name + age | `businesses` | Call cockpit header, Present deck | If captured |
| Pipeline stage | `cards` + `pipeline_stages` | Pipeline board, cockpit | After card exists |
| SMS / email thread (last 20 msgs) | `messages` | Call cockpit precall block (summary only) | After comms |
| Conversation AI summary + sentiment | `conversations` | Cockpit precall (first line) | If AI ran |
| Templates already sent | `messages.template_key` | Cockpit payload (keys list) | After sends |
| Booked call time + meeting link | `tasks` | Cockpit `join_url`, staff SMS | At book |
| Closer pay on funding close | `commission_rules` | Staff booked SMS | At book |
| Real bureau scores (EX/EQ/TU) | `crs_results` | Cockpit credit panel, pipeline drawer (after fetch), Present | **Only after diagnostic paid + CRS pull** |
| Utilization, inquiries, derogs | CRS payload | Cockpit credit panel | After CRS |
| Outcome tier / funding engine | `crs_results.outcome_tier` | Present deck, drawer | After CRS |
| Soft-pull / diagnostic status | `payment_links`, `soft_pull_requests`, consent | Present deck `soft_pull` block | After pay link sent/paid |
| Income estimates (from bureau) | CRS via `incomeEstimates()` | Pipeline drawer, Present | After CRS |
| Lender matches | computed (`matchForClient`) | Cockpit underwrite block | After CRS + tradelines help |
| Prior call outcomes + notes | `call_outcomes` | Agent `fetchContext` only | After prior calls |
| Interview / insight recordings | `customer_insights` | Agent `fetchContext` only | If logged |
| City / state / address | `pii_identity.addresses` (encrypted) | **Not on pre-call UI** — cockpit returns `city: null` | After identity capture (often never pre-call) |
| LinkedIn / Facebook / social | — | **Nothing for leads** (`social_*` = company marketing) | Never automatic today |
| Call recording / transcript | — | Cockpit says “do not exist yet” | Never |
| DND flags (stop texting) | `clients.dnd_*` | Agent context only | If set |

**Bottom line today:** Closers get a **good survey brief + comms snippet + pay motivation** in the booked SMS. On the call screen they get **more** if they open call cockpit — but credit is empty until diagnostic, social is empty, and the “precall” panel is only four fields + one paragraph.

---

## 2. Profile sections (what a closer would see)

Grouped the way a human thinks before dialing.

### A. Who they are (identity)

| Field | Tier | Source | Accuracy | Available |
|---|---|---|---|---|
| Full name | T1 | Survey / `clients` | High | At book |
| Email, phone | T1 | `clients` | High | At book |
| City, state | T1 (after build) / T3 | Survey `home_city`/`home_state` **or** `pii_identity` | High if self-report; medium if enrichment | At book once we add survey fields; identity later |
| Time zone (guess) | T2 | Phone area code or enrichment | Medium | At book |
| Avatar / face hint | T1 | Gravatar from email | Low–medium (~20–35% hit) | Minutes after book (async job) |
| LinkedIn URL | T3 / T2 | Self-report, post-book ask, or PDL | **~95%+** if they type it; **~80–90%** if paid API + closer confirms | Book → 24h before call |
| Facebook / Instagram / X URLs | T2 / T4 | Paid API or username sweep | **Very low** (Facebook ~10–25%) | Unreliable — badges only |
| “Account exists on LinkedIn” hint | T1 | Email registration check (Holehe-style) | Medium — not a URL | Async after book |
| Business entity name | T1 | Survey branch + `businesses` | High when answered | At book |
| Business age band | T1 | `cf_svy_has_business` | Self-reported | At book |

### B. Money & business (survey + later CRS)

| Field | Tier | Source | Accuracy | Available |
|---|---|---|---|---|
| Target funding amount | T1 | `cf_svy_funding_target_amount` | Self-reported band | At book |
| Planned use of funds | T1 | `cf_svy_planned_use` | Self-reported | At book |
| “What would money change?” | T1 | `cf_svy_money_change_now` (multi) | Self-reported — **best motivation copy** | At book |
| Has business vs personal-only | T1 | `cf_svy_has_business` | Self-reported | At book |
| Revenue band | T1 | `cf_svy_business_revenue` | Self-reported | At book (business path) |
| Revenue verifiable? | T1 | `cf_svy_revenue_verifiable` | Self-reported | At book |
| Personal income band | T1 | `cf_svy_annual_income_range` | Self-reported | At book (personal path) |
| Income verifiable? | T1 | `cf_svy_income_verifiable` | Self-reported | At book |
| Available capital band | T1 | `cf_svy_available_capital` | Self-reported | At book |
| Self-reported FICO band | T1 | `cf_svy_self_reported_fico` | Self-reported — can be wrong | At book |
| Real FICO (3 bureaus) | T1 display / paid pull | `crs_results` after diagnostic | High (bureau) | **After diagnostic paid** — usually not pre-first-call |
| Utilization, inquiries, derogs | T1 | CRS payload | High | After CRS |
| Outcome tier / funding engine total | T1 | CRS + `outcome_tier` | High after pull | After CRS |
| Bureau income estimates | T1 | CRS | Estimate, not W-2 | After CRS |
| Lender match count + top names | T1 | `matchForClient` | Depends on CRS + rules | After CRS |
| Prior funded amount | T1 | `clients.funded_amount` | High if set | If returning client |

### C. Digital footprint (social, web)

| Field | Tier | Source | Accuracy | Available |
|---|---|---|---|---|
| Self-reported LinkedIn | T3 | Optional survey / post-book page | **~95%+** | If they fill it |
| Paid enrichment (PDL / FullContact) | T2 | Email + name + city | LinkedIn **~55–70%** hit, **~80–90%** right person | Async after book |
| Gravatar name + photo | T1 | Email hash | **~70–85%** match when present | Async |
| Email → “has LinkedIn account” badge | T1 | Registration probe | Hint only | Async |
| Pre-filled Google / LinkedIn search links | T1 | Name + city + state | Human finds the rest | Always (free) |
| Closer ✅ / ❌ confirm on guessed URL | T3 | Cockpit click | Turns guess → verified | On call prep |
| Facebook profile | T4 | Paid API | **~10–25%**, stale URLs | Do not promise |
| Instagram / X profile URL | T4 | Paid / sweep | **~5–20%** | Do not promise |
| Website / company from email domain | T2 | MX + enrichment | Medium for business domains; useless for Gmail | Async |
| News / lawsuits / bankruptcy | T4 | Court search APIs | Flaky, expensive, compliance risk | Not recommended auto |

### D. Communication history (SMS / email / calls)

| Field | Tier | Source | Accuracy | Available |
|---|---|---|---|---|
| Last 20 messages (in/out) | T1 | `messages` | Exact | At book |
| Inbound needs reply flags | T1 | Pipeline SQL | Exact | At book |
| Conversation summary | T1 | `conversations.summary` | AI-written — can drift | If AI ran |
| Sentiment | T1 | `conversations.sentiment` | Rough | If AI ran |
| Templates already sent (keys) | T1 | `messages` | Exact | At book |
| Booking confirm / precall / day-of SMS sent? | T1 | Template keys | Exact | After workflows fire |
| Prior call outcomes + closer notes | T1 | `call_outcomes` | Exact | If returning lead |
| Prior interview insights + recording URL | T1 | `customer_insights` | Exact when logged | If logged |
| Live call recording / transcript | T4 | — | — | **Not built** |
| Portal pre-call chat widget messages | T1 | Portal messages | Exact | If they used portal chat |

### E. Qualification & recommended path

| Field | Tier | Source | Accuracy | Available |
|---|---|---|---|---|
| Lane: PASS / DOWNSELL / MANUAL_REVIEW | T1 | `classifySurvey()` | Logic is sound; **negatives often missing → MANUAL_REVIEW** | At book |
| Recommended first offer | T1 | Lane → Funding DFY vs Repair DFY | Rule-based | At book |
| Upsell reminder (stack paths) | T1 | Staff alert copy | Fixed copy | At book |
| Outcome tier from CRS | T1 | CRS | Replaces guess after pull | After CRS |
| Soft-pull / diagnostic status | T1 | `soft_pull` block in deck | Exact | Real-time on cockpit |
| Analyzer path / legacy prequal fields | T1 | `client_custom_fields` legacy cols | May be empty on new leads | If migrated data |

### F. Pay motivation for closer

| Field | Tier | Source | Accuracy | Available |
|---|---|---|---|---|
| Funding deposit closer $ | T1 | `commission_rules` × deposit | Exact from rules table | At book |
| Manager $ on same deposit | T1 | `commission_rules` | Exact | At book |
| Back-end % of funded amount | T1 | `commission_rules` | Exact rate; **dollar amount unknown** | At book |
| Repair closer $ | — | — | **No active rule today** | **Missing — do not invent** |
| Closer MTD cash / close rate | T1 | `call_outcomes` for logged-in closer | Exact for that rep | On cockpit (not per-lead) |

### G. Red flags / compliance

| Field | Tier | Source | Accuracy | Available |
|---|---|---|---|---|
| DND SMS / email / voice | T1 | `clients.dnd_*` | Exact | If set |
| CRM archived | T1 | `custom_fields.crm_archived_at` | Exact | If set |
| Demo lead flag | T1 | `clients.is_demo` | Exact | If demo |
| Consent valid for soft pull | T1 | `consentStatus()` | Exact | After consent flow |
| Diagnostic paid but no CRS yet | T1 | payment + pull request status | Exact | Real-time |
| Compliance “never say” list | T1 | Cockpit static checklist | Policy | Always on cockpit |
| Typed score in outbound copy | T1 | Already in staff SMS | **COMPLIANCE REVIEW REQUIRED** | Today |
| Unverified social URL in AI prompt | T4 | — | **Must not do** until human confirms | Never auto |

---

## 3. Tier legend

| Tier | Meaning | Examples |
|---|---|---|
| **T1 — free, ship now** | Already in DB or cheap async job we can build | Survey rollup, comms history, qualification lane, pay lines, Gravatar, search links |
| **T2 — paid API** | Needs vendor budget (~$0.10–0.25/lookup) | People Data Labs LinkedIn + job title + city |
| **T3 — lead gives it / human confirms** | Highest accuracy path | Optional LinkedIn field, post-book SMS ask, closer ✅ on PDL guess |
| **T4 — not possible / illegal / too flaky** | Do not auto-show as fact | Facebook scrape, guaranteed full social graph, call transcript we do not record, repair closer pay we do not have rules for |

---

## 4. Mock profile — Jane Doe (fictional)

Text mock of one screen. `[guess]` = machine guess needing confirm. `[after diagnostic]` = not there yet at first call.

```
══════════════════════════════════════════════════════
 PRE-CALL PROFILE · Jane Doe · Call Tue 2:00 PM PT
 Booked 38 minutes ago · Source: Meta / utm_campaign=warm-aug
══════════════════════════════════════════════════════

▸ WHO
  Jane Doe · jane.doe@gmail.com · (512) 555-0142
  Austin, TX · [self-reported on survey — Tier 1 once we add fields]
  Business: Doe Consulting LLC · 1–2 years
  LinkedIn: linkedin.com/in/janedoeconsulting ✅ self-reported
  Gravatar: photo found · display name "Jane D." [hint]
  Badges: likely has LinkedIn account · no Facebook URL on file

▸ MONEY & GOALS
  Wants: $100k – $200k
  Use: Growth (marketing, inventory, hiring)
  If money landed: peace of mind + grow faster
  Revenue: $250k – $499k/yr · can verify: bank statements + tax returns
  Capital on hand: $5k – $25k
  Said FICO: 700–749
  Real scores: [after diagnostic — not pulled yet]
  Engine / tier: — · Lender matches: —

▸ PATH & PLAY
  Lane: MANUAL_REVIEW (negatives question not answered — treat as yellow)
  Run first: Pick path on call · stack repair if needed
  Diagnostic: not paid · consent: not on file

▸ COMMS (6 messages)
  Last inbound (yesterday 4:12p): "Yes Tuesday works, send the link"
  Sent: BOOKING-CONFIRM, SMS-BS01-01-BOOKED
  AI summary: Interested, asked about timeline twice · sentiment: positive

▸ YOUR PAY IF YOU CLOSE FUNDING DFY
  $5,000 on $30,000 deposit (closer) · Manager: $1,500
  Plus 0.25% of whatever funds
  Repair close $: — (no rule on file)

▸ FLAGS
  No DND · Not demo · No prior calls on file

▸ QUICK LINKS
  [Open call cockpit] [Present deck] [Google search] [Confirm LinkedIn ✅]
══════════════════════════════════════════════════════
```

---

## 5. Honest ceiling — “everything about them” is not possible

Chris’s vision is right: **more context = better calls**. But no product gets 100% of a stranger’s life before a phone ring.

**What “everything” cannot mean:**

- We will not know their real FICO before they pay for diagnostic (by design — no pre-call credit pull).
- We will not reliably find Facebook / Instagram for most Gmail leads.
- We will not hear a prior call recording we never stored.
- We will not know bank balances, exact income, or private debts unless they say so or CRS runs.
- We cannot legally scrape protected data without consent.

**Realistic 80% profile completeness target** (booked lead, **minutes before call**, full stack shipped):

| Slice | Realistic completeness | Notes |
|---|---|---|
| Identity + contact | **~95%** | Name/email/phone always; city/state ~70% once survey adds them |
| Money story (self-report) | **~90%** | Survey is rich when they finish it |
| Real credit file | **~15–30%** pre-first-call | Most first calls happen before diagnostic |
| Social / LinkedIn verified | **~55–70%** | Self-report + post-book ask + PDL + closer confirm |
| Comms context | **~75%** | All sends logged; AI summary only when AI ran |
| Qualification lane | **~60%** | Broken until negatives field exists or we accept MANUAL_REVIEW |
| Pay motivation | **~80%** | Funding path yes; repair path no |
| Compliance flags | **~85%** | DND + consent gaps visible when missing |

**Blended “feels fully prepped” score: ~65–75% on a typical first book**, rising to **~80–85%** for leads who (a) complete survey + city/state + LinkedIn, (b) had a few SMS back-and-forth, or (c) already paid diagnostic.

That is the honest 80% target: **not 80% of the entire internet on every lead** — **80% of what actually helps a closer sound prepared**.

---

## 6. Where it should live (recommendation)

| Surface | Pros | Cons | Verdict |
|---|---|---|---|
| **Call cockpit** (`/app/closer-call.html`) | Closer is already here to dial; `buildCockpit` already assembles client + credit + precall + pay context; protected core flow | Crowded UI today | **Primary home — “Prep” tab or expandable panel** |
| **Pipeline drawer** | Managers/setters peek without opening call | Read-only; not where closers live during dial; partial data until lazy fetch | **Secondary — same data, collapsed “Prep summary” + link to cockpit** |
| **Present deck** | Great for screen-share after connect | Wrong moment — you do not screen-share prep before they answer | **Keep survey + engine for live pitch, not pre-call dossier** |
| **Staff booked SMS** | Already dopamine + full survey dump | Too long; no links UI; not scannable at a glance | **Keep alert + one line: “Prep ready → [link]”** |

**Recommendation:** Build **one canonical prep payload** (server module fed by survey + messages + enrichment job). Show it:

1. **Full panel on call cockpit** — default view when `client_id` is in URL before connect.
2. **Short summary in pipeline drawer** — name, lane, pay line, last inbound snippet, “Open prep”.
3. **Staff SMS** — stays punchy; link to cockpit prep, not raw social URLs.

Present stays the **live** deck. Prep stays **pre-call**.

---

## 7. Suggested build order (when Chris says go)

Not a commit list — priority only.

1. **T1 rollup module** — one function that merges survey (`CF_SURVEY_QUESTIONS`), lane, comms, pay, flags (reuse `buildAlertBody` + `buildPrecall` + `classifySurvey`).
2. **Cockpit Prep panel** — render rollup; expand precall from 4 fields to full survey sections.
3. **Survey city/state + optional LinkedIn** — free accuracy lift (see dopamine board § Solution stack).
4. **Post-book “drop your LinkedIn”** — one SMS + one-field page.
5. **Async enrichment job** — Gravatar + email badges + PDL (if approved) on `booking.created`.
6. **Human confirm** — ✅/❌ on guessed LinkedIn in cockpit.
7. **Pipeline drawer** — consume same payload API.

**Do not block staff booked SMS on enrichment.** Text fires immediately; prep link fills in over the next few minutes.

---

## 8. Open decisions for Chris

1. Is **MANUAL_REVIEW** acceptable until negatives exists, or add negatives to CF?
2. Approve **PDL budget** (~$50–150/mo) or stay T1-only first?
3. **Required vs optional** city/state + LinkedIn on survey (conversion vs accuracy)?
4. Must closer **click confirm** on machine LinkedIn guesses before we store as verified?

---

## 9. Paid tools (shopping list)

**COMPLIANCE REVIEW REQUIRED** before buying any vendor or running paid lookups on consumer-finance leads.

| Vendor | Good at | Ballpark | Gmail consumer fit |
|---|---|---|---|
| **PDL** (People Data Labs) | Person API — LinkedIn, job, city from email/name/phone | ~$98/mo (350 matches) · ~$0.28/match | **Best fit** |
| **FullContact** | Identity graph — tie email/phone to social handles | ~$99/mo (~1k calls) · sales to start | Good |
| **Apollo** | B2B sales — work email, company, LinkedIn | ~$49–99/user/mo + 1 credit/match | **Poor** (work-email world) |
| **Clearbit** (HubSpot Breeze) | Company from business email domain | HubSpot seat $20+/mo — no standalone API | **Useless** on Gmail |
| **Pipl** | Deep identity / fraud — aliases, social trace | ~$3k+/yr custom — not self-serve | Deep but overkill; not for cold outreach |
| **Lusha** | B2B contact reveal — work email + phone | ~$53+/mo (Pro) · 1 credit/email | **Poor** on personal Gmail |

**Fundhub pick:** PDL. **Rough cost at 40–100 books/mo:** ~$98/mo (Pro floor covers volume). **Paid still won't get you:** reliable Facebook, personality, private life, or real FICO (that stays CRS).

---

## 10. Comma's pre-qual + premium tier (2026-08-23)

**COMPLIANCE REVIEW REQUIRED** — credit pulls, prescreen, and paid enrichment on consumer-finance leads.

Chris asked what “Comma's pre-qual” is vs the highest-end paid enrichment stack. This section is **code/docs only** for Fundhub wiring; Comma's marketing pages fill gaps where the repo has no integration.

### What Fundhub actually gets from Comma's today

**Comma's (formerly FanBasis) is wired as a payment processor only.** `src/adapters/commas.mjs` + `src/payments/commas-api.mjs`.

| Comma's gives us | We store | When |
|---|---|---|
| Payment succeeded / failed / refund / dispute | `commas_inbox` → canonical events (`payment.received`, `diagnostic.paid`, etc.) | Webhook (at-most-once; sweeper retries) |
| Amount, payer email, product title | Event payload + `transactions` row | Same |
| Our metadata round-trip (`link_ref`, `client_id`, `org_id`) | Resolves to `payment_links` row → whose money, what purpose | Checkout session mint |
| Checkout URL for variable amounts | `payment_links.checkout_url`, `commas_session_id` | Staff sends pay link |

**Comma's does NOT return enrichment, credit scores, income, or LinkedIn in any Fundhub code path.** If Comma's Qualifier runs on their side, nothing in this repo reads it yet.

### What “pre-qual” means inside Fundhub (UnderwriteIQ / CRS)

This is the pre-qual number closers and SMS templates use — **not** a Comma's API field.

| Step | What happens |
|---|---|
| 1 | Client pays **$32 “UnderwriteIQ soft-pull assessment”** through a **Comma's checkout link** (`purpose: diagnostic`) |
| 2 | Comma's webhook → `diagnostic.paid` |
| 3 | `src/handlers/diagnostic-soft-pull.mjs` → **C-00** runs CRS soft pull (needs signed soft-pull consent first) |
| 4 | CRS hits bureau **prequal FICO9** endpoints via Stitch Credit (`tu-prequal-fico9`, `exp-prequal-fico9`, `efx-prequal-fico9` in vendor reference) |
| 5 | UnderwriteIQ engine runs → `decision.rendered` |
| 6 | We write **`analyzer_prequal_amount`** + **`total_funding_estimate`** (same dollar figure), **`outcome_tier`**, full **`crs_results`** (scores, utilization, tradelines) |

**Where it shows up:** pipeline drawer “Prequal”, staff SMS merge tag `{{contact.analyzer_prequal_amount}}`, client portal `GET /api/read/portal-summary` (`prequal_amount` / `prequal_display`).

**When it exists:** only **after** diagnostic paid + consent + CRS pull completes. Most first calls happen **before** that — so pre-call profile usually has **self-reported FICO band**, not the real pre-qual dollar amount.

**Plain English:** Comma's collects the $32. **Fundhub's own CRS/UnderwriteIQ engine** produces the pre-qual funding estimate. Comma's is the cash register, not the credit brain — in code.

### Comma's “Qualifier” (their product — not in repo)

Comma's/FanBasis markets **Qualifier**: “Enriches every lead with income, credit and net worth.” Their privacy policy says it may run a **soft credit inquiry** through third parties and returns a **yes/no eligibility** result to the business — not a full credit report stored in Fundhub.

**Gap:** No `qualifier` adapter, webhook, or field writer exists in this repo. If Chris pays for Qualifier on Comma's, that data is **not landing on the Fundhub client file today** unless someone copies it in by hand or we build a wire.

### Premium enrichment landscape (beyond PDL ~$98/mo)

**COMPLIANCE REVIEW REQUIRED** before buying or running on consumer leads.

| Tier | Vendors | Good at | Ballpark | Gmail consumer lead fit |
|---|---|---|---|---|
| **Mid ~$100/mo** | **PDL**, FullContact, email-registration probes, Gravatar | LinkedIn URL, job, city from email+name; “account exists” hints | $98–150/mo at 40–100 books | **Best mid-tier** for LinkedIn |
| **High $500–2k/mo** | FullContact enterprise tiers, Experian Activate / prescreen APIs, TransUnion TruValidate starter | Richer identity graph, device signals, some prescreen | Custom quotes; often annual minimums | Better with name+address+SSN last-4 — not cold email alone |
| **Enterprise $10k+/yr** | **Pipl**, **LexisNexis Accurint**, **TransUnion TLOxp / IDVision**, **Experian** consumer files, **Socure**, **Alloy**, **Persona** | Deep identity, fraud, aliases, assets, business ties, KYC/KYB | $3k–$50k+/yr; sales-led | Overkill for “find their LinkedIn”; right for fraud/KYC and business diligence |
| **B2B mismatch** | ZoomInfo, Cognism, Apollo, Lusha | Work email, company, sales contacts | $50–150/user/mo | **Poor** — personal Gmail leads |
| **Already in stack (Fundhub)** | **CRS / UnderwriteIQ** (post-$32), **LexisNexis business report** on CRS account (planned, `docs/workflows/next-stack-2026-08-16.md`) | Real bureau soft pull + funding engine; company bankruptcies/liens/UCC | CRS subscription + per-pull; Lexis via CRS | **Core credit pre-qual** — not pre-call for most first books |
| **Comma's-native (if subscribed)** | **Comma's Qualifier** | Income / credit / net-worth signal at funnel | Bundled with Commas — pricing not in repo | Unknown hit rate; **not wired to Fundhub** |

### Stack vision — “everything about them” pre-call

Honest layering (what helps a closer **before** the first ring):

| Layer | Source | Pre-call? | Notes |
|---|---|---|---|
| Survey + lane + pay | Fundhub (free) | **Yes — today** | Richest free slice |
| Comma's Qualifier | Comma's dashboard/API | **Only if wired** | Would add income/credit tier early; needs integration |
| PDL + city/state + self-report LinkedIn | Paid + survey | **Yes — async after book** | Best social/job path |
| Gravatar + email badges | Free | Yes | Hints, not URLs |
| Comma's $32 → CRS pre-qual | Fundhub + CRS | **Usually no** on first call | Real dollars + FICO after they pay |
| Lexis business (CRS) | CRS | After business name known | Company risk, not personal social |
| Socure / Alloy / Persona | Enterprise | At capture if fraud is the goal | Identity/fraud, not LinkedIn |
| Pipl / Accurint / TLO | Enterprise | Skip for pre-call prep | Compliance-heavy; use for investigations |

**Realistic “highest end” pre-call stack:** survey + city/state + optional LinkedIn + PDL + human confirm + Comma's Qualifier **if we wire it** + staff booked brief. **Real FICO and funding pre-qual stay CRS**, gated behind Comma's payment and consent — by design.

### FCRA / permissible purpose (plain English)

| Data type | Typical permissible purpose | Fundhub today |
|---|---|---|
| People search (PDL LinkedIn) | **Not FCRA** — marketing/operations enrichment if no credit decision | Not built; needs policy before buy |
| Comma's Qualifier soft pull | **FCRA** — client must capture consent; Comma's returns pass/fail to merchant | Not in repo |
| CRS / UnderwriteIQ soft pull | **FCRA** — signed soft-pull consent + legitimate business need | Built; consent gate enforced |
| Lexis business report | **GLBA / business due diligence** — company, not consumer FICO | Planned via CRS |
| Socure / Alloy / Persona | **FCRA / KYC** — identity verification for account opening | Not in repo |
| Accurint / TLO / Pipl deep trace | **FCRA or GLBA** depending on product — often investigations, collections, fraud | Not in repo |

**Rule of thumb:** If it touches credit score or creditworthiness for a offer, treat it as **FCRA** — consent, permissible purpose, and no using enrichment data you are not allowed to use for that decision.

---

*Vision only. Code references: `src/sales/cockpit.mjs` (`buildPrecall`), `src/staff/booked-call-alert.mjs`, `src/survey/cf-question-map.mjs`, `src/sales/closer-deck.mjs`, `src/agents/context.mjs`, `api/dashboard/pipeline.mjs`, `src/adapters/commas.mjs`, `src/adapters/crs.mjs`, `src/handlers/client-lifecycle.mjs` (`onDecisionRendered`), `api/read/portal-summary.mjs`.*
