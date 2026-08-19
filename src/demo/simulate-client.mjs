// Simulated client loader — Finance OS "Load simulated data".
//
// Extends the product-backlog "simulated credit files" idea and the CRS
// sandbox field names already encoded in src/tradelines/index.mjs
// (creditorName, creditLimitAmount, currentBalanceAmount, accountIdentifier,
// accountOpenedDate — confirmed 2026-08-01 against the vendor library).
//
// Creates a REAL client (is_demo=true), crs_results row, tradelines via the
// real ingest path, a sales pipeline card, and mock bank/card rows when those
// endpoints' tables allow. Teardown deletes by is_demo markers.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THE PAYLOAD BELOW IMITATES A REAL PULL INSTEAD OF INVENTING ITS OWN SHAPE
//
// It used to carry the three bureau scores in two places of its own invention —
// `consumerSignals.scores.perBureau` and `crm_payload.scores` — and nowhere
// else. A REAL pull stores something different. mergeBureauReports
// (src/finance/crs-map.mjs:196-223) writes fourteen keys at the TOP level of
// `crs_results.result`, and `scores` is one of them. The readers are written
// against that: triMerge reads `result.scores` (src/http/client-detail.mjs:30-34)
// and the underwriting adapter takes its bureau scores from triMerge and from
// nothing else (src/underwrite/adapter.mjs:288). Neither has ever heard of
// `consumerSignals`.
//
// So a demo client created by the Finance OS button read score 0, no bureau
// available and $0 of funding on UnderwriteIQ, while the scores the seed
// "wrote" sat in a key nothing reads. Found live 2026-08-18.
//
// The fix belongs here and not in the readers. The readers are right about
// production; teaching them the demo's private shape would make the demo the
// thing that defines the contract. The old keys stay — src/adapters/crs.mjs:44-47
// reads `consumerSignals` and the CRM export reads `crm_payload` — so this
// payload now answers both.
//
// ONE KEY IS DELIBERATELY NOT "sandbox". `environment: "sandbox"` makes triMerge
// skip the entire row (src/http/client-detail.mjs:76), which puts the score
// straight back to 0 no matter what else is written here. This payload calls
// itself "simulated", which is true and which no reader treats as a reason to
// look away. What marks the row as demo is the is_demo COLUMN, not a string
// buried in the jsonb.
// ═══════════════════════════════════════════════════════════════════════════

import { ingestCrsResult } from "../tradelines/store.mjs";
import { ingestCrsLiabilities } from "../liabilities/store.mjs";
import { mergeCustomFields } from "../workflows/custom-fields.mjs";
import { pool } from "../db.mjs";

export const DEMO_EMAIL_PREFIX = "sim+";
export const DEMO_EMAIL_DOMAIN = "demo.fundhub.local";

/* The three bureau FICOs on this file. One place, because the merged top-level
   `scores` object and each bureau's own report below are both built from it. */
const SIM_SCORES = Object.freeze({ EX: 718, EQ: 724, TU: 731 });

/* Vendor-facing names, for the parts of the payload that carry them the way a
   bureau does rather than the way this repo does. */
const BUREAU_NAME = Object.freeze({ EX: "Experian", EQ: "Equifax", TU: "TransUnion" });

/**
 * One simulated account, in the field names a real CRS record uses.
 *
 * TWO FACTS ARE WRITTEN TWICE, AND BOTH SPELLINGS ARE LOAD-BEARING. This repo
 * has two normalizers reading the same record, and their key lists do not
 * agree:
 *   * the account identifier — src/tradelines/index.mjs:94 accepts
 *     `accountIdentifier`, src/liabilities/index.mjs:65 does NOT. Without the
 *     `account_ref` spelling, accountRefOf() returns null for every line, the
 *     billing position cannot be attached to its card, and no card_liabilities
 *     row is ever written.
 *   * the balance — src/tradelines/index.mjs:92 accepts `currentBalanceAmount`,
 *     src/liabilities/index.mjs:47-49 does not. Without the `currentBalance`
 *     spelling the position carries no measure at all and normalizeLiability
 *     drops the record (src/liabilities/index.mjs:176).
 * The mismatch is a real latent bug on the live CRS path too, recorded on the
 * fix board. It is worked around here rather than repaired here, because
 * src/liabilities/ is not this file's to change.
 */
function simTradeline({ creditorName, accountType, limit, balance, apr, ref, openedOn, bureau }) {
  return {
    creditorName,
    accountType,
    creditLimitAmount: limit,
    currentBalanceAmount: balance,
    currentBalance: balance,
    apr,
    accountIdentifier: ref,
    account_ref: ref,
    // Every account on this file is in good standing. That is not decoration:
    // it is what makes the zero negatives and zero late payments written to
    // custom_fields below true of the accounts actually planted, instead of a
    // claim contradicted by the client's own tradelines.
    paymentStatus: "current",
    accountOpenedDate: openedOn,
    bureau
  };
}

/* THE FOUR ACCOUNTS. Opened dates are all more than two years back and stay
   that way — the engine calls a line "seasoned" at 24 months and seasoning
   gates every funding figure it produces (src/underwrite/vendor/underwriter.cjs:173).
   APRs are ordinary rates for these products; before this they were absent and
   every line normalized to apr null, which sorts last in the draw waterfall. */
const SIM_ACCOUNTS = Object.freeze([
  { creditorName: "Chase Sapphire Preferred", accountType: "revolving",
    limit: "12000", balance: "2100", apr: "22.24", ref: "SIM-CHASE-001",
    openedOn: "2019-04-12", bureau: "EX" },
  { creditorName: "American Express Blue Business Cash", accountType: "revolving",
    limit: "25000", balance: "4800", apr: "18.49", ref: "SIM-AMEX-001",
    openedOn: "2020-08-01", bureau: "EQ" },
  { creditorName: "Capital One Spark", accountType: "revolving",
    limit: "8000", balance: "950", apr: "24.99", ref: "SIM-CAP1-001",
    openedOn: "2021-01-20", bureau: "TU" },
  { creditorName: "Toyota Motor Credit", accountType: "installment",
    limit: "28000", balance: "14200", apr: "5.90", ref: "SIM-TOYO-001",
    openedOn: "2022-06-15", bureau: "EX" }
]);

/* THE HARD INQUIRIES ON THIS FILE. Seven of them, and the per-bureau counts
   written to custom_fields are COUNTED FROM THIS LIST rather than typed out
   again — a demo whose stated inquiry count disagrees with the inquiries it
   shows is worse than one with no inquiries at all. */
const SIM_INQUIRIES = Object.freeze([
  { creditorName: "Chase Bank USA NA",        bureau: "EX", date: "2025-11-14" },
  { creditorName: "Discover Financial Svcs",  bureau: "EX", date: "2026-01-08" },
  { creditorName: "US Bank NA",               bureau: "EX", date: "2026-02-27" },
  { creditorName: "Amex Membership Banking",  bureau: "EX", date: "2026-04-03" },
  { creditorName: "Barclays Bank Delaware",   bureau: "EQ", date: "2025-12-19" },
  { creditorName: "Citibank NA",              bureau: "EQ", date: "2026-03-11" },
  { creditorName: "Navy Federal CU",          bureau: "TU", date: "2026-05-22" }
]);

const inquiriesFor = (code) => SIM_INQUIRIES.filter((i) => i.bureau === code);

/* THE SIX UNDERWRITING COUNTS, written to clients.custom_fields.
 *
 * These are the only per-client numbers the underwriting adapter reads
 * (src/underwrite/adapter.mjs:98-102, :293-294, :446), and until now the seed
 * wrote none of them. The engine does NOT read an absent count as zero: it
 * keeps it null (src/underwrite/vendor/underwriter.cjs:38-43), and a null
 * negatives count fails `neg === 0` (:212), so an unwritten count made the demo
 * client NOT fundable, withheld all loan funding and produced no business
 * figure at all.
 *
 * The values are the ones this file's own contents support. Zero negatives and
 * zero late payments because all four accounts above are current and there are
 * no public records; the inquiry counts are counted from SIM_INQUIRIES; and the
 * business is 30 months old, over the engine's 24-month step
 * (src/underwrite/vendor/underwriter.cjs:277-285), which is what a FULL_FUNDING
 * demo needs before any business figure appears.
 */
const SIM_UNDERWRITING_FIELDS = Object.freeze({
  crs_inquiries_ex: inquiriesFor("EX").length,
  crs_inquiries_eq: inquiriesFor("EQ").length,
  crs_inquiries_tu: inquiriesFor("TU").length,
  crs_negative_items_count: 0,
  crs_late_payments_count: 0,
  business_age_months: 30
});

/* One bureau's own report, in the shape mergeBureauReports reads back out of a
   vendor response: a `scores` ARRAY of models (src/finance/crs-map.mjs:86-105
   picks the FICO one out of it), plus that bureau's lines and inquiries. Kept
   whole and per-bureau so `result.bureaus` here means what it means on a real
   pull, including for the fallback read at src/http/client-detail.mjs:46-50. */
function simBureauReport(code, lines) {
  return {
    scores: [{ modelName: "FICO 9", scoreValue: SIM_SCORES[code], scoreMaximumValue: 850 }],
    tradelines: lines.filter((t) => t.bureau === code),
    inquiries: inquiriesFor(code).map((i) => ({
      creditorName: i.creditorName,
      sourceType: BUREAU_NAME[code],
      inquiryDate: i.date
    })),
    publicRecords: [],
    errorMessages: []
  };
}

/**
 * Build a CRS-shaped payload using real bureau field names.
 *
 * The top-level keys are the fourteen mergeBureauReports emits
 * (src/finance/crs-map.mjs:196-223); `consumerSignals`, `crm_payload`,
 * `outcome`, `reason_codes` and `preapprovals` are this repo's own additions
 * and are kept because other readers still consume them. See the file header
 * for why both sets are present.
 *
 * `pulledAt` is a parameter with a clock default, exactly as mergeBureauReports
 * declares it (src/finance/crs-map.mjs:141), so a caller that needs a fixed
 * payload can pin it.
 */
export function buildSimulatedCrsPayload({ email, name, pulledAt = new Date().toISOString() } = {}) {
  const tradelines = SIM_ACCOUNTS.map(simTradeline);
  const scores = { ex: SIM_SCORES.EX, eq: SIM_SCORES.EQ, tu: SIM_SCORES.TU };

  return {
    // ── the production shape ──────────────────────────────────────────────
    source: "crs",
    product: "prequal-fico9",
    // NOT "sandbox" — see the file header. A sandbox result is skipped whole.
    environment: "simulated",
    pulledAt,
    // Bureau order matches BUREAU_CODES (src/finance/crs-map.mjs:29), which is
    // the order a merged payload lists them in.
    bureausPulled: ["TU", "EX", "EQ"],
    bureaus_pulled: "TU/EX/EQ",
    scores,
    // The model name has to read as FICO or the score is discarded on the way
    // to the screen (src/http/client-detail.mjs:22-27).
    scoreModels: { ex: "FICO 9", eq: "FICO 9", tu: "FICO 9" },
    // Real CRS sandbox tradeline field names (see src/tradelines/index.mjs).
    // Top level, because that is the only container the tradeline normalizer
    // looks in before giving up (src/tradelines/index.mjs:113-131).
    tradelines,
    // `source` as a bureau CODE and an ISO `date` — the two fields the merge
    // adds on top of the vendor's own record (src/finance/crs-map.mjs:180-189),
    // and what src/inquiry-ops/extract-disputables.mjs:67-70 reads.
    inquiries: SIM_INQUIRIES.map((i) => ({
      creditorName: i.creditorName,
      sourceType: BUREAU_NAME[i.bureau],
      inquiryDate: i.date,
      source: i.bureau,
      date: i.date
    })),
    // A clean file. Empty, not absent — "we looked and there are none" is a
    // different statement from "nobody asked".
    publicRecords: [],
    bureaus: {
      TU: simBureauReport("TU", tradelines),
      EX: simBureauReport("EX", tradelines),
      EQ: simBureauReport("EQ", tradelines)
    },
    // All three bureaus answered, so there is nothing to report here.
    bureauErrors: {},
    requestIds: { TU: "simulated-TU", EX: "simulated-EX", EQ: "simulated-EQ" },

    // ── this repo's own keys, kept for the readers that already use them ──
    outcome: "FULL_FUNDING",
    reason_codes: ["sim_demo", "low_util"],
    preapprovals: { totalCombined: 125000 },
    consumerSignals: {
      scores: { perBureau: { ...scores } },
      utilization: { pct: 18 }
    },
    crm_payload: {
      outcome: "FULL_FUNDING",
      contact: { email: email || null, name: name || null },
      scores: { ...scores },
      customFields: {
        total_funding_estimate: 125000,
        crs_utilization: 18
      }
    }
  };
}

async function firstSalesStage(db, orgId) {
  const r = await db.query(
    `SELECT ps.id AS stage_id, p.id AS pipeline_id
       FROM pipelines p
       JOIN pipeline_stages ps ON ps.pipeline_id = p.id
      WHERE p.org_id = $1 AND p.key = 'sales'
      ORDER BY ps.sort_order ASC
      LIMIT 1`,
    [orgId]
  );
  return r.rows[0] || null;
}

/**
 * loadSimulatedClient(db, { orgId, staffId })
 * → { client, crs, tradelines, card, email }
 */
export async function loadSimulatedClient(db, { orgId, staffId = null } = {}) {
  if (!orgId) throw new TypeError("loadSimulatedClient: orgId required");

  const stamp = Date.now();
  const email = `${DEMO_EMAIL_PREFIX}${stamp}@${DEMO_EMAIL_DOMAIN}`;
  const firstName = "Simulated";
  const lastName = "Client";
  const name = `${firstName} ${lastName}`;
  const phone = `+1555${String(stamp).slice(-7)}`;

  // Schema (001 / 094): first_name, last_name, is_demo — never clients.name or
  // clients.status. The Finance OS button used the wrong columns and silently
  // failed for every operator click (verified 2026-08-04).
  const clientRes = await db.query(
    `INSERT INTO clients (
       org_id, email, first_name, last_name, phone, channel_source, tags,
       consent_sms, is_demo
     ) VALUES (
       $1, $2, $3, $4, $5, 'simulated', ARRAY['is_demo','simulated'],
       true, true
     ) RETURNING *`,
    [orgId, email, firstName, lastName, phone]
  );
  const client = clientRes.rows[0];

  const payload = buildSimulatedCrsPayload({ email, name });
  const crsRes = await db.query(
    // is_demo on the ROW, not just on the client. Audit item T16-23 found 61
    // rows across 7 tables that were demo work stored as if it were real, which
    // makes cleanup and reporting quietly wrong. Every table this function
    // writes to carries the column — but two of them are written by shared
    // ingest code that has no business knowing about demo data, so those two
    // are flagged in a follow-up statement below rather than at insert time.
    `INSERT INTO crs_results (org_id, client_id, result, outcome_tier, is_demo)
     VALUES ($1, $2, $3::jsonb, $4, true)
     RETURNING *`,
    [orgId, client.id, JSON.stringify(payload), "FULL_FUNDING"]
  );
  const crs = crsRes.rows[0];

  const ingested = await ingestCrsResult(db, crs);

  // THE FLAG THE COMMENT ABOVE USED TO CLAIM WAS ALREADY HANDLED. It was not:
  // `is_demo` is not one of the columns the tradeline upsert writes
  // (src/tradelines/store.mjs:18-21), so every line this seeder created landed
  // is_demo=false while its client, credit result, card and bank account were
  // all true. Teardown still worked — it deletes by client, not by flag — but
  // any report that excludes demo data counted these four lines as real.
  //
  // Fixed here and NOT by adding the column to that COLUMNS array, which is the
  // live ingest path for every real client. This is the same follow-up UPDATE
  // the sibling seeder already does (src/demo/platform-seed.mjs:88).
  await db.query(
    `UPDATE tradelines SET is_demo = true WHERE client_id = $1 AND org_id = $2`,
    [client.id, orgId]
  );

  // The billing position on each account — what the statement closed at and
  // whether the account is current. Nothing in production calls this yet, so
  // without it the demo client has tradelines and no card_liabilities at all,
  // and the underwriting adapter reports `payment_status` missing on every line
  // (src/underwrite/adapter.mjs:212) because there is no position to read a
  // standing from. Attaches by account_ref — see simTradeline for why each
  // record carries that spelling as well as `accountIdentifier`.
  const liabilities = await ingestCrsLiabilities(db, crs);
  await db.query(
    `UPDATE card_liabilities SET is_demo = true WHERE client_id = $1 AND org_id = $2`,
    [client.id, orgId]
  );

  await db.query(
    `UPDATE clients SET
       outcome_tier = 'FULL_FUNDING',
       updated_at = now()
     WHERE id = $1`,
    [client.id]
  );

  // The six counts UnderwriteIQ reads off the client. See
  // SIM_UNDERWRITING_FIELDS for what each value is and why it is that value.
  // Written through the existing helper rather than folded into the UPDATE
  // above, because `custom_fields || patch` is the one merge idiom this repo
  // uses for that column and it must not grow a second one.
  await mergeCustomFields(db, client.id, SIM_UNDERWRITING_FIELDS);

  let card = null;
  const stage = await firstSalesStage(db, orgId);
  if (stage) {
    const cardRes = await db.query(
      `INSERT INTO cards (org_id, client_id, pipeline_id, stage_id, owner, is_demo)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [orgId, client.id, stage.pipeline_id, stage.stage_id, staffId]
    );
    card = cardRes.rows[0];
  }

  // Best-effort bank account + card liability via tables that already exist.
  // Failures here must not undo the client — Finance OS can still show tradelines.
  try {
    await db.query(
      `INSERT INTO bank_accounts (
         org_id, client_id, name, account_type, mask, current_balance_cents, currency_code, raw,
         is_demo
       ) VALUES ($1, $2, 'Simulated Checking', 'depository', '4242', 500000, 'USD',
                 '{"provider":"mock","is_demo":true}'::jsonb, true)`,
      [orgId, client.id]
    );
  } catch { /* optional — tradelines + crs are the required half */ }

  return {
    client,
    crs,
    tradelines: ingested.rows,
    tradeline_count: ingested.ingested,
    liability_count: liabilities.recorded,
    card,
    email,
    finance_os_href: `/app/finance-os.html?client_id=${client.id}`
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   TEARING DOWN A DEMO CLIENT

   WHAT WENT WRONG BEFORE.
   The old version deleted from a hand-written list of eleven tables and then
   deleted the client. Ten of those eleven deletes were wrapped in
   `.catch(() => null)`; the twelfth — the client itself — was bare. So the
   only statement that could report a problem was the last one, and every
   statement before it had already committed (there was no transaction).

   The result, seen live on 2026-08-18: the caller gets a flat 500 naming
   `clients`, while the client's messages, tradelines, credit results and
   cards are already gone. The client is left stranded and half-erased,
   still visible in every list, and permanently undeletable through this
   path — re-running does not help, because the children that blocked it are
   in tables the list never mentioned.

   WHAT ACTUALLY BLOCKS THE DELETE.
   67 foreign keys point at `clients`. 38 are ON DELETE CASCADE and take care
   of themselves. The other 29 do not: 16 are NO ACTION (they refuse) and 13
   are SET NULL (they orphan the row instead, which is how `bank_transactions`
   ended up with 18 rows attached to nobody — audit item T16-06). The old
   list named only 3 of the 16 blockers, and 8 of its 11 entries were
   redundant CASCADE tables it never needed to touch.

   WHY THIS IS NOW READ FROM THE CATALOG INSTEAD OF TYPED OUT.
   This is the third time a hand-maintained list here has drifted behind the
   schema. Any new table with a non-cascading link to `clients` broke demo
   teardown silently, and nothing failed until someone pressed delete. So the
   list is no longer written down: it is asked of the database itself, every
   time. A table added next month is handled without anyone remembering to
   come back here.

   WHY IT IS TWO STATEMENTS IN A TRANSACTION, AND NOT ONE.

   The children go first, all of them in ONE statement built from
   data-modifying CTEs. Then the client goes, in a second statement. Both sit
   inside an explicit BEGIN/COMMIT on a single checked-out connection.

   The one statement for the children buys the thing that matters most: delete
   ORDER stops mattering. A NO ACTION foreign key is checked at the END of a
   statement, not as each row goes, so parent and child rows among the children
   can be removed in the same breath. That sidesteps every ordering puzzle in
   this schema at once — contracts before documents, documents before invoices,
   and the circular documents ↔ document_versions pair.

   The client CANNOT join that statement, and this is the part that is easy to
   get wrong. It was got wrong here first, and live caught it:

     demo teardown failed for client cb6f5839-…: documents ad69a9a0-…:
     documents are never deleted — register a superseding version instead

   Several tables carry an archive-only guard trigger — documents, contracts,
   invoices, commission_ledger, entitlements and others. Migrations 150, 151 and
   152 rewrote those triggers so a demo wipe is allowed, and the way they allow
   it is by looking UP at the parent: `EXISTS (SELECT 1 FROM clients c WHERE
   c.id = OLD.client_id AND c.is_demo)`. That lookup only answers yes while the
   client row is still there. Put the client's own DELETE in the same statement
   and the trigger can find the client already gone, decide this is not a demo
   wipe after all, and refuse.

   Postgres is explicit that sub-statements of a data-modifying CTE "cannot see
   one another's effects on the target tables" and that trying to is
   unpredictable. A trigger doing its own SELECT against another CTE's target
   is exactly that situation. So the client is deleted separately, after the
   children are done, while every guard trigger has had the answer it needs.

   The explicit transaction is what keeps this atomic across the two
   statements — without it, statement one committing and statement two failing
   would recreate the half-erased client this whole rewrite exists to prevent.
   `db` here is a pool, and separate `db.query` calls are not guaranteed the
   same connection, so a connection is checked out for the duration.

   Cost: three round trips instead of twelve-plus. Combined with the client_id
   indexes in db/migrations/202_client_fk_indexes.sql, that is what takes this
   path back under Netlify's 10-second function limit — it was timing out at 504.

   Nothing is swallowed. If a delete is refused, the error is re-raised with
   the name of the table that refused it, instead of a misleading complaint
   about `clients`.

   ONE KNOWN LIMIT, DELIBERATELY NOT WORKED AROUND.
   `affiliate_payout_lines` carries its own guard trigger
   (db/migrations/033_affiliates.sql) that refuses any delete once the parent
   payout run is marked `paid`, and — unlike the archive guards rewritten in
   150/151/152 — it has no demo exemption. A demo client whose commission
   landed in a paid affiliate run therefore still cannot be torn down. That
   needs a migration to broaden the trigger, it is recorded on the fix board,
   and it is left failing loudly rather than papered over.
   ═══════════════════════════════════════════════════════════════════════════ */

// Rows that hang off a demo client's contracts, documents or invoices rather
// than off the client itself. The catalog sweep below only finds direct
// links, so these three are named. Each is a NO ACTION foreign key that would
// otherwise refuse the parent's delete:
//   contract_signers.contract_id  → contracts(id)
//   invoice_payments.invoice_id   → invoices(id)
//   document_versions.document_id → documents(id)
const INDIRECT_CHILDREN = [
  { table: "contract_signers", column: "contract_id", parent: "contracts" },
  { table: "invoice_payments", column: "invoice_id", parent: "invoices" },
  { table: "document_versions", column: "document_id", parent: "documents" }
];

// Postgres identifiers we are about to interpolate. They come from the
// catalog, not from a caller, but this stays as a cheap tripwire: anything
// that is not a plain identifier is a sign something is very wrong.
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ident = (name) => {
  if (!SAFE_IDENT.test(name)) throw new Error(`unsafe identifier from catalog: ${name}`);
  return `"${name}"`;
};

/**
 * clientChildTables(db) — every table with a single-column foreign key to
 * `clients` that does NOT cascade, read live from the catalog.
 *
 * NO ACTION and RESTRICT refuse the parent delete; SET NULL and SET DEFAULT
 * quietly detach the row and leave it behind. For a demo client we want both
 * gone, so all four are returned. CASCADE is excluded — the database already
 * handles those, and re-deleting them is wasted work.
 */
export async function clientChildTables(db) {
  const { rows } = await db.query(`
    SELECT cl.relname AS table_name,
           a.attname  AS column_name,
           con.confdeltype AS on_delete
      FROM pg_constraint con
      JOIN pg_class cl     ON cl.oid = con.conrelid
      JOIN pg_namespace n  ON n.oid = cl.relnamespace
      JOIN LATERAL unnest(con.conkey) AS k(attnum) ON true
      JOIN pg_attribute a  ON a.attrelid = con.conrelid AND a.attnum = k.attnum
     WHERE con.contype = 'f'
       AND con.confrelid = 'public.clients'::regclass
       AND n.nspname = 'public'
       AND array_length(con.conkey, 1) = 1
       AND con.confdeltype <> 'c'
     ORDER BY cl.relname, a.attname
  `);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = `${r.table_name}.${r.column_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ table: r.table_name, column: r.column_name });
  }
  return out;
}

/**
 * Build the one-statement wipe of a client's CHILDREN ($1 = client id).
 *
 * The client row itself is deliberately NOT deleted here — the guard triggers
 * on documents, contracts and invoices need to look it up and see it is a demo
 * client before they will allow their own row to go. See the header.
 *
 * Order within the statement is cosmetic: foreign keys between these tables are
 * NO ACTION and are therefore checked once, at the end.
 */
function buildChildWipeStatement(children) {
  const parts = ["victim AS (SELECT id FROM clients WHERE id = $1 AND is_demo = true)"];
  let n = 0;

  for (const c of INDIRECT_CHILDREN) {
    parts.push(
      `w${n++} AS (DELETE FROM ${ident(c.table)} WHERE ${ident(c.column)} IN ` +
      `(SELECT id FROM ${ident(c.parent)} WHERE client_id IN (SELECT id FROM victim)))`
    );
  }
  for (const c of children) {
    parts.push(
      `w${n++} AS (DELETE FROM ${ident(c.table)} WHERE ${ident(c.column)} IN (SELECT id FROM victim))`
    );
  }

  // A WITH needs a final query. This one also tells us the client matched.
  return `WITH ${parts.join(",\n     ")}\nSELECT count(*)::int AS matched FROM victim`;
}

/**
 * teardownSimulated(db, { orgId, clientId?, limit? })
 *
 * Removes simulated clients. With `clientId`, only that one, and only when it
 * is flagged `is_demo` — a real client is never touched by this path. Without
 * it, every demo client in the org, newest first, capped by `limit`.
 *
 * `orgId` may be omitted when `clientId` is given; it is then read from the
 * client row. (Before this, callers that passed only a client id threw a
 * TypeError that a surrounding catch swallowed, so their cleanup never ran —
 * src/verification/journeys/funding.mjs is one such caller.)
 *
 * Returns { removed: [{id, email}], count, truncated } — `truncated` is true
 * when more demo clients matched than `limit` allowed, so a caller can call
 * again rather than assume the org is clean.
 */
export async function teardownSimulated(db, { orgId, clientId = null, limit = 100 } = {}) {
  if (!orgId && !clientId) throw new TypeError("teardownSimulated: orgId or clientId required");

  const cap = Math.max(1, Math.min(Number(limit) || 100, 500));
  let clients;
  if (clientId && orgId) {
    clients = await db.query(
      `SELECT id, email FROM clients WHERE org_id = $1 AND id = $2 AND is_demo = true`,
      [orgId, clientId]
    );
  } else if (clientId) {
    clients = await db.query(
      `SELECT id, email FROM clients WHERE id = $1 AND is_demo = true`,
      [clientId]
    );
  } else {
    clients = await db.query(
      `SELECT id, email FROM clients
        WHERE org_id = $1 AND is_demo = true
          AND (email LIKE $2 OR 'simulated' = ANY(tags))
        ORDER BY created_at DESC
        LIMIT $3`,
      [orgId, `${DEMO_EMAIL_PREFIX}%@${DEMO_EMAIL_DOMAIN}`, cap + 1]
    );
  }

  const matched = clients.rows;
  const truncated = !clientId && matched.length > cap;
  const targets = truncated ? matched.slice(0, cap) : matched;
  if (targets.length === 0) return { removed: [], count: 0, truncated: false };

  // Asked once per call, not once per client.
  const childStatement = buildChildWipeStatement(await clientChildTables(db));

  const removed = [];
  for (const c of targets) {
    // One connection for the pair of statements, so BEGIN/COMMIT actually
    // covers both. db.connect exists on a checked-out client in tests; the
    // shared pool is the normal path.
    const conn = typeof db.connect === "function" ? await db.connect() : await pool().connect();
    try {
      await conn.query("BEGIN");
      await conn.query(childStatement, [c.id]);
      // Client last, and only now — the guard triggers above have had their
      // answer. `is_demo = true` is repeated here rather than trusted from the
      // SELECT: a real client must not be removable by this path even if the
      // row changed underneath us.
      const gone = await conn.query(
        `DELETE FROM clients WHERE id = $1 AND is_demo = true RETURNING id`, [c.id]
      );
      await conn.query("COMMIT");
      if (gone.rowCount > 0) removed.push({ id: c.id, email: c.email });
    } catch (err) {
      await conn.query("ROLLBACK").catch(() => null);
      // Name what actually refused. Postgres puts the table on the error for a
      // foreign-key violation; a guard trigger puts its own sentence in the
      // message. Either beats a bare complaint about `clients`, which was the
      // one table that was never the problem.
      const blocker = err && (err.table || err.constraint);
      const why = blocker ? ` — blocked by ${blocker}` : "";
      const wrapped = new Error(`demo teardown failed for client ${c.id}${why}: ${err.message}`);
      wrapped.cause = err;
      wrapped.code = err && err.code;
      throw wrapped;
    } finally {
      conn.release();
    }
  }
  return { removed, count: removed.length, truncated };
}
