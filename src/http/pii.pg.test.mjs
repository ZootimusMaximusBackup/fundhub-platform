// Postgres-backed tests for /api/pii — the SSN reveal, and the reason it demands.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**/*.test.mjs" and "scripts/**/*.test.mjs"; a test placed in api/
// is never collected and passes forever by never running. The handler is
// imported from here instead.
//
// WHAT THIS FILE EXISTS TO PIN. Rule 4 in src/pii/index.mjs says "A REASON IS
// REQUIRED", and for a while nothing enforced it: revealSsn() defaults
// `reason = null` and degrades the log row to a bare "ssn", the check lived in
// the browser, and /api/pii was unrouted so nobody could notice. Routing the
// endpoint made the gap live — a POST {client_id, action:"reveal"} with no
// reason returned all nine digits and wrote an access-log row that said only
// that somebody, sometime, read an SSN. That is the exact state rule 4 exists to
// prevent: an unexplained disclosure is indistinguishable from every other one.
//
// So these tests assert AGAINST pii_access_log, not against the response body.
// A response is the endpoint's account of what it did; the row is what it did.
// "The reveal was refused" is only true if no row was written, and "the reason
// was recorded" is only true if the reason text is in the column an auditor
// reads. Both of those are questions for the table.
//
// Skipped without DATABASE_URL like every other *.pg.test.mjs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { storeIdentity } from "../pii/index.mjs";
import handler from "../../api/pii.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

// A real 32-byte key. The handler calls revealSsn() without an `env` override,
// so the key has to be on process.env for the duration of this suite.
const TEST_KEY = Buffer.alloc(32, 11).toString("base64");
const SSN = "123456789";

const STAFF_EMAIL_LIKE = "pii_pg_test_%@example.com";
const CLIENT_EMAIL_LIKE = "pii.pg.test.%@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  r.getHeader = (k) => r.headers[String(k).toLowerCase()];
  return r;
};

describe("/api/pii — reveal", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, keyBefore;
  const staff = {};   // role → { id, token }

  /* The handler runs the real requirePrincipal against the real sessions table,
     so every call carries a token minted for a real staff row. There is no
     injection seam, deliberately. */
  const call = async (body, token, method = "POST") => {
    const r = res();
    await handler({
      method,
      query: {},
      body,
      headers: token ? { authorization: "Bearer " + token } : {}
    }, r);
    return r;
  };

  const reveal = (token, body) => call({ client_id: client, action: "reveal", ...body }, token);

  const logRows = async () => (await db.query(
    `SELECT id, org_id, client_id, accessed_by, field, created_at
       FROM pii_access_log WHERE client_id = $1 ORDER BY created_at, id`, [client])).rows;

  const wipeLog = async () => { await db.query(`DELETE FROM pii_access_log WHERE client_id = $1`, [client]); };

  async function purge() {
    // pii_identity cascades from clients; pii_access_log does NOT, so it goes
    // first. Run before() as well as after(): a crashed previous run must not
    // collide with idx_staff_email_org.
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      await db.query(`DELETE FROM pii_access_log WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM pii_identity   WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients        WHERE id = ANY($1)`, [ids]);
    }
    // sessions.staff_id is ON DELETE CASCADE, so the staff delete takes the
    // minted tokens with it.
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  }

  before(async () => {
    keyBefore = process.env.PII_ENC_KEY;
    process.env.PII_ENC_KEY = TEST_KEY;

    org = await resolveDefaultOrg(db);
    await purge();

    // One staff row per role that matters: the four IDENTITY_ROLES, plus two
    // STAFF roles deliberately outside that set. The gate in api/pii.mjs is
    // narrower than ROLE_SETS.STAFF on purpose; both sides need a witness.
    for (const role of ["owner", "admin", "inquiry_specialist", "funding_advisor", "closer", "setter"]) {
      const id = (await db.query(
        `INSERT INTO staff (org_id, name, role, email, status)
         VALUES ($1,$2,$3,$4,'active') RETURNING id`,
        [org, `Pii Pgtest ${role}`, role, `pii_pg_test_${role}@example.com`])).rows[0].id;
      staff[role] = { id, token: (await createSession(db, { staffId: id, orgId: org })).token };
    }

    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Piipgtest','Subject','pii.pg.test.subject@example.com') RETURNING id`,
      [org])).rows[0].id;

    await storeIdentity(db, { orgId: org, clientId: client, ssn: SSN });
  });

  after(async () => {
    await purge();
    if (keyBefore === undefined) delete process.env.PII_ENC_KEY;
    else process.env.PII_ENC_KEY = keyBefore;
    await close();
  });

  // ── the reveal that is allowed to happen ──────────────────────────────────

  test("a reveal with a real reason returns the SSN and writes that reason to the log", async () => {
    await wipeLog();
    const reason = "disputing Equifax inquiry #4471 with the bureau";
    const r = await reveal(staff.inquiry_specialist.token, { reason });

    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.ssn, SSN, "the reveal did not return the stored number");

    // The claim is not "the endpoint said 200". It is "an auditor opening
    // pii_access_log can read why this happened".
    const rows = await logRows();
    assert.equal(rows.length, 1, "a successful reveal did not write exactly one log row");
    assert.ok(rows[0].field.includes(reason),
      `pii_access_log.field does not contain the stated reason: ${JSON.stringify(rows[0].field)}`);
    assert.notEqual(rows[0].field, "ssn",
      "the log row degraded to a bare 'ssn' — the reason was accepted and then discarded");

    // Attribution comes from the session, never from the body.
    assert.equal(rows[0].accessed_by, staff.inquiry_specialist.id,
      "the log row was attributed to somebody other than the caller");
    assert.equal(rows[0].org_id, org);
    assert.equal(rows[0].client_id, client);
  });

  test("the reason is trimmed but otherwise stored verbatim", async () => {
    await wipeLog();
    const r = await reveal(staff.inquiry_specialist.token, { reason: "   funding file review — Ramírez (2 of 3)   " });
    assert.equal(r.code, 200, JSON.stringify(r.body));

    const rows = await logRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].field, "ssn (funding file review — Ramírez (2 of 3))",
      "the reason did not survive into the log column intact");
  });

  test("a caller cannot choose their own attribution with accessed_by in the body", async () => {
    await wipeLog();
    const r = await reveal(staff.inquiry_specialist.token, {
      reason: "attribution check", accessed_by: staff.closer.id, staff_id: staff.closer.id
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));

    const rows = await logRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].accessed_by, staff.inquiry_specialist.id,
      "a body field redirected the audit trail onto another employee");
  });

  test("every IDENTITY_ROLE can reveal, and each one's reveal is logged", async () => {
    for (const role of ["owner", "admin", "inquiry_specialist", "funding_advisor"]) {
      await wipeLog();
      const r = await reveal(staff[role].token, { reason: `${role} needs the number` });
      assert.equal(r.code, 200, `${role} was refused: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.ssn, SSN);

      const rows = await logRows();
      assert.equal(rows.length, 1, `${role}'s reveal wrote ${rows.length} log rows`);
      assert.equal(rows[0].accessed_by, staff[role].id);
      assert.ok(rows[0].field.includes(`${role} needs the number`));
    }
  });

  // ── no reason, no reveal ──────────────────────────────────────────────────

  test("a reveal with NO reason is a 400 and writes NO log row", async () => {
    // The regression this whole file exists for. Before the guard, this shape
    // returned 200 with all nine digits and left behind a row saying "ssn" —
    // a disclosure with no stated purpose, which is what rule 4 forbids.
    await wipeLog();
    const r = await reveal(staff.inquiry_specialist.token, {});

    assert.equal(r.code, 400, `a reason-less reveal returned ${r.code}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "reason is required — every reveal is written to pii_access_log");
    assert.equal(r.body.ssn, undefined, "a refused reveal still returned the SSN");

    assert.deepEqual(await logRows(), [],
      "a refused reveal still wrote to pii_access_log — an unexplained disclosure was recorded as one");
  });

  test("an explicitly null or undefined reason is refused the same way", async () => {
    for (const reason of [null, undefined]) {
      await wipeLog();
      const r = await reveal(staff.inquiry_specialist.token, { reason });
      assert.equal(r.code, 400, `reason: ${String(reason)} returned ${r.code}`);
      assert.equal(r.body.ok, false);
      assert.equal(r.body.ssn, undefined);
      assert.equal((await logRows()).length, 0, `reason: ${String(reason)} wrote a log row`);
    }
  });

  test("an empty or whitespace-only reason is not a reason", async () => {
    // "" was already falsy enough to degrade the row to a bare "ssn". "   " was
    // WORSE than nothing: truthy, so it produced a row reading "ssn (   )" — an
    // audit trail that looks populated and says nothing.
    for (const reason of ["", "   ", "\t", "\n", " \t\n "]) {
      await wipeLog();
      const r = await reveal(staff.inquiry_specialist.token, { reason });

      assert.equal(r.code, 400, `reason ${JSON.stringify(reason)} was accepted (${r.code})`);
      assert.equal(r.body.ok, false);
      assert.equal(r.body.error, "reason is required — every reveal is written to pii_access_log");
      assert.equal(r.body.ssn, undefined, `reason ${JSON.stringify(reason)} disclosed the SSN`);

      assert.equal((await logRows()).length, 0,
        `reason ${JSON.stringify(reason)} wrote a log row with nothing readable in it`);
    }
  });

  test("a non-string reason is a 400 — not a 500, and not silently coerced", async () => {
    // A number or an object must not become the string an auditor later reads.
    // "ssn (42)" and "ssn ([object Object])" are not explanations, and neither
    // is a stack trace: this is a bad request, not a server fault.
    for (const reason of [42, 0, true, false, {}, { note: "inquiry" }, [], ["inquiry"], 3.14]) {
      await wipeLog();
      const r = await reveal(staff.inquiry_specialist.token, { reason });

      assert.equal(r.code, 400,
        `reason ${JSON.stringify(reason)} returned ${r.code} instead of 400`);
      assert.equal(r.body.ok, false);
      assert.equal(r.body.error, "reason is required — every reveal is written to pii_access_log");
      assert.equal(r.body.ssn, undefined, `reason ${JSON.stringify(reason)} disclosed the SSN`);

      assert.equal((await logRows()).length, 0,
        `reason ${JSON.stringify(reason)} wrote a log row — a non-string was coerced into the audit trail`);
    }
  });

  test("a refused reveal does not leak the number through a later history read", async () => {
    await wipeLog();
    await reveal(staff.inquiry_specialist.token, {});
    const r = await call(undefined, staff.inquiry_specialist.token, "GET");
    // GET with no client_id is a 400; the point is only that nothing was logged.
    assert.ok(r.code === 400 || r.code === 200);
    assert.equal((await logRows()).length, 0);
  });

  // ── the role gate is narrower than STAFF ──────────────────────────────────

  test("a closer is 403 and writes no log row, even with a perfectly good reason", async () => {
    await wipeLog();
    const r = await reveal(staff.closer.token, { reason: "closing the deal, want the SSN" });

    assert.equal(r.code, 403, `a closer got ${r.code} on an SSN reveal`);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "forbidden");
    assert.equal(r.body.ssn, undefined, "a closer was shown a client's social security number");

    assert.equal((await logRows()).length, 0, "a forbidden reveal still wrote a log row");
  });

  test("a setter is 403 too — STAFF is not the identity gate", async () => {
    await wipeLog();
    const r = await reveal(staff.setter.token, { reason: "curious" });
    assert.equal(r.code, 403, `a setter got ${r.code}`);
    assert.equal(r.body.ssn, undefined);
    assert.equal((await logRows()).length, 0);
  });

  test("a role outside the set cannot read the masked identity or the history either", async () => {
    for (const role of ["closer", "setter"]) {
      const r = await call(undefined, staff[role].token, "GET");
      assert.equal(r.code, 403, `${role} reached GET /api/pii (${r.code})`);
      assert.equal(r.body.identity, undefined);
    }
  });

  test("no session at all is a 401 and writes nothing", async () => {
    await wipeLog();
    const r = await reveal(undefined, { reason: "no token" });
    assert.equal(r.code, 401, `an unauthenticated reveal returned ${r.code}`);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.ssn, undefined);
    assert.equal((await logRows()).length, 0, "an unauthenticated reveal wrote a log row");
  });

  // ── the log is what the history endpoint serves ───────────────────────────

  test("accessHistory surfaces the reason an auditor needs, newest first", async () => {
    await wipeLog();
    await reveal(staff.owner.token, { reason: "first look" });
    await reveal(staff.admin.token, { reason: "second look" });

    const r = res();
    await handler({
      method: "GET",
      query: { client_id: client, history: "1" },
      headers: { authorization: "Bearer " + staff.owner.token }
    }, r);

    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.access.length, 2);
    const fields = r.body.access.map((a) => a.field);
    assert.ok(fields.some((f) => f.includes("first look")), `history lost a reason: ${JSON.stringify(fields)}`);
    assert.ok(fields.some((f) => f.includes("second look")), `history lost a reason: ${JSON.stringify(fields)}`);
    assert.ok(!fields.includes("ssn"),
      "a reveal reached the history with no stated purpose");
    await wipeLog();
  });
});
