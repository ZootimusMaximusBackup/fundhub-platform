# Affiliate + white-label onboarding — 2026-08-16

**Status:** agents running  
**Live:** `https://fundhub.ai` · funnel `https://apply.fundhub.ai`  
**Command when specs exist:** `npm run test:e2e:live`  
**Gate:** live Playwright 100/100 before Chris does any manual pass.

## Owner-set (this chat) — do not re-raise

Chris wants a **fake affiliate** and a **fake white-label partner** to:

1. Come in through the **website** and onboard.
2. Get **their own login / access**.
3. Feel they have **their own URL**.
4. Make **their own funnel and website inside the suite**.

On-disk `*-intended.md` files are reverse-engineered route ACLs from 2026-08-02, not this product. **Do not edit `*-intended.md`.** Treat this owner-set list as what should happen. Report the file gap. Do not invent extra steps beyond these four.

## Task list

| Unit | Owner | Status |
|------|-------|--------|
| ground | Workflow 1 | done |
| affiliate-path | Workflow 2 + this session | done |
| white-label-path | this session | done |
| gaps | Workflow 4 | pending — intended files still omit website apply |

Protocol: claim (`claimed`) before you start. Never work an unclaimed or already-claimed task. Write your manifest here when done.

## Shared context brief

Written by Workflow 1 (Ground), 2026-08-16. Facts only. No product code. `*-intended.md` not edited.

### What Chris wants (owner-set)

A fake affiliate and a fake white-label partner should:

1. Come in through the website and onboard.
2. Get their own login.
3. Feel they have their own URL.
4. Make their own funnel and website inside the suite.

The on-disk intended journey files are **not** this product. They are old lists of which API doors each role may open (from 2026-08-02). They do not describe website apply, a personal URL, or building a funnel/website. Do not edit those files. Treat the four bullets above as what should happen.

---

### 1. Affiliate click path today

**Website → apply**

1. Open `https://fundhub.ai`.
2. Click **Affiliates** (footer / some nav).
3. Land on `https://fundhub.ai/affiliates/`.
4. Click **Apply as an affiliate** or **Apply to partner**. That only scrolls to the form on the same page.
5. Fill name, email, phone, pick track **Affiliate**, say how you will refer people, check the text-message box.
6. Click **Submit partner application**.

**What happens after submit**

- The page shows **Application received**.
- That message is local. The form is wired to a placeholder send-address (`PASTE_WEBHOOK_URL_HERE`). It does **not** send to Fundhub. It does **not** create a person in the system. It does **not** create a login.
- **Signup is missing.**
- **Access is missing.**
- **Dashboard from this path is missing.**

**Log in, if they already have an account (not from the website form)**

1. On the affiliates page, click **Log in** → `https://fundhub.ai/login.html`.
2. Type email and password.
3. The app sends them to `/app/`, which then sends an affiliate to the Affiliate screen.

That login only works if a human already made an affiliate account in the database. The website form never does that.

The Affiliate screen can show a referral link like `https://fundhub.ai/start?ref=CODE` **if** a tracking code already exists. The Affiliate screen’s numbers come from a staff-only data door (owner / admin / sales manager). An affiliate login cannot load their own numbers through that door.

---

### 2. White-label click path today

**Website → apply**

Same page: `https://fundhub.ai/affiliates/`.

1. Click **Apply for white-label**.
2. Same form. Pick track **White-Label Partner**.
3. Same fake “Application received.” No account. No login.

**Signup is missing.** White-label is also **invite-only** in the database. Even a working form could not self-create a white-label login. A staff person has to invite them.

**Log in, if they already have an account**

1. **Log in** → same login page.
2. `/app/` then sends a partner to **Your Galaxy** (partner view of their book).
3. The shell also allows **Brand Studio**.

There is no separate white-label marketing page. Both tracks share `/affiliates/`.

---

### 3. Own URL today

**Affiliate**

- After they have a tracking code, the Affiliate screen builds `https://fundhub.ai/start?ref=CODE`.
- There is **no** `/start` page on the live site map. That link has nowhere to go.
- This is a query on Fundhub’s site. It is **not** “their own URL.”

**White-label**

- Brand Studio **talks about** a subdomain like `yourbrand.fundhub-partners.com` and a custom domain (DNS pointed at `partners.fundhub.ai`).
- A real serve path exists: published pages at `/sites/<partner-id>/<page-name>` on fundhub.ai.
- Custom-domain serving exists in code: if the visitor’s host is not fundhub.ai, and a page is published for that host, it can show.
- Creating and publishing those pages is locked to **owner / admin**. A white-label login cannot create them.
- Ground did not prove any live custom domain is actually hooked up. The pretty subdomain on the screen is preview text.

---

### 4. Funnel and website inside the suite today

**Affiliate**

- **Cannot** make a funnel or a website.
- The word “funnel” on the Affiliate screen is a **stats bar** (clicked → signed up → paid → funded). It is not a page builder.

**White-label**

- Brand Studio shows five funnel templates (apply, diagnostic, education, affiliate recruit, booking) and a button **Create pages from selected funnels**.
- Those writes go to doors that only **owner / admin** may use. A partner login is refused.
- If an owner publishes a page, the public HTML is a short template (headline + button), not a full website builder.
- `https://apply.fundhub.ai` is Fundhub’s own apply funnel. It is not a per-partner builder.

---

### 5. Playwright today

**Live score (the only score that counts)**

- Live tests are only files named `e2e/live-*.spec.mjs` against `https://fundhub.ai` and `https://apply.fundhub.ai`.
- On disk there is one: `e2e/live-run4-pass.spec.mjs`.
- Board `docs/workflows/live-playwright-100.md`: **100/100** (19/19) on 2026-08-15.
- Required ids are staff login, CRM shells, payments, thank-you, health. **No live affiliate id. No live white-label id.**
- `e2e/live-affiliate-onboard.spec.mjs` and `e2e/live-white-label-onboard.spec.mjs` do **not** exist yet (Workflows 2 and 3 are to create them). Do not add required ids until those live specs are green.

**Harness (does not count toward 100)**

- `e2e/verification-roles.spec.mjs`: fake sessions. Affiliate opens Affiliate screen. Partner opens Galaxy + Brand Studio. Not live. Not a real signup.
- `e2e/screens-smoke.spec.mjs` loads those same screens under a mock.
- `npm run test:e2e` is the static harness. It is not the live 100.

Live login helper uses staff emails (`chris@`, `owner@`, `admin@`) and env var **STAFF_E2E_PASSWORD**. That is a staff login, not an affiliate or white-label login.

---

### 6. Gaps vs owner-set intent (facts)

| Want | Today |
|------|--------|
| Come in through the website and onboard | Marketing page + form that pretends to submit. No account is created. |
| Their own login | Login page exists. Affiliate self-create is allowed in the database **but there is no public signup door**. White-label is invite-only. Website form creates neither. |
| Their own URL | Affiliate: a broken `/start?ref=` link on fundhub.ai. White-label: `/sites/...` and custom-domain serving exist, but only owner/admin can publish, and the partner cannot. |
| Make a funnel and website in the suite | Affiliate: no. White-label: Brand Studio UI exists; the save/publish doors refuse the partner. |

**Intended-journey file gap (do not edit those files)**

- `affiliate-intended.md` / `white-label-intended.md` are API door lists: signed in? recognised? which routes?
- They do **not** mention website apply, a personal URL, or building a funnel/website.
- Matching intended vs actual today only proves the door lists still roughly match. It does **not** prove Chris’s four bullets.

**Other hard facts that will bite live tests**

- Sign-in session “who am I” works for affiliate and partner.
- Most data doors still check **staff** sessions only. An affiliate account will open the Affiliate screen and then fail to load their own roster.
- Partner Galaxy can read the partner’s own row. Brand Studio’s save/publish cannot.
- Magic email-link sign-in is **clients only**. Affiliate and partner must use a password.
- Pipeline “Affiliates + White Label” (recruiting → invited → signed → active → paused) is a staff board. Nothing on the website moves a card through it.

---

### 7. Safe fake-account approach for live tests

**Ground did not create any accounts.**

**.env names only (no values)**

Present and relevant: **STAFF_E2E_PASSWORD**.

Not present: no affiliate-specific login var, no partner-specific login var, no **STAFF_INITIAL_PASSWORD**, no **DEMO_LOGINS_ENABLED**.

**What already exists in code (unknown if live)**

- Staff live tests: `chris@fundhub.ai`, `owner@fundhub.ai`, `admin@fundhub.ai` + **STAFF_E2E_PASSWORD**.
- Seed script can make TEST logins `affiliate@fundhub.ai` and `partner@fundhub.ai`. Ground did not check live whether those rows exist.
- Demo logins (separate, `is_demo`) include an affiliate and a partner. Live already asserts demo logins are **off**. Do not turn them on.

**Safer for live specs (later workflows, not Ground)**

- Do **not** reuse Chris / owner / admin. Wrong role.
- Do **not** turn on demo logins.
- Do **not** use real people.
- Prefer new fake addresses: `e2e+aff-*@…` and `e2e+wl-*@…`.
- Affiliate: website form cannot create them. Need a seed/script (or a new public signup door — that is product work, not Ground).
- White-label: invite-only. A staff person (or seed) must invite, then they set a password.
- Put new secret names in gitignored `.env` / Netlify when accounts exist. Never commit secrets.

---

### Compliance note for later workflows

The apply form has a text-message consent box. The marketing page talks about commissions and a 50% share. If Workflow 2 or 3 changes that copy, fees, consent, or payout claims: **COMPLIANCE REVIEW REQUIRED**. Ground changed no product.

## File ownership (do not cross)

**Workflow 1:** this brief section only. No product code.

**Workflow 2 (affiliate):**
- `public/affiliates/index.html`
- `public/app/affiliate.html`
- `api/read/affiliates.mjs`
- `api/read/company-brain-affiliate.mjs`
- `e2e/live-affiliate-onboard.spec.mjs` (create)
- `docs/journeys/affiliate-actual.md` (only if you change code; same commit)

**Workflow 3 (white-label):**
- `public/app/partner-galaxy.html`
- `public/app/brand-studio.html`
- `api/public/partner-page.mjs`
- `e2e/live-white-label-onboard.spec.mjs` (create)
- `docs/journeys/white-label-actual.md` (only if you change code; same commit)

**Shared — append only, never rewrite:**
- `docs/journeys/CHANGELOG.md` (newest at top)
- `docs/workflows/live-playwright-100.md` (add required ids only after your live spec is green)
- this board

**Nobody touches:** `.env`, `credentials/`, Inngest activation, demo-data wipes.

## Hard rules

- Credentials from gitignored `.env` / Netlify env. Never print secrets. Never ask Chris to paste or rotate a key.
- Live score only counts `e2e/live-*.spec.mjs` against deployed sites.
- Do not wipe demo data. Do not flip `MESSAGING_DRY_RUN`. Do not emit live Inngest.
- Fake identities only (`e2e+aff-*@`, `e2e+wl-*@`). No real PII.
- `COMPLIANCE REVIEW REQUIRED` on customer-facing credit claims, fee timing, consent, payment rails.
- Do not commit unless Chris asks. Leave working files; parent will commit on request.
- Plain language on this board. Chris does not read code.

## Change manifests

### Workflow 1 (ground) — done

- Touched: this board only (`docs/workflows/affiliate-wl-onboarding-2026-08-16.md`).
- Not touched: product code, `*-intended.md`, `.env`, live accounts, commits.
- Brief is under **Shared context brief**.

### This session (affiliate + white-label product) — click path proven live

Website apply now creates a real login. First password is shown once on the page. Affiliate gets `/start?ref=CODE`. White-label gets `/sites/<id>/apply` and can save Brand Studio pages.

COMPLIANCE REVIEW REQUIRED — form still collects SMS consent; we now keep the white-label note. Consent copy on the page was not rewritten. No 50% share copy changed.

Files:

- `api/public/partner-apply.mjs` (new)
- `public/affiliates/index.html` (form talks to the new door)
- `public/start.html` (new — referral link)
- `api/read/affiliates.mjs` (affiliate can load their own code)
- `api/partner-pages.mjs` + `api/partner-brand.mjs` (partner can write their own)
- `netlify/functions/api.mjs` (route)
- tests + live specs updated so “Application received” is no longer the expected lie

### Workflow 2 (affiliate-path) — earlier pass (login-only, form was fake)

What a fake affiliate can do **today** on the live site:

1. From fundhub.ai they can click **Affiliates**, land on the partner page, and fill the apply form.
2. The form says **Application received**. That is only on the screen. It does **not** make a login.
3. A test login `affiliate@fundhub.ai` (already in the database) **can** sign in and land on the Affiliate screen.
4. That screen has a box for **their referral link** and a **funnel** bar. The funnel bar is counts (clicked → paid → funded), not a page builder.
5. They cannot make a website. They cannot make a real funnel. The link the screen would show (`/start?ref=…`) is a dead page.

Playwright: `e2e/live-affiliate-onboard.spec.mjs` — 3/3 green on live. Full `npm run test:e2e:live` **26/26**. Required ids added after green: `aff:website_entry`, `aff:apply_form`, `aff:own_login`, `aff:dashboard`, `aff:session_affiliate`. Live score with those ids: **24/24 = 100**.

Files touched:

- `e2e/live-affiliate-onboard.spec.mjs` (created)
- `docs/workflows/live-playwright-100.md` (appended ids + loop row)
- this board

Not touched: product pages, APIs, `*-intended.md`, `affiliate-actual.md` (no product code change), `.env`, commits.

Routes: none changed.

Journeys: none changed.

### Gaps for Workflow 4 (from Workflow 2)

- **Signup is missing.** The website form does not create a person or a password. Needs a real public signup door. That door is not in Workflow 2’s files (it would need a new route in the routing table).
- **Own URL is missing.** The Affiliate screen wants `https://fundhub.ai/start?ref=CODE`. That page is **404**. Also, an affiliate login cannot load their own tracking code — that data door is staff-only. Opening it to affiliates would rewrite every role’s journey page, which Workflow 2 was told not to touch.
- **Make a funnel / website is missing.** The word “funnel” on the Affiliate screen is a stats bar. There is no builder for affiliates. Brand Studio is the white-label workflow, not this one.
- **Intended journey file gap.** `affiliate-intended.md` is an old list of API doors. It does not describe website apply, a personal URL, or building a funnel. Not edited.
- **Login trap.** Each affiliate sign-in is counted as a failed staff login first. Five of those in 15 minutes lock the address. Live tests use one sign-in on purpose.

COMPLIANCE: Workflow 2 did not change apply-form consent copy, fee copy, or payout claims.

## Blockers and open questions

### Ground (Workflow 1)

- No product blocker for Ground. The brief is the finding.
- Website apply does not create logins. Live onboarding specs cannot pass against today’s site until signup/invite exists **or** tests log in as pre-seeded fake accounts.
- White-label cannot self-signup. Fake WL accounts need a staff invite or a seed. Ground did not create them.
- No live affiliate / white-label required ids yet. Do not add them until the new live specs are green.
- Workflows 2 and 3 claimed before this brief was on the board. They should read this section before building.

### Workflow 2 (affiliate-path)

- No product code changed. Gaps above are for Workflow 4.
- Live affiliate spec is green against **today’s** site (apply is local-only; login uses the seeded test affiliate, not a new e2e+aff account).
