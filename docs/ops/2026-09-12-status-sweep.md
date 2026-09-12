# Status sweep — fulfillment, portal, marketing

Measured 2026-09-12 against main at 99c1a7d. 50 agents: 10 traced one area each in
code, then 40 more tried to disprove every "this works" the first ten claimed.
24 of those claims did not survive. 16 findings block launch.

Read-only. Nothing here was changed.

COMPLIANCE REVIEW REQUIRED — several findings below concern payment rails, fee
timing and refund behaviour.

---

## The five that cost money today

### 1. A client can pay for an extra repair round and nothing happens. Then it is cancelled.

The button is live on the client's own progress page (`public/progress.html:1133`).
It posts to `/api/paid-services`, the client is sent to a real payment page, and the
client is charged. The handler that would turn that payment into work is never
registered (`src/register-all.mjs:28`).

Seven days later an hourly job cancels the unpaid-looking request
(`src/paid-services/expire.mjs:110-135`). The client paid. The record says unpaid.

Nothing anywhere moves a paid round from `staged` to `fulfilled`. Every UPDATE
against that table was searched across `src/`, `api/`, `db/`, `scripts/` and
`netlify/`: no code writes `fulfilled`. The status was designed and never filled in.

### 2. A staff-run credit pull produces zero documents, every time, silently.

Two separate causes, either one fatal:

* The workers that build documents are never switched on in the deployed function.
  `ensureRegistered` appears nowhere in `netlify/functions/api.mjs`. The credit-pull
  endpoint does not notice (`api/finance/crs-pull.mjs:29-33`, `src/events/bus.mjs:112`).
* The staff button pulls ONE bureau per tap (`api/finance/crs-pull.mjs:8`, `:113`),
  and the printer refuses to run without all three bureau scores
  (`src/underwrite/black-report-client.mjs:107-111`, `src/underwrite/letter-pack.mjs:226`).

The automatic path off the $32 diagnostic works — that one pulls all three.

### 3. Documents can be recorded as saved and not exist.

No setting anywhere in the repository chooses where documents are stored.
`DOCUMENT_STORE_PROVIDER` appears only in tests, a README, and the default itself —
never in `netlify.toml` or any config file. The default keeps files in the server's
own memory (`src/documents/store.mjs:414`, `:184-200`). On that setting the PDF bytes
vanish when the server restarts while the database row still says the file is there.
The same default holds for client uploads.

### 4. "Delivered" is claimed when nothing was stored. Three separate places.

* `src/workflows/c-06-crs-results-router.mjs:116-117`, `:134-137` — delivered is decided
  as soon as the PDFs exist in memory; saving happens afterwards inside a catch that
  swallows every error.
* `src/workflows/ds-02-diy-letters.mjs:91-92` — returns `delivered: true` whatever the
  save produced, under a comment reading "Never report delivered without storing".
* `src/metro2/diy/deliver.mjs:81-92` — sets the client to "Ready" and returns
  `delivered: true` without checking how many documents were stored.

A partial build is worse: if four documents fail and one survives, the system records
success and stamps the client so it never tries again.

### 5. Nobody is told the documents are ready.

On the automatic path no email or text goes out when the pack is built. The finished
copy exists and is seeded; the workflow that owns it sends nothing
(`src/workflows/u-02-analyzer-complete-delivery.mjs:63-67`).

There is no receipt to the client when a payment lands either. Every handler on
`payment.received`, `deposit.paid` and `sale.closed` was checked: they write rows and
place cards. None writes a message to the buyer.

---

## The portal

* **A client who owes $5,000 sees no amount and no Pay button.** The server works out
  exactly what is owed and finds the link to pay it (`api/read/portal-summary.mjs:421-479`).
  No page reads it (`public/app/client-portal.html`).
* **The Payments tab permanently reads "No payments yet."** Shown to the person who just
  paid (`public/app/client-portal.html:2243-2251`). There is no endpoint a client can
  call to list their own payments, so it can only ever be filled in for staff.
* **Paying gives nobody a way in.** No sign-in link is emailed when money lands
  (`src/workflows/s-portal-invite.mjs:1-13`). Portal access only rides along with the
  booking-confirmation email. The emailed link is the only door — clients cannot set a
  password at all.
* **The link a buyer is emailed dies in 15 minutes**, while the booking-confirmation link
  lasts a year. Reading email over lunch means a dead link.
* **The signature on the dispute-letter authorization is thrown away.** The screen demands
  ink and refuses an empty box, then sends a message to the server without it
  (`public/app/client-portal.html:2552`).
* **The $5,000 Capital Blueprint tile can never open.** The portal asks for one key, the
  purchase grants a different one. Five of six products unlock; this one cannot.
* **A phone photo is rejected.** The file picker invites a type the server always refuses.
* **"Turn on notifications" is dead.**
* **Six of the eight tracker steps can never light up**, and the tracker vanishes entirely
  once someone buys funding.

---

## Marketing

* **Ad attribution writes correctly and cannot be read.** The database half was proven
  against a scratch Postgres with all 277 migrations, as the unprivileged role production
  uses: 8/8 pass. The deployed read path returns a server error because of a missing
  bundle entry, and the screen swallows it. A competing last-touch copy is what a human
  actually sees.
* **Money per ad does not exist.** Nothing connects `client_ad_attribution` to revenue.
* **Ad spend is never pulled in.** The code that reads spend, impressions and clicks from
  Meta (`src/adplatforms/meta.mjs:131`) has no caller — no schedule, no button.
* **The Client Control Panel shows nothing about which ad brought the person.**
* **The ad-script checker never runs by itself.** No test step, no hook, no command runs
  it. The one instruction saying to run it before Chris sees a draft sits in a skill file
  Claude Code cannot load — it is the only skill in the repo without a `.claude/skills`
  entry.
* **The folder the checker grades is empty.** `docs/ads/scripts/` holds one README saying
  the 83 ad scripts and the VSLs are still in a chat window.
* **Nothing syncs on its own** for ClickFunnels or YouTube. Numbers move only when a human
  presses Sync now.

---

## Already cost real money

On 2026-09-06 a packaging mistake stopped every scheduled job on the site from 17:50,
and a real $3,000 receipt sat unprocessed. There is still no alert when the
minute-by-minute payment job stops running.

A function to go and ask the payment processor about a missed payment and feed it back
into the queue exists and looks complete (`reconcilePayment`) — with no caller.

---

## The eight questions only Chris can answer

1. Has a real payment ever been seen arriving with our own reference echoed back? The
   code says three times in its own comments that this round trip has never been checked
   against a live payload.
2. When staff tap one bureau, should the five documents build from that one bureau — or
   are they only ever meant to come from the three-bureau automatic pull?
3. When a client finishes all six repair rounds, who declares it finished — a person or
   the system? And do the chase messages stop then?
4. Should the buyer's sign-in link last a year like the booking one, or is 15 minutes
   deliberate?
5. Should the portal show what is owed and a Pay button, or is taking money strictly the
   advisor's job?
6. Should a client who presses "Refer a friend" get the Message Blaster and the partner
   question box, or should both be hidden from clients?
7. Do you want the eight-step tracker fixed, and should it survive someone buying funding?
8. Are ad scripts 7, 8 and 9 actually running? All three fail the checker, and the file's
   own header lists only 1–4 and the VSL as filmed.

---

## What is genuinely solid

The payment chain itself is unusually well built. Signature checked, stored durably
before anything else, drained by a once-a-minute job outside the workflow engine so the
money path does not depend on it, every handler wrapped so one failure cannot stop the
others. The sale, the attribution, the commission split and the entitlement all get
written without a human. Row-level security holds as the unprivileged role. The ad
attribution SQL is correct and proven.

The failures above are almost all the last mile: the work is done and the client is never
told, or the record says finished when it is not.
