/* GET /api/inquiries?recent=letters — WHO MAY READ IT.
 *
 * THE HOLE THIS CLOSES. The Specialist desk's two queue reads were moved off
 * ROLE_SETS.STAFF onto ROLE_SETS.SPECIALIST_DESK, because a setter could open
 * public/app/inquiry-remover.html and read every client's dispute file. The
 * "Recent Letters Issued" block on the same screen was added in the same change
 * and left on the wide gate. So the case table refused a setter — "This queue is
 * for staff on this desk" — and the card directly below it filled in with real
 * client names and which bureau each one's dispute letter went to, company-wide.
 * `curl` worked for them too.
 *
 * WHY THIS FILE DRIVES THE HANDLER INSTEAD OF READING IT. The gate on the shipped
 * feature was three `HTML_SRC.includes(...)` checks on markup, which is not a
 * test of a gate: it passes whether or not any role is ever refused. Every case
 * here calls the real handler with a real session row and asserts the STATUS CODE
 * and WHETHER THE QUERY RAN. A gate that answers 403 and reads anyway is the
 * failure worth catching, and only the query log can see it.
 *
 * The session row is faked, not the gate: requirePrincipal, verifySession and
 * read-api's requireRole all run for real, against a stub `db` that answers the
 * session lookup the way Postgres would. `deps.db` is the seam — the same one
 * api/read/inquiry-cases.mjs already exposes.
 *
 * ⚠️ UNDER src/ ON PURPOSE. npm test's glob is "src/**" and "scripts/**" only; a
 * test placed next to the handler under api/ silently never runs.
 */
import { test, describe } from "node:test";
import assert from "node:assert";

import handler from "../../api/inquiries.mjs";
import { ROLE_SETS } from "./read-api.mjs";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INQUIRY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/* One row, shaped like what the screen actually renders. If a refused role ever
   sees this, they have learned that Dana Ruiz is disputing something with
   Equifax and who at the company sent the letter. */
const LETTER_ROWS = [{
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  kind: "letter",
  outcome: "queued_for_delivery",
  created_at: "2026-08-29T17:00:00Z",
  bureau: "EQ",
  staff_name: "Rae Mendez",
  client_name: "Dana Ruiz"
}];

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

/* The stub. `calls` is the point of it: the assertions below are about whether
   the letters query ran, not about what the handler said it did. */
function makeDb(role, { orgId = ORG } = {}) {
  const calls = [];
  return {
    calls,
    lettersQueries() {
      return calls.filter((c) => /a\.kind IN \('letter', 'portal'\)/.test(c.sql));
    },
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("UPDATE sessions")) {
        return {
          rows: [{
            session_id: "sess-1",
            expires_at: "2099-01-01T00:00:00Z",
            staff_id: "staff-1",
            org_id: orgId,
            role: role,
            email: "someone@example.com",
            name: "Someone",
            status: "active",
            avatar_key: null,
            active_flag: "true"
          }]
        };
      }
      // listRecentLetters — the read this file is about.
      if (/a\.kind IN \('letter', 'portal'\)/.test(sql)) return { rows: LETTER_ROWS };
      // listAttempts — one row's history, the OTHER GET branch, deliberately not gated.
      if (sql.includes("FROM inquiry_attempts")) return { rows: [] };
      throw new Error("stub db: unexpected query:\n" + sql);
    }
  };
}

const req = (query) => ({
  method: "GET",
  headers: { authorization: "Bearer test-token" },
  query: query
});

const call = async (role, query) => {
  const db = makeDb(role);
  const r = res();
  await handler(req(query), r, { db });
  return { r, db };
};

/* The four that work this desk, and the three that reach the screen from the
   shared staff sidebar (public/app/shell.js ROLE_TABS) and must not. Read off
   ROLE_SETS itself so widening the set cannot silently widen this test. */
const ALLOWED = [...ROLE_SETS.SPECIALIST_DESK];
const REFUSED = ["setter", "closer", "sales_manager"];

describe("GET /api/inquiries?recent=letters — the role gate", () => {

  test("the set under test is the same one the desk's other two reads use", () => {
    assert.deepEqual(ALLOWED.sort(), ["admin", "funding_advisor", "inquiry_specialist", "owner"]);
  });

  for (const role of REFUSED) {
    test(`a ${role} is refused, and the query never runs`, async () => {
      const { r, db } = await call(role, { recent: "letters" });
      assert.equal(r.code, 403, `a ${role} was served the letter list`);
      assert.equal(r.body.ok, false);
      assert.equal(r.body.letters, undefined, "the refusal carried the rows anyway");
      assert.equal(db.lettersQueries().length, 0,
        `a ${role} was refused but the read ran anyway — the rows left the database`);
    });

    test(`a ${role} sees no client name and no bureau anywhere in the refusal`, async () => {
      const { r } = await call(role, { recent: "letters" });
      const said = JSON.stringify(r.body);
      assert.equal(said.includes("Dana Ruiz"), false, "a refused role was told a client's name");
      assert.equal(said.includes("Rae Mendez"), false, "a refused role was told who sent it");
    });

    test(`a ${role} may still read one row's own history — the gate did not widen`, async () => {
      // The over-gating guard. This branch is not about who works the desk; a
      // closer expanding a row on a screen they are allowed to be on must still
      // work, exactly as it did before the letters block existed.
      const { r } = await call(role, { inquiry_id: INQUIRY });
      assert.equal(r.code, 200, `the untouched GET branch was gated for a ${role}`);
      assert.ok(Array.isArray(r.body.attempts));
    });
  }

  for (const role of ALLOWED) {
    test(`a ${role} is served the letters`, async () => {
      const { r, db } = await call(role, { recent: "letters" });
      assert.equal(r.code, 200, `a ${role} works this desk and was refused: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.ok, true);
      assert.equal(r.body.letters.length, 1);
      assert.equal(r.body.letters[0].client_name, "Dana Ruiz");
      assert.equal(db.lettersQueries().length, 1);
    });
  }

  test("the read is still bound to the caller's own company", async () => {
    const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const db = makeDb("inquiry_specialist", { orgId: OTHER });
    const r = res();
    await handler(req({ recent: "letters" }), r, { db });
    assert.equal(r.code, 200);
    const q = db.lettersQueries()[0];
    assert.ok(q, "the letters query did not run");
    assert.equal(q.params[0], OTHER,
      "the org bound to the query is not the org on the session — a specialist could read another company's letters");
  });

  test("an unknown role is refused, not admitted by default", async () => {
    // Fails closed. A role added to the staff table and not to the set gets
    // nothing, rather than everything.
    const { r, db } = await call("brand_new_role", { recent: "letters" });
    assert.equal(r.code, 403);
    assert.equal(db.lettersQueries().length, 0);
  });

  test("a blank role is refused", async () => {
    const { r, db } = await call("", { recent: "letters" });
    assert.equal(r.code, 403);
    assert.equal(db.lettersQueries().length, 0);
  });

  test("no session at all is a 401, and nothing is read", async () => {
    const db = makeDb("inquiry_specialist");
    const r = res();
    await handler({ method: "GET", headers: {}, query: { recent: "letters" } }, r, { db });
    assert.equal(r.code, 401);
    assert.equal(db.lettersQueries().length, 0);
  });

  test("the refusal names the set, so the screen can say who this is for", async () => {
    const { r } = await call("setter", { recent: "letters" });
    assert.match(String(r.body.message), /inquiry_specialist/);
  });

  test("?limit is still capped, so a permitted role cannot pull the whole table", async () => {
    // 50 is the cap in listRecentLetters. The gate is not the only guard here.
    const { db } = await call("inquiry_specialist", { recent: "letters", limit: "5000" });
    assert.equal(db.lettersQueries()[0].params[1], 50);
  });
});
