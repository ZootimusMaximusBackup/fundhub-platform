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

import { ingestCrsResult } from "../tradelines/store.mjs";

export const DEMO_EMAIL_PREFIX = "sim+";
export const DEMO_EMAIL_DOMAIN = "demo.fundhub.local";

/** Build a CRS-shaped payload using real bureau field names. */
export function buildSimulatedCrsPayload({ email, name } = {}) {
  return {
    outcome: "FULL_FUNDING",
    reason_codes: ["sim_demo", "low_util"],
    preapprovals: { totalCombined: 125000 },
    consumerSignals: {
      scores: { perBureau: { ex: 718, eq: 724, tu: 731 } },
      utilization: { pct: 18 }
    },
    crm_payload: {
      outcome: "FULL_FUNDING",
      contact: { email: email || null, name: name || null },
      scores: { ex: 718, eq: 724, tu: 731 },
      customFields: {
        total_funding_estimate: 125000,
        crs_utilization: 18
      }
    },
    // Real CRS sandbox tradeline field names (see src/tradelines/index.mjs).
    tradelines: [
      {
        creditorName: "Chase Sapphire Preferred",
        accountType: "revolving",
        creditLimitAmount: "12000",
        currentBalanceAmount: "2100",
        accountIdentifier: "SIM-CHASE-001",
        accountOpenedDate: "2019-04-12",
        bureau: "EX"
      },
      {
        creditorName: "American Express Blue Business Cash",
        accountType: "revolving",
        creditLimitAmount: "25000",
        currentBalanceAmount: "4800",
        accountIdentifier: "SIM-AMEX-001",
        accountOpenedDate: "2020-08-01",
        bureau: "EQ"
      },
      {
        creditorName: "Capital One Spark",
        accountType: "revolving",
        creditLimitAmount: "8000",
        currentBalanceAmount: "950",
        accountIdentifier: "SIM-CAP1-001",
        accountOpenedDate: "2021-01-20",
        bureau: "TU"
      },
      {
        creditorName: "Toyota Motor Credit",
        accountType: "installment",
        creditLimitAmount: "28000",
        currentBalanceAmount: "14200",
        accountIdentifier: "SIM-TOYO-001",
        accountOpenedDate: "2022-06-15",
        bureau: "EX"
      }
    ]
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
    `INSERT INTO crs_results (org_id, client_id, result, outcome_tier)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING *`,
    [orgId, client.id, JSON.stringify(payload), "FULL_FUNDING"]
  );
  const crs = crsRes.rows[0];

  const ingested = await ingestCrsResult(db, crs);

  await db.query(
    `UPDATE clients SET
       outcome_tier = 'FULL_FUNDING',
       updated_at = now()
     WHERE id = $1`,
    [client.id]
  );

  let card = null;
  const stage = await firstSalesStage(db, orgId);
  if (stage) {
    const cardRes = await db.query(
      `INSERT INTO cards (org_id, client_id, pipeline_id, stage_id, owner)
       VALUES ($1, $2, $3, $4, $5)
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
         org_id, client_id, name, account_type, mask, current_balance_cents, currency_code, raw
       ) VALUES ($1, $2, 'Simulated Checking', 'depository', '4242', 500000, 'USD',
                 '{"provider":"mock","is_demo":true}'::jsonb)`,
      [orgId, client.id]
    );
  } catch { /* optional — tradelines + crs are the required half */ }

  return {
    client,
    crs,
    tradelines: ingested.rows,
    tradeline_count: ingested.ingested,
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

   WHY IT IS ONE STATEMENT.
   Everything happens inside a single SQL statement built from data-modifying
   CTEs. That buys three things at once:

     1. It is atomic. A single statement either wholly succeeds or wholly
        rolls back, so the half-erased client above cannot happen again. No
        BEGIN/COMMIT is needed, which matters because `db` here is a pool —
        separate `db.query` calls are not guaranteed the same connection and
        so cannot share a transaction.
     2. Delete ORDER stops mattering. A NO ACTION foreign key is checked at
        the END of the statement, not as each row goes. Parent and child can
        be removed in the same breath, which sidesteps the ordering puzzles
        (contracts before documents, documents before invoices, and the
        circular documents ↔ document_versions pair).
     3. It is one round trip instead of twelve-plus. Combined with the
        client_id indexes added in db/migrations/202_client_fk_indexes.sql,
        this is what takes the path back under Netlify's 10-second function
        limit — the same path was timing out at 504.

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

/** Build the one-statement wipe for a single client id ($1). */
function buildWipeStatement(children) {
  const parts = ["victim AS (SELECT id FROM clients WHERE id = $1 AND is_demo = true)"];
  let n = 0;

  // Grandchildren first in the text (order is cosmetic — see header note 2).
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

  return `WITH ${parts.join(",\n     ")}\nDELETE FROM clients WHERE id IN (SELECT id FROM victim) RETURNING id`;
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
  const statement = buildWipeStatement(await clientChildTables(db));

  const removed = [];
  for (const c of targets) {
    try {
      const res = await db.query(statement, [c.id]);
      if (res.rowCount > 0) removed.push({ id: c.id, email: c.email });
    } catch (err) {
      // Name the table that actually refused. Postgres puts it on the error
      // as `table` for a foreign-key violation; a guard trigger puts its own
      // message in `message`. Either beats a bare complaint about `clients`.
      const blocker = err && (err.table || err.constraint);
      const why = blocker ? ` — blocked by ${blocker}` : "";
      const wrapped = new Error(`demo teardown failed for client ${c.id}${why}: ${err.message}`);
      wrapped.cause = err;
      wrapped.code = err && err.code;
      throw wrapped;
    }
  }
  return { removed, count: removed.length, truncated };
}
