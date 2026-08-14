# Copy spec v2 — shared board

Status: done (W0–W4)  
Model: cursor-grok-4.5-low (owner-set)  
Spec: MASTER COPY SPECIFICATION v2.0 — layout-preserving, by ID

Open for human:
- **COMPLIANCE REVIEW REQUIRED** — education refunds now 14 days / under 20% (W2)
- Enroll page is an application queue, not Stripe checkout
- `support@fundhubeducation.com` still HTML-only (verify mailbox)

## Tasks

| ID | Owner | Status | Notes |
|---|---|---|---|
| W0 — Bugs | agent | done | Login/logo/noscript done. Enroll → `/education/enroll/` (application form; no Stripe yet). |
| W1 — Homepage + global | agent | done | HOME.* NEW + GLOBAL.NAV.CTA + GLOBAL.FOOT.* |
| W2 — Education + refunds | agent | done | EDU.* NEW + §8.1 five refund locations |
| W3 — Affiliates | agent | done | AFF.HERO.SUB only (logo is W0) |
| W4 — Microcopy | [W4](5d3aa36a-b056-4596-b1fd-e36a6ff1e9ff) | done | PART 9 labels/errors/submit/404 |

## Rules

- Nothing moves. Drop strings by ID.
- LOCKED = byte-identical. KEEP = do not touch.
- Company: Fundhub (lowercase h). Product: UnderwriteIQ.
- No banned words from Part 1. No exclamation points.
- Claim before start. Write manifest when done.

## Manifests

### W0 — Bugs (blocked on §8.2 enroll)

**Done**
1. **PART 6 Login** — `public/login.html`
   - META.TITLE → `Sign in | fundhub`; META.ROBOTS `noindex` kept
   - H1 `fundhub`; SUB `Sign in to your account`
   - FIELD.1/2 placeholders; BTN `Sign in`; LINK forgot; HELP `Need help? support@fundhub.ai`
   - RESET.SUB / RESET.BTN / RESET.SUCCESS (success string in forgot-handler JS)
   - BACK kept; removed `chris@fundhub.ai` prefill + note
2. **§5.3 Affiliates nav logo** — `public/affiliates/index.html` nav brand `href="/affiliates/"` only (footer brand still `/`)
3. **§8.4 Homepage noscript** — `public/index.html` apply-form noscript text replaced per spec
4. **§8.3 Education inbox report** — `support@fundhubeducation.com` appears in:
   - `public/education/index.html` (footer)
   - `public/education/refund/index.html` (2×)
   - `public/education/privacy/index.html` (2×)
   - `public/education/terms/index.html` (1×)
   - **Configured in repo/env?** No. Not in `.env.example`. Local `.env` / Netlify production mail keys present are Mailgun/Resend/Twilio for fundhub (not `fundhubeducation.com`). No education-support mailbox key found. Address is HTML-only.

**Blocked**
2. **§8.2 Enroll buttons** — still `href="#"` on `public/education/index.html`. No public education checkout/enroll route in repo (no Stripe/Commas/FanBasis product URLs for these programs). CRM `payment-links` is staff-only. Per brief: do not invent checkout → **blocked**.

**Verify**
- `npm run lint` — clean (1114 files)
- `chris@fundhub.ai` gone from `public/login.html`
- Remaining public HTML hits (app demo fixtures only; out of PART 6 scope): `public/crm.html`, `public/app/staff-teams.html`, `public/app/journeys.html`

**Journeys / routes / exports** — none

### W1 — Homepage + global (done)

File: `public/index.html` only. Layout unchanged. LOCKED/KEEP left alone. Education, affiliates, login, refund, JS fallback not touched.

| ID | Status |
|---|---|
| GLOBAL.NAV.CTA | updated → See your options |
| GLOBAL.FOOT.DESC | updated |
| GLOBAL.FOOT.TRUST | updated (`&` → `and`) |
| HOME.META.TITLE | updated |
| HOME.META.DESC | updated |
| HOME.HERO.H1 | updated (variant A) |
| HOME.HERO.SUB | updated |
| HOME.HERO.BTN1 | updated → See your options |
| HOME.TERM.L2 | updated → profile assembled |
| HOME.TERM.L4 | updated → matched against partner criteria |
| HOME.BADGE.1 | updated (both marquee tracks) |
| HOME.BADGE.6 | updated (both marquee tracks) |
| HOME.STAT.1–3 | values updated; labels KEEP |
| HOME.PROC.SUB | updated |
| HOME.PROC.1.BODY | LOCKED — untouched |
| HOME.PROC.2.BODY | updated |
| HOME.PROC.3.BODY | updated |
| HOME.ENG.H2 | updated |
| HOME.ENG.SUB | updated |
| HOME.ENG.1.BODY | updated |
| HOME.ENG.2.BODY | updated |
| HOME.ENG.3.BODY | LOCKED — untouched |
| HOME.AGT.1–4 | bodies updated; H4 KEEP |
| HOME.OPT.INTRO | updated |
| HOME.OPT.F01–F06 | bodies updated; order kept |
| HOME.OPT.FOOTNOTE | LOCKED — untouched |
| HOME.CMP.SUB | updated |
| HOME.CMP Fundhub column | 5 cells updated |
| HOME.CMP.FOOTNOTE | LOCKED — untouched |
| HOME.SEC.SUB | updated |
| HOME.SEC.S06.BODY | updated |
| HOME.GTE.SUB | updated |
| HOME.GTE titles/bodies/footnote | LOCKED — untouched |
| HOME.MCTA.MICRO | updated |
| HOME.MCTA.BTN | updated → See your options |
| HOME.APP.INTRO | updated |
| HOME.APP.D1–D3 | LOCKED — untouched |

Journeys: none. Routes: none. Exports: none.

### W3 — Affiliates (done)

- **File:** `public/affiliates/index.html`
- **Changed:** AFF.HERO.SUB — hero `.lede` only: `runs the fulfillment` → `runs fulfillment` (match v2 NEW string)
- **Untouched (KEEP/LOCKED):** track bullets, platform cards, compare rows, AFF.FORM.CONSENT, AFF.CMP.FOOTNOTE, form body, logo link (W0)
- **Journeys:** none
- **Routes:** none

### W4 — Microcopy (done)

**Files touched**
- `public/js/homepage-survey.js` — funding form labels, placeholders, validation, button states
- `src/survey/cf-question-map.mjs` — funding-need + credit titles kept in sync with homepage JS
- `public/affiliates/index.html` — partner form labels/placeholders + validation/submit strings only (AFF.FORM.CONSENT LOCKED untouched; success KEEP)
- `public/404.html` — H1, body, homepage link label

**Applied (slots existed)**
| Slot | Where |
|---|---|
| Name / Email / Phone / Business labels + placeholders | homepage survey contact + affiliates form |
| Funding need title | homepage survey step `funding_target_amount` |
| Credit title | homepage survey step `current_score` |
| Empty / bad email / bad phone / consent / submit failed / duplicate | homepage survey `setErr` paths |
| Empty / bad email / bad phone / consent | affiliates form `alert` paths |
| Idle `Submit application` / Submitting `Sending…` / Success `Received` | homepage survey submit button |
| Affiliates submitting `Sending…` | partner submit button |
| Partner success | KEEP (unchanged) |
| `404.H1` / `404.BODY` / `404.BTN` | `public/404.html` (BTN = homepage list link text) |

**Left undone (no UI slot — not invented)**
- Funding application success heading/body — homepage redirects to apply.fundhub.ai; no in-page success panel
- Enrollment success heading/body — no enrollment success UI (checkout still W0-blocked)
- Cookie / consent banner — not added (per brief)
- Partner submit-failed + duplicate strings — affiliates form has no real fail/dedupe path
- Partner idle button left as `Submit partner application` (funding idle string is for the funding form)

**Untouched**
- Homepage marketing (W1), education/refunds (W2), affiliates hero (W3), login/enroll bugs (W0)
- AFF.FORM.CONSENT LOCKED
- Cookie banner

**Verify**
- `node --test src/config/homepage-survey-js-sync.test.mjs src/survey/cf-question-map.test.mjs src/config/homepage-survey-steps.test.mjs` — 10/10 pass

**Journeys / routes / exports** — none

### W2 — Education + refunds (done)

**COMPLIANCE REVIEW REQUIRED** — refund behavior wording changed (owner-directed §8.1).

**Files touched**
- `public/education/index.html`
- `public/education/refund/index.html`

**IDs dropped**
- `EDU.META.DESC` NEW → meta description
- `EDU.HERO.SUB.B` NEW → hero bold lede (removed “You do the work yourself” from hero)
- `EDU.BADGE.2` NEW → marquee badge strip (both loops): “40+ video lessons per program”
- `EDU.CM.FOOT` → removed leading “You execute every step yourself.”; remainder kept
- `EDU.FOOT.DISC` NEW → footer legal disclaimer replaced
- §8.1 refund phrase word-identical in 5 places:
  1. hero/stat Refunds cell
  2. CM enroll note
  3. CS enroll note
  4. FAQ refund answer
  5. `/education/refund/` §1

**Kept untouched (per brief)**
- `EDU.STD.N01–N04`, all 20 curriculum modules, FAQ except refund, CS footer
- Enroll button `href="#"` left for W0
- Homepage, affiliates, login not touched

**Terms / privacy confirm (read-only)**
- `public/education/terms/index.html` — exists; titles/meta/body scope to Fundhub Education programs (FUNDHUB LLC)
- `public/education/privacy/index.html` — exists; §1 Scope covers this site, Fundhub Education enrollment, student portal
- No pages invented

**Journeys** — none (static marketing HTML only)
**Exports / routes** — none
