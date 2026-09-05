# LinkedIn hiring automation — what we can actually get

**Date:** 2026-09-05
**For:** Chris
**Status:** Settled by first-party evidence. Chris's own developer console was checked.

---

## The short version

**Automated, free, continuous job posting to LinkedIn IS available to us today** — through
LinkedIn's **Basic Job Posting**, switched on from our own Company Page. The catch is that the
poster has to be one of LinkedIn's approved recruiting tools. **Our own code can never be the
poster, no matter what we build.**

Two earlier versions of this file were wrong. The first said to skip LinkedIn automation
entirely; the second said the only automated route was paid ads. Both missed Basic Job Posting.
The corrected picture is below.

---

## Proof the Talent door is shut

Our LinkedIn app **"Fundhub Scheduler"** (created 2025-11-19, standalone app) shows, on its
Products tab:

**Added:** Share on LinkedIn (Default Tier) · Sign In with LinkedIn using OpenID Connect
(Standard Tier)

**Available to request:** Advertising API · Lead Sync API · Matched Audiences API ·
Events Management API · Conversions API · LinkedIn Ad Library

**Greyed out, cannot even request:** Live Events · Community Management API ·
Member Data Portability API · Pages Data Portability API

**No Talent product appears anywhere on that page** — not Job Posting, not Apply Connect, not
Apply with LinkedIn, not Recruiter System Connect. Not added, not available, not greyed out.
They are invisible to a non-partner account.

This matches LinkedIn's public docs:

- **Job Posting API** — "We are currently not accepting new partnerships for LinkedIn's Job
  Posting API." (page updated 2026-06-03)
- **Apply with LinkedIn** — "we are currently not accepting any new partners for Apply with
  LinkedIn (AWLI)."
- **Apply Connect** — no closure banner, genuinely open, and basic jobs through it are free
  (no Job Slots needed). But it is defined as "an integration between applicant tracking
  system (ATS) and LinkedIn" where the partner posts "on behalf of your customers," it
  requires a LinkedIn Recruiter Corporate or Professional Services licence, and it does not
  appear in our console.

**Consequence for our code:** `src/hiring/linkedin.mjs` cannot run. `postJob` hits
`/rest/simpleJobPostings` (Job Posting API) and `ingestApplications` hits `/rest/jobApplications`
(Apply Connect). Those are two different gated products, and we hold neither.

---

## The route that works: Basic Job Posting (free)

On our own LinkedIn Company Page: **Settings → Job Postings → switch on "Enable basic job
posting" → "+ Connect ATS" → pick the provider.** LinkedIn then posts our open roles by itself,
within 24–48 hours, and keeps them current. One-time setup, no LinkedIn contract, no partner
application, no Job Slots purchase.

**THE CONSTRAINT THAT DECIDES OUR ARCHITECTURE.** LinkedIn's FAQ: *"Basic Job Posting is
available to our approved ATS partners."* In-house systems and custom XML feeds are not
accepted. FundHub is not on that list and will not be — the route in is
`LL-BD@linkedin.com`, and it is the same partner gate that is shut everywhere else.

So the poster is a third-party recruiting tool. LinkedIn publishes 150+ approved ones, many
with free or cheap tiers (BreezyHR, JazzHR, Recruitee, Manatal, BambooHR, CareerPlug, Ashby,
Workable, Zoho, Greenhouse, Lever). We pick one that has an API or webhooks, let it own the
LinkedIn bridge, and pull applicants from it into FundHub. **FundHub keeps everything
downstream** — screening, outreach, booking, the calendar.

What free costs us is reach, not access: basic jobs appear on the company page's Jobs tab and
in job search, but LinkedIn does not push them at candidates the way a paid post does.

Two exclusions, and we pass both: search and staffing agencies are barred (we are a direct
employer), and companies with existing Job Slot contracts must use Job Wrapping instead (we
have none).

<https://www.linkedin.com/help/recruiter/answer/a1343559>

## The paid alternative: recruiting ads + Lead Sync

| Step | Product | Status in our console |
|---|---|---|
| Create the recruiting ad and its Lead Gen Form | **Advertising API** | Request access (Development Tier) |
| Pull form submissions into FundHub automatically | **Lead Sync API** | Request access (Standard Tier) |
| Track applications completed | Conversions API | Request access |

Requirements published by LinkedIn: an **active LinkedIn Ads account**, **Super Admin** on it,
and scopes `r_marketing_leadgen_automation` and `rw_ads`.

A candidate sees a job ad in feed, taps, fills a form pre-filled from their LinkedIn profile,
and the submission lands in our database with no human touching it. This is a genuine
automated inbound applicant pipeline. **It costs ad spend, not a partnership.**

Docs: <https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/getting-access-leadsync>

## What we already hold

- **Share on LinkedIn** — posts to the **authenticated member's own feed** (`w_member_social`).
  So we can auto-post "we're hiring, apply here" from Chris's personal profile today. It does
  NOT post as the company page: that needs `w_organization_social` via the **Community
  Management API**, which is greyed out in our console.
- **Sign In with LinkedIn (OpenID Connect)** — name, email, verified identity. Enough to power
  an "apply with LinkedIn" button on our own careers page that pre-fills a form. It does not
  return work history — that was AWLI's job, and AWLI is closed.

## The free manual fallback

A free job post on LinkedIn, tied to our Company Page:

- **one active free post at a time**, and a limited number per 30 days
- live **14 days**, then paused; auto-closes at 30 days if not promoted
- **10–30 applications** depending on role, then it pauses and drops out of search
- staffing and recruitment agencies are excluded; a direct employer like FundHub is not

Enough to hire a couple of closers by hand. Not enough to run a pipeline.

<https://www.linkedin.com/help/linkedin/answer/a517777>

---

## Recommendation

1. **Pick an approved recruiting tool with an API**, connect it on the Company Page, and let it
   own the LinkedIn bridge. Free tier where possible. This is the only route to automated
   LinkedIn posting that exists for us.
2. **Build the careers page and the application form.** Every route lands here, and it is ours.
3. **Build the downstream chain** (outreach, booking, calendar). LinkedIn blocks none of it,
   and it is the part that actually saves the owner time.
4. **Stop building against `src/hiring/linkedin.mjs`.** `postJob` calls the closed Job Posting
   API and `ingestApplications` calls Apply Connect — two separate partner products, neither of
   which appears in our developer console. The code is correct and can never run. Do not delete
   it, do not try to make it work, and do not count it as a step that is nearly finished.

## Owner decision needed

Which approved recruiting tool to connect. That choice decides where applicants first land and
which API we pull them from, so it is worth ten minutes before anyone writes the connector.

## Sources

- <https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview>
- <https://learn.microsoft.com/en-us/linkedin/talent/apply-with-linkedin/apply-with-linkedin>
- <https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/apply-connect-overview>
- <https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/getting-access-leadsync>
- <https://www.linkedin.com/help/linkedin/answer/a517777>
