# Hiring: Zoho is the LinkedIn pipeline. Owner-set 2026-09-05.

## The decision

**Zoho Recruit is the applicant tracking system.** It owns the LinkedIn bridge. FundHub owns
everything after the applicant arrives.

Owner, 2026-09-05: *"Zoho is fine. LinkedIn API is only for large recruiting pipelines, which
we aren't. We leverage someone else's pipeline."*

That is the correct read and it closes a question three sessions have now chased.

## Why this is settled and must not be re-litigated

LinkedIn's Job Posting API is closed to new partners, and every remaining Talent product is
built for software vendors posting on behalf of *their customers*. FundHub hires about five
people a year for itself. It was never going to qualify, and no amount of code changes that.

Zoho Recruit is an approved LinkedIn source, so it can do the one thing our own code cannot:
post to LinkedIn automatically. We rent that access instead of applying for it.

## What this means for the build

```
  Zoho Recruit  ──posts──►  LinkedIn
       │
       │ applicants land here first
       ▼
   FundHub  ──► screening, outreach, booking, the owner's calendar
```

* **Zoho is the front door.** Job postings and first-touch applicant capture live there.
* **FundHub is everything after.** Our pipeline, our routing rule (294), our outreach, our
  booking. None of it depends on LinkedIn.
* **We pull, Zoho does not push into our tables directly.** A connector reads Zoho's API (or
  receives its webhooks) and calls the existing `apply()` in `src/hiring/pipeline.mjs`, so a
  Zoho applicant is graded by the same rubric and held to the same human gate as any other.
  A second, unaudited front door is exactly what 051 was written to prevent.

## What is now dead

`src/hiring/linkedin.mjs` — `postJob`, `closeJob`, `ingestApplications`. Correct code for a
product we will never be granted. **Do not delete it and do not try to make it work.** It stays
as the record of a route that was closed, so nobody spends another week rediscovering that.

`hiring_channel_connections` keeps its `'linkedin'` channel value. Zoho does not need a row
there — it authenticates as itself, to LinkedIn, on LinkedIn's side.

## Open

Which Zoho Recruit plan, and whether its free tier exposes the API endpoints the connector
needs. That is a question for the connector lane, not for the owner.

## Related

* [`linkedin-job-posting-access-2026-09-05.md`](linkedin-job-posting-access-2026-09-05.md) —
  the full evidence trail for why every LinkedIn route is shut.
* `db/migrations/294_hiring_role_brief_and_owner.sql` — the routing rule this feeds.
