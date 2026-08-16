#!/usr/bin/env node
/** Re-run a live CRS pull for the prove client. Prints scores / error codes only. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT_ID = "9af65808-a619-4e65-ae91-239766a006b7";

function loadEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] == null) process.env[k] = v;
  }
}

async function main() {
  loadEnv();
  process.env.CRS_API_HOST = process.env.CRS_LIVE_API_HOST || process.env.CRS_API_HOST;
  process.env.CRS_API_USERNAME = process.env.CRS_LIVE_API_USERNAME || process.env.CRS_API_USERNAME;
  process.env.CRS_API_PASSWORD = process.env.CRS_LIVE_API_PASSWORD || process.env.CRS_API_PASSWORD;
  process.env.CRS_ALLOW_LIVE = "1";
  process.env.ADAPTERS_DRY_RUN = "0";

  const { db, close } = await import("../src/db.mjs");
  const { requestSoftPull } = await import("../src/finance/soft-pulls.mjs");
  const { runCrsPull, CRS_PROVIDER, DIAGNOSTIC_PULL_REASON } = await import("../src/finance/crs-pull.mjs");
  const { clientAccountId } = await import("../src/workflows/c-00-crs-soft-pull-request.mjs");
  const { isoBirthDate } = await import("../src/finance/crs-identities.mjs");

  const identity = (await db.query(
    `SELECT p.dob FROM pii_identity p WHERE p.client_id = $1`,
    [CLIENT_ID]
  )).rows[0];
  const dobOk = !!isoBirthDate(identity?.dob);
  if (!dobOk) {
    console.log(JSON.stringify({ ok: false, reason: "dob_not_iso" }));
    await close();
    process.exit(1);
  }

  const consent = (await db.query(
    `SELECT 1 FROM client_consents
      WHERE client_id = $1 AND kind = 'soft_pull_consent' AND revoked_at IS NULL
      LIMIT 1`,
    [CLIENT_ID]
  )).rows[0];
  if (!consent) {
    console.log(JSON.stringify({ ok: false, reason: "no_consent" }));
    await close();
    process.exit(1);
  }

  const staff = (await db.query(
    `SELECT id FROM staff WHERE org_id = $1 ORDER BY created_at LIMIT 1`,
    [ORG]
  )).rows[0];
  const accountId = await clientAccountId(db, CLIENT_ID);
  if (!accountId) {
    console.log(JSON.stringify({ ok: false, reason: "no_account" }));
    await close();
    process.exit(1);
  }

  const requested = await requestSoftPull(db, {
    orgId: ORG,
    clientId: CLIENT_ID,
    requestedBy: { kind: "staff", id: staff?.id || accountId },
    reason: DIAGNOSTIC_PULL_REASON,
    costCents: null,
    provider: CRS_PROVIDER,
    idempotencyKey: `repull-prove-crs:${Date.now()}`
  });
  if (!requested.created || !requested.request?.id) {
    console.log(JSON.stringify({
      ok: false,
      reason: requested.reason || "not_created"
    }));
    await close();
    process.exit(1);
  }

  const pull = await runCrsPull(db, {
    orgId: ORG,
    clientId: CLIENT_ID,
    requestId: requested.request.id,
    env: process.env
  });

  const result = pull?.result || {};
  const bday = result?.bureaus?.EQ?.requestData?.birthDate
    || result?.bureaus?.EX?.requestData?.birthDate
    || "";
  console.log(JSON.stringify({
    ok: pull?.ok === true,
    code: pull?.code || null,
    reason: pull?.reason || null,
    environment: result.environment || null,
    scores: result.scores || null,
    bureauErrors: result.bureauErrors || {},
    birth_is_iso: /^\d{4}-\d{2}-\d{2}$/.test(String(bday)),
    crs_result_id: pull?.crsResultId || null
  }, null, 2));

  await close();
  process.exit(pull?.ok === true ? 0 : 1);
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
