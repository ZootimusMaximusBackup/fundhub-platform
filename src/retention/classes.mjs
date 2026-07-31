// The five data classes a retention policy governs, and what happens to each
// when its period runs out.
//
// The argument for every de-identify-vs-delete decision is in the header of
// db/migrations/100_retention_policy.sql. This file is the implementation of
// those decisions and restates each one in a sentence so a reader here does not
// have to go and find the migration.
//
// ============================================================================
// TWO RULES THIS WHOLE FILE IS BUILT AROUND
// ============================================================================
//
// 1. *** COUNTING NEVER WRITES. *** Every class has a `count` that issues a
//    SELECT and nothing else, and a `purge` that is the only thing that can
//    write. scripts/retention-purge.mjs calls `purge` ONLY under an explicit
//    --apply. A dry run is not "a purge with the writes turned off"; it is a
//    different function that has no write in it. That is why
//    scripts/retention-purge.test.mjs can prove a dry run changes nothing by
//    watching what SQL is issued, rather than by trusting a flag.
//
// 2. *** EVERY QUERY IS ORG-SCOPED, AND THE ORG IS NOT OPTIONAL. *** Every SQL
//    string below carries `org_id = $1`, and ctxOrThrow() refuses a missing or
//    blank org before any of them run. There is no "all orgs" mode and no way to
//    ask for one. A purge that crosses a tenancy boundary is the worst available
//    outcome for this tool, so the boundary is checked in the one place every
//    class goes through.
//
// ============================================================================
// THE RETENTION CLOCK: WHICH COLUMN COUNTS AS "OLD"
// ============================================================================
//
// Four of the five classes measure age from `created_at` — how long WE have held
// the record, which is the question a retention policy actually asks.
//
// soft_pull_ledger is the exception and uses `requested_at`. Both columns exist
// on that table, and requested_at is in trg_soft_pull_requests_immutable's guarded
// list while created_at is not. Measuring from the immutable column means the
// retention clock cannot be reset by rewriting a row.

import { DATA_CLASSES } from "./policy.mjs";

/* ---------------------------------------------------------------------------
   MOCK-DATA MARKERS

   *** THERE IS NO is_demo COLUMN ANYWHERE IN THIS SCHEMA. *** Mock rows cannot
   be identified structurally, so they are identified by the markers the script
   that writes them actually leaves behind. These are read off
   scripts/demo-journey.mjs, not guessed:

     scripts/demo-journey.mjs:43   emit(..., { idempotencyKey: `demo:${i}:${name}` })
     scripts/demo-journey.mjs:11   const EMAIL = "demo.journey@fundhub.ai"

   They live here rather than in a column for the reason 085 gave about
   normaliseMerchant(): a matcher belongs "in code where it can be tested, not
   baked into a column here where changing it would need a migration and a
   backfill".

   *** DELIBERATELY NARROW. *** These patterns match EVENT ROWS ONLY. They do not
   match anything by email, by name, or by "looks like a test". A pattern like
   '%@example.com' would sweep real rows the moment a client used that address,
   and the cost of a wrong match here is deleted production data. If a marker
   cannot be proven to identify mock data, it does not belong in this list.
--------------------------------------------------------------------------- */
export const MOCK_EVENT_KEY_PATTERNS = Object.freeze(["demo:%"]);

/* The demo client scripts/demo-journey.mjs creates. COUNTED AND REPORTED, NEVER
   DELETED — see reportOnly() below and the migration header. */
export const MOCK_CLIENT_EMAILS = Object.freeze(["demo.journey@fundhub.ai"]);

/** Back-compat alias for the two lists together, for callers that just want to
    see every marker this module matches on. */
export const MOCK_MARKERS = Object.freeze({
  eventKeyPatterns: MOCK_EVENT_KEY_PATTERNS,
  clientEmails: MOCK_CLIENT_EMAILS
});

/* The tombstone a de-identified payload is replaced with. An emptied field has
   to say it was emptied ON PURPOSE — otherwise a reader cannot tell a purged
   record from one that never had a payload, and "we lost it" and "we removed it
   under policy" are very different answers to give an auditor. It doubles as the
   idempotency guard: a row carrying the marker is already done and is excluded
   from both the count and the update, so re-running is free and does not churn
   updated_at. */
const TOMBSTONE = (dataClass) => `jsonb_build_object(
        '_retention_purged', true,
        '_purged_at', to_jsonb(now()),
        '_policy', 'retention_policy.${dataClass}')`;

function ctxOrThrow(ctx, dataClass) {
  const orgId = ctx?.orgId;
  // Fail closed. No org, no query — not "no filter".
  if (!orgId || String(orgId).trim() === "") {
    throw new Error(`${dataClass}: orgId is required — a retention query is never run unscoped`);
  }
  const retainDays = ctx?.retainDays;
  // The runner is supposed to have skipped an unset class before getting here.
  // Checked again anyway: this is the last gate before a destructive statement,
  // and `undefined` arriving as an interval would expire everything.
  if (!Number.isSafeInteger(retainDays) || retainDays < 1) {
    throw new Error(
      `${dataClass}: retainDays must be a whole number of days >= 1, got ${JSON.stringify(retainDays)} — an unset retention period must skip the class, never purge it`
    );
  }
  return { orgId: String(orgId), retainDays };
}

const one = (res) => res?.rows?.[0] ?? {};
const num = (v) => (v === null || v === undefined ? 0 : Number(v));

/* ===========================================================================
   1. crs_raw_payloads — DE-IDENTIFY
   ---------------------------------------------------------------------------
   The raw bureau report on a human being, in crs_results.result.

   DE-IDENTIFY, and it is forced rather than preferred: deleting a crs_results
   row that a FULFILLED soft_pull_requests row points at makes 077's ON DELETE
   SET NULL violate soft_pull_requests_result_ck, and the delete errors. The
   record that a pull happened must survive regardless — so the payload is
   emptied and the row, its client, its created_at and its outcome_tier stay.
   outcome_tier is kept on purpose: it is a derived label, not bureau content.

   This reads crs_results and writes only its `result` column. It does not touch
   src/tradelines/ ingest or crs_results parsing in any way.
=========================================================================== */
const crsRawPayloads = {
  dataClass: "crs_raw_payloads",
  action: "de_identify",
  label: "raw credit-report payloads",
  why: "De-identify: deleting the row breaks the soft-pull ledger's own CHECK constraint, and the record that a pull happened has to survive. Only the bureau payload goes.",

  async count(db, ctx) {
    const { orgId, retainDays } = ctxOrThrow(ctx, "crs_raw_payloads");
    const r = await db.query(
      `SELECT count(*)::bigint AS n
         FROM crs_results
        WHERE org_id = $1
          AND created_at < now() - make_interval(days => $2::int)
          AND NOT (result ? '_retention_purged')`,
      [orgId, retainDays]
    );
    return { expired: num(one(r).n) };
  },

  async purge(tx, ctx) {
    const { orgId, retainDays } = ctxOrThrow(ctx, "crs_raw_payloads");
    const r = await tx.query(
      `UPDATE crs_results
          SET result = ${TOMBSTONE("crs_raw_payloads")},
              updated_at = now()
        WHERE org_id = $1
          AND created_at < now() - make_interval(days => $2::int)
          AND NOT (result ? '_retention_purged')`,
      [orgId, retainDays]
    );
    return { affected: num(r?.rowCount) };
  }
};

/* ===========================================================================
   2. pii_access_log — DELETE
   ---------------------------------------------------------------------------
   One row per SSN reveal, written by src/pii/index.mjs.

   DELETE. De-identification is structurally impossible: client_id is
   `uuid NOT NULL REFERENCES clients(id)`, so there is nothing to null out. And
   past its period the log stops being an audit trail and becomes a standing
   inventory of whose SSN is on file. An access log with a defined lifetime is a
   stronger position than one that grows forever because nobody chose.
=========================================================================== */
const piiAccessLog = {
  dataClass: "pii_access_log",
  action: "delete",
  label: "PII access log (SSN reveals)",
  why: "Delete: the row cannot be redacted because client_id is NOT NULL, and every row asserts that a named person's SSN was disclosed.",

  async count(db, ctx) {
    const { orgId, retainDays } = ctxOrThrow(ctx, "pii_access_log");
    const r = await db.query(
      `SELECT count(*)::bigint AS n,
              count(DISTINCT client_id)::bigint AS clients_touched
         FROM pii_access_log
        WHERE org_id = $1
          AND created_at < now() - make_interval(days => $2::int)`,
      [orgId, retainDays]
    );
    const row = one(r);
    return { expired: num(row.n), clientsTouched: num(row.clients_touched) };
  },

  async purge(tx, ctx) {
    const { orgId, retainDays } = ctxOrThrow(ctx, "pii_access_log");
    const r = await tx.query(
      `DELETE FROM pii_access_log
        WHERE org_id = $1
          AND created_at < now() - make_interval(days => $2::int)`,
      [orgId, retainDays]
    );
    return { affected: num(r?.rowCount) };
  }
};

/* ===========================================================================
   3. soft_pull_ledger — DELETE
   ---------------------------------------------------------------------------
   The consumer-credit request ledger (077).

   DELETE. 077's header already reached this conclusion for the cascade case —
   "a table of 'we pulled this person's credit' that outlives the erasure of the
   person is a liability, not an audit trail" — and retention is the same
   argument with a clock instead of a cascade. Redaction is not available anyway:
   trg_soft_pull_requests_immutable guards every identifying column, and changing
   an immutability trigger on a consumer-credit table is its own review.

   *** cost_cents IS INTEGER CENTS AND NULL MEANS UNKNOWN, NOT FREE. *** The
   count reports rows with an unknown cost as their OWN number and lets SUM()
   return NULL when every expiring row is unknown. It is never COALESCEd to 0 —
   that would put "this pull was free" into a report nobody double-checked, which
   is the exact mistake 077's header warns about.
=========================================================================== */
const softPullLedger = {
  dataClass: "soft_pull_ledger",
  action: "delete",
  label: "soft-pull ledger (consumer-credit requests)",
  why: "Delete: 077 already decided this log should not outlive the consumer record, and its immutability trigger blocks redacting any identifying column.",

  async count(db, ctx) {
    const { orgId, retainDays } = ctxOrThrow(ctx, "soft_pull_ledger");
    // requested_at, not created_at: it is the immutable column, so the retention
    // clock cannot be reset by rewriting a row. See this file's header.
    const r = await db.query(
      `SELECT count(*)::bigint AS n,
              count(*) FILTER (WHERE cost_cents IS NULL)::bigint AS unknown_cost,
              sum(cost_cents)::bigint AS known_cost_cents
         FROM soft_pull_requests
        WHERE org_id = $1
          AND requested_at < now() - make_interval(days => $2::int)`,
      [orgId, retainDays]
    );
    const row = one(r);
    return {
      expired: num(row.n),
      unknownCost: num(row.unknown_cost),
      // *** NOT COALESCED. *** null here means "every expiring row has an unknown
      // cost", which is a different fact from "the expiring rows cost nothing",
      // and the report prints it as "unknown" rather than as $0.00.
      knownCostCents: row.known_cost_cents === null || row.known_cost_cents === undefined
        ? null
        : Number(row.known_cost_cents)
    };
  },

  async purge(tx, ctx) {
    const { orgId, retainDays } = ctxOrThrow(ctx, "soft_pull_ledger");
    const r = await tx.query(
      `DELETE FROM soft_pull_requests
        WHERE org_id = $1
          AND requested_at < now() - make_interval(days => $2::int)`,
      [orgId, retainDays]
    );
    return { affected: num(r?.rowCount) };
  }
};

/* ===========================================================================
   4. bank_transactions — DE-IDENTIFY
   ---------------------------------------------------------------------------
   The bank ledger (085).

   DE-IDENTIFY. The amount, direction and date are the evidence the entire
   cash-flow model runs on; deleting the row destroys the ability to look at
   historic cash flow. The sensitive part is the DETAIL: merchant_name is kept
   verbatim by design ("SQ *BLUE BOTTLE 4471 OAKLAND CA" — a place, a date and a
   person), and `raw` is the unparsed provider payload, the field most likely to
   carry an identifier nobody audited.

   *** amount_cents IS NEVER TOUCHED. *** It is NOT NULL and CHECKed non-zero, it
   is integer cents, and rewriting it would corrupt every cash-flow number
   downstream. The UPDATE below does not name it.

   *** client_id IS DELIBERATELY NOT SEVERED. *** Nulling it would be stronger
   de-identification and would also destroy per-client cash-flow history, which
   is a live feature. That trade is a policy decision, so it is reported on the
   shared board rather than made here.
=========================================================================== */
const bankTransactions = {
  dataClass: "bank_transactions",
  action: "de_identify",
  label: "bank transactions",
  why: "De-identify: the amount and date are the evidence cash flow is built on and must survive. The verbatim merchant name and the raw provider payload are the sensitive detail and are scrubbed.",

  async count(db, ctx) {
    const { orgId, retainDays } = ctxOrThrow(ctx, "bank_transactions");
    const r = await db.query(
      `SELECT count(*)::bigint AS n
         FROM bank_transactions
        WHERE org_id = $1
          AND created_at < now() - make_interval(days => $2::int)
          AND NOT (raw ? '_retention_purged')`,
      [orgId, retainDays]
    );
    return { expired: num(one(r).n) };
  },

  async purge(tx, ctx) {
    const { orgId, retainDays } = ctxOrThrow(ctx, "bank_transactions");
    // amount_cents, posted_on, authorized_on, client_id and bank_account_id are
    // all absent from this SET list on purpose. See the block comment above.
    const r = await tx.query(
      `UPDATE bank_transactions
          SET merchant_name = NULL,
              raw = ${TOMBSTONE("bank_transactions")},
              updated_at = now()
        WHERE org_id = $1
          AND created_at < now() - make_interval(days => $2::int)
          AND NOT (raw ? '_retention_purged')`,
      [orgId, retainDays]
    );
    return { affected: num(r?.rowCount) };
  }
};

/* ===========================================================================
   5. mock_data — DELETE
   ---------------------------------------------------------------------------
   Demo and smoke rows. Nothing legitimate is destroyed by removing them, and
   their presence harms every audit because a reader cannot tell them from real
   rows.

   *** THE SCOPE IS NARROW ON PURPOSE: EVENT ROWS ONLY. *** See
   MOCK_EVENT_KEY_PATTERNS above. The demo CLIENT and everything cascading from
   it — pii_identity, crs_results, soft_pull_requests, bank_accounts, plaid_items
   — is COUNTED AND REPORTED but never deleted, because a cascading client delete
   crosses five tables and CLAUDE.md §11 reserves that for a human.
=========================================================================== */
const mockData = {
  dataClass: "mock_data",
  action: "delete",
  label: "mock / demo data",
  why: "Delete: demo rows are not a record of anything. Only event rows with a known demo marker are removed; the demo client and its cascade are reported for a human to decide.",

  async count(db, ctx) {
    const { orgId, retainDays } = ctxOrThrow(ctx, "mock_data");
    const r = await db.query(
      `SELECT count(*)::bigint AS n
         FROM events
        WHERE org_id = $1
          AND created_at < now() - make_interval(days => $2::int)
          AND idempotency_key IS NOT NULL
          AND idempotency_key LIKE ANY ($3::text[])`,
      [orgId, retainDays, [...MOCK_EVENT_KEY_PATTERNS]]
    );
    return { expired: num(one(r).n) };
  },

  /* reportOnly — the demo client and its cascade. NEVER DELETED. This exists so
     the runner can say "there is also this, and I am not touching it", which is
     the honest thing to print. A tool that silently ignores what it will not
     handle reads as though there was nothing there. */
  async reportOnly(db, ctx) {
    const orgId = ctx?.orgId;
    if (!orgId) throw new Error("mock_data: orgId is required");
    const r = await db.query(
      `SELECT c.id, c.email,
              (SELECT count(*) FROM crs_results        x WHERE x.client_id = c.id)::bigint AS crs_results,
              (SELECT count(*) FROM soft_pull_requests x WHERE x.client_id = c.id)::bigint AS soft_pulls,
              (SELECT count(*) FROM pii_access_log     x WHERE x.client_id = c.id)::bigint AS pii_reads
         FROM clients c
        WHERE c.org_id = $1
          AND c.email = ANY ($2::text[])`,
      [String(orgId), [...MOCK_CLIENT_EMAILS]]
    );
    return r.rows.map((row) => ({
      clientId: row.id,
      email: row.email,
      crsResults: num(row.crs_results),
      softPulls: num(row.soft_pulls),
      piiReads: num(row.pii_reads)
    }));
  },

  async purge(tx, ctx) {
    const { orgId, retainDays } = ctxOrThrow(ctx, "mock_data");
    const r = await tx.query(
      `DELETE FROM events
        WHERE org_id = $1
          AND created_at < now() - make_interval(days => $2::int)
          AND idempotency_key IS NOT NULL
          AND idempotency_key LIKE ANY ($3::text[])`,
      [orgId, retainDays, [...MOCK_EVENT_KEY_PATTERNS]]
    );
    return { affected: num(r?.rowCount) };
  }
};

/* The registry, in the order a report should read: most sensitive first. Keyed
   by the same strings the retention_policy CHECK constraint enforces. */
export const CLASSES = Object.freeze({
  crs_raw_payloads: crsRawPayloads,
  pii_access_log: piiAccessLog,
  soft_pull_ledger: softPullLedger,
  bank_transactions: bankTransactions,
  mock_data: mockData
});

/* A class list that cannot silently drift from policy.mjs. If DATA_CLASSES gains
   an entry and this file does not, the missing class would be skipped by the
   runner without a word — so it throws at import time instead. */
for (const name of DATA_CLASSES) {
  if (!CLASSES[name]) {
    throw new Error(`src/retention/classes.mjs has no handler for data class "${name}"`);
  }
}

/** classFor(name) — the handler, or undefined. */
export function classFor(name) {
  return CLASSES[name];
}

/** countFor / applyFor — thin named wrappers so a caller reads as what it does. */
export function countFor(name) {
  return CLASSES[name]?.count;
}
export function applyFor(name) {
  return CLASSES[name]?.purge;
}
