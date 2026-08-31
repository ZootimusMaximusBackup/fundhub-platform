# ConsumerDirect / SmartCredit signup widget — research and build plan

**COMPLIANCE REVIEW REQUIRED** — this touches credit-repair messaging, consent capture, fee timing
and payment rails. Nothing here ships without Chris saying yes.

**Plan only. No widget code was written. No new page, screen, tab or menu row is proposed.**

Date: 2026-08-28. Researched from the three ConsumerDirect developer pages Chris was sent, plus the
SmartCredit work already in this repo.

---

## BLOCKER — the branding guidelines never reached us

ConsumerDirect sent a branding guidelines PDF as an attachment. **It did not arrive.** We do not
have it. Nothing in this repo contains it. This is not a guess — the file is simply absent.

That matters because "Brand distinction" is one of the six things ConsumerDirect checks before they
give us a live key. We cannot finish that part of the work without the file.

### What I could not work out without it

1. Which SmartCredit logo file to use, what size it must be, and how much empty space has to sit
   around it.
2. How the Fundhub mark and the SmartCredit mark are allowed to sit together on one page. Side by
   side? Stacked? Divided by a line? Unknown.
3. The exact SmartCredit brand colours, and which of our funnel colours are allowed to sit next to
   them.
4. The typeface SmartCredit wording has to be set in.
5. Whether the word "SmartCredit" may appear in plain sentences without the logo, and how the first
   use on a page must be marked.
6. Their signup form ships with four ready-made looks named `material`, `bootstrap`, `sc` and
   `galaxy`. The docs do not say which one a partner is expected to use, or whether we are allowed
   to restyle it with our own colours at all. The guidelines file is the only place that could say.
7. Whether their "co-brand" block must be shown on our page, and which logo it would show for our
   partner number.
8. The exact wording of any credit line they require in our footer (for example a "SmartCredit is a
   registered trademark of…" sentence). We would be inventing it otherwise, and we do not invent.
9. Whether the name they approved on our co-brand form is "Fundhub", "Fundhub Credit Solutions LLC",
   or something else. Their form has a company-name field and it has to match what they approved.

### A second gap, in their own docs

Their compliance page says every funnel hosted outside their systems "must undergo a compliance
review." **It never says how.** No email address, no list of what to send, no timescale, no
description of what approval looks like. The only address anywhere in the three pages is
`partnerintegration@consumerdirect.com`, and it appears in a different context (asking for keys and
test data), not for review.

So: we do not know how to submit for review. That absence is the finding. It goes in the questions
list in workflow 5 below.

---

## The other blocker — the keys we were given do not match the names the code reads

This is the fastest thing to fix and it stops everything.

The code already looks for the key and the partner number. It looks under these names:

```
CONSUMER_DIRECT_CLIENT_KEY   or   SMART_CREDIT_CLIENT_KEY
CONSUMER_DIRECT_PID          or   SMART_CREDIT_PID
CONSUMER_DIRECT_ENV          or   SMART_CREDIT_ENV
```

Chris set these on Netlify:

```
CONSUMERDIRECT_STAGE_CLIENT_KEY
CONSUMERDIRECT_PID
```

**Not one of them matches.** `CONSUMERDIRECT_PID` and `CONSUMER_DIRECT_PID` are different names —
one underscore apart. The code will never see them. The signup form will stay switched off, and
nothing on the page will tell anyone why.

There is a second problem hiding behind the first. The key we were given is a **stage** key — a
practice key, for their test system. But the code only points at the practice system when
`CONSUMER_DIRECT_ENV` is set to `stage`, and that name is not set at all. So even after the names
are fixed, a practice key would be pointed at the real live system and would fail.

Source: `api/public/optimize.mjs`, the `smartCreditFromEnv` function (lines 60–87 on this branch,
lines 71–97 on `feat/smartcredit-widget`).

I did not fix this. It is a code change and this task is plan-only. It is workflow 1 below.

---

## G. Is the widget even the right tool?

We already send people to SmartCredit. On `feat/smartcredit-widget` the `/optimize` page has a
button that reads "Get My Credit Report" and goes to `https://smartcredit.com/cblp/?PID=29056`.
That is their own official tracking link. It works today.

Here is the honest comparison. This is Chris's call, not mine.

### What the link gives us now

| | |
|---|---|
| Build cost | None. It is live. |
| Compliance review | **Not needed.** Their rule is about funnels hosted outside their systems. This one is inside their systems. |
| Card numbers on our website | None. They type it on SmartCredit's site. |
| Attribution | Yes — the partner number is in the link. |
| Person stays on our page | No. They leave, in a new tab. |
| Do we learn what happened | **No.** We never find out if they signed up. |
| Can we save them typing | No. |
| Look and feel | SmartCredit's, not ours. |

### What the widget gives us instead

| | |
|---|---|
| Build cost | Real. See the split below. |
| Compliance review | **Required.** Our page becomes a funnel outside their systems. |
| Card numbers on our website | Yes. Their script collects it, but it is typed on our page. |
| Attribution | Yes — the partner number goes in as a hidden field. |
| Person stays on our page | Yes. |
| Do we learn what happened | **Yes.** Their code fires a signal at every step, carrying the person's name and email. |
| Can we save them typing | Yes. We can fill in what they already gave us. |
| Look and feel | Ours, using their colour settings. |
| New way it can break | Their script has to load from their servers. If it is slow or down, the signup on `/optimize` is dead. A link cannot fail that way. |

### The honest answer

**One thing is genuinely new: we would know what happened.**

Right now somebody clicks "Get My Credit Report" and vanishes. We do not know if they signed up, got
stuck, or gave up. The widget tells us, step by step, with their name and email. That is the whole
difference.

Everything else on that list — the look, the pre-filling, staying on the page — is nice. None of it
is worth a compliance review on its own.

So the question is really: **do we intend to use that information?** If we would store it, follow up
on it, and count it, the widget earns its keep. If we would not, we are taking on a compliance
review and a card form on our own website to gain almost nothing.

I am not making that call. Chris is.

---

## H. What it would replace or collide with

The widget and the partner link want the same spot on the page.

Look at `public/optimize.html` on `feat/smartcredit-widget`. There is one button, `id="go"`. It is
the link today. And the page's own code already contains this, in `mountWidget`:

```js
go.parentNode.insertBefore(slot, go);
go.hidden = true;
```

It hides the link and puts the widget where the link was. **So the decision is already made in
code: the widget replaces the link.** They cannot both be the main button.

Three real collisions, all on that same page:

1. **Counting.** The `cblp` link is the tracking link. A commit note from today
   (`584a9dcd`) is explicit: we had been pointing at a different SmartCredit address that "does not
   track, so enrollments through it may not have been attributed." Now there would be two ways to
   reach the same partner number — the link and the widget's hidden field. Two paths to one number
   is how counting goes wrong.

2. **The price line.** Under the button it says *"All three bureaus · membership from $19.99 · no
   free trial"*. That line was added on purpose. The commit note says a button with no price on it
   "walks somebody straight into an unannounced paywall, which is the fastest way to lose the ones
   who would have paid." But the widget draws its **own** plan and billing screens. If their screen
   shows a different price, or a plan chooser, our line and their screen disagree on the same page.
   That is exactly what ConsumerDirect's pricing rule is about.

3. **Spanish.** `SMART_CREDIT_AFFILIATE_URL_ES` (`https://smartcredito.com/cblp/?PID=29056`) is
   already saved in the code but not used. The widget does Spanish a different way, with a language
   setting and an optional language chooser. Turning the widget on makes that saved Spanish link
   dead. Somebody has to decide: keep it as a backup, or delete it.

### One more collision that is not on the page

`feat/smartcredit-widget` **is not merged**. It is not on `main`. It changes 393 lines of
`public/optimize.html` and 57 lines of `api/public/optimize.mjs` — which is exactly where widget
work would go. Any widget branch started from `main` today would fight it.

**Anything built for the widget must start from `feat/smartcredit-widget`, or wait until it
merges.** Not from `main`.

### The positioning line the widget must not break

`/optimize` is for another funder's **declined** referrals, sent back to that funder. It never says
"funded with us." It says we will talk to your funder. Every word around the widget has to hold that
line.

There is a live tension here worth naming. Our page currently frames the SmartCredit signup as step
**01** of a three-step Fundhub process ("01 Set up your account / 02 We read every line / 03 We go
through it together"). ConsumerDirect's compliance rule says their service must be "clearly
presented and distinguished from services provided by the partner" and **must not** be combined into
a package. A numbered step 01 inside our own process reads like a package. That needs rewording
before review. See the checklist.

---

## A. What the widget actually is

**In one line: it is a piece of code we paste into one of our own pages, and it draws SmartCredit's
signup form right there on our page.**

It is not a link somewhere else. It is not a box-within-a-page (an "iframe"). It is not a
behind-the-scenes data connection. It is a script that runs in the visitor's browser and builds a
form inside a slot we leave for it.

The whole thing is two lines of page code:

```html
<div id="cd-signup-widget"
     data-clientkey="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
     data-productname="smartcredit"
     data-memberurl="https://stage-sc.consumerdirect.app"></div>
<script type="module" async defer
        src="https://stage-cdn.consumerdirect.io/cd-widgets/latest/cd-signup.js"></script>
```

Those are the practice ("stage") addresses. The live ones are `https://www.smartcredit.com` and
`https://cdn.consumerdirect.io/cd-widgets/latest/cd-signup.js`.

### What the visitor sees and does

Five steps, all on our page, one after the other:

1. **AccountStep** — they set up a login.
2. **PersonalStep** — name and address.
3. **IdentityStep** — questions only they could answer, taken from their credit file.
4. **BillingStep** — credit card.
5. **ConfirmationStep** — done, they are signed up.

Three things can go wrong and each has its own named outcome: `SignupError`,
`SignupErrorOutsideUS` (they are not in the United States), and `SignupErrorBlackbox`.

### What comes back to us

Every time the person moves to a new step, the script raises a signal in the browser called
`cd-signup-next-step`. We can listen for it. It carries:

| What it carries | What it is |
|---|---|
| `step` | Which of the five steps they just reached |
| `customerToken` | A reference code for that person. **The docs never say what it is for or what we may do with it.** |
| `customerName` | Their name |
| `customerEmail` | Their email |
| `PID` | Our partner number |
| `company` | The company they are attached to |
| `memberPlan` | Which plan they picked |

**Nothing is sent to our server by ConsumerDirect.** There is no notification to our back end. No
return address. No redirect back to us. If we want to keep any of this, our own page code has to
catch that signal and send it somewhere ourselves.

There is also `window.CDWidgets.restartSignup()`, which starts the form over.

---

## B. What it needs from us

### Required — the form will not appear without these

| What they call it | What it is | Where it comes from in this repo | State today |
|---|---|---|---|
| `data-clientkey` | Our key from them | `api/public/optimize.mjs` → `smartCreditFromEnv()` | **Name mismatch. See blocker above.** |
| `data-productname` | Which product. Always `"smartcredit"` | Same function, written in the code | Fine |
| `data-memberurl` | Where their member site lives | Same function, switches on practice vs live | **Practice switch not set** |
| script `src` | Where their code is downloaded from | Same function, switches on practice vs live | **Practice switch not set** |
| `PID` | Our 5-digit partner number, as a hidden field | Same function; falls back to `29056` | **Name mismatch** |

### Optional — nothing breaks without them

| What they call it | What it does |
|---|---|
| `data-theme` | One of four ready-made looks: `material`, `bootstrap`, `sc`, `galaxy` |
| `data-lang` | Force a language, e.g. `es` for Spanish |
| `data-switcher` | Show a language chooser |
| `company_email`, `sponsorcode` | Extra hidden fields we can pass through |
| `AID`, `SID`, `TID`, `ADID`, `CID`, `SOURCEID` | Extra tracking values, passed in the web address |
| `firstName`, `lastName`, `email` | Fill in what the person already typed, passed in the web address |
| A block of settings named `cd-signup-prefill` | A fuller way to fill things in — see the warning below |
| `#cd-progress-widget` | A progress bar |
| `#cd-memberplans-widget` | A plan chooser |
| `#cd-cobrand-widget` | Shows the co-brand logo they have on file for our partner number |
| `#cd-marketing-message-widget` | A message block, takes a `data-companyname` |
| About 40 colour settings | e.g. `--cd-body-background`, `--cd-primary-btn-bg`, `--cd-error-color` |

**Warning on pre-filling.** Their example for the fuller pre-fill block shows a social security
number and a full credit card number written straight into the page. **We must never do that.** Our
rules forbid personal data in code, and it would put a card number in plain view. If we pre-fill at
all, it should be name and email only — nothing more.

### Things they did NOT ask for

I checked all three pages for each of these. Every one is **not mentioned anywhere in the docs**:

- A list of website addresses to register with them (an "allowed origins" list)
- Any browser security-policy requirement
- A return address to send the person back to
- A notification to our server
- Any behind-the-scenes call our server has to make
- A stated requirement that the page be secure (HTTPS)

**Not mentioned is not the same as not required.** These all belong on the questions list. Do not
build as if the answer is "none."

One thing I can state as fact from our side: **we have no browser security policy anywhere in this
repo.** There is no such rule in `netlify.toml`, and `public/_headers` sets only caching rules and
one file type. So nothing we own would block their script from loading today.

### Getting a live key

Their sandbox page says production needs "a unique Test Last Name and a Test Credit Card generated
specifically for your PID" and to ask a sales rep or `partnerintegration@consumerdirect.com`.

It says **nothing** about whether the practice key and the live key are different, or what review
step sits between them. Chris was told there is a review. The docs do not describe it.

---

## C. The compliance checklist

Straight from their compliance page, turned into lines Chris can tick. Their six headings, kept in
their order. I have marked which ones the page already passes today, based on
`feat/smartcredit-widget`.

### Website security

- [ ] The website's security certificate is current and valid. *(Not a code item — check the
      certificate on fundhub.ai.)*

### Brand distinction

- [ ] The SmartCredit brand is easy to spot and clearly separate from the Fundhub brand — logos,
      wording and trademarks. **BLOCKED — needs the branding guidelines file.**
- [ ] Every single use of **SmartCredit®**, **ScoreBuilder®**, **SmartCredit Report®** and
      **ScoreBoost™** carries its ® or ™ symbol.
      **NOT DONE TODAY.** The page writes "SmartCredit" with no symbol anywhere.
- [ ] SmartCredit is described **only** as a credit monitoring product.
- [ ] No credit-repair wording is used anywhere near a description of SmartCredit.
      **Already held.** The page says Audit, never credit repair, and states plainly that
      "Fundhub Credit Solutions LLC does not repair credit or contact bureaus on your behalf."

### Service information

- [ ] Clear enough information appears during signup that the person understands they are
      subscribing to SmartCredit.
- [ ] It is not hidden that this is a **separate** SmartCredit membership.
- [ ] SmartCredit's service is presented separately from Fundhub's service, not merged with it.
- [ ] The two are **not** sold as one bundle or package.
      **AT RISK TODAY.** The page numbers the SmartCredit signup as step "01" of a three-step
      Fundhub process. That reads like a package. Reword before review.

### Pricing

- [ ] SmartCredit's price and plan details appear on the card page (for plans that are not
      sponsored).
- [ ] Sponsored plans are shown as a benefit already included — never as a free extra.
- [ ] The person understands this is a **recurring monthly** charge.
- [ ] If there is a trial: how long it lasts, what it costs, and the monthly price after it are all
      shown clearly.
      **Partly held.** The page says "membership from $19.99 · no free trial". Once the widget draws
      its own billing screen, our line and their screen must agree. Check both together.

### Payment terms and conditions

- [ ] **SmartCredit's own** four documents are linked. Not ours. The exact addresses from their
      page:
  - Service Agreement — `https://www.smartcredit.com/help/terms-and-privacy/service-agreement.htm`
  - Privacy Policy — `https://www.smartcredit.com/help/terms-and-privacy/privacy-policy.htm`
  - Terms of Use — `https://www.smartcredit.com/help/terms-and-privacy/site-use.htm`
  - Consumer Rights — `https://www.smartcredit.com/help/terms-and-privacy/consumer-rights.htm`
      **NOT DONE TODAY.** The page links Fundhub's own `/privacy/` and `/terms/` and nothing of
      SmartCredit's.
- [ ] A tick box saying the person agrees sits on the card page, **before** payment is taken.
- [ ] That tick box and those links sit **near the submit button**.
      **UNKNOWN.** Their widget draws the card page itself, so their tick box may already be inside
      it. The docs do not say. **Ask before building our own — building a second one would be
      wrong.**

### Website disclosure

- [ ] It is clear to the person **when** their SmartCredit membership starts.
- [ ] It is stated that cancelling one product does **not** cancel the other.
      **NOT DONE TODAY.** No such sentence on the page.

### Cross-reference — rules we already hold ourselves to

`docs/compliance/creative-block-reasons.md` is our own rulebook. It governs **adverts and
campaigns**, not this page — so it does not automatically police `/optimize`. But it covers the same
ground, and ConsumerDirect's "no credit-repair wording" rule sits directly on top of it. The bans
that overlap:

| Our rule | What it forbids | Law it cites |
|---|---|---|
| `guaranteed-score-increase` | Promising a set or guaranteed rise in a credit score | CROA 15 U.S.C. 1679b(a)(3) |
| `promise-to-remove-accurate-info` | Claiming to remove accurate negative information | CROA 15 U.S.C. 1679b(a)(3) |
| `remove-late-payments-collections` | Claiming to remove lates, collections, charge-offs, bankruptcies and the rest | CROA 15 U.S.C. 1679b(a)(3) |
| `advance-fee` | Charging or advertising a fee before credit-repair work is finished | CROA 15 U.S.C. 1679b(b) |
| `guaranteed-timeline` | Guaranteeing how long results take | CROA 15 U.S.C. 1679b(a)(3) |
| `guaranteed-approval` | Promising approval | FTC Act 15 U.S.C. 45 |
| `file-segregation-cpn` | Offering a CPN or a new credit file | CROA 15 U.S.C. 1679b(a)(1)-(2) |
| `croa-consumer-rights` | **A presence rule.** Fires when the "Consumer Credit File Rights Under State and Federal Law" wording is missing | CROA 15 U.S.C. 1679c(a) |

The last one is worth a look. The `/optimize` footer already carries a rights paragraph pointing at
the Fair Credit Reporting Act, and the marquee says "No score promises · no guarantees". Whether
that satisfies the CROA rights wording is a question for Chris, not something to decide in a build.

**No customer-facing claim about credit outcomes is drafted in this document, and none should be
drafted for this widget.**

---

## D. Where it fits in this repo

I searched before proposing anything. Almost all of it already exists.

### The look — funnel/SLO, and it is already applied

There are two brand identities in this repo. Anything that is a form or a landing page uses the
**funnel/SLO** look — the one defined by `public/js/homepage-survey.js` — and never the main-site or
education/enroll look.

**The widget must match the funnel/SLO look.**

The good news: `/optimize` already does. Its page is built from the funnel booking pair
(`clickfunnels-fragments/04a-book-top.html` + `04b-book-bottom.html`) — fixed grid backdrop, centred
logo, spectrum eyebrow, 900px wrap, soft floating cards, an FCRA marquee, ghost wordmark footer. Its
form parts (`.field`, `.consent`, `.disclaim`) are the same shapes `homepage-survey.js` builds.

So there is no styling decision to make. The widget drops into a page that is already correct. What
it needs is their colour settings pointed at our funnel colours so their form does not look like a
stranger inside our card.

### The SMS consent wording — already reused correctly

The approved, shipped block lives at `public/js/homepage-survey.js` line 232–233:

> I agree to receive SMS from Fundhub.ai about my funding application. Msg &amp; data rates may
> apply. Msg frequency varies. Reply STOP to opt out, HELP for help. See our Privacy Policy and
> Terms.

`/optimize` already reuses it with exactly two phrases changed off the funding funnel — "Fundhub
Credit Solutions LLC" instead of "Fundhub.ai", and "about my file" instead of "about my funding
application". That is the correct treatment and it is already in place, above the button the widget
would replace.

**Two things to watch:**

1. The tick is still **not stored anywhere**. `api/public/optimize.mjs` never reads `sms_consent`.
   Today the page saves it into the browser's own short-term memory and nothing else. A ticked box
   leaves no record. This is a known, already-traced gap — not something the widget creates — but
   the widget does not fix it either.
2. **Their form collects a phone number itself**, inside PersonalStep, where our consent block does
   not apply. Whose consent covers that number is a question for them, not a thing to assume.

### Routes — no new route is needed to turn the widget on

A handler file that is not in the routing table answers 404. The routing table is
`netlify/functions/api.mjs`, and `/optimize`'s handler is **already in it**:

```
line 162:  import publicOptimize from "../../api/public/optimize.mjs";
line 591:  "public/optimize": publicOptimize,
```

So turning the widget on needs **zero** new routes.

A new route is only needed if we decide to record the step signals. That would be **one** new
handler plus **one** new line in that table plus a test — and it must be added to
`src/http/routes.test.mjs`'s expectations or it will fail the build. A candidate name, not a
decision: `api/public/optimize-signup-event.mjs` → `"public/optimize-signup-event"`.

**That route should not be built until Chris says where the signals go.** We do not have a table for
them and I am not inventing one.

### Outbound sending — the widget needs none

New outbound sending is only allowed in `src/messaging/providers/*`. Nothing else may gain one.

**The widget does not need one.** All of its traffic goes from the visitor's browser straight to
ConsumerDirect. Our server never calls them. Nothing is transmitted from our code.

The moment that changes is if we ever use the `customerToken` to fetch something from ConsumerDirect
server-to-server — for example to pull the credit report into the audit. That **would** be outbound
transmission, and it would have to live in a new provider module at
`src/messaging/providers/consumerdirect.mjs`. Nowhere else. Not in `src/lib/`, not in
`src/handlers/`, not inside the `/optimize` handler.

That is not in scope for this plan, and the docs do not describe any such call.

---

## E. Everything we do not know

Collected in one place. Every line is a real absence, not a guess.

**Blocked on the branding guidelines file:**

1. Logo files, sizes and spacing
2. How the two brands may sit together
3. Brand colours
4. Typeface
5. First-use trademark treatment in plain sentences
6. Which of the four ready-made looks to use, or whether custom colours are allowed
7. Whether the co-brand block is required, and what logo it shows for our partner number
8. Required footer credit wording
9. The exact company name they approved on our co-brand form

**Blocked on ConsumerDirect answering:**

10. How to submit for compliance review — who, what, how long
11. Whether their card step already carries the four legal links and the tick box, or whether we
    must add them ourselves
12. Whether they require our website address to be registered against the key
13. Whether the practice key and the live key are different keys
14. What the `customerToken` is for and what we are allowed to do with it
15. The unique Test Last Name and Test Credit Card for partner number 29056, needed for live testing
16. Which consent covers the phone number their own form collects

**Blocked on Chris deciding:**

17. Whether we actually want the step signals stored — see section G. This decides whether workflow
    2 exists at all.
18. Keep or delete the unused Spanish link.

---

## F. The split — how to build it, if Chris says go

Five workflows. The shared board is **this file**:
`docs/workflows/consumerdirect-widget-2026-08-28.md`. Every workflow reads it before starting and
writes its manifest to it before reporting done.

**Model: Opus — compliance-flagged, regulated, and Chris cannot check the output himself.**

### What runs together and what waits

- Workflows **1, 3 and 5** run at the same time. No dependencies between them.
- Workflow **4** waits for workflow 1. It cannot test a widget that is switched off.
- Workflow **2** waits for **Chris**, not for code. It should not start until he answers question 17.

**Everything starts from `feat/smartcredit-widget`, not from `main`.** That branch is not merged and
it owns the two files this work touches.

### Task board

| # | Unit | Owner | Status |
|---|---|---|---|
| 1 | Fix the key names and the practice switch | this chat | `pending` |
| 2 | Record the step signals | waiting on Chris | `blocked` — needs question 17 answered |
| 3 | Compliance wording on the page | unclaimed | `pending` |
| 4 | Practice-run proof with screenshots | unclaimed | `blocked` — waits on 1 |
| 5 | Questions for ConsumerDirect | unclaimed | `pending` |

**I am taking workflow 1.** It is the smallest, and nothing can be tested until it is done.

---

### Workflow 1 — Fix the key names and the practice switch

```
Repo: fundhub-platform. Start from branch `feat/smartcredit-widget` (NOT main — it is unmerged and
owns the files you are touching). Read CLAUDE.md first and follow it, especially §2 (never invent),
§7 (compliance flagging) and §10 (write for a non-coder).

Read the shared board first: docs/workflows/consumerdirect-widget-2026-08-28.md. Mark workflow 1 as
`claimed` before you start, and write your manifest to that file before you report done.

COMPLIANCE REVIEW REQUIRED — this is a credit-monitoring signup on a regulated page.

PROBLEM: The ConsumerDirect signup form on /optimize will never switch on, because the environment
variable names the code reads do not match the names that were actually set on Netlify.

The code, in `api/public/optimize.mjs` → `smartCreditFromEnv()`, reads:
  CONSUMER_DIRECT_CLIENT_KEY  or  SMART_CREDIT_CLIENT_KEY
  CONSUMER_DIRECT_PID         or  SMART_CREDIT_PID
  CONSUMER_DIRECT_ENV         or  SMART_CREDIT_ENV

What is actually set on Netlify:
  CONSUMERDIRECT_STAGE_CLIENT_KEY   (secret)
  CONSUMERDIRECT_PID

Note the missing underscore between CONSUMER and DIRECT. Nothing matches.

Second problem: the key we hold is a STAGE (practice) key. The code only points at the practice
system when the env name ends up equal to "stage". No such variable is set, so a practice key would
be sent to the live system and fail.

TASK:
1. Make `smartCreditFromEnv()` also accept CONSUMERDIRECT_STAGE_CLIENT_KEY and CONSUMERDIRECT_PID.
   Keep the existing names working — do not remove them, other code and tests read them.
2. Decide and implement how the practice/live switch is driven. A stage-named key is a strong
   signal, but do NOT silently infer it if that would surprise anyone. If you are not certain, stop
   and ask Chris ONE question before writing code (CLAUDE.md §2).
3. Update `src/http/optimize-public.test.mjs` to cover the new names and the practice switch.
4. Update `docs/journeys/optimize-actual.md` in the SAME commit, and append one line to
   `docs/journeys/CHANGELOG.md`.

DO NOT: print any key value, set or read Netlify env vars (api.netlify.com is blocked from agent
environments — report it, do not route around it), add a route, add a page, or change any wording on
the page. Wording is workflow 3.

DONE MEANS: npm run lint clean; the test suite green with no test weakened or deleted; journeys and
changelog updated in the same commit; manifest written to the shared board. Note that `npx tsc
--noEmit` is listed in CLAUDE.md §6 but there is no tsconfig in this repo, so it checks nothing —
say so rather than reporting it as a pass.

Report in CLAUDE.md §9 format.
```

### Workflow 2 — Record the step signals (BLOCKED — do not start yet)

```
Repo: fundhub-platform. Start from branch `feat/smartcredit-widget` (NOT main). Read CLAUDE.md
first and follow it, especially §2 (never invent) and §10 (write for a non-coder).

DO NOT START until Chris has answered this question, in his own words:
  "When somebody moves through the SmartCredit signup on /optimize, where should that land?
   A new record? An existing client record? A note? Nowhere?"

If he has not answered, mark workflow 2 `blocked` on the shared board
(docs/workflows/consumerdirect-widget-2026-08-28.md), write why, and stop. Do not choose a place for
the data yourself. Do not create a table.

BACKGROUND: ConsumerDirect's signup form raises a browser signal called `cd-signup-next-step` each
time the person moves a step. It carries: step, customerToken, customerName, customerEmail, PID,
company, memberPlan. It is the ONLY thing we get back — there is no notification to our server and
no return address.

ONCE UNBLOCKED, THE SHAPE IS:
1. Page code on public/optimize.html listens for the signal and posts it to our own endpoint.
2. One new handler. A candidate name, not a decision: api/public/optimize-signup-event.mjs
3. One new line in the routing table at netlify/functions/api.mjs. A handler that is not in that map
   answers 404 — this has shipped broken twice. src/http/routes.test.mjs enforces it.
4. A test at src/http/optimize-signup-event.pg.test.mjs (endpoint tests live under src/, never under
   api/ — the test runner's glob is src/** and scripts/** only).
5. Journey + changelog in the same commit.

HARD RULES:
- This endpoint takes personal data from a stranger with no login, exactly like the existing
  /api/public/optimize. Treat it the same way.
- Never log or store the customerToken until ConsumerDirect has told us what it is for. We do not
  know. Ask, do not assume.
- No outbound sending from this handler. New outbound sending is only ever allowed in
  src/messaging/providers/* and this is not that.
- No new page, screen, tab or menu row.

Report in CLAUDE.md §9 format.
```

### Workflow 3 — Compliance wording on the page

```
Repo: fundhub-platform. Start from branch `feat/smartcredit-widget` (NOT main — it is unmerged and
owns public/optimize.html). Read CLAUDE.md first, especially §7 (compliance flagging) and §10.

COMPLIANCE REVIEW REQUIRED. Flag it at the top of your summary.

Read the shared board first: docs/workflows/consumerdirect-widget-2026-08-28.md, section C. Mark
workflow 3 `claimed` before you start.

ConsumerDirect will review our page before they give us a live key. Section C of that board is their
checklist. Four items fail today. Fix these four and nothing else:

1. TRADEMARK SYMBOLS. Every use of SmartCredit must read SmartCredit®. If ScoreBuilder®,
   SmartCredit Report® or ScoreBoost™ ever appear, they carry their symbols too. The page has none
   today.

2. SMARTCREDIT'S OWN LEGAL LINKS. Their rule requires THEIR four documents, not ours. Exact
   addresses:
     Service Agreement  https://www.smartcredit.com/help/terms-and-privacy/service-agreement.htm
     Privacy Policy     https://www.smartcredit.com/help/terms-and-privacy/privacy-policy.htm
     Terms of Use       https://www.smartcredit.com/help/terms-and-privacy/site-use.htm
     Consumer Rights    https://www.smartcredit.com/help/terms-and-privacy/consumer-rights.htm
   The page links Fundhub's /privacy/ and /terms/ today and none of SmartCredit's. Keep Fundhub's —
   add SmartCredit's alongside. Do NOT add a second agreement tick box: their own card screen may
   already carry one and we have not confirmed it. Links only.

3. CANCELLATION IS SEPARATE. Add a plain sentence saying that cancelling one product does not cancel
   the other. Write it at a 5th grade reading level.

4. NOT A PACKAGE. The page currently numbers the SmartCredit signup as step "01" of a three-step
   Fundhub process ("01 Set up your account / 02 We read every line / 03 We go through it
   together"). Their rule says their service must be clearly separated from ours and not combined
   into a package. Reword so SmartCredit reads as a separate thing the person signs up for in their
   own name — which is already true and the page already says so further down ("Your report is set
   up in your own name, with your own login, and you keep it").

HOLD THIS LINE. /optimize is for another funder's DECLINED referrals, sent back to that funder. It
never says "funded with us". It says we will talk to your funder. Do not break that.

NEVER: draft any claim about a credit score going up, an item being removed, an approval, or a
timeline. Not one word. Our own rulebook at docs/compliance/creative-block-reasons.md bans all of
them under CROA and the FTC Act.

DO NOT: touch api/public/optimize.mjs (that is workflow 1), add a route, add a page, or change the
funnel look. The page uses the funnel/SLO identity from clickfunnels-fragments/04a-book-top.html and
public/js/homepage-survey.js. Keep it.

DONE MEANS: npm run lint clean; src/http/optimize-html.test.mjs updated and green; a Playwright
check on the changed page; docs/journeys/optimize-actual.md and docs/journeys/CHANGELOG.md updated
in the SAME commit; manifest on the shared board.

Report in CLAUDE.md §9 format.
```

### Workflow 4 — Practice-run proof with screenshots (BLOCKED — waits on workflow 1)

```
Repo: fundhub-platform. Read CLAUDE.md first, especially §8 (annotated screenshots) and §10.

DO NOT START until workflow 1 is marked `done` on the shared board
(docs/workflows/consumerdirect-widget-2026-08-28.md). You cannot test a form that is switched off.
If workflow 1 is not done, mark workflow 4 `blocked`, write why, and stop.

GOAL: prove the ConsumerDirect signup form works end to end against their PRACTICE (stage) system,
and produce the screenshots ConsumerDirect will want for their review.

Their practice test data, from their sandbox page:
  Social security number: 555-55-5555  (any other personal details will be accepted)
  Test card: 4111111111111111, CVV 123  (or 5454545454545454; use CVV 900 if 123 is rejected)

Walk all five steps: AccountStep, PersonalStep, IdentityStep, BillingStep, ConfirmationStep.
Also capture what happens on their three error outcomes if you can reach any of them:
SignupError, SignupErrorOutsideUS, SignupErrorBlackbox.

SCREENSHOT RULE (CLAUDE.md §8, owner-set): every screenshot shown to Chris MUST be marked up before
it counts. Red boxes on the exact thing being discussed, numbered when there is more than one, with
a caption line per mark in a legend on the image. An unmarked screenshot is an incomplete
deliverable. Tooling: docs/workflows/*-evidence/_mark-shots.mjs + _apply-marks.py.

ALSO RECORD, because these are open questions on the board:
- Does their card step already carry an agreement tick box and the four SmartCredit legal links? If
  it does, workflow 3 must NOT add a second one.
- What price and what plans does their billing step actually show? Our page says "membership from
  $19.99 · no free trial". If their screen disagrees, that is a compliance problem — report it, do
  not fix it.
- Does the `cd-signup-next-step` signal actually fire, and what is in it at each step? Do not record
  or paste any real personal data — this is practice data only, but treat it carefully anyway.

DO NOT: run against the live SmartCredit system. Do not use a real social security number or a real
card. Do not run npm run verify:e2e against the live database. Do not change any code — this
workflow only observes and photographs.

Evidence folders are gitignored (.gitignore excludes *-evidence/). Commit the write-up; hand Chris
the images directly.

Report in CLAUDE.md §9 format.
```

### Workflow 5 — Questions for ConsumerDirect

```
Repo: fundhub-platform. Read CLAUDE.md first, especially §2 (never invent — a missing answer IS the
finding) and §10 (write for a non-coder).

Read the shared board: docs/workflows/consumerdirect-widget-2026-08-28.md, section E. Mark workflow
5 `claimed` before you start.

TASK: DRAFT — do not send — a short, plain email to ConsumerDirect asking the sixteen things we
cannot answer from their documentation. Their address is partnerintegration@consumerdirect.com.
Chris sends it, not you. Save the draft to the shared board under a new heading.

THE MOST IMPORTANT ONE IS FIRST: their branding guidelines were sent as an attachment and never
reached us. Ask for it again, and ask for a link rather than an attachment.

Then the rest, in this order:
1. How do we submit our page for the compliance review? Who, what to send, how long does it take?
2. Does your signup form's card step already show your Service Agreement, Privacy Policy, Terms of
   Use and Consumer Rights, with an agreement tick box? Or must our page add them?
3. Do you need our website address registered against our key?
4. Is the practice key different from the live key, and what is the step between them?
5. What is the customerToken for, and what are we allowed to do with it?
6. Please send the unique Test Last Name and Test Credit Card for PID 29056.
7. Your form collects a mobile number in its own step. Whose consent covers texting that number —
   yours or ours?
8. Which of your four ready-made looks should a partner use, and are we allowed to restyle with the
   CSS variables instead?
9. Is the co-brand block required on our page, and what logo will it show for PID 29056?
10. What exact wording do you require in our footer to credit your trademarks?
11. Which company name did you approve on our co-brand form — "Fundhub" or "Fundhub Credit
    Solutions LLC"?

KEEP IT SHORT. Group them. No preamble.

DO NOT: send the email yourself. Do not write any code. Do not guess an answer and put it on the
board as fact — an unanswered question stays unanswered.

Report in CLAUDE.md §9 format.
```

---

## Sources

Three ConsumerDirect pages, read 2026-08-28:

- `https://developer.consumerdirect.io/docs/credit-as-a-service-signup-widget`
- `https://developer.consumerdirect.io/docs/sandbox-testing`
- `https://developer.consumerdirect.io/docs/support-compliance-review`

Repo files read:

- `api/public/optimize.mjs` (this branch and `feat/smartcredit-widget`)
- `public/optimize.html` (`feat/smartcredit-widget`)
- `public/js/homepage-survey.js`
- `netlify/functions/api.mjs`
- `netlify.toml`, `public/_headers`
- `docs/journeys/optimize-intended.md`, `docs/journeys/optimize-actual.md`
- `docs/workflows/optimize-credit-solutions-2026-08-28.md`
- `docs/compliance/creative-block-reasons.md`
- `src/http/optimize-public.test.mjs`, `src/http/optimize-html.test.mjs`

Git history read: `584a9dcd`, `d0c392a2` (PR #279), `2de977e6` (PR #278).
