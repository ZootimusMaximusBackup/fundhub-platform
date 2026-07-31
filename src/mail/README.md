# `src/mail/` — the direct-mail (Deluxe) pipeline

## Read this before you wire anything

**Nothing in this system mails anything. That is deliberate, and it is not an
oversight you have been asked to fix.**

If you are here because a ticket says "turn on the mail drop", "schedule the
batch", or "send the campaign" — stop and read the gate below first. The absence
of a send path is the feature. Somebody removed the temptation on purpose.

---

## The gate

The mail program targets **prescreen data**. Under the **FCRA**, using a
prescreened list to solicit consumers obliges the sender to extend a **firm
offer of credit** to everyone who responds and qualifies. That is a legal
commitment made by dropping the mail, not by anything a person clicks
afterwards. Getting it wrong is not a bug report, it is a regulatory exposure
with per-violation damages.

**No drop happens until all three of these are true. None of them are true
today:**

1. **The FCRA research report is in.** What the firm-offer obligation actually
   requires of this offer, in writing.
2. **Deluxe compliance has reviewed the piece and the offer structure.** Both.
   A compliant mail piece carrying a non-compliant offer is still
   non-compliant.
3. **A lawyer has signed off on the broker/lender-of-record structure.** Who is
   making the firm offer — us, or a lender we broker to — determines who carries
   the obligation. It is not settled.

**THE BUILD IS NOT GATED. THE DROP IS.** Building ingestion, suppression, slug
resolution and response handling is expected and encouraged — that work has to
exist and be tested before anyone can responsibly say yes. What may not exist is
a path that puts mail in the post.

---

## What that means concretely for code in this directory

There is **no activation path wired**, in the same way `mail_universe` shipped
in `001_init.sql` as a table with no writer:

- **No scheduler and no cron.** Nothing polls for campaigns due to drop.
- **No send function.** Not a stubbed one, not a disabled one, not one that
  throws.
- **No outbound call.** Consistent with the rest of the repo: nothing in
  `src/adapters/` or `src/lib/` transmits, and `sendTemplated` only writes
  `messages` rows with `status='queued'`.
- **No feature flag, env var, or `enabled` / `is_live` / `active` column** that
  could be flipped to start a drop. There is nothing to flip. This is why
  `mail_campaigns.status` has no present-tense sending state — see below.

> If you find yourself writing something that could mail, **stop and write a
> comment instead.** Then raise it, with the three gate conditions above, to
> whoever owns the decision. A capability that only needs a config change to
> start mailing is the thing this design exists to prevent.

Note that even after the gate lifts, **this system still never transmits.**
Deluxe physically prints and mails. The most this schema will ever do is
*record* that a drop happened somewhere else. `status = 'dropped'` is past
tense, written after the fact, by a human.

---

## The tables

`mail_universe` predates this work — `db/schema/001_init.sql:349`, headed
"Deluxe records (Section 13). Scaffold now, activate after gate." Per-record
data lives in its `fields jsonb`; there is no per-record column set.

`db/migrations/065_mail_campaigns.sql` adds three tables. Its header comment is
the long-form reasoning; this is the map.

| Table | What it is |
| --- | --- |
| `mail_campaigns` | One row per drop, so `campaign_id` stops being a free-text string. |
| `mail_responses` | Append-only log: one row per response event against a `mail_universe` record. |
| `mail_tracked_numbers` | Inbound-only Twilio numbers keyed to a campaign batch. |

### The linkage is a soft join, not a foreign key

```sql
mail_universe.campaign_id = mail_campaigns.campaign_key
```

`mail_universe.campaign_id` is `text`, is not a foreign key to anything, and
**may already hold data**. Retyping it to `uuid` would abort the moment one row
holds a non-uuid label, and even a text FK would validate existing rows and
fail. So `mail_campaigns.campaign_key` is a `UNIQUE text` column holding exactly
the string that appears in `campaign_id`, and the join is by string equality.

**It is a soft link and it is honest about being one.** Tightening it to a real
FK is a later migration that must first backfill one campaign row per distinct
`campaign_id`, then repoint — and it needs to see production data before anyone
writes it. Do not tighten it blind.

### The log versus the latest state

`mail_universe.responded_at` and `mail_universe.outcome_tier` are the
**denormalised latest state** — one value, overwritten. `mail_responses` is the
**log** — never overwritten. A record can respond twice (calls the tracked
number Tuesday, hits the PURL Friday); the log keeps both, the denormalised pair
keeps the most recent.

Keeping them in step is the **response handler's** job. There is deliberately no
database trigger doing it, so it stays testable and does not fire invisibly
during a bulk load.

### `outcome_tier` here is unconstrained, deliberately

There is an `outcome_tier` vocabulary in this schema already —
`clients.outcome_tier` is
`FRAUD_HOLD|MANUAL_REVIEW|REPAIR_ONLY|FUNDING_PLUS_REPAIR|FULL_FUNDING|PREMIUM_STACK`
— but that is the **CRS decision tier for a client who has already been through
a soft pull.** A mail respondent has not been through anything yet.

Nothing in the schema or the code says the two vocabularies are the same, so
migration 065 does not assert that they are and adds **no CHECK**. If you are
about to write mail tier values, **get the real vocabulary from whoever owns the
offer** rather than borrowing this one because it is nearby.

### `mail_campaigns.status`

```
draft → universe_loaded → compliance_hold → approved → dropped
                                          ↘ cancelled
```

`compliance_hold` is where every real campaign parks until all three gate
conditions clear. **No code path in this repo leaves it.** `approved` is set by
a human, by hand, after sign-off.

There is deliberately **no `sending`, `live`, `active` or `scheduled` value.** A
status vocabulary containing a present-tense sending state invites code that
tries to advance a row into it. If you need one, that is the gate conversation,
not a migration.

### No derived counts

`mail_campaigns.records_ordered` is the **vendor-stated quantity on the order** —
an external fact that exists nowhere else. There is no stored count of loaded,
suppressed or responded records, because all three are `count(*)` over
`mail_universe` and a stored copy is wrong from the first suppression onward.

`idx_mail_universe_campaign_suppressed` on `(campaign_id, suppressed)` is what
makes computing them cheap — verified using the index at 80k rows. Use it:

```sql
SELECT count(*) FROM mail_universe
 WHERE campaign_id = $1 AND suppressed = false;
```

---

## Who owns what

This directory is being built by several threads. Migration `065` and this
README establish the schema and the gate; **ingestion, suppression, slug
resolution and response handling are owned by other threads.** If you are one of
them, the tables are ready and the rules above are the contract.

Thread C holds migrations `065`–`069`.
