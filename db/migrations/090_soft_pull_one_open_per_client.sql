-- 090_soft_pull_one_open_per_client.sql — make "one tap is one pull" true when
-- the taps arrive at the same instant.
--
-- *** THIS FILE STILL PULLS NOBODY'S CREDIT. *** It adds one index and closes
-- rows that a race already created. There is no provider client, no scheduler
-- and no activation flag here, exactly as in 077.
--
--
-- WHAT WAS BROKEN.
--
-- src/finance/soft-pulls.mjs enforced rule 2 ("one tap is one pull") with a
-- SELECT followed by an INSERT. That is two statements with a gap between them,
-- and two callers can both finish the SELECT before either reaches the INSERT.
-- Both then see nothing open and both write. Reproduced against a real
-- Postgres: three simultaneous requests for one client produced three rows and
-- 4500 cents of cost for one question. The route is live
-- (netlify/functions/api.mjs → api/finance/soft-pull.mjs), so the caller is a
-- button on a phone, which is exactly the thing that gets tapped twice and
-- retried by the network.
--
-- A guard that only holds when the calls happen to be spaced out is not a
-- guard. Pulling a consumer's credit twice is a real harm and a real cost, and
-- the only place a simultaneous double-write can be adjudicated is the database.
--
--
-- WHY THIS IS THE INDEX 077 SAID NOT TO CREATE.
--
-- 077 ends with a deliberate note against exactly this index, on the grounds
-- that nothing moves a row out of 'queued', so a client's first request would
-- block every later one at the database level with no way to clear it.
--
-- That reasoning applied to a raise. This index does not produce one: the
-- INSERT in requestSoftPull() now carries ON CONFLICT DO NOTHING, and a caller
-- that loses the race re-reads and is handed the open request with
-- created:false — the SAME answer rule 2 already gave a second tap, and the
-- same answer the surviving in-module guard gives a tap that arrives a second
-- later. Nothing new blocks. What changes is that the answer is now also true
-- when the two taps are simultaneous.
--
-- The "no way to clear it" half was already untrue when 077 shipped:
-- closeSoftPull() moves a row to 'failed' or 'cancelled' and fulfilSoftPull()
-- moves it to 'fulfilled'. src/finance/soft-pulls.pg.test.mjs pins both, and
-- pins that a client whose request is resolved can start a new pull.
--
--
-- THE BACKFILL CLOSES DUPLICATES, IT DOES NOT DELETE THEM.
--
-- The index cannot be created while any client already has two open requests,
-- and the defect above has been live, so some may exist. Nothing is deleted: a
-- request that was recorded happened, and the row that says who asked and why
-- is the audit trail. The EARLIEST open request per client stays open; the
-- later duplicates are moved to 'cancelled' with a stated reason, which is what
-- 'cancelled' is for and what closeSoftPull() would have written. Attribution
-- is untouched, so the immutability trigger from 077 permits it.

UPDATE soft_pull_requests dup
   SET status       = 'cancelled',
       state_reason = 'closed by migration 090: duplicate open request for this client, created by the non-atomic double-tap guard in requestSoftPull()',
       resolved_at  = now(),
       updated_at   = now()
 WHERE dup.status = 'queued'
   AND EXISTS (
     SELECT 1 FROM soft_pull_requests keep
      WHERE keep.client_id = dup.client_id
        AND keep.status = 'queued'
        AND (keep.requested_at, keep.id) < (dup.requested_at, dup.id)
   );

-- One open request per client, adjudicated by Postgres rather than by a gap
-- between two statements. Partial, so resolved history is unaffected: a client
-- may have any number of fulfilled, failed or cancelled requests.
CREATE UNIQUE INDEX IF NOT EXISTS uq_soft_pull_requests_one_open
  ON soft_pull_requests (client_id) WHERE status = 'queued';

COMMENT ON INDEX uq_soft_pull_requests_one_open IS
  'One outstanding soft pull per client. The double-tap guard in src/finance/soft-pulls.mjs reads then writes, which two simultaneous callers can both pass; this index is what actually stops the second consumer-credit event and the second charge. Losing callers are handed the open request via ON CONFLICT DO NOTHING, never an error.';
