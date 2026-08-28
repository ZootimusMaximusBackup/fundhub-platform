# Optimize — Fundhub Credit Solutions LLC referral page

**COMPLIANCE REVIEW REQUIRED** — credit-repair referral copy. No score-up claims. Page says Audit, not credit repair.

**Owner 2026-08-28 (his words):** Creating / running (make this live).

PR [#271](https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/271) merged into `main` 2026-08-28. Netlify deploys `main` on its own. No migrations in that change.

Worktree: `/Users/zootimusmaximus/fundhub-optimize`  
Branch: `feat/optimize-apply` (merged)

## Workflows

| # | Unit | Owner | Status |
|---|---|---|---|
| 1 | Hidden public page `/optimize` + `/optimize.com` — book, optional Audit checkout, gated Smart Credit, Audit roadmap from existing repair brain | this chat | **done — live** 2026-08-28. PR 271 on `main`. |
| 2 | Smart Credit enroll live on this page | waiting | **wired-but-dark** — no CONSUMER_DIRECT / SMART_CREDIT client key + PID in `.env` or Netlify |
| 3 | Blake inbound → follow-up (email first, SMS after opt-in) | this chat | **plan only** — no ingest door exists. Do not build a Gmail robot. |

## Shared brief

- Entity on every public word: **Fundhub Credit Solutions LLC**
- Referrals only. Low-key. No “your score will go up.” No “credit repair” on the page.
- Book URL (reuse, do not invent): `https://apply.fundhub.ai/schedule/phonecall`
- Audit checkout: keep title **Consulting Services Assessment**. Never POST `/public-api/products/create`.
- Smart Credit: Enrollment Widget only, and only when client key + PID exist.
- No Identity IQ. No CRS on this page. No Blake ingest. No Twilio from Gmail.

## Workflow 1 manifest

- `public/optimize.html` — page
- `api/public/optimize.mjs` — GET config / POST Audit checkout
- `netlify.toml` — `/optimize.com` → `/optimize.html` (200 rewrite)
- `netlify/functions/api.mjs` — route `public/optimize`
- `src/pulse/registry.mjs` — `public/optimize`
- `src/http/optimize-html.test.mjs`
- `src/http/optimize-public.test.mjs`
- `docs/journeys/optimize-intended.md`
- `docs/journeys/optimize-actual.md`
- `docs/journeys/CHANGELOG.md` — one line

## Left waiting

Smart Credit affiliate / partner client key + PID. When those names exist in env, the Enrollment Widget renders. Until then the slot stays hidden.

## Owner note — already has a SmartCredit account (2026-08-28)

**Owner-set:** Chris already has a SmartCredit / Consumer Direct account. This is not a brand-new signup.

- Email on their co-brand form: `stanbridgejchris@gmail.com` (same as the first inquiry)
- He was on the final-steps form (special messaging + Fundhub logo ready to submit)
- Affiliate link / widget client key / PID are still not in `.env` or Netlify — waiting on their portal after he submits that form, or their reply to the partner emails
- Public page still says **Audit**. No “credit repair” on visitor copy.

## Live URLs proved 2026-08-28 (clicked like a person)

Paste these to Claude for restyle. Do not restyle in a Grok chat.

| What | Exact URL | Notes |
|---|---|---|
| Website | https://fundhub.ai | Home. Title: fundhub \| Business Funding Up to $500K, No Hard Inquiry |
| Optimize | https://fundhub.ai/optimize | Same page as `.com`. 200. Title: Book a call \| Fundhub Credit Solutions LLC |
| Optimize (same page) | https://fundhub.ai/optimize.com | 200 rewrite to the same HTML. Not xyl.in anymore. |
| Same file | https://fundhub.ai/optimize.html | Same bytes as `/optimize` |
| **Audit** | https://fundhub.ai/optimize#audit | Same page. `#audit` jumps to the Audit form (`id="audit"`). Not a second page. |
| Audit data (not a look) | https://fundhub.ai/api/public/optimize?view=roadmap | JSON only. Built from `src/metro2/diy/from-crs.mjs` + `src/repair/round-plan.mjs` on a stored sample file. Not a screen. |
| Book calendar | https://apply.fundhub.ai/schedule/phonecall | Live Book a call. Meeting with Chris. Keep this. |

**What Audit looks like live:** A heading “Audit”, an email box, **Pay for Audit**, and **See Audit roadmap**. Click the roadmap button and a numbered R1–R6 list opens **on the same page**. `#audit` jumps to that form. There is no `/audit` page.

`#roadmap` is a hidden box on the same page. Opening `https://fundhub.ai/optimize#roadmap` does **not** show the list until someone clicks the button.

Pay for Audit posts to `/api/public/optimize` and mints **Consulting Services Assessment**. Do not make a new Commas product.

## Blake inbound — plan (no new robot)

**Searched.** No Blake Edwardson ingest. `src/gmail/` can **read** prove Gmail. It does not make a client or send a text. Mailgun inbound is the bank inbox (`mg.fundhub.ai`). Twilio inbound only **links** to a person who already exists. It must not mint a client from a raw text. `START` / `STOP` already work for people on file.

**Do not** auto-Twilio from a Gmail forward. That skips opt-in.

### How we send (already possible — no new path)

1. Add the person as a file: Pipeline → **New Client** (`POST /api/pipeline-clients`). Needs name, email, phone, product. Same door as the apply form.
2. **Email first** with the link: Messaging → send email (`POST /api/messages`). Paste https://fundhub.ai/optimize (and book https://apply.fundhub.ai/schedule/phonecall if you want).
3. **SMS only after they opt in.** Page checkbox is on `/optimize` now (PR 271 `sms_consent`). The handler still does **not** store the tick. Or a CRM consent mark. Or they text `START` to the **company** number after we asked by email.
4. Follow-up from the same CRM / Twilio templates we already have. Do not invent a blast.

### Company number (not 661 personal)

- **Send from:** `(561) 304-8368` — env names `TWILIO_SEND_FROM` and `FUNDHUB_REP_NUMBER`. Same company line.
- **Not from:** Chris’s personal 661 prove phone.
- **Not from:** the 661 agent sim line used for tests.
- `messaging_settings` holds the company send switch and cap. It does **not** hold the from-number. The from-number is those env names.

**Goofy but true:** today’s SMS gate is **opt-out** (STOP), not **opt-in** (must check a box first). If staff hits Send on SMS, it can go. So for Blake people: email only until they opt in. Do not click SMS yet.

### Do not build

- A Gmail-forward robot
- Auto-SMS when Blake emails or texts Chris
- A new Commas product
- Credit-repair words on the public page
- A new blast / nurture key for this

### Later (not this chat)

The SMS checkbox is on the live page (PR 271). Storing that tick still needs a handler change. Leave display work for Claude. SMS from the company 561 number only after opt-in.
