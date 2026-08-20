// Short-lived production-safe fixtures for the live launch-proof browser walk.
//
// Every row is named E2E TEST FIXTURE and carries a fixed marker. Cleanup
// refuses to touch a row when the marker does not match. The commission rule is
// inactive, so it can be read on the screen but can never calculate a payout.

import { fileURLToPath } from "node:url";
import pg from "pg";

import "./load-env.mjs";
import { hashPassword } from "../src/auth/hash.mjs";

export const FIXTURE_MARKER = "fundhub-launch-proof-2026-08-20";
export const CLIENT_EMAIL = "e2e+aff-launch-proof-client@fundhub.ai";
export const CLIENT_NAME = "E2E LAUNCH PROOF TEST FIXTURE";
export const RULE_NAME = "E2E LAUNCH PROOF — READ ONLY TIER FIXTURE";

export const FIXTURE_IDS = Object.freeze({
  client: "8e2e2000-0000-4000-8000-000000000001",
  account: "8e2e2000-0000-4000-8000-000000000002",
  card: "8e2e2000-0000-4000-8000-000000000003",
  rule: "8e2e2000-0000-4000-8000-000000000004",
  tier: "8e2e2000-0000-4000-8000-000000000005"
});

function connectionString(value) {
  const dsn = value || process.env.DATABASE_URL;
  if (!dsn) throw new Error("DATABASE_URL is required");
  return dsn;
}

function fixturePassword(value) {
  const password = value
    || process.env.LAUNCH_PROOF_CLIENT_PASSWORD
    || process.env.STAFF_E2E_PASSWORD
    || process.env.STAFF_INITIAL_PASSWORD;
  if (!password) {
    throw new Error(
      "LAUNCH_PROOF_CLIENT_PASSWORD, STAFF_E2E_PASSWORD, or STAFF_INITIAL_PASSWORD is required"
    );
  }
  return password;
}

function requireFixtureSwitch() {
  if (process.env.LAUNCH_PROOF_FIXTURES !== "1") {
    throw new Error("Set LAUNCH_PROOF_FIXTURES=1 to manage launch-proof fixtures");
  }
}

async function connect(value) {
  const client = new pg.Client({ connectionString: connectionString(value) });
  await client.connect();
  return client;
}

async function assertSafeRows(db) {
  const clients = await db.query(
    `SELECT id, lower(email) AS email, client_master_key,
            custom_fields->>'launch_proof_fixture' AS marker
       FROM clients
      WHERE id = $1
         OR lower(email) = $2
         OR client_master_key = $3`,
    [FIXTURE_IDS.client, CLIENT_EMAIL, FIXTURE_MARKER]
  );
  for (const row of clients.rows) {
    if (
      row.id !== FIXTURE_IDS.client
      || row.email !== CLIENT_EMAIL
      || row.client_master_key !== FIXTURE_MARKER
      || row.marker !== FIXTURE_MARKER
    ) {
      throw new Error("Refusing to touch a client row that is not the marked launch-proof fixture");
    }
  }

  const accounts = await db.query(
    `SELECT id, client_id, lower(email) AS email, name
       FROM accounts
      WHERE id = $1 OR lower(email) = $2`,
    [FIXTURE_IDS.account, CLIENT_EMAIL]
  );
  for (const row of accounts.rows) {
    if (
      row.id !== FIXTURE_IDS.account
      || row.client_id !== FIXTURE_IDS.client
      || row.email !== CLIENT_EMAIL
      || row.name !== CLIENT_NAME
    ) {
      throw new Error("Refusing to touch an account row that is not the marked launch-proof fixture");
    }
  }

  const cards = await db.query(
    `SELECT id, client_id FROM cards WHERE id = $1 OR client_id = $2`,
    [FIXTURE_IDS.card, FIXTURE_IDS.client]
  );
  for (const row of cards.rows) {
    if (row.id !== FIXTURE_IDS.card || row.client_id !== FIXTURE_IDS.client) {
      throw new Error("Refusing to touch a Pipeline card that is not the marked launch-proof fixture");
    }
  }

  const rules = await db.query(
    `SELECT id, name, notes, active
       FROM commission_rules
      WHERE id = $1 OR name = $2`,
    [FIXTURE_IDS.rule, RULE_NAME]
  );
  for (const row of rules.rows) {
    if (
      row.id !== FIXTURE_IDS.rule
      || row.name !== RULE_NAME
      || row.notes !== FIXTURE_MARKER
      || row.active !== false
    ) {
      throw new Error("Refusing to touch a commission rule that is not the inactive fixture");
    }
  }

  const tiers = await db.query(
    `SELECT id, rule_id FROM commission_rule_tiers WHERE id = $1 OR rule_id = $2`,
    [FIXTURE_IDS.tier, FIXTURE_IDS.rule]
  );
  for (const row of tiers.rows) {
    if (row.id !== FIXTURE_IDS.tier || row.rule_id !== FIXTURE_IDS.rule) {
      throw new Error("Refusing to touch a commission tier that is not the marked fixture");
    }
  }

  return {
    clientExists: clients.rows.length === 1,
    accountExists: accounts.rows.length === 1,
    cardExists: cards.rows.length === 1,
    ruleExists: rules.rows.length === 1,
    tierExists: tiers.rows.length === 1
  };
}

async function deleteMarkedRows(db) {
  const safe = await assertSafeRows(db);

  if (safe.accountExists) {
    await db.query(`DELETE FROM account_sessions WHERE account_id = $1`, [FIXTURE_IDS.account]);
  }
  await db.query(
    `DELETE FROM account_magic_links
      WHERE lower(email) = $1
        AND (client_id = $2 OR account_id = $3)`,
    [CLIENT_EMAIL, FIXTURE_IDS.client, FIXTURE_IDS.account]
  );
  await db.query(`DELETE FROM auth_attempts WHERE lower(email) = $1`, [CLIENT_EMAIL]);
  await db.query(
    `DELETE FROM accounts
      WHERE id = $1 AND client_id = $2 AND lower(email) = $3 AND name = $4`,
    [FIXTURE_IDS.account, FIXTURE_IDS.client, CLIENT_EMAIL, CLIENT_NAME]
  );
  await db.query(
    `DELETE FROM cards WHERE id = $1 AND client_id = $2`,
    [FIXTURE_IDS.card, FIXTURE_IDS.client]
  );
  await db.query(
    `DELETE FROM commission_rule_tiers WHERE id = $1 AND rule_id = $2`,
    [FIXTURE_IDS.tier, FIXTURE_IDS.rule]
  );
  await db.query(
    `DELETE FROM commission_rules
      WHERE id = $1 AND name = $2 AND notes = $3 AND active = false`,
    [FIXTURE_IDS.rule, RULE_NAME, FIXTURE_MARKER]
  );
  await db.query(
    `DELETE FROM clients
      WHERE id = $1
        AND lower(email) = $2
        AND client_master_key = $3
        AND custom_fields->>'launch_proof_fixture' = $3`,
    [FIXTURE_IDS.client, CLIENT_EMAIL, FIXTURE_MARKER]
  );

  return safe;
}

export async function setupLaunchProofFixtures({
  databaseUrl,
  password
} = {}) {
  requireFixtureSwitch();
  const db = await connect(databaseUrl);
  try {
    await db.query("BEGIN");
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [FIXTURE_MARKER]);
    const existing = await assertSafeRows(db);
    if (Object.values(existing).some(Boolean)) {
      throw new Error(
        "Marked launch-proof fixtures already exist; run the cleanup command before starting a new proof"
      );
    }

    const org = await db.query(`SELECT id FROM orgs WHERE slug = 'fundhub' LIMIT 1`);
    if (org.rows.length !== 1) throw new Error("Fundhub org was not found");
    const orgId = org.rows[0].id;

    const pipeline = await db.query(
      `SELECT p.id AS pipeline_id, s.id AS stage_id
         FROM pipelines p
         JOIN pipeline_stages s ON s.pipeline_id = p.id AND s.org_id = p.org_id
        WHERE p.org_id = $1 AND p.key = 'sales'
        ORDER BY s.sort_order ASC, s.name ASC
        LIMIT 1`,
      [orgId]
    );
    if (pipeline.rows.length !== 1) throw new Error("Sales Pipeline and its first stage are required");

    const passwordHash = await hashPassword(fixturePassword(password));
    await db.query(
      `INSERT INTO clients (
         id, org_id, client_master_key, first_name, last_name, email,
         custom_fields, funded, outcome_tier, tags, is_demo
       ) VALUES (
         $1, $2, $3, 'E2E LAUNCH PROOF', 'TEST FIXTURE', $4,
         $5::jsonb, false, 'MANUAL_REVIEW', ARRAY['e2e','launch-proof'], false
       )`,
      [
        FIXTURE_IDS.client,
        orgId,
        FIXTURE_MARKER,
        CLIENT_EMAIL,
        JSON.stringify({
          launch_proof_fixture: FIXTURE_MARKER,
          total_funding_estimate: "25000",
          cf_svy_self_reported_fico: "700-719",
          cf_svy_funding_target_amount: "$25,000",
          cf_svy_planned_use: "E2E browser proof only"
        })
      ]
    );
    await db.query(
      `INSERT INTO accounts (
         id, org_id, kind, email, name, password_hash, status, client_id, activated_at
       ) VALUES ($1, $2, 'client', $3, $4, $5, 'active', $6, now())`,
      [
        FIXTURE_IDS.account,
        orgId,
        CLIENT_EMAIL,
        CLIENT_NAME,
        passwordHash,
        FIXTURE_IDS.client
      ]
    );
    await db.query(
      `INSERT INTO cards (
         id, org_id, client_id, pipeline_id, stage_id, owner, entered_at
       ) VALUES ($1, $2, $3, $4, $5, 'E2E TEST FIXTURE', now())`,
      [
        FIXTURE_IDS.card,
        orgId,
        FIXTURE_IDS.client,
        pipeline.rows[0].pipeline_id,
        pipeline.rows[0].stage_id
      ]
    );
    await db.query(
      `INSERT INTO commission_rules (
         id, org_id, name, description, basis, stacking, role, calc_method,
         tier_mode, amount_basis, effective_from, active, notes
       ) VALUES (
         $1, $2, $3, 'Inactive browser proof fixture; never used for payouts.',
         'front_end', 'bonus', 'closer', 'tiered', 'marginal',
         'deposit_collected', '2026-01-01T00:00:00Z', false, $4
       )`,
      [FIXTURE_IDS.rule, orgId, RULE_NAME, FIXTURE_MARKER]
    );
    await db.query(
      `INSERT INTO commission_rule_tiers (
         id, org_id, rule_id, min_amount, max_amount, percent, sort_order, notes
       ) VALUES ($1, $2, $3, 0, NULL, 1.25, 1, $4)`,
      [FIXTURE_IDS.tier, orgId, FIXTURE_IDS.rule, FIXTURE_MARKER]
    );

    await db.query("COMMIT");
    return {
      clientId: FIXTURE_IDS.client,
      email: CLIENT_EMAIL,
      cardId: FIXTURE_IDS.card,
      ruleId: FIXTURE_IDS.rule
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}

export async function cleanupLaunchProofFixtures({ databaseUrl } = {}) {
  requireFixtureSwitch();
  const db = await connect(databaseUrl);
  try {
    await db.query("BEGIN");
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [FIXTURE_MARKER]);
    const removed = await deleteMarkedRows(db);
    await db.query("COMMIT");
    return removed;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}

async function main() {
  const action = process.argv[2];
  if (action === "setup") {
    const result = await setupLaunchProofFixtures();
    console.log(
      `launch-proof fixtures ready: client ${result.clientId}, card ${result.cardId}, rule ${result.ruleId}`
    );
    return;
  }
  if (action === "cleanup") {
    await cleanupLaunchProofFixtures();
    console.log("launch-proof fixtures cleaned");
    return;
  }
  throw new Error("Usage: node scripts/launch-proof-fixtures.mjs setup|cleanup");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`launch-proof fixtures failed: ${error.message}`);
    process.exitCode = 1;
  });
}
