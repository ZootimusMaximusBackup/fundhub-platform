# Booked-alert dopamine — 2026-08-23

Owner go: closer play + known pay in the booked-call staff text. Facebook find and confetti are separate jobs.

**Pre-call profile vision (full product outline):** [`pre-call-profile-vision-2026-08-23.md`](./pre-call-profile-vision-2026-08-23.md)

Do not edit comms-logic boards. Do not edit `src/messaging/**`.

---

## Tasks

| id | owner | status | notes |
|---|---|---|---|
| closer-play | this thread | done | Path + upsell + funding deposit pay wired into staff SMS body. |
| close-pay | unclaimed | pending | Repair / downsell closer % is not on the rules table. Do not invent. |
| facebook-find | research 2026-08-23 | done (read-only) | No repo OSINT today. Facebook URLs are the hardest hit. See **Findings: facebook-find** below. |
| confetti | unclaimed | pending | Sales-board celebration. Twilio SMS cannot pop Apple iMessage confetti. |

---

## Shared brief

- Staff text job: `src/staff/booked-call-alert.mjs` + `src/workflows/s-04c-staff-booked-alert.mjs`
- Path gate (already in repo): `src/config/survey-qualification.mjs` — PASS / DOWNSELL / MANUAL_REVIEW from typed score + negatives
- Negatives field is often missing today → MANUAL_REVIEW when score is 700+
- Score below 700-749 → DOWNSELL (credit repair first)
- Product names from `src/config/offers.mjs`
- Closer funding deposit: live `commission_rules` (owner-set one sixth of Funding DFY deposit). Manager 5% of that deposit. Back-end 0.25% of funded amount — amount unknown at book time
- Repair closer pay: **NEED** — no active closer rule on repair products

**COMPLIANCE REVIEW REQUIRED** — typed score and pay lines stay in the text.

---

## Change manifest (closer-play)

Files:

- `src/staff/booked-call-alert.mjs`
- `src/staff/booked-call-alert.test.mjs`
- `docs/workflows/booked-alert-dopamine-2026-08-23.md`

No new routes. No new env. No Facebook. No confetti.

---

## Findings: facebook-find (read-only, 2026-08-23)

**Repo today:** zero people-search / OSINT for leads. `social_*` tables are company marketing only. Hiring has LinkedIn fields for candidates, not clients.

**What we have at book time:** name, email, phone, full survey Q/A in `custom_fields`, `channel_source`, UTM/referrer in `custom_fields`. **No city/state** in the survey. `channel_source` is loaded in the staff alert job but not shown in the SMS body.

**Honest accuracy (consumer leads, pre-call):**

**Owner ask 2026-08-23 — can we hit 80–90%?** No, not for “the right person’s profile URL” on Fundhub’s mix (mostly personal Gmail, no city/state). Realistic v2 paid ceiling: **LinkedIn ~40–55%** of leads get a usable URL (~75–85% of those are the right person); **Facebook ~10–20%**; **Instagram / X ~5–15% each**. Free v1 is “account exists” hints and Gravatar — useful prep, not profile URLs. Target **40–50% LinkedIn**, not 80–90% across platforms.

| Input | What you get | Accuracy |
|---|---|---|
| Email | “Registered on X/Y/Z” (Holehe-style) or Gravatar avatar/name | Medium for account-exists; **not** profile URLs |
| Phone | WhatsApp/Telegram presence hints only | Low–medium; no name match |
| Name + city | People search | **Low** — we don't capture city/state |
| Email local-part → username | Username sweep | Low–medium; many false positives |
| **Facebook profile URL** | Almost nothing reliable free | **Very low** — Graph API needs consent; OSINT blocked |

**Facebook is hardest.** Meta killed public lookup. Paid APIs (PDL, FullContact) sometimes return a Facebook URL from email, but hit rate is spotty post-2020 and costs ~$0.05–0.25/lookup. Do not promise Facebook in v1.

**Zero new spend v1:** Survey-based sales brief + qualification lane (PASS/DOWNSELL/MANUAL_REVIEW) + channel/UTM + optional free Gravatar + lightweight email-registration checks ported to Node fetch (not Python Holehe on Netlify).

**Paid v2 (owner approval):** People Data Labs or FullContact Person Enrichment — best honest path for LinkedIn URL + job title + city when email matches. Store results in `clients.custom_fields` or a new `lead_enrichment` jsonb with `verified_at` + `source` + confidence. Never inject unverified social into AI prompts.

**Where it should live:** async Inngest step on `booking.created` (parallel to S-04C SMS, does not block text). Display on closer-call cockpit + CRM drawer. Staff SMS gets a one-line “Prep ready →” link, not raw social URLs.

**COMPLIANCE REVIEW REQUIRED** before storing social URLs or running OSINT on consumer-finance leads.

**City/state accuracy lift (read-only, 2026-08-23):** Survey has no city/state today. Adding them helps **LinkedIn most** (paid v2: ~40–55% → ~55–70% usable URL; right-person when hit ~75–85% → ~80–90%). **Facebook** modest (~10–20% → ~15–25%). **Instagram/X** small (~5–15% → ~8–20%). **Overall correct profile URL** ~35–50% → ~45–62% — meaningful, not 80–90%. Does not fix Gmail miss rate, Meta API block, or free v1. **Also unlocks:** bank Apply proxy geo (`home_city`/`business_city` already read in `src/proxy/sessions.mjs`), closer prep, lender state rules — social prep alone is not the main win.

---

## Solution stack (2026-08-23)

**COMPLIANCE REVIEW REQUIRED** before storing social URLs or running paid OSINT on consumer-finance leads.

Build in this order. Each step adds accuracy. Later steps use what earlier steps collect.

### 1. Add city + state to the survey (build — free)

- **What:** Two required fields on homepage survey, ClickFunnels funnel, and pipeline “New Client.” Save to `clients.custom_fields` as `home_city` / `home_state` (or `business_city` / `business_state` if they say they have a business).
- **Accuracy:** Raises paid LinkedIn lookup from ~40–55% to ~55–70% usable URL. Right person when we get a hit: ~80–90%. Overall correct profile URL across all platforms: ~35–50% → ~45–62%.
- **Cost:** Free.
- **Where:** `public/js/homepage-survey.js`, `api/public/survey-submit.mjs`, `src/adapters/clickfunnels.mjs`, `client_custom_fields` / `custom_fields`. Bank Apply proxy already reads these in `src/proxy/sessions.mjs`.

### 2. Ask for LinkedIn URL on survey or book page (build — free)

- **What:** Optional field: “Your LinkedIn profile (helps us prep for your call).” Same on `apply.fundhub.ai/funding-book-call` if ClickFunnels allows a custom field.
- **Accuracy:** When they fill it, **~95%+** correct — they typed their own link. Expect **30–50%** of leads to fill an optional field; required field gets **50–70%** but may hurt conversion.
- **Cost:** Free.
- **Where:** Same capture doors as step 1. Store as `custom_fields.linkedin_url` with `source: self_reported`.

### 3. Post-book SMS/email: “Drop your LinkedIn before the call” (build — free send)

- **What:** One short message after book, before the call. Link to a one-field page or reply-by-SMS. Runs in existing booking comms (parallel to S-04C staff alert).
- **Accuracy:** **~25–40%** of leads who did not give LinkedIn on the survey will reply. Those replies are **~95%+** accurate.
- **Cost:** Free (existing Twilio/Mailgun).
- **Where:** New step in booking workflow (`src/workflows/s-04-*`), capture page or SMS reply handler, `custom_fields.linkedin_url`.

### 4. Paid enrichment API — People Data Labs (buy — best for LinkedIn)

- **What:** Call PDL Person Enrichment with email + name + city/state. Read field `linkedin_url` (also `job_title`, `location_locality` for prep). FullContact is a backup vendor; PDL is stronger for US professional / LinkedIn data.
- **Accuracy:** **~55–70%** of leads get a LinkedIn URL when city/state is on file (~40–55% without). Of those hits, **~80–90%** are the right person. Does not work well on personal Gmail with no other signals.
- **Cost:** Paid — ~**$0.10–0.20 per lookup** on typical plans; budget **~$50–150/mo** at current book volume.
- **Where:** New `src/enrichment/pdl.mjs`. Async Inngest step on `booking.created` (does not block staff SMS). Store in `custom_fields.enrichment` or new `lead_enrichment` jsonb: `{ linkedin_url, source: "pdl", confidence, verified_at }`. **Do not** put unverified URLs in AI prompts.

### 5. Email registration checks — Holehe-style, ported to Node (build — free)

- **What:** Check if their email is registered on LinkedIn, Twitter, Instagram, etc. This tells us “account exists,” not the profile URL.
- **Accuracy:** **~50–70%** useful as a hint (“probably has LinkedIn”). **Not** a profile link. Helps closer know where to look.
- **Cost:** Free (our code + outbound fetch).
- **Where:** New `src/enrichment/email-accounts.mjs`. Same Inngest enrichment job as step 4. Show as badges on closer cockpit prep panel.

### 6. Gravatar (build — free)

- **What:** MD5 their email → `gravatar.com` → avatar + display name if public.
- **Accuracy:** **~20–35%** of consumer emails have a Gravatar. When present, **~70–85%** name/face match helps confirm the right person. No LinkedIn URL.
- **Cost:** Free.
- **Where:** Same enrichment module. Cockpit prep panel shows avatar + “Gravatar name: X” when found.

### 7. Human-in-loop — pre-filled search links in closer cockpit (build — free)

- **What:** On the call cockpit, show: (a) PDL LinkedIn link if found, (b) one-click “Search Google” and “Search LinkedIn” links pre-filled with `name + city + state`, (c) ✅ Confirm / ❌ Wrong buttons. Confirmed URL is saved as verified.
- **Accuracy:** Closer confirms in **~10 seconds**. Turns a **~80–90%** machine guess into **~98%** verified for that lead. Catches all PDL false positives.
- **Cost:** Free.
- **Where:** `src/sales/cockpit.mjs` + closer dashboard UI. Writes `custom_fields.linkedin_url_verified_at`.

### 8. What we CANNOT do (honest ceiling)

- **Facebook scrape / Graph lookup without user login:** Meta blocked this. Paid APIs return Facebook **~10–25%** of the time and URLs go stale. Do not promise Facebook in v1.
- **Instagram / X profile URL from email alone:** **~5–20%** hit rate. Same story.
- **80–90% fully automatic** on all leads with no self-report: **impossible** with our data mix (mostly personal Gmail, no city/state today).
- **Fake accuracy:** Showing a wrong LinkedIn hurts trust more than showing nothing. Unverified links must be labeled “guess — please confirm.”

---

### “Super accurate” recipe (LinkedIn specifically)

**Goal:** Highest honest LinkedIn accuracy before the call.

| Layer | What | LinkedIn accuracy (this layer) |
|---|---|---|
| A | Required city/state + optional LinkedIn on survey | ~30–50% of leads give URL at **~95%+** correct |
| B | Post-book “drop your LinkedIn” message | +**~15–25%** more at **~95%+** correct |
| C | PDL enrichment on everyone still missing URL | +**~20–35%** at **~80–90%** right person (needs human confirm) |
| D | Closer 10-sec confirm in cockpit | PDL hits become **~98%** verified |

**Combined honest numbers (LinkedIn only, after full stack ships):**

- **~55–70%** of booked leads have a **verified** LinkedIn URL before the call (self-report + post-book).
- **~15–25%** more have a **good guess** from PDL (closer confirms in 10 sec).
- **~10–20%** remain unknown — personal Gmail, no social footprint, or wrong PDL hit rejected.

**Overall: ~70–85% verified correct LinkedIn URL before call** if closer clicks confirm. **~55–70%** if you skip human confirm and trust PDL alone.

**Not 80–90% on Facebook or Instagram.** LinkedIn is the only platform worth optimizing.

---

### Three decisions Chris makes today

1. **Survey fields:** Optional LinkedIn on survey, or required city/state + optional LinkedIn, or both required?
2. **Paid API:** Approve PDL (~$0.10–0.20/lookup, ~$50–150/mo) or stay free-only until self-report numbers prove out?
3. **Human confirm:** Closer must click ✅ on PDL guesses before we store as verified, or show guesses unlabeled?
