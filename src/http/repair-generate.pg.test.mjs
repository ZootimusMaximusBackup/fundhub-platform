// Postgres-backed tests for POST /api/repair/generate.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**" and "scripts/**"; a test placed in api/ is never collected
// and passes forever by never running (CLAUDE.md §12). The handler is imported
// from here instead, and imported INSIDE before() so that "no DATABASE_URL" is a
// real skip rather than a module-load failure.
//
// WHY IT EXISTS. src/metro2/rounds/store.mjs holds the only three INSERTs into
// dispute_cases, dispute_items and dispute_letters, and nothing in the repo
// called any of them. src/repair/cases.mjs decides `can_send` by counting
// dispute_letters rows, so the Repair desk was permanently empty and not one
// dispute letter had ever been produced. The seam being tested here is that
// writer.
//
// These tests assert against STORED ROWS, not response shapes. "A letter was
// generated" is a fact about dispute_letters, not about a JSON body — and the
// two refusal tests assert the ABSENCE of rows, because the expensive failure
// mode for this endpoint is inventing a dispute for a client who has none.
//
// Run it against a scratch database, never production:
//   DATABASE_URL="postgres://…/fundhub_t4" node --test src/http/repair-generate.pg.test.mjs

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import { listRepairCases } from "../repair/cases.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const EMAIL = "repair_generate_pg_test@example.com";
const STAFF_EMAIL = "repair_generate_pg_staff@example.com";
const OTHER_STAFF_EMAIL = "repair_generate_pg_closer@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

/* A stored Equifax pull that the Metro 2 engine really does find violations in:
   an account whose Date of Account Information is 790 days stale (M2-005) and
   the same creditor pulling twice on one day (M2-036). Shape copied from
   src/metro2/diy/from-crs.test.mjs, which is the fixture the engine's own tests
   use — not invented here, so a change to the engine breaks this honestly. */
function equifaxReport(over = {}) {
  return {
    requestedBureaus: { transunion: false, experian: false, equifax: true },
    responseDetail: { dateRequested: "2026-03-01T21:46:24.834278Z" },
    creditFiles: [
      {
        creditFileDetail: {
          creditFileInfileDate: "2026-03-01",
          creditFileResultStatusType: "FileReturned",
          sourceType: "Equifax"
        }
      }
    ],
    inquiries: over.inquiries ?? [
      { creditorName: "EXAMPLE CARD CO", inquiryDate: "2024-05-09", businessType: "Finance", sourceType: "Equifax" },
      { creditorName: "EXAMPLE CARD CO", inquiryDate: "2024-05-09", businessType: "Finance", sourceType: "Equifax" }
    ],
    tradelines: over.tradelines ?? [
      {
        accountIdentifier: "5121080011112222",
        accountOpenedDate: "2019-06-12",
        accountOwnershipType: "Individual",
        accountReportedDate: "2024-01-01",
        accountStatusType: "Open",
        accountType: "Revolving",
        creditorName: "EXAMPLE BANK NA",
        currentBalanceAmount: "1842",
        currentRatingType: "AsAgreed",
        sourceType: "Equifax"
      }
    ]
  };
}

/* The same file with the two defects removed: reported three days before the
   pull, and a single inquiry. The engine finds nothing, which is the ordinary
   outcome for a clean report and must NOT produce a letter. */
function cleanReport() {
  return equifaxReport({
    inquiries: [
      { creditorName: "EXAMPLE CARD CO", inquiryDate: "2026-02-01", businessType: "Finance", sourceType: "Equifax" }
    ],
    tradelines: [
      {
        accountIdentifier: "5121080011112222",
        accountOpenedDate: "2019-06-12",
        accountOwnershipType: "Individual",
        accountReportedDate: "2026-02-25",
        accountStatusType: "Open",
        accountType: "Revolving",
        creditorName: "EXAMPLE BANK NA",
        currentBalanceAmount: "1842",
        currentRatingType: "AsAgreed",
        sourceType: "Equifax"
      }
    ]
  });
}

describe("POST /api/repair/generate", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let handler, orgId, staffId, otherStaffId, token, otherToken, clientId;

  const post = async (body, tok = token) => {
    const r = res();
    await handler(
      { method: "POST", body, headers: { authorization: "Bearer " + tok } },
      r
    );
    return r;
  };

  /* Client-only cleanup, called before each test. events.client_id is a plain
     foreign key with NO cascade, so those rows go first or the DELETE fails with
     23503. dispute_cases / dispute_items / dispute_letters / crs_results /
     pii_identity / cards all cascade from clients. */
  async function wipeClient() {
    await db.query(
      `DELETE FROM events WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
    await db.query(
      `DELETE FROM repair_decision_log WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
    await db.query(`DELETE FROM clients WHERE email = $1`, [EMAIL]);
  }

  async function wipeAll() {
    await wipeClient();
    await db.query(
      `DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email = ANY($1::text[]))`,
      [[STAFF_EMAIL, OTHER_STAFF_EMAIL]]);
    await db.query(`DELETE FROM staff WHERE email = ANY($1::text[])`, [[STAFF_EMAIL, OTHER_STAFF_EMAIL]]);
  }

  /* A client with a real name and a real postal address. Both come from the
     fixture, never from the module under test — the whole point is that a name
     is never fabricated when one is absent. */
  async function buildClient({ result = null, withAddress = true, name = ["Real", "Person"], authorized = true } = {}) {
    clientId = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name)
       VALUES ($1,$2,$3,$4) RETURNING id`, [orgId, EMAIL, name[0], name[1]]
    )).rows[0].id;
    if (withAddress) {
      await db.query(
        `INSERT INTO pii_identity (org_id, client_id, addresses) VALUES ($1,$2,$3::jsonb)`,
        [orgId, clientId, JSON.stringify([
          { address_line1: "412 Pecan St", address_city: "Austin", address_state: "TX", address_zip: "78701" }
        ])]
      );
    }
    if (authorized) {
      await db.query(
        `INSERT INTO client_consents (
           org_id, client_id, kind, consent_version, consent_text,
           capture_method, granted_name, granted_by_kind, granted_by_staff_id
         ) VALUES (
           $1::uuid, $2::uuid, 'dispute_authorization', 'dispute-auth-v1',
           'I authorize Fundhub to prepare dispute letters for my review.',
           'typed', $3, 'staff', $4::uuid
         )`,
        [orgId, clientId, `${name[0]} ${name[1]}`, staffId]
      );
    }
    if (result) {
      await db.query(
        `INSERT INTO crs_results (org_id, client_id, result) VALUES ($1,$2,$3::jsonb)`,
        [orgId, clientId, JSON.stringify(result)]
      );
    }
    return clientId;
  }

  const countRows = async (table) => Number((await db.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE client_id = $1::uuid`, [clientId]
  )).rows[0].n);

  before(async () => {
    ({ default: handler } = await import("../../api/repair/generate.mjs"));
    await wipeAll();
    orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
    assert.ok(orgId, "an org must exist — run the seed");

    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'PG Specialist','inquiry_specialist',$2,'active') RETURNING id`,
      [orgId, STAFF_EMAIL]
    )).rows[0].id;
    ({ token } = await createSession(db, { staffId, orgId }));

    otherStaffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'PG Setter','setter',$2,'active') RETURNING id`,
      [orgId, OTHER_STAFF_EMAIL]
    )).rows[0].id;
    ({ token: otherToken } = await createSession(db, { staffId: otherStaffId, orgId }));
    assert.ok(otherStaffId);
  });

  after(async () => {
    await wipeAll();
    await close();
  });

  test("no dispute authorization: refuses before looking at the credit file", async () => {
    await wipeClient();
    await buildClient({
      result: { bureausPulled: ["EQ"], bureaus: { EQ: equifaxReport() } },
      authorized: false
    });

    const r = await post({ client_id: clientId });

    assert.equal(r.code, 200);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.reason, "no_authorization");
    assert.equal(await countRows("dispute_letters"), 0);
  });

  test("no credit file on record: refuses, and writes no dispute rows at all", async () => {
    await wipeClient();
    await buildClient({ result: null });

    const r = await post({ client_id: clientId });

    assert.equal(r.code, 200);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.reason, "no_credit_file",
      "a client with no pull must be refused, never given an invented file");

    assert.equal(await countRows("dispute_cases"), 0, "no case may exist without a credit file");
    assert.equal(await countRows("dispute_items"), 0);
    assert.equal(await countRows("dispute_letters"), 0);
  });

  test("a clean credit file: answers no_violations and writes no letter", async () => {
    await wipeClient();
    await buildClient({ result: { bureausPulled: ["EQ"], bureaus: { EQ: cleanReport() } } });

    const r = await post({ client_id: clientId });

    assert.equal(r.code, 200);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.reason, "no_violations",
      "finding nothing is a legitimate outcome and must not be dressed up as a success");

    assert.equal(await countRows("dispute_letters"), 0,
      "no rule-backed finding means no letter — a letter here would be an invented dispute");
    assert.equal(await countRows("dispute_cases"), 0);
  });

  test("a file with real violations: case, items and letter rows really exist", async () => {
    await wipeClient();
    await buildClient({ result: { bureausPulled: ["EQ"], bureaus: { EQ: equifaxReport() } } });

    const r = await post({ client_id: clientId });

    assert.equal(r.code, 200);
    assert.equal(r.body.ok, true, JSON.stringify(r.body));

    const cases = await db.query(
      `SELECT id, bureau, round, status FROM dispute_cases WHERE client_id = $1::uuid`, [clientId]);
    assert.equal(cases.rows.length, 1, "one bureau had findings, so one case");
    assert.equal(cases.rows[0].bureau, "EQ");
    assert.equal(cases.rows[0].round, "R1");

    const items = await db.query(
      `SELECT rule_id, severity FROM dispute_items WHERE client_id = $1::uuid ORDER BY rule_id`, [clientId]);
    assert.ok(items.rows.length >= 2, "the engine's findings are stored as items");
    assert.ok(items.rows.every((i) => i.rule_id && i.severity),
      "every stored item carries a rule id and a severity — nothing is filed without one");

    const letters = await db.query(
      `SELECT id, bureau, status, body_text, rule_ids, fingerprint
         FROM dispute_letters WHERE client_id = $1::uuid`, [clientId]);
    assert.equal(letters.rows.length, 1, "one letter row was really written");
    const letter = letters.rows[0];
    assert.equal(letter.status, "generated");
    assert.ok(letter.body_text.length > 200, "the letter has a real body");
    assert.ok(letter.rule_ids.length >= 2, "the letter names the rules it claims");
    assert.match(letter.body_text, /Real Person/,
      "the letter carries the client's real name from the clients row");
    assert.doesNotMatch(letter.body_text, /\[Consumer Name\]/,
      "a stored letter must never go out with a placeholder name");

    /* THE TRAP. generateLetter's fingerprint is the raw shingle set — every
       distinct 5-character slice of the letter, hundreds of entries. Storing it
       raw would put a chopped-up copy of the letter in the row beside the
       letter. It is reduced to one digest. */
    assert.equal(letter.fingerprint.length, 1,
      "fingerprint is one digest, not the whole shingle set");
    assert.match(letter.fingerprint[0], /^sha256:[0-9a-f]{64}$/);

    /* And the point of all of it: the client is now on the Repair desk with a
       Send available, which was impossible before because nothing wrote here. */
    const desk = await listRepairCases(db, { orgId, limit: 200 });
    const file = desk.files.find((f) => f.client_id === clientId);
    assert.ok(file, "the client now appears on the Repair desk queue");
    assert.equal(file.can_send, true, "the desk can offer a Send");
    assert.equal(file.letters_ready, 1);
    assert.equal(file.stage_key, "ready_to_send",
      "the optimization card moved, which is what puts the client on the desk");
  });

  test("running it twice does not duplicate the case, the items or the letter", async () => {
    await wipeClient();
    await buildClient({ result: { bureausPulled: ["EQ"], bureaus: { EQ: equifaxReport() } } });

    const first = await post({ client_id: clientId });
    assert.equal(first.body.ok, true);
    const cases1 = await countRows("dispute_cases");
    const items1 = await countRows("dispute_items");
    const letters1 = await countRows("dispute_letters");
    assert.equal(letters1, 1);

    const second = await post({ client_id: clientId });
    assert.equal(second.code, 200);
    assert.equal(second.body.ok, true);
    assert.equal(second.body.already_generated, true,
      "the second call reports the round was already generated rather than redoing it");

    assert.equal(await countRows("dispute_cases"), cases1, "no duplicate case");
    assert.equal(await countRows("dispute_items"), items1, "no duplicate items");
    assert.equal(await countRows("dispute_letters"), letters1, "no duplicate letter");
  });

  test("a role outside owner/admin/closer/inquiry_specialist is refused with 403", async () => {
    await wipeClient();
    await buildClient({ result: { bureausPulled: ["EQ"], bureaus: { EQ: equifaxReport() } } });

    const r = await post({ client_id: clientId }, otherToken);

    assert.equal(r.code, 403, "a setter may not generate dispute letters");
    assert.equal(r.body.ok, false);
    assert.equal(await countRows("dispute_letters"), 0,
      "the gate stops the write, not just the response");
  });

  test("a client_id that is not a uuid is a 400, not a crash", async () => {
    const r = await post({ client_id: "not-a-uuid" });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "client_id_required");
  });

  test("a round outside the R1/R2/R3/FURNISHER set is a 400", async () => {
    await wipeClient();
    await buildClient({ result: { bureausPulled: ["EQ"], bureaus: { EQ: equifaxReport() } } });
    const r = await post({ client_id: clientId, round: "R9" });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "invalid_round");
    assert.equal(await countRows("dispute_cases"), 0);
  });

  test("GET is refused — this endpoint only writes on POST", async () => {
    const r = res();
    await handler({ method: "GET", headers: { authorization: "Bearer " + token } }, r);
    assert.equal(r.code, 405);
  });
});
