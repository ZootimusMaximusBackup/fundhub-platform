# Outside services: what works, what doesn't

**14 services were checked. One investigator each.**

- **4 are live and proven to work:** Meta Ads, Twilio texts (out), Twilio replies (in), Resend email.
- **10 are not working.** Of those: 5 are built but have no password or no connected account, 4 are built but nothing in the app ever calls them, and 1 is a leftover from a cancelled vendor.

11 of the 14 were tested by actually running the code. 3 were only read, not run: **Oxylabs, Meta Pixel, and GoHighLevel.** Treat those three as less certain.

---

## Money stops here. Fix these first.

**1. Oxylabs — funding advisors cannot apply to banks. ONLY CHRIS CAN FIX THIS.**

> **CORRECTED 2026-09-06, after this report was written.** The report below said the working
> password was on Chris's laptop and this was a ten-minute deploy. **That is wrong.** The laptop
> credentials were run against Oxylabs directly, using the repo's own `verify()` in
> `src/adapters/oxylabs.mjs`, and they were refused: `oxylabs_connect_failed:407`,
> `isOxylabsAuthFailure = true`. So the live site's settings were never the problem. The pair that
> worked on 2026-08-26 does not work now.
>
> **What it actually takes:** somebody logs into the Oxylabs dashboard and finds out why the
> residential sub-user is refused — suspended, out of traffic, or a lapsed plan. Chris is the only
> person with that login (`docs/STILL-MISSING.md:19`). No code change and no deploy touches this.
>
> **Already done:** the laptop pair was written to Netlify production as secrets on 2026-09-06, so
> when the account is revived the live site already carries the right sub-user name. If reviving it
> changes the password, that one value still needs setting.
>
> **Do not chase the env-var theory again.** It has now been tested and ruled out.

What a person sees: an advisor clicks Apply for a client and gets "Oxylabs rejected the proxy login."
The bank page never opens, so the application never gets submitted. Confirmed from a real click on
2026-09-06 and again by direct probe the same day.

Two things stay true from the original finding. The error message on screen tells you to fix a
`customer-` prefix that is already correct and will waste someone's day. And even a good login does
not route the advisor's browser unless the Chrome add-on is hand-installed on their machine; nobody
could tell from the code whether it is installed anywhere.

**2. Mailgun bank inbox — replies from banks never arrive.**
What a person sees: a bank writes back about a client's funding application and nothing happens. The client's funding card never moves, because nobody sees the answer.
What it takes: the code works — the investigator ran it and it correctly read "approved" and "denied" out of test emails. The blocker is a bill. The repo's own to-do list, written 2026-08-31, says the Mailgun account is paused on an unpaid balance. Pay it, point the mail route at the site, then forward one real bank email to prove it. Half a day, and most of that is proving it. **Nobody has ever proved one real bank email arrived.**

**3. Twilio replies (in) — works today, but can die silently.**
What a person sees right now: nothing broken. A real text with a photo came in on 2026-08-24 and became a document on the client's file. But if the password on the live site is missing or wrong, every single client reply is refused and thrown away with no warning anywhere.
What it takes: someone with the Twilio login checks that every company phone number points at our address, and someone with the Netlify login confirms two settings. Hours, no coding. Only one phone number is on record as pointed at us. A second number with a blank setting would drop every reply and nothing in the code would show it.

**4. Resend email — works today, with two holes.**
What a person sees right now: emails send. A real sign-in email was delivered to a real inbox on 2026-08-20. Hole one: when a client hits Reply, the reply goes to an address nobody reads. Hole two, see below.
What it takes: one setting for the reply address (15 minutes, but first decide which mailbox should actually receive replies — that is a DNS decision, not code).

**5. A brand-new company cannot text or email anyone. Four separate investigators found this on their own.**
What a person sees: you add a white-label partner or a new company. Their texts and emails queue up forever and never go out. No error, no warning.
Why: a one-time database step in the past filled in a "which service sends for this company" row for the companies that existed that day. Nothing in the running app has ever created that row for a company added since.
What it takes: about 2 hours — one database fix plus a default for new companies. **Nobody could open the live database, so we do not know whether any real company is affected yet.**

---

## Everything else

**Live (4)**
- **Meta Ads** — the Campaigns screen really does pull spend and pause/resume ads. One ad account is connected. Warning: this path has no safety switch, so a staff member clicking Budget changes real Facebook spend instantly. Spend numbers only refresh when a human presses Sync. Taking over a *client's* ad account is blocked by Facebook, not by us.
- **Twilio texts (out)** — done and sending. It is now the only way a text can leave the system; the old backup is a dead stub. Carrier registration for business texting is a fact about the Twilio account that nobody could see from the code — if it is not approved, texts are quietly dropped by the phone companies while our records still say "sent."
- **Twilio replies (in)** — covered above.
- **Resend email** — covered above.

**Built, but the account or password is missing (5)**
- **Facebook posting** — code is finished; nobody has ever pressed Connect Facebook and finished the popup, so no page is linked. Facebook may also need to approve the app first, which is days to weeks and out of our hands. Instagram posting was never actually written — it is an empty shell that always refuses.
- **LinkedIn company posts** — the login was never finished. Worse, the code asks LinkedIn for permission to post as a *person*, but then posts as the *company*. So even after finishing the login, the first post would be rejected. About 2 hours of code, then waiting on LinkedIn to approve a product.
- **LinkedIn job posting** — dead end, and Chris already decided this on 2026-09-05. LinkedIn stopped letting new companies use it. No amount of work opens that door. The button exists on the ops screen and shows the words "not_configured," which reads like a bug and is not one.
- **Twilio WhatsApp** — this is not a customer thing. It is one daily message to Darwin the tech helper. One setting is missing. Even with it, the sending number has not been approved for WhatsApp, so it would probably fail quietly.
- **Oxylabs** — covered above.

**Built, but nothing in the app calls it (4)**
- **Zoho Recruit** (the plan for getting jobs onto LinkedIn) — 1,100 lines of finished, tested code with no way to connect an account, no schedule, no button, and no screen. Blocked at the very start: the phone number Zoho verifies against is disconnected, so there is no Zoho account yet. Also, the one live "post a job" button in the system points at the dead LinkedIn code instead.
- **Meta Pixel** (telling Facebook who booked) — the two tracking lines in the repo fire on small clicks *after* a booking, not on the booking itself. Nothing in this repo loads the pixel or deploys that page; it lives in ClickFunnels. **Read, not run.** The last saved copy of the live page had no tracking at all.
- **TikTok Ads** — the adapter works, but the only route that reaches ad tools refuses anything that is not Facebook, and there is no way to connect a TikTok account at all. Note: TikTok bans credit repair ads outright, and the code blocks it in three places on purpose.
- **Mailgun** — covered above. Important correction to earlier notes: Mailgun is *not* dead weight. Sending was moved to Resend on purpose, but receiving bank replies is still Mailgun's job and nothing else does it.

**Leftover junk (1)**
- **GoHighLevel** — cancelled 2026-08-14. Texting no longer touches it. But every new client signup still tries to copy their name, email and phone into the cancelled account, which fails and leaves a "link missing" mark on their record. 2-3 hours of deleting. **Read, not run.**

---

## What I could not confirm

- **The live site's settings.** 12 of the 14 investigators said the Netlify service is blocked by a network rule, so they could not read what is set on the live site. Everything about passwords in this report is from Chris's laptop, not from live.
- **One investigator disagrees.** The WhatsApp investigator says they *did* list the live site's settings and found 82 of them. The Oxylabs investigator says the *laptop's* file holds 82 settings. The matching number makes me think the WhatsApp investigator read the laptop and thought it was live. I would not treat that as production proof. Someone should run one command and write the answer down.
- **The master send switch.** There is one setting that blocks every text and email until it is explicitly turned off. Two documents in the repo disagree about which way it is set on the live site — one from 2026-08-12 says blocked, another says open. Real emails and texts have gone out since, which suggests open, but nobody read the live value.
- **The live database.** No investigator could open it. So: whether a Facebook page is actually connected, whether any company is missing its send rows, and whether a real bank email has ever landed are all unknown.
- **Two investigators disagree on held posts.** Any social post about credit repair is held for a human on purpose. One investigator says an owner *can* release it from the Posts screen. Another says nothing in the product ever fills in the approval. Both read real code. Worth ten minutes to settle before anyone schedules those posts.
- **Two investigators disagree on Meta Ads.** The Pixel investigator quoted a note in the code saying the ads connection has never been used for real. The Meta Ads investigator found a saved record of a real, successful call to Facebook on 2026-08-24 returning a real campaign name. The saved record is stronger. The note in the code is out of date.
- **Stale documents keep causing wrong answers.** `docs/STILL-MISSING.md` and two workflow boards say Oxylabs and Facebook passwords are unset. They are set. That file is over a month old and has already misled at least two people.
- **Not looked at.** These were named inside the evidence but nobody was assigned to check them: ClickFunnels (where bookings actually come from), the credit-pull provider, Lendflow, the Twilio *voice* line (one note says it was pointed at a Twilio holding page, not at us), the background job runner, and the file storage. I do not know what else was left off the list of 14.