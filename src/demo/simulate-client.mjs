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

/**
 * teardownSimulated(db, { orgId, clientId? })
 * Removes simulated clients for the org. If clientId given, only that one
 * (and only if is_demo). Cascades via FK where present; explicit deletes
 * where needed.
 */
export async function teardownSimulated(db, { orgId, clientId = null } = {}) {
  if (!orgId) throw new TypeError("teardownSimulated: orgId required");

  const clients = await db.query(
    clientId
      ? `SELECT id, email FROM clients WHERE org_id = $1 AND id = $2 AND is_demo = true`
      : `SELECT id, email FROM clients WHERE org_id = $1 AND is_demo = true
           AND (email LIKE $2 OR 'simulated' = ANY(tags))`,
    clientId
      ? [orgId, clientId]
      : [orgId, `${DEMO_EMAIL_PREFIX}%@${DEMO_EMAIL_DOMAIN}`]
  );

  const removed = [];
  for (const c of clients.rows) {
    // Order matters where FKs lack ON DELETE CASCADE.
    await db.query(`DELETE FROM messages WHERE client_id = $1`, [c.id]).catch(() => null);
    await db.query(`DELETE FROM conversations WHERE client_id = $1`, [c.id]).catch(() => null);
    await db.query(`DELETE FROM cards WHERE client_id = $1`, [c.id]).catch(() => null);
    await db.query(`DELETE FROM tasks WHERE client_id = $1`, [c.id]).catch(() => null);
    await db.query(`DELETE FROM tradelines WHERE client_id = $1`, [c.id]).catch(() => null);
    await db.query(`DELETE FROM crs_results WHERE client_id = $1`, [c.id]).catch(() => null);
    await db.query(`DELETE FROM snapshots WHERE client_id = $1`, [c.id]).catch(() => null);
    await db.query(`DELETE FROM transactions WHERE client_id = $1`, [c.id]).catch(() => null);
    try {
      await db.query(`DELETE FROM bank_accounts WHERE client_id = $1`, [c.id]);
    } catch { /* optional table */ }
    try {
      await db.query(`DELETE FROM card_liabilities WHERE client_id = $1`, [c.id]);
    } catch { /* optional */ }
    await db.query(`DELETE FROM clients WHERE id = $1 AND is_demo = true`, [c.id]);
    removed.push({ id: c.id, email: c.email });
  }
  return { removed, count: removed.length };
}
