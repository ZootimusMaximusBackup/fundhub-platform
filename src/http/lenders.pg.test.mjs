/* Postgres-backed tests for the lender database write endpoint, api/lenders.mjs.
 *
 * WHY THIS FILE EXISTS. The three controls on the Lenders screen — "Add blank
 * row", the per-row "Save", and "Import now" — had never been fired. Not
 * because they failed: the 2026-08-18 UI audit deliberately did not press them,
 * because pressing them writes the live lender list. So they were UNPROVEN, and
 * the only automated coverage was src/http/lenders-role-gate.test.mjs, which
 * drives a stub `db` and never writes a row. It proves who is refused. It
 * cannot prove that a single lender was ever created, saved or imported.
 *
 * These tests fire all three against a real Postgres, in a scratch org of their
 * own, so the controls are proven without touching anybody's real list.
 *
 * WHAT ONLY A REAL DATABASE CAN SHOW HERE:
 *  - the INSERT and UPDATE statements in src/lenders/store.mjs are legal against
 *    the schema in db/migrations/138_lenders.sql, including the lender_table
 *    enum cast and the ::date cast on last_updated_date;
 *  - the money columns are numeric(14,2) DOLLARS, not integer cents, so 25000.50
 *    must come back as 25000.50 and not as 250.01 or 2500050;
 *  - a NULL money column survives the whole round trip as null and is never
 *    quietly turned into 0, which would read on screen as "this lender approves
 *    $0" — a false statement about a real lender;
 *  - the CSV importer's upsert on (org_id, external_row_id) actually finds the
 *    earlier row instead of creating a duplicate lender.
 *
 * NO REAL LENDER NAMES ARE USED. Every row here is an obvious fixture, written
 * and deleted inside this file. Proving the import path works is NOT the same as
 * importing the real lender book, and this file does not do the latter.
 *
 * It lives under src/http/ and not next to the handler because package.json's
 * test glob walks src/ and scripts/ only; a test in api/ is never collected and
 * passes forever by never running (CLAUDE.md, traps).
 *
 * Skipped without DATABASE_URL, like every other *.pg.test.mjs.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import handler from "../../api/lenders.mjs";
import matchesHandler from "../../api/read/lender-matches.mjs";
import readLenders from "../../api/read/lenders.mjs";
import { LENDER_CSV_COLUMNS } from "../lenders/tables.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const SLUG = "t8-lenders-http-test";
const FOREIGN_SLUG = "t8-lenders-http-test-other-co";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/lenders (create · save · import)", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, foreignOrg, client;
  let owner, closer, foreignOwner;

  const call = async (h, { method = "POST", body, query = {}, token, deps } = {}) => {
    const r = res();
    await h(
      { method, query, body, headers: token ? { authorization: "Bearer " + token } : {} },
      r,
      deps || {}
    );
    return r;
  };
  const api = (opts) => call(handler, opts);

  const lenderRows = async (orgId = org) => (await db.query(
    `SELECT * FROM lenders WHERE org_id = $1 ORDER BY lower(name), id`, [orgId]
  )).rows;

  const wipeLenders = async () => {
    await db.query(`DELETE FROM lenders WHERE org_id = ANY($1)`, [[org, foreignOrg]]);
  };

  async function purge() {
    const orgIds = (await db.query(
      `SELECT id FROM orgs WHERE slug = ANY($1)`, [[SLUG, FOREIGN_SLUG]]
    )).rows.map((r) => r.id);
    if (!orgIds.length) return;
    await db.query(`DELETE FROM lenders WHERE org_id = ANY($1)`, [orgIds]);
    await db.query(`DELETE FROM inquiry_log WHERE org_id = ANY($1)`, [orgIds]);
    await db.query(`DELETE FROM clients WHERE org_id = ANY($1)`, [orgIds]);
    await db.query(
      `DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE org_id = ANY($1))`,
      [orgIds]
    ).catch(() => {});
    await db.query(`DELETE FROM staff WHERE org_id = ANY($1)`, [orgIds]);
    await db.query(`DELETE FROM orgs WHERE id = ANY($1)`, [orgIds]);
  }

  before(async () => {
    await purge();

    const mkOrg = async (slug, name) => (await db.query(
      `INSERT INTO orgs (slug, name, demo_mode_enabled) VALUES ($1,$2,false) RETURNING id`,
      [slug, name]
    )).rows[0].id;

    const mkStaff = async (orgId, role, email, name) => {
      const id = (await db.query(
        `INSERT INTO staff (org_id, name, role, email, status)
         VALUES ($1,$2,$3,$4,'active') RETURNING id`, [orgId, name, role, email]
      )).rows[0].id;
      return { id, token: (await createSession(db, { staffId: id, orgId })).token };
    };

    org = await mkOrg(SLUG, "T8 Lenders Http Test Co");
    /* A SECOND COMPANY. On a one-org database every tenancy bug in this
       endpoint is invisible. */
    foreignOrg = await mkOrg(FOREIGN_SLUG, "T8 Lenders Http Test Other Co");

    owner = await mkStaff(org, "owner", "t8_lenders_http_owner@example.com", "T8 Lenders Owner");
    // In ROLE_SETS.STAFF but outside ROLE_SETS.LENDERS. Without one of these,
    // "the gate works" only means "a signed-in person gets in".
    closer = await mkStaff(org, "closer", "t8_lenders_http_closer@example.com", "T8 Lenders Closer");
    foreignOwner = await mkStaff(
      foreignOrg, "owner", "t8_lenders_http_otherco@example.com", "T8 Lenders Otherco Owner"
    );

    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, custom_fields)
       VALUES ($1,'T8','Lendersubject',$2::jsonb) RETURNING id`,
      [org, JSON.stringify({ business_state: "TX" })]
    )).rows[0].id;
  });

  after(async () => { await purge(); await close().catch(() => {}); });

  /* ── "Add blank row" — public/app/lenders.html:516 btnAdd ──────────────── */

  describe('the "Add blank row" button', () => {

    test("writes exactly one real row, under the caller's org", async () => {
      await wipeLenders();
      const r = await api({
        body: { action: "create", lender_table: "OnlineBizCC", name: "T8 Fixture Bank", active: true },
        token: owner.token
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.ok, true);
      assert.ok(r.body.lender && r.body.lender.id, "the response carries the new row's id");

      // Assert against the ROW, not the response. A response is the endpoint's
      // account of what it did; the row is what it did.
      const rows = await lenderRows();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, "T8 Fixture Bank");
      assert.equal(rows[0].lender_table, "OnlineBizCC");
      assert.equal(rows[0].org_id, org);
      assert.equal(rows[0].active, true);
      assert.equal(rows[0].id, r.body.lender.id);
      // Every create stamps who and when.
      assert.equal(rows[0].last_updated_by, "T8 Lenders Owner");
      assert.ok(rows[0].last_updated_date, "last_updated_date is stamped");
      // Nothing was invented to fill the blanks.
      assert.equal(rows[0].typical_approval_range, null);
      assert.equal(rows[0].priority_tier, null);
    });

    test("refuses a product type that is not one of the seven, and writes nothing", async () => {
      await wipeLenders();
      const r = await api({
        body: { action: "create", lender_table: "MadeUpProduct", name: "T8 Fixture Bank" },
        token: owner.token
      });
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "invalid_lender_table");
      assert.equal((await lenderRows()).length, 0);
    });

    test("refuses a blank name, and writes nothing", async () => {
      await wipeLenders();
      const r = await api({
        body: { action: "create", lender_table: "OnlineBizCC", name: "   " },
        token: owner.token
      });
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "name_required");
      assert.equal((await lenderRows()).length, 0);
    });

    test("a closer cannot add a lender", async () => {
      await wipeLenders();
      const r = await api({
        body: { action: "create", lender_table: "OnlineBizCC", name: "T8 Closer Bank" },
        token: closer.token
      });
      assert.equal(r.code, 403, JSON.stringify(r.body));
      assert.equal((await lenderRows()).length, 0);
    });
  });

  /* ── the per-row "Save" — public/app/lenders.html:404 saveRow ──────────── */

  describe('the per-row "Save" button', () => {

    const seed = async (patch = {}) => {
      await wipeLenders();
      const r = await api({
        body: { action: "create", lender_table: "OnlineBizCC", name: "T8 Save Fixture", ...patch },
        token: owner.token
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      return r.body.lender.id;
    };

    test("saves the inline-edit fields the screen actually sends", async () => {
      const id = await seed();
      const r = await api({
        body: {
          action: "save",
          id,
          patch: {
            bureaus_pulled: "EQ",
            eligible_states: "TX, OK",
            priority_tier: 2,
            insider_tips: "fixture note",
            notes: "fixture note",
            active: true
          }
        },
        token: owner.token
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.ok, true);
      // The screen does `rows[i] = d.lender` — so a successful save MUST return
      // a row that still carries its id, or the row loses its identity.
      assert.equal(r.body.lender.id, id);

      const row = (await lenderRows())[0];
      assert.equal(row.bureaus_pulled, "EQ");
      assert.equal(row.eligible_states, "TX, OK");
      assert.equal(row.priority_tier, 2);
      assert.equal(row.insider_tips, "fixture note");
      assert.equal(row.active, true);
      assert.equal(row.last_updated_by, "T8 Lenders Owner");
    });

    test("money columns are dollars, not cents, and a blank one stays unknown", async () => {
      const id = await seed();
      const r = await api({
        body: {
          action: "save",
          id,
          patch: {
            typical_approval_range: 25000.5,
            average_starting_loc: 10000,
            // max_known_loc deliberately left alone — it must stay NULL.
            minimum_deposit: 0
          }
        },
        token: owner.token
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));

      const row = (await lenderRows())[0];
      // numeric comes back as a string from pg; compare as a number.
      assert.equal(Number(row.typical_approval_range), 25000.5,
        "25000.50 dollars stayed 25000.50 — it was not read as cents");
      assert.equal(Number(row.average_starting_loc), 10000);
      // NULL means unknown and must survive. Turning it into 0 would put
      // "approves $0" on the screen next to a real lender's name.
      assert.equal(row.max_known_loc, null, "an untouched money column stays unknown");
      // And a real, deliberate zero is still a zero — not confused with unknown.
      assert.equal(Number(row.minimum_deposit), 0);

      assert.equal(r.body.lender.typical_approval_range, 25000.5);
      assert.equal(r.body.lender.max_known_loc, null);
    });

    test("saving a lender that does not exist is a 404, not a silent success", async () => {
      await wipeLenders();
      const r = await api({
        body: { action: "save", id: "11111111-1111-4111-8111-111111111111", patch: { notes: "x" } },
        token: owner.token
      });
      assert.equal(r.code, 404);
      assert.equal(r.body.ok, false);
    });

    test("one company cannot save another company's lender", async () => {
      const id = await seed();
      const r = await api({
        body: { action: "save", id, patch: { notes: "reached across" } },
        token: foreignOwner.token
      });
      assert.equal(r.code, 404, JSON.stringify(r.body));
      const row = (await lenderRows())[0];
      assert.equal(row.notes, null, "the other company's row was not touched");
    });

    test("a save with no id is refused", async () => {
      const r = await api({ body: { action: "save", patch: { notes: "x" } }, token: owner.token });
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "id_required");
    });

    test("a closer cannot save a lender", async () => {
      const id = await seed();
      const r = await api({
        body: { action: "save", id, patch: { notes: "closer was here" } },
        token: closer.token
      });
      assert.equal(r.code, 403, JSON.stringify(r.body));
      assert.equal((await lenderRows())[0].notes, null);
    });

    /* REGRESSION — the defect fixed on 2026-08-18.
     *
     * When the UPDATE matches no row but the row is plainly still there, the
     * handler used to fall through and answer 200 {ok:true, lender:null}. The
     * screen then does `rows[i] = d.lender`, so the row in its cache becomes
     * null, the next render writes tr.dataset.id = undefined, and that row's
     * next Save posts id:"undefined" and gets a 400. One phantom save poisoned
     * the row until a page reload.
     *
     * The UPDATE-matched-nothing case cannot be produced by ordinary input, so
     * it is produced here by wrapping the REAL pool and swallowing only the
     * UPDATE. Everything else — the session lookup, the gate, the re-read —
     * runs against the real database. */
    test("a save that changes no row never answers ok with an empty lender", async () => {
      const id = await seed();
      const wrapped = {
        query: async (sql, params) =>
          /^\s*UPDATE\s+lenders\b/i.test(String(sql))
            ? { rows: [], rowCount: 0 }
            : db.query(sql, params)
      };
      const r = await api({
        body: { action: "save", id, patch: { notes: "will not stick" } },
        token: owner.token,
        deps: { db: wrapped }
      });

      // The exact shape that poisoned the screen must never appear again.
      assert.equal(
        r.code === 200 && r.body.ok === true && r.body.lender == null,
        false,
        "200 ok:true with lender:null is the defect"
      );
      assert.equal(r.body.ok, false, "a save that did not happen is reported as a failure");
      assert.equal(r.code, 409);
      assert.equal(r.body.error, "save_failed");
      assert.ok(r.body.message, "the screen has something to show the user");
      // And the row really was left alone.
      assert.equal((await lenderRows())[0].notes, null);
    });
  });

  /* ── "Import now" — public/app/lenders.html:500 btnImportRun ───────────── */

  describe('the "Import now" button', () => {

    /* A SYNTHETIC fixture, used only inside this test. These are not lenders.
       The real lender book still has to be imported by hand — see the report. */
    const FIXTURE_CSV = [
      "lender_table,name,product_name,eligible_states,bureaus_pulled,priority_tier," +
        "typical_approval_range,average_starting_loc,max_known_loc,active,external_row_id,notes",
      'OnlineBizCC,T8 Fixture Alpha,Alpha Card,"TX, OK",EQ,1,25000.50,10000,,true,T8-FIX-1,' +
        '"note with a comma, and ""quotes"""',
      "BizLOC_Stated,T8 Fixture Beta,Beta Line,All States,EX,2,\"$50,000\",,,true,T8-FIX-2,",
      "PersonalCC,T8 Fixture Gamma,,,TU,3,,,,false,T8-FIX-3,"
    ].join("\n");

    test("an empty paste is refused before anything is written", async () => {
      await wipeLenders();
      const r = await api({ body: { action: "import", csv: "   " }, token: owner.token });
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "csv_required");
      assert.equal((await lenderRows()).length, 0);
    });

    test("imports every row in the file, and only what the file contains", async () => {
      await wipeLenders();
      const r = await api({ body: { action: "import", csv: FIXTURE_CSV }, token: owner.token });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.ok, true);
      assert.equal(r.body.parsed, 3);
      assert.equal(r.body.imported, 3);
      assert.equal(r.body.updated, 0);
      assert.deepEqual(r.body.errors, []);

      const rows = await lenderRows();
      assert.equal(rows.length, 3, "three lines in, three rows out — nothing invented");
      assert.deepEqual(
        rows.map((x) => x.name).sort(),
        ["T8 Fixture Alpha", "T8 Fixture Beta", "T8 Fixture Gamma"]
      );

      const alpha = rows.find((x) => x.name === "T8 Fixture Alpha");
      assert.equal(alpha.lender_table, "OnlineBizCC");
      assert.equal(alpha.eligible_states, "TX, OK", "a quoted comma stayed one field");
      assert.equal(alpha.notes, 'note with a comma, and "quotes"');
      assert.equal(alpha.priority_tier, 1);
      assert.equal(alpha.active, true);
      assert.equal(Number(alpha.typical_approval_range), 25000.5, "dollars, not cents");
      assert.equal(alpha.max_known_loc, null, "a blank money cell is unknown, not 0");

      const beta = rows.find((x) => x.name === "T8 Fixture Beta");
      assert.equal(Number(beta.typical_approval_range), 50000, '"$50,000" parsed as 50000 dollars');
      assert.equal(beta.average_starting_loc, null);

      const gamma = rows.find((x) => x.name === "T8 Fixture Gamma");
      assert.equal(gamma.active, false, "active=false survived the import");
      assert.equal(gamma.eligible_states, null);
      assert.equal(gamma.org_id, org);
    });

    test("re-importing the same file updates in place instead of duplicating", async () => {
      // Depends on the previous test's three rows being present.
      const before = await lenderRows();
      assert.equal(before.length, 3);

      const r = await api({ body: { action: "import", csv: FIXTURE_CSV }, token: owner.token });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.imported, 0);
      assert.equal(r.body.updated, 3, "matched on external_row_id");

      const after = await lenderRows();
      assert.equal(after.length, 3, "no duplicate lenders");
      assert.deepEqual(after.map((x) => x.id).sort(), before.map((x) => x.id).sort());
    });

    test("a bad line is reported and skipped — the good lines still land", async () => {
      await wipeLenders();
      const csv = [
        "lender_table,name,external_row_id",
        "OnlineBizCC,T8 Fixture Good,T8-OK-1",
        "NotAProduct,T8 Fixture BadTable,T8-BAD-1",
        "OnlineBizCC,,T8-BAD-2"
      ].join("\n");
      const r = await api({ body: { action: "import", csv }, token: owner.token });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.imported, 1);
      assert.equal(r.body.errors.length, 2, "both bad lines are named back to the user");

      const rows = await lenderRows();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, "T8 Fixture Good");
    });

    test("a file with no name column imports nothing and says why", async () => {
      await wipeLenders();
      const r = await api({
        body: { action: "import", csv: "lender_table,notes\nOnlineBizCC,hello" },
        token: owner.token
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.imported, 0);
      assert.ok(r.body.errors.some((e) => /name column/i.test(e)));
      assert.equal((await lenderRows()).length, 0);
    });

    test("a tip row is skipped and logo_path is stored on a real bank", async () => {
      await wipeLenders();
      const csv = [
        "lender_table,name,logo_path,external_row_id",
        "OnlineBizCC,T8 Fixture Logo Bank,/assets/lenders/chase.png,T8-LOGO-1",
        "InBranchBizCC,Apply at one Elan bank then a second,,"
      ].join("\n");
      const r = await api({ body: { action: "import", csv }, token: owner.token });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.imported, 1);
      assert.equal(r.body.skipped_tips, 1);
      const rows = await lenderRows();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, "T8 Fixture Logo Bank");
      assert.equal(rows[0].logo_path, "/assets/lenders/chase.png");
    });

    test("a closer cannot import the lender book", async () => {
      await wipeLenders();
      const r = await api({ body: { action: "import", csv: FIXTURE_CSV }, token: closer.token });
      assert.equal(r.code, 403, JSON.stringify(r.body));
      assert.equal((await lenderRows()).length, 0);
    });

    test("the import lands in the caller's company only", async () => {
      await wipeLenders();
      await api({ body: { action: "import", csv: FIXTURE_CSV }, token: owner.token });
      assert.equal((await lenderRows(org)).length, 3);
      assert.equal((await lenderRows(foreignOrg)).length, 0);
    });
  });

  /* ── T8-10: an empty book is why nobody matches ────────────────────────── */

  describe("why no client matched a lender", () => {

    test("with an empty lender table the match count is 0 — and that is the only cause", async () => {
      await wipeLenders();
      const r = await call(matchesHandler, {
        method: "GET", query: { client_id: client }, token: owner.token
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.ok, true);
      assert.equal(r.body.match_count, 0);
      assert.deepEqual(r.body.matches, []);
      // Nothing was refused. There was simply nothing to refuse.
      assert.deepEqual(r.body.skipped, []);
    });

    test("import three fixture lenders and the same client immediately matches them", async () => {
      await wipeLenders();
      const csv = [
        "lender_table,name,eligible_states,bureaus_pulled,priority_tier,active,external_row_id",
        "OnlineBizCC,T8 Match Alpha,All States,EQ,1,true,T8-M-1",
        // Unknown coverage: must be included, not treated as a restriction.
        "BizLOC_Stated,T8 Match Beta,,EX,,true,T8-M-2",
        // The client's own state, spelled as a list.
        'PersonalCC,T8 Match Gamma,"TX, OK",TU,3,true,T8-M-3',
        // Not eligible where this client is.
        "PersonalLoans,T8 Match Delta,NY,EQ,2,true,T8-M-4",
        // Switched off — must never match.
        "PersonalLOC,T8 Match Epsilon,All States,EQ,1,false,T8-M-5"
      ].join("\n");

      const imp = await api({ body: { action: "import", csv }, token: owner.token });
      assert.equal(imp.code, 200, JSON.stringify(imp.body));
      assert.equal(imp.body.imported, 5);

      const r = await call(matchesHandler, {
        method: "GET", query: { client_id: client }, token: owner.token
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.match_count, 3, "the empty book was the whole problem");

      const names = r.body.matches.map((m) => m.name).sort();
      assert.deepEqual(names, ["T8 Match Alpha", "T8 Match Beta", "T8 Match Gamma"]);
      // A lender with no stated coverage is included, not silently blocked.
      assert.ok(names.includes("T8 Match Beta"));
      // A lender that does not serve this state is out; an inactive one never appears.
      assert.equal(names.includes("T8 Match Delta"), false);
      assert.equal(names.includes("T8 Match Epsilon"), false);

      // A missing priority tier sorts last, it does not jump to the front.
      const tiers = r.body.matches.map((m) => m.priority_tier);
      assert.equal(tiers[0], 1, "tier 1 leads");
      assert.equal(tiers[tiers.length - 1], null, "the untiered lender is last, not first");
    });

    test("the imported rows are the same rows the Lenders screen reads back", async () => {
      const r = await call(readLenders, { method: "GET", query: {}, token: owner.token });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      const list = r.body.lenders || r.body.rows || r.body.items;
      assert.ok(Array.isArray(list), "the read endpoint returns a list: " + JSON.stringify(Object.keys(r.body)));
      assert.equal(list.length, 5);
      assert.ok(list.every((L) => L.id), "every row carries an id, so its Save button can post one");
    });

    test("match uses company state when the person row has none", async () => {
      await wipeLenders();
      const csv = [
        "lender_table,name,eligible_states,bureaus_pulled,priority_tier,active,external_row_id",
        "OnlineBizCC,T8 CoState All,All States,EQ,1,true,T8-CS-1",
        "PersonalCC,T8 CoState Texas,TX,TU,2,true,T8-CS-2",
        "PersonalLoans,T8 CoState NewYork,NY,EQ,2,true,T8-CS-3"
      ].join("\n");
      const imp = await api({ body: { action: "import", csv }, token: owner.token });
      assert.equal(imp.code, 200, JSON.stringify(imp.body));
      assert.equal(imp.body.imported, 3);

      const companyClient = (await db.query(
        `INSERT INTO clients (org_id, first_name, last_name, custom_fields)
         VALUES ($1,'T8','CompanyState','{}'::jsonb) RETURNING id`,
        [org]
      )).rows[0].id;
      await db.query(
        `INSERT INTO businesses (org_id, client_id, name, entity_data)
         VALUES ($1,$2,'T8 Texas Co',$3::jsonb)`,
        [org, companyClient, JSON.stringify({ state: "TX" })]
      );

      const r = await call(matchesHandler, {
        method: "GET", query: { client_id: companyClient }, token: owner.token
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.summary.client_state, "TX");
      const names = r.body.matches.map((m) => m.name).sort();
      assert.deepEqual(names, ["T8 CoState All", "T8 CoState Texas"]);
      assert.equal(names.includes("T8 CoState NewYork"), false);
    });
  });

  /* ── the shape of the file Chris has to hand over ──────────────────────── */

  test("the importer accepts every column it advertises", async () => {
    await wipeLenders();
    // One header line naming every supported column, one row using them all.
    // If a column name here ever stops matching the database, this fails.
    const values = LENDER_CSV_COLUMNS.map((c) => {
      if (c === "lender_table") return "OnlineBizCC";
      if (c === "name") return "T8 Every Column";
      if (c === "active") return "true";
      if (c === "priority_tier") return "1";
      if (c === "external_row_id") return "T8-ALL-1";
      if (["typical_approval_range", "average_starting_loc", "max_known_loc",
        "minimum_deposit", "minimum_revenue_threshold"].includes(c)) return "1000";
      if (c === "minimum_time_in_business_years") return "2";
      if (c === "apr_range_pct") return "12.5";
      if (c === "repayment_terms_months") return "24";
      return "x";
    });
    const csv = LENDER_CSV_COLUMNS.join(",") + "\n" + values.join(",");

    const r = await api({ body: { action: "import", csv }, token: owner.token });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.errors, [], "no column was rejected as unknown");
    assert.equal(r.body.imported, 1);
    assert.equal((await lenderRows()).length, 1);
  });

  test("a column the importer does not know is reported, not silently dropped", async () => {
    await wipeLenders();
    const r = await api({
      body: {
        action: "import",
        csv: "lender_table,name,Bank / Issuer Name\nOnlineBizCC,T8 Unknown Col,ignored"
      },
      token: owner.token
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.imported, 1);
    assert.ok(
      r.body.errors.some((e) => /Unknown columns ignored/.test(e)),
      "the user is told which headings were not understood"
    );
  });
});
