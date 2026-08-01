// Endpoint tests for /api/consent/capture — the capture flow, with a stubbed
// database and NO DATABASE_URL.
//
// WHY THIS IS A .test.mjs AND NOT A .pg.test.mjs. CLAUDE.md §12 records that
// with DATABASE_URL unset the ~193 *.pg.test.mjs tests skip and the suite still
// reports zero failures — so a rule that only has a pg test is a rule that is
// unproven on most runs. The claims below are the ones that must hold on EVERY
// pass, because each of them is a way the gate could be opened by accident:
//
//   * org scoping comes from the session and a body/query org is ignored;
//   * a client principal can only ever act on themself;
//   * the role gate is a real second call and refuses roles outside the set;
//   * the consent WORDS are never taken from the request body.
//
// HOW THE DATABASE IS STUBBED. src/db.mjs exports `db` as a plain object
// `{ query }`, and every handler imports that same object, so replacing its
// `query` property swaps the database for the whole import graph — no module
// mocking, no flags, no DATABASE_URL. The stub is a router over the SQL text: it
// answers the session lookup that requireAuth performs and then whatever the
// handler asks next, recording everything for assertions. pool() is never
// reached, so nothing tries to connect.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import handler from "../../api/consent/capture.mjs";
import { CURRENT_SOFT_PULL_VERSION, SOFT_PULL_DISCLOSURES } from "../consent/disclosures.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const OTHER_CLIENT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const STAFF = "33333333-3333-3333-3333-333333333333";
const CONSENT_ID = "66666666-6666-6666-6666-666666666666";

const realQuery = db.query;
let calls = [];

/* stubDb — route by SQL text. `session` describes who the caller is; null means
   no valid session at all. Anything the handler asks beyond the session lookup
   is answered from `answers`, a list of [pattern, result] pairs consulted in
   order, defaulting to an empty result set. */
function stubDb({ session = null, answers = [] } = {}) {
  calls = [];
  db.query = async (text, params) => {
    calls.push({ text, params });

    // requireAuth → authenticate → verifySession
    if (/FROM live JOIN staff s/i.test(text)) {
      if (!session) return { rows: [] };
      /* `in` and not `??`. A test that sets role:null or orgId:null is testing
         exactly the null — and `null ?? "closer"` would quietly hand the handler
         a valid closer session instead, so the assertion would pass against a
         case that never ran. That is how a stub hides the bug it was written to
         find, and it did here before this was fixed. */
      const pick = (key, fallback) => (key in session ? session[key] : fallback);
      return { rows: [{
        session_id: "sess-1", expires_at: new Date(Date.now() + 3_600_000),
        staff_id: pick("staffId", STAFF), org_id: pick("orgId", ORG),
        role: pick("role", "closer"), email: "e@example.com",
        name: "A Staffer", status: pick("status", "active"), active_flag: "true"
      }] };
    }
    for (const [pattern, result] of answers) {
      if (pattern.test(text)) return typeof result === "function" ? result(params) : result;
    }
    return { rows: [] };
  };
}

beforeEach(() => { calls = []; });
afterEach(() => { db.query = realQuery; });

/* A minimal res double. Records status and body rather than writing anything. */
function mkRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }
  };
  return res;
}

const mkReq = (over = {}) => ({
  method: "GET",
  headers: { authorization: "Bearer tok" },
  query: {},
  body: {},
  ...over
});

const consentRow = (over = {}) => ({
  id: CONSENT_ID, org_id: ORG, client_id: CLIENT, kind: "soft_pull_consent",
  consent_text: SOFT_PULL_DISCLOSURES[CURRENT_SOFT_PULL_VERSION].text,
  consent_version: CURRENT_SOFT_PULL_VERSION,
  granted_by_kind: "staff", granted_by_account_id: null, granted_by_staff_id: STAFF,
  capture_method: "typed", granted_name: "Dana Client",
  captured_ip: null, captured_user_agent: null, document_id: null,
  granted_at: new Date(Date.now() - 60_000), expires_at: null,
  revoked_at: null, revoked_reason: null, revoked_by_kind: null,
  revoked_by_account_id: null, revoked_by_staff_id: null,
  created_at: new Date(), updated_at: new Date(), is_valid: true,
  ...over
});

const INSERT = /INSERT INTO client_consents/i;
const SELECT = /FROM client_consents/i;
const UPDATE = /UPDATE client_consents/i;

// ── DATABASE_URL really is unset ───────────────────────────────────────────

test("this file never reaches a real database, whatever DATABASE_URL says", async () => {
  /* The claim is that these rules are proven on EVERY pass, including the
     passes with no database — so the suite must neither need DATABASE_URL nor
     be affected by it.
   *
   * Asserting `DATABASE_URL === undefined` was the first version of this test
   * and it was wrong: CLAUDE.md §12 tells you to verify the suite WITH a real
   * Postgres, and under that instruction this test failed while everything it
   * was guarding still worked. A guard that fires on the recommended workflow
   * trains people to ignore it.
   *
   * So it proves the real property instead. DATABASE_URL is pointed at an
   * address nothing is listening on for the duration of one request. If any
   * code path reached the actual pool rather than the stub, it would fail to
   * connect and this would not return 200. */
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/nonexistent";
  try {
    stubDb({ session: { role: "closer" }, answers: [[SELECT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({ query: { client_id: CLIENT } }), res);
    assert.equal(res.statusCode, 200,
      "the handler reached something other than the stub — this suite has grown a real database dependency");
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    db.query = realQuery;
  }
});

// ── authentication ─────────────────────────────────────────────────────────

describe("who may reach the endpoint", () => {
  test("no session is a 401 and touches no consent table", async () => {
    stubDb({ session: null });
    const res = mkRes();
    await handler(mkReq({ headers: {} }), res);
    assert.equal(res.statusCode, 401);
    assert.ok(!calls.some((c) => SELECT.test(c.text)));
  });

  test("an invalid token is a 401", async () => {
    stubDb({ session: null });
    const res = mkRes();
    await handler(mkReq(), res);
    assert.equal(res.statusCode, 401);
  });

  test("a method other than GET or POST is a 405 with an allow header", async () => {
    stubDb({ session: { role: "closer" } });
    const res = mkRes();
    await handler(mkReq({ method: "DELETE" }), res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "GET, POST");
  });
});

// ── the role gate is a real second call ────────────────────────────────────

describe("the role gate", () => {
  for (const role of ["setter", "inquiry_specialist", "partner", "recruiter", "", null]) {
    test(`a ${JSON.stringify(role)} staff session is refused with 403 and writes nothing`, async () => {
      // These roles pass requireAuth — they are valid sessions. The gate that
      // stops them is the SECOND call, which is the one api/read/tradelines.mjs
      // was missing when it passed { roles } to requireAuth and had it dropped.
      stubDb({ session: { role } });
      const res = mkRes();
      await handler(mkReq({
        method: "POST",
        body: { client_id: CLIENT, capture_method: "checkbox" }
      }), res);

      assert.equal(res.statusCode, 403, `role ${JSON.stringify(role)} got past the gate`);
      assert.ok(!calls.some((c) => INSERT.test(c.text)),
        `role ${JSON.stringify(role)} recorded a consent`);
    });
  }

  for (const role of ["owner", "admin", "closer", "funding_advisor"]) {
    test(`a ${role} may capture`, async () => {
      stubDb({ session: { role }, answers: [[INSERT, { rows: [consentRow()] }]] });
      const res = mkRes();
      await handler(mkReq({
        method: "POST",
        body: { client_id: CLIENT, capture_method: "typed", granted_name: "Dana Client" }
      }), res);
      assert.equal(res.statusCode, 200, `${role} was refused: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.ok, true);
    });
  }

  test("the capture role set matches the soft-pull role set exactly", async () => {
    // A wider set here would be a way around the narrower one on the pull
    // endpoint, because a consent is the thing that unlocks the pull.
    const fs = await import("node:fs");
    const url = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const read = (p) => fs.readFileSync(path.resolve(here, p), "utf8");
    const setOf = (src, name) => {
      const m = new RegExp(`${name}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]`).exec(src);
      return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean).sort();
    };
    assert.deepEqual(
      setOf(read("../../api/consent/capture.mjs"), "CONSENT_ROLES"),
      setOf(read("../../api/finance/soft-pull.mjs"), "SOFT_PULL_ROLES"),
      "the consent and soft-pull role sets have drifted apart — one is now a way around the other"
    );
  });
});

// ── org scoping comes from the session ─────────────────────────────────────

describe("org scoping", () => {
  test("the org in the query string is ignored — the session's org is used", async () => {
    stubDb({ session: { orgId: ORG, role: "closer" }, answers: [[SELECT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({ query: { client_id: CLIENT, org_id: OTHER_ORG } }), res);

    assert.equal(res.statusCode, 200);
    const read = calls.find((c) => SELECT.test(c.text));
    assert.equal(read.params[0], ORG, "the query-string org reached the database");
    assert.ok(!read.params.includes(OTHER_ORG), "the caller's org appeared in the query");
  });

  test("the org in the POST body is ignored — the session's org is used", async () => {
    stubDb({ session: { orgId: ORG, role: "closer" }, answers: [[INSERT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: { client_id: CLIENT, org_id: OTHER_ORG, capture_method: "checkbox" }
    }), res);

    assert.equal(res.statusCode, 200);
    const ins = calls.find((c) => INSERT.test(c.text));
    assert.equal(ins.params[0], ORG, "the body org was written to the row");
    assert.ok(!ins.params.includes(OTHER_ORG));
  });

  test("a session with no org is refused, not defaulted", async () => {
    // Fail closed. Picking a default org would file the consent under the wrong
    // tenant and gate the wrong tenant's credit pulls.
    stubDb({ session: { orgId: null, role: "closer" } });
    const res = mkRes();
    await handler(mkReq({ query: { client_id: CLIENT } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /org_id is required/);
    assert.ok(!calls.some((c) => SELECT.test(c.text) || INSERT.test(c.text)));
  });
});

// ── the words are never taken from the body ────────────────────────────────

describe("the consent wording is server-owned", () => {
  test("a consent_text in the body is ignored, and the server's words are stored", async () => {
    // THE MOST IMPORTANT TEST IN THIS FILE. If the body could set the text,
    // anybody who can reach this endpoint could record that a consumer agreed
    // to a sentence they never saw.
    stubDb({ session: { role: "closer" }, answers: [[INSERT, { rows: [consentRow()] }]] });
    const res = mkRes();
    const forged = "I agree to a HARD credit pull and waive all my rights.";
    await handler(mkReq({
      method: "POST",
      body: {
        client_id: CLIENT, capture_method: "typed", granted_name: "Dana Client",
        consent_text: forged
      }
    }), res);

    assert.equal(res.statusCode, 200);
    const ins = calls.find((c) => INSERT.test(c.text));
    assert.ok(!ins.params.includes(forged), "the body's wording was written to the row");
    assert.equal(ins.params[3], SOFT_PULL_DISCLOSURES[CURRENT_SOFT_PULL_VERSION].text,
      "the stored words are not the server's own copy of that version");
    assert.equal(ins.params[4], CURRENT_SOFT_PULL_VERSION);
  });

  test("an unknown consent_version is refused, not silently upgraded to the current one", async () => {
    stubDb({ session: { role: "closer" } });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: {
        client_id: CLIENT, capture_method: "checkbox", consent_version: "soft-pull-v99"
      }
    }), res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "consent_version_unknown");
    assert.ok(!calls.some((c) => INSERT.test(c.text)));
  });

  test("GET returns the disclosure so the screen never holds its own copy", async () => {
    stubDb({ session: { role: "closer" }, answers: [[SELECT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({ query: { client_id: CLIENT } }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.disclosure.version, CURRENT_SOFT_PULL_VERSION);
    assert.equal(res.body.disclosure.text, SOFT_PULL_DISCLOSURES[CURRENT_SOFT_PULL_VERSION].text);
  });
});

// ── attribution comes from the session ─────────────────────────────────────

describe("attribution", () => {
  test("a staff capture is attributed to the session's staff id, not the body's", async () => {
    stubDb({ session: { staffId: STAFF, role: "closer" }, answers: [[INSERT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: {
        client_id: CLIENT, capture_method: "checkbox",
        granted_by_staff_id: "99999999-9999-9999-9999-999999999999",
        granted_by_kind: "client"
      }
    }), res);

    const ins = calls.find((c) => INSERT.test(c.text));
    // [org, client, kind, text, version, granterKind, accountId, staffId, ...]
    assert.equal(ins.params[5], "staff", "the body redirected the attribution kind");
    assert.equal(ins.params[7], STAFF);
    assert.equal(ins.params[6], null);
    assert.ok(!ins.params.includes("99999999-9999-9999-9999-999999999999"),
      "a body-supplied staff id was written as the granter");
  });

  test("the user agent is read from the request headers, not from the body", async () => {
    stubDb({ session: { role: "closer" }, answers: [[INSERT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      headers: { authorization: "Bearer tok", "user-agent": "RealBrowser/1.0" },
      body: {
        client_id: CLIENT, capture_method: "checkbox",
        captured_user_agent: "Forged/9.9", captured_ip: "9.9.9.9"
      }
    }), res);

    const ins = calls.find((c) => INSERT.test(c.text));
    assert.equal(ins.params[11], "RealBrowser/1.0");
    assert.ok(!ins.params.includes("Forged/9.9"), "a body-supplied user agent became evidence");
    assert.ok(!ins.params.includes("9.9.9.9"), "a body-supplied ip became evidence");
  });

  test("x-forwarded-for's first entry is taken as the client ip", async () => {
    stubDb({ session: { role: "closer" }, answers: [[INSERT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      headers: { authorization: "Bearer tok", "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
      body: { client_id: CLIENT, capture_method: "checkbox" }
    }), res);
    assert.equal(calls.find((c) => INSERT.test(c.text)).params[10], "203.0.113.7");
  });

  test("a junk x-forwarded-for is dropped rather than stored as a fact", async () => {
    stubDb({ session: { role: "closer" }, answers: [[INSERT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      headers: { authorization: "Bearer tok", "x-forwarded-for": "not-an-address" },
      body: { client_id: CLIENT, capture_method: "checkbox" }
    }), res);
    assert.equal(calls.find((c) => INSERT.test(c.text)).params[10], null);
  });
});

// ── input validation ───────────────────────────────────────────────────────

describe("input validation", () => {
  for (const bad of [undefined, "", "not-a-uuid", "123", "22222222-2222-2222-2222"]) {
    test(`client_id ${JSON.stringify(bad)} is a 400 on GET and on POST`, async () => {
      for (const req of [
        mkReq({ query: { client_id: bad } }),
        mkReq({ method: "POST", body: { client_id: bad, capture_method: "checkbox" } })
      ]) {
        stubDb({ session: { role: "closer" } });
        const res = mkRes();
        await handler(req, res);
        assert.equal(res.statusCode, 400);
        assert.ok(!calls.some((c) => INSERT.test(c.text)));
      }
    });
  }

  test("an unknown kind is refused rather than coerced to the default", async () => {
    stubDb({ session: { role: "closer" } });
    const res = mkRes();
    await handler(mkReq({ query: { client_id: CLIENT, kind: "vibes" } }), res);
    assert.equal(res.statusCode, 400);
  });

  test("an invented capture method is a 400 and writes nothing", async () => {
    stubDb({ session: { role: "closer" } });
    const res = mkRes();
    await handler(mkReq({
      method: "POST", body: { client_id: CLIENT, capture_method: "verbal" }
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "capture_method_invalid");
    assert.ok(!calls.some((c) => INSERT.test(c.text)));
  });

  test("a typed capture with no name is a 400", async () => {
    stubDb({ session: { role: "closer" } });
    const res = mkRes();
    await handler(mkReq({
      method: "POST", body: { client_id: CLIENT, capture_method: "typed" }
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "granted_name_required");
  });

  test("an unknown action is refused rather than treated as a grant", async () => {
    stubDb({ session: { role: "closer" } });
    const res = mkRes();
    await handler(mkReq({
      method: "POST", body: { client_id: CLIENT, action: "approve", capture_method: "checkbox" }
    }), res);
    assert.equal(res.statusCode, 400);
    assert.ok(!calls.some((c) => INSERT.test(c.text)));
  });
});

// ── revocation ─────────────────────────────────────────────────────────────

describe("revocation", () => {
  test("a revoke with no reason is refused", async () => {
    stubDb({ session: { role: "closer" } });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: { client_id: CLIENT, action: "revoke", consent_id: CONSENT_ID }
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "reason_required");
    assert.ok(!calls.some((c) => UPDATE.test(c.text)));
  });

  test("a revoke is scoped by the session's org", async () => {
    stubDb({
      session: { orgId: ORG, role: "closer" },
      answers: [[UPDATE, { rows: [consentRow({ revoked_at: new Date(), revoked_reason: "withdrew" })] }]]
    });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: {
        client_id: CLIENT, action: "revoke", consent_id: CONSENT_ID,
        reason: "client withdrew on a call", org_id: OTHER_ORG
      }
    }), res);

    assert.equal(res.statusCode, 200);
    const upd = calls.find((c) => UPDATE.test(c.text));
    assert.equal(upd.params[1], ORG, "the revoke was scoped by the body's org");
    assert.equal(res.body.consent.valid, false);
  });

  test("revoking something not live is a 409, not a success", async () => {
    stubDb({ session: { role: "closer" }, answers: [[UPDATE, { rows: [] }]] });
    const res = mkRes();
    await handler(mkReq({
      method: "POST",
      body: { client_id: CLIENT, action: "revoke", consent_id: CONSENT_ID, reason: "withdrew" }
    }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "not_revocable");
  });
});

// ── the GET answer ─────────────────────────────────────────────────────────

describe("the status read", () => {
  test("returns the verdict and the history together", async () => {
    stubDb({ session: { role: "closer" }, answers: [[SELECT, { rows: [consentRow()] }]] });
    const res = mkRes();
    await handler(mkReq({ query: { client_id: CLIENT } }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status.valid, true);
    assert.equal(res.body.kind, "soft_pull_consent");
    assert.ok(Array.isArray(res.body.history));
  });

  test("a client with no consent reads as none, not as an error", async () => {
    stubDb({ session: { role: "closer" }, answers: [[SELECT, { rows: [] }]] });
    const res = mkRes();
    await handler(mkReq({ query: { client_id: OTHER_CLIENT } }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status.valid, false);
    assert.equal(res.body.status.reason, "none_on_file");
  });
});
