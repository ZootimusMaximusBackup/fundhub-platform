/* Audit m8 — reading a partner's brand must be gated, not merely authenticated.
 *
 * THE DEFECT. api/partner-brand.mjs:96 called requireAuth and then went straight
 * to the SELECT:
 *
 *     const staff = await requireAuth(req, res, { db });
 *     if (!staff) return;
 *     if (req.method === "GET") { ... SELECT * FROM v_partner_brand_effective ... }
 *
 * requireAuth answers exactly one question — is this caller signed in — and
 * every staff row is signed in. That includes role='partner', which is a REAL
 * staff role seeded into the catalog by db/migrations/036_partner_role.sql so
 * that external white-label operators can reach Brand Studio. So a signed-in
 * rival partner could put any partner uuid in the query string and read that
 * partner's wordmark, six-stop colour ramp, trading name, postal address,
 * support address, custom domain and the exact list of funnels they had chosen
 * to run. Same for every internal role that has no business there — a setter, a
 * closer, an inquiry specialist.
 *
 * The PUT branch had the correct check the whole time. Only the read was open,
 * which is the usual shape of this bug: a SELECT does not read as dangerous the
 * way an INSERT does, so nobody looked at it twice.
 *
 * THE FIX. One predicate, canAccessBrand(), used by both methods: owner and
 * admin may reach any partner's brand; a partner may reach only its own; nobody
 * else may reach any. It is a role check AND an ownership check, because either
 * one alone is wrong — a role check alone locks a partner out of their own
 * brand (which is what Brand Studio is for), and an ownership check alone locks
 * out the owner/admin who set the partner up.
 *
 * WHY THIS FILE LIVES UNDER src/http/ AND NOT NEXT TO THE HANDLER.
 * package.json's test glob is "src/**" and "scripts/**". A test placed under
 * api/ is silently never collected — that trap has already bitten this repo
 * twice. Same reason src/http/dashboard-role-gate.test.mjs sits here.
 *
 * WHY THIS IS BEHAVIOURAL AND NOT A SOURCE REGEX. src/db.mjs exports `db` as a
 * plain object whose `query` is a property, and every layer under the handler —
 * requireAuth → attachStaff → authenticate → verifySession — takes that same
 * object. Swapping db.query for a stub runs the REAL handler, the REAL session
 * verifier and the REAL gate, so these assertions describe what the endpoint
 * DOES rather than what its source text says. Restored in after().
 */

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { db } from "../db.mjs";
import handler from "../../api/partner-brand.mjs";

const TOKEN = "test-session-token";

// Two partners. The rival holds MINE; the brand under test belongs to THEIRS.
const MINE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const THEIRS = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

const getReq = (partnerId) => ({
  method: "GET",
  headers: { authorization: `Bearer ${TOKEN}` },
  query: { partner_id: partnerId }
});

/* The row a leak would hand over. Every field here is commercially sensitive to
   the partner that owns it, so a failing assertion can name exactly what got
   out rather than just reporting a status code. */
const BRAND_ROW = {
  partner_id: THEIRS,
  org_id: "org-1",
  wordmark_url: "https://cdn.example.com/rival-wordmark.svg",
  ink: "#101820",
  paper: "#fffefb",
  ramp: ["#0a2540", "#123a63", "#1b5186", "#2468a9", "#2d7fcc", "#3696ef"],
  display_face: "Playfair Display",
  mono_face: "IBM Plex Mono",
  voice: "Warm, direct, never salesy.",
  entity_name: "Rival Capital Partners LLC",
  entity_address: "500 Competitor Way, Suite 900, Austin TX 78701",
  support_email: "help@rivalcapital.example",
  domain: "apply.rivalcapital.example",
  selected_funnels: ["crs-fast-track", "high-ticket-consult", "reactivation-q3"]
};

let realQuery;
let currentRole = "closer";
let brandSelects = 0;

async function stubQuery(sql) {
  const text = String(sql);
  // The session lookup — one live, active session holding `currentRole`.
  if (/FROM live JOIN staff/.test(text)) {
    return { rows: [{
      session_id: "session-1",
      expires_at: new Date(Date.now() + 3600_000),
      staff_id: "staff-1", org_id: "org-1",
      role: currentRole, email: "staff@example.com", name: "Test Staff",
      status: "active", active_flag: null
    }] };
  }
  // The brand read. Counted, so a test can assert the refusal happened BEFORE
  // the row was ever touched — a gate that fires after the query has already
  // leaked the timing difference between a partner id that exists and one that
  // does not.
  if (/v_partner_brand_effective/.test(text)) {
    brandSelects += 1;
    return { rows: [BRAND_ROW] };
  }
  return { rows: [] };
}

// Names a leak in the failure message instead of leaving a bare status code.
function assertNoBrandLeaked(body) {
  const text = JSON.stringify(body || {});
  for (const secret of [
    BRAND_ROW.entity_name, BRAND_ROW.domain, BRAND_ROW.entity_address,
    BRAND_ROW.support_email, BRAND_ROW.wordmark_url, BRAND_ROW.ink,
    ...BRAND_ROW.selected_funnels
  ]) {
    assert.ok(!text.includes(secret),
      `the refusal body still carried the partner's "${secret}"`);
  }
  assert.ok(!("brand" in (body || {})), "the refusal body still carried a brand object");
}

describe("m8: GET /api/partner-brand is gated, not just authenticated", () => {
  before(() => { realQuery = db.query; db.query = stubQuery; });
  after(() => { db.query = realQuery; });
  beforeEach(() => { brandSelects = 0; });

  test("a rival partner cannot read another partner's brand", async () => {
    currentRole = "partner";
    const r = res();
    await handler(getReq(THEIRS), r);

    assert.equal(r.code, 403,
      "a signed-in role='partner' — an external white-label operator — read " +
      "another partner's brand. Body was: " + JSON.stringify(r.body));
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "forbidden");
    assertNoBrandLeaked(r.body);
    assert.equal(brandSelects, 0,
      "the refusal came AFTER the row was fetched; the gate must run first");
  });

  test("internal roles with no business here are refused too", async () => {
    for (const role of ["closer", "setter", "funding_advisor", "inquiry_specialist"]) {
      currentRole = role;
      const r = res();
      await handler(getReq(THEIRS), r);
      assert.equal(r.code, 403,
        `role='${role}' read a white-label partner's brand. Body was: ` +
        JSON.stringify(r.body));
      assertNoBrandLeaked(r.body);
    }
  });

  test("a role nobody has heard of is refused, not admitted by default", async () => {
    for (const role of ["intern", "", null, "PARTNER_ADMIN"]) {
      currentRole = role;
      const r = res();
      await handler(getReq(THEIRS), r);
      assert.equal(r.code, 403,
        `role=${JSON.stringify(role)} defaulted to allowed. Body was: ` +
        JSON.stringify(r.body));
      assertNoBrandLeaked(r.body);
    }
  });

  test("owner and admin still read any partner's brand — this closes a door, it does not brick the screen", async () => {
    for (const role of ["owner", "admin", "Owner", "  ADMIN  "]) {
      currentRole = role;
      const r = res();
      await handler(getReq(THEIRS), r);
      assert.equal(r.code, 200,
        `role=${JSON.stringify(role)} was locked out of Brand Studio. Body was: ` +
        JSON.stringify(r.body));
      assert.equal(r.body.ok, true);
      assert.equal(r.body.brand.entity_name, BRAND_ROW.entity_name);
      assert.equal(r.body.brand.partner_id, THEIRS);
    }
  });

  /* The ownership arm. staff.partner_id does not exist on a session yet
     (src/auth/session.mjs selects id, org_id, role, email, name, status), so
     this is asserted against the predicate's input rather than a real login.
     It is here so that when Unit 12 lands partner sessions, the rule it must
     satisfy is already written down and running. */
  test("a partner reading its OWN brand is allowed once sessions carry partner_id", async () => {
    currentRole = "partner";
    const r = res();
    const req = getReq(MINE);
    // Stand in for what a Unit 12 partner session will attach. requireAuth
    // overwrites req.staff from the session, so the handler's own `staff`
    // binding is what matters — patch the session row instead.
    const withPartner = async (sql) => {
      const out = await stubQuery(sql);
      if (/FROM live JOIN staff/.test(String(sql))) out.rows[0].partner_id = MINE;
      return out;
    };
    const saved = db.query;
    db.query = withPartner;
    try {
      await handler(req, r);
    } finally {
      db.query = saved;
    }
    /* Today this is a 403: verifySession does not select partner_id, so the
       value set above never reaches the staff object the handler holds. The
       assertion records the CURRENT truth and names the future one, rather than
       pretending a capability exists. When session.mjs starts carrying
       partner_id this flips to 200 and the message below says why. */
    assert.equal(r.code, 403,
      "a partner session now carries partner_id — src/auth/session.mjs must be " +
      "selecting it. That is Unit 12 landing, and this expectation should flip " +
      "to 200 with r.body.brand.partner_id === MINE.");
  });

  test("a malformed or missing partner_id is still the caller's 400, not a 403 or a 500", async () => {
    currentRole = "owner";
    const bad = res();
    await handler(getReq("not-a-uuid"), bad);
    assert.equal(bad.code, 400);
    assert.equal(bad.body.error, "invalid_partner_id");

    const missing = res();
    await handler({ method: "GET", headers: { authorization: `Bearer ${TOKEN}` }, query: {} }, missing);
    assert.equal(missing.code, 400);
    assert.equal(missing.body.error, "partner_id_required");
  });

  test("the write path is unchanged — the same roles are refused a PUT", async () => {
    for (const role of ["partner", "closer", "setter", "intern"]) {
      currentRole = role;
      const r = res();
      await handler({
        method: "PUT",
        headers: { authorization: `Bearer ${TOKEN}` },
        body: { partner_id: THEIRS, ink: "#000000" }
      }, r);
      assert.equal(r.code, 403,
        `role='${role}' can now WRITE a partner brand. The read gate must not ` +
        `have widened the write. Body was: ` + JSON.stringify(r.body));
    }
    currentRole = "owner";
    const ok = res();
    await handler({
      method: "PUT",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: { partner_id: THEIRS, ink: "#000000" }
    }, ok);
    assert.notEqual(ok.code, 403, "owner lost write access: " + JSON.stringify(ok.body));
  });

  test("an unauthenticated read is still 401, and says nothing about the partner", async () => {
    const r = res();
    await handler({ method: "GET", headers: {}, query: { partner_id: THEIRS } }, r);
    assert.equal(r.code, 401);
    assertNoBrandLeaked(r.body);
    assert.equal(brandSelects, 0);
  });
});
