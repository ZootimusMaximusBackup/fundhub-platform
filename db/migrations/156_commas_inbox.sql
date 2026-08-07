-- 156_commas_inbox.sql — durable inbox for inbound Commas payment webhooks.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS TABLE EXISTS.
--
-- Commas delivers AT MOST ONCE. There are no retries, ever: a delivery that
-- fails is logged on their side and dropped. That single property is what
-- makes the old design unsafe. The adapter used to verify, normalise, emit
-- canonical events and run the whole money chain BEFORE answering the request,
-- so any failure between "bytes arrived" and "money recorded" lost the payment
-- permanently — the deposit never registered, no row anywhere said so, and no
-- retry was coming.
--
-- So the webhook now does the smallest durable thing it can: verify the
-- signature, write the exact bytes here, answer 200. Interpreting the payload,
-- emitting canonical events and running the money chain all happen afterwards,
-- driven by netlify/functions/commas-inbox-sweeper.mjs. Every one of those
-- later steps is retryable, because the bytes are already safe.
--
-- The reconciliation poll lands rows here too (source = 'reconcile'), so a
-- payment we never received a webhook for takes exactly the same path as one
-- we did. One processing path, one set of bugs.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY NOT webhook_captures (145).
--
-- That table is a forensic tap — write-only, read by a human comparing adapter
-- output against a real payload. It has no status, no attempt count and no
-- dedupe key, so nothing can drive work from it. Widening it would give one
-- table two jobs: the audit copy would start being mutated by the queue.
-- Captures stay a tap. This is the queue.

CREATE TABLE IF NOT EXISTS commas_inbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),

  /* dedupe_key — what makes a re-delivery a no-op.
     Built by the adapter as "<payment_id>:<event_type>", falling back to
     "body:<sha256 of the exact bytes>:<event_type>" when the payload carries
     no payment id. Keyed on the PAYMENT and not on the envelope id, because
     the envelope id is per-DELIVERY: two deliveries of one payment carry two
     envelope ids and would both be treated as new money. */
  dedupe_key   text NOT NULL,

  /* The idempotency anchor Commas documents: data.payment_id. Nullable because
     a malformed or unexpected payload must still be stored rather than
     rejected — an unparseable body we kept is a bug report; one we refused is
     a lost payment. */
  payment_id   text,
  event_type   text,

  raw_body     text NOT NULL,
  headers      jsonb NOT NULL DEFAULT '{}'::jsonb,

  /* 'webhook' — arrived by push. 'reconcile' — recovered by polling
     GET /payments/:id after we noticed we never got the push. */
  source       text NOT NULL DEFAULT 'webhook',

  status       text NOT NULL DEFAULT 'pending',
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,

  received_at  timestamptz NOT NULL DEFAULT now(),

  /* When the sweeper took the row. A serverless function can be killed
     mid-pass, which leaves a row stranded in 'processing' with nothing coming
     back for it. Without this column that row is invisible to the next pass
     and the payment is lost exactly the way the table was built to prevent.
     The sweeper reclaims anything held longer than STALE_CLAIM_MINUTES. */
  claimed_at   timestamptz,
  processed_at timestamptz,

  CONSTRAINT commas_inbox_source_chk
    CHECK (source IN ('webhook', 'reconcile')),

  /* 'ignored' is a terminal SUCCESS, not a failure: a well-formed event of a
     type we deliberately do not act on. Distinguished from 'done' so the
     sweeper's counts stay honest about what actually moved money. */
  CONSTRAINT commas_inbox_status_chk
    CHECK (status IN ('pending', 'processing', 'done', 'failed', 'ignored'))
);

/* The idempotency guarantee. A re-delivered webhook collides here and the
   INSERT does nothing — before any interpretation of the payload has happened,
   and without needing the events table to catch it later. */
CREATE UNIQUE INDEX IF NOT EXISTS commas_inbox_dedupe_uniq
  ON commas_inbox (org_id, dedupe_key);

/* The sweeper's claim query. Partial, because the interesting rows are a tiny
   fraction of the table forever after. 'failed' is included: a failed row is
   retried, since the failure is usually ours (a handler threw) and the payment
   is real either way. 'processing' is included so a row stranded by a killed
   function can be reclaimed rather than stranded forever. */
CREATE INDEX IF NOT EXISTS commas_inbox_work_idx
  ON commas_inbox (received_at)
  WHERE status IN ('pending', 'failed', 'processing');

/* The reconciliation lookup: "have we already seen this payment id?" */
CREATE INDEX IF NOT EXISTS commas_inbox_payment_idx
  ON commas_inbox (org_id, payment_id)
  WHERE payment_id IS NOT NULL;

COMMENT ON TABLE commas_inbox IS
  'Durable landing table for Commas webhooks. Written before the 200 is sent; '
  'drained by netlify/functions/commas-inbox-sweeper.mjs. Exists because Commas '
  'delivers at most once and never retries.';
