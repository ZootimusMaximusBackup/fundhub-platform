/* Who may open the Banking Surface (audit M9).
 *
 * THE DEFECT. The Banking Surface reads `bank_accounts` — balances belonging to
 * a named real person, sourced from a bank connection. Bank connections are NOT
 * approved in this product: src/banking/plaid.mjs is two empty seams behind an
 * open SOC 2 review of storing bank credentials and a consent-capture flow that
 * compliance has not signed off (docs/workflows/finish-the-build/W5.md). The
 * endpoint nevertheless admitted ROLE_SETS.STAFF — every employee role, closer
 * and setter included — and public/app/shell.js handed the screen to the same
 * set. So the day somebody sets the three PLAID_* variables for one test client,
 * that client's real balances land on every staff desk in the company with no
 * second decision by a human.
 *
 * THE RULE UNDER TEST. Until bank connections are approved, the Banking Surface
 * endpoint is owner/admin only — ROLE_SETS.FINANCE, the set this repo already
 * uses for "money and people". Configuring Plaid is not an approval, and it
 * must not widen the audience by itself.
 *
 * THE SCREEN THIS ENDPOINT USED TO SERVE IS GONE. banking-surface.html was one
 * of eleven Finance screens Finance OS (finance-os.html) absorbed — an owner
 * decision, not a regression. This endpoint stays routed and gated exactly as
 * it was; nothing currently on the shared staff surface calls it any more, but
 * its own role gate is still worth guarding on its own.
 *
 * WHY IT IS TESTED HERE. package.json's test glob only walks src/ and scripts/
 * (CLAUDE.md, traps). This file needs no database: src/db.mjs exports `db` as a
 * plain object with one `query` method, so the session lookup and the account
 * read are both stubbed and the handler runs exactly as it does in production.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import handler from "../../api/read/banking-surface.mjs";

const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";

/* Roles that exist in the staff catalog but are not owner/admin. These are the
   ones that used to reach a client's bank balances. */
const OTHER_STAFF = ["funding_advisor", "closer", "inquiry_specialist", "setter"];

/* ── the endpoint ─────────────────────────────────────────────────────────── */

/** Plaid fully and correctly configured — the state that makes the existing
    isPlaidEnabled() gate open. The key is 32 bytes of base64 so it is well
    formed; it is a test constant and unlocks nothing. */
const PLAID_ENV = {
  PLAID_CLIENT_ID: "test-client-id",
  PLAID_SECRET: "test-secret",
  PLAID_TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
  PLAID_ENV: "sandbox"
};

const PLAID_KEYS = ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_TOKEN_ENC_KEY", "PLAID_ENV"];

let savedEnv = {};
let savedQuery = null;

function setPlaid(on) {
  for (const k of PLAID_KEYS) {
    if (on) process.env[k] = PLAID_ENV[k];
    else delete process.env[k];
  }
}

beforeEach(() => {
  savedEnv = {};
  for (const k of PLAID_KEYS) savedEnv[k] = process.env[k];
  savedQuery = db.query;
});

afterEach(() => {
  for (const k of PLAID_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  db.query = savedQuery;
});

/**
 * callAs(role) — run the real handler with a session for `role`.
 *
 * db.query is replaced for the duration: the first shape is the session lookup
 * inside verifySession(), the second is this endpoint's own SELECT. Returns the
 * status, the body, and — the point of the whole exercise — whether the read of
 * bank_accounts was reached at all.
 */
async function callAs(role) {
  let readReached = false;
  db.query = async (sql) => {
    if (/FROM bank_accounts/i.test(sql)) {
      readReached = true;
      return { rows: [] };
    }
    // verifySession's CTE. One live session for a staff member with this role.
    return {
      rows: [{
        session_id: "sess-1",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        staff_id: "staff-1",
        org_id: "org-1",
        role,
        email: `${role}@fundhub.ai`,
        name: role,
        status: "active",
        active_flag: "true"
      }]
    };
  };

  const res = {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };

  await handler(
    { method: "GET", headers: { authorization: "Bearer session-token" }, query: { client_id: CID } },
    res
  );

  return { status: res.statusCode, body: res.body, readReached };
}

describe("GET /api/read/banking-surface — bank balances are not on every staff desk", () => {

  for (const role of OTHER_STAFF) {
    test(`a ${role} is refused, even with Plaid fully configured`, async () => {
      setPlaid(true);
      const r = await callAs(role);
      assert.equal(r.status, 403,
        `${role} got ${r.status} from the banking surface — bank connections are not approved, ` +
        `so this screen is owner/admin only until a human signs off`);
      assert.equal(r.readReached, false,
        `${role} was refused but bank_accounts was queried anyway`);
    });
  }

  test("an owner still gets the data when Plaid is configured", async () => {
    setPlaid(true);
    const r = await callAs("owner");
    assert.equal(r.status, 200, "narrowing the gate must not lock out the roles that own this");
    assert.equal(r.readReached, true);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.source, "bank_accounts");
  });

  test("an admin still gets the data when Plaid is configured", async () => {
    setPlaid(true);
    const r = await callAs("admin");
    assert.equal(r.status, 200);
    assert.equal(r.readReached, true);
  });

  test("with Plaid unconfigured even an owner is refused", async () => {
    // The gate that already exists, kept: configuration is the first condition,
    // role is the second, and neither one alone opens the screen.
    setPlaid(false);
    const r = await callAs("owner");
    assert.equal(r.status, 403);
    assert.equal(r.readReached, false);
    assert.match(String(r.body.error), /plaid/i);
  });
});

/* ── the shell ────────────────────────────────────────────────────────────── */
//
// banking-surface.html itself is gone — Finance OS (finance-os.html) absorbed
// it along with ten other Finance screens, an owner decision, not a
// regression. The shell-level describe block that used to live here asserted
// public/app/shell.js sent non-owner/admin roles home from that screen; there
// is no longer a screen to be sent home from. What is still real and still
// worth guarding is the endpoint gate above, which src/http/*-endpoints tests
// and src/http/app-nav-reachability.test.mjs (sidebar consistency) now cover
// between them.
