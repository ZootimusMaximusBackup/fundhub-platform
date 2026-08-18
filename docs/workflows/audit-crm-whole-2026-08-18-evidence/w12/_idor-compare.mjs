#!/usr/bin/env node
// Compare own vs other-id portal bodies. Status + hashes only. Never print bodies/tokens.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import { createAccountSession, revokeAccountSession } from "../../../../src/auth/account-session.mjs";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const OUT = path.join(ROOT, "docs/workflows/audit-crm-whole-2026-08-18-evidence/w12");
const BASE = "https://fundhub.ai";
const TEST_CLIENT = "8556bedc-46e1-4d85-b0cd-a24adfee1521";
const TEST_ACCOUNT = "55d85886-0ca8-4e1e-825a-f9b218ed12c2";
const FORBIDDEN_PREFIX = "9af65808";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim().replace(/^export\s+/, "");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

const probe = JSON.parse(fs.readFileSync(path.join(OUT, "probe.json"), "utf8"));
const otherPrefix = probe.idor?.otherIdPrefix;
if (!otherPrefix || otherPrefix.startsWith(FORBIDDEN_PREFIX)) throw new Error("bad other prefix");

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const e2e = await c.query(
  `SELECT id::text AS id FROM clients WHERE email ILIKE 'e2e+%' AND id::text NOT LIKE $1 AND id::text <> $2 LIMIT 1`,
  [FORBIDDEN_PREFIX + "%", TEST_CLIENT]
);
const otherId = e2e.rows[0]?.id;
if (!otherId || otherId.startsWith(FORBIDDEN_PREFIX)) {
  await c.end();
  throw new Error("no second e2e client");
}
const acct = (await c.query(`SELECT id, org_id, kind, client_id FROM accounts WHERE id=$1`, [TEST_ACCOUNT])).rows[0];
const session = await createAccountSession(c, { accountId: acct.id, orgId: acct.org_id, userAgent: "w12-idor-compare" });
const token = session.token;

async function grab(route) {
  const res = await fetch(BASE + route, { headers: { authorization: "Bearer " + token, accept: "application/json" } });
  const text = await res.text();
  const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
  return {
    status: res.status,
    bytes: text.length,
    hash,
    containsOwnId: text.includes(TEST_CLIENT),
    containsOtherId: text.includes(otherId),
    containsForbidden: text.includes(FORBIDDEN_PREFIX)
  };
}

const names = [
  ["portal-summary", "/api/read/portal-summary?client_id="],
  ["portal-contracts", "/api/read/portal-contracts?client_id="],
  ["entitlements", "/api/read/entitlements?client_id="],
  ["consent", "/api/consent/capture?client_id="]
];
const rows = [];
for (const [name, prefix] of names) {
  const own = await grab(prefix + TEST_CLIENT);
  const other = await grab(prefix + otherId);
  rows.push({
    name,
    ownStatus: own.status,
    otherStatus: other.status,
    sameHash: own.hash === other.hash,
    sameBytes: own.bytes === other.bytes,
    ownContainsOwnId: own.containsOwnId,
    ownContainsOtherId: own.containsOtherId,
    otherContainsOwnId: other.containsOwnId,
    otherContainsOtherId: other.containsOtherId,
    leakedForbidden: own.containsForbidden || other.containsForbidden
  });
}

await revokeAccountSession(c, token);
await c.end();

const out = { ranAt: new Date().toISOString(), otherIdPrefix: otherId.slice(0, 8), rows };
fs.writeFileSync(path.join(OUT, "idor-compare.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
