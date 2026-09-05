// GET /api/read/client-progress against a real Postgres.
//
// FOUR CLIENTS, DRIVEN THROUGH THE REAL ENDPOINT, because every field in this
// payload is a claim about a stored row and a unit test with a hand-made object
// cannot fail the way a wrong column name fails:
//
//   MID     — mid-round, two real pulls, an open dispute case, a card in
//             transit, a checklist with an overdue item and a paid alternative.
//   NEW     — brand new. No pull, no case, no card, no waypoint, no document.
//             Every score must come back null, and nothing may come back 0.
//   ONEBIZ  — one business with an Intelliscore.
//   TWOBIZ  — two businesses, so the toggle has something to toggle between.
//             F44 in the 2026-09-03 walkthrough was a business fact that never
//             reached the engine, so this path is RUN rather than reasoned about.
//
// IT LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test glob is
// "src/**" and "scripts/**"; a test placed in api/ is never collected and passes
// forever by never running (CLAUDE.md §12).
//
// THE SESSIONS ARE REAL. requirePrincipal runs against account_sessions, so the
// "a client reads their own file and nobody else's" rule is exercised rather
// than assumed.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs. A skipped
// .pg.test.mjs is not green.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createAccountSession } from "../auth/account-session.mjs";
import { createSession } from "../auth/session.mjs";
import { moveRepairCard } from "../repair/pipeline.mjs";
import { upsertWaypoint, requestPaidService } from "../waypoints/store.mjs";
import { priceDisputeRound } from "../waypoints/pricing.mjs";
/* The one name api/paid-services.mjs will accept on a POST. Asserting against
   this rather than a literal is the point: the two assertions below used to
   pin "dispute_round", which is the STORED kind (331:147-149) and is refused by
   that endpoint with `unknown_service`. So the response satisfied its test and
   could not be acted on. */
import { SERVICE_KEY } from "../paid-services/round.mjs";
import { claimsFiled } from "../progress/timeline.mjs";
import handler from "../../api/read/client-progress.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const EMAIL_LIKE = "cp.pg.test.%@example.com";
const ACCT_LIKE = "cp_pg_test_%@example.com";
const STAFF_EMAIL = "cp_pg_test_staff@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

/* PRINT WHAT THE ENDPOINT ACTUALLY SAID. The brief asks for the real JSON for
   each of the four clients, and a test that only asserts is a test whose author
   is the only person who ever saw the answer. */
const SHOW = process.env.PROGRESS_SHOW === "1";

describe("/api/read/client-progress", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, staffToken;
  const c = {};      // name → { id, token }

  const loadAs = async (token, query = {}) => {
    const r = res();
    await handler({ method: "GET", query, headers: { authorization: "Bearer " + token } }, r);
    return r;
  };

  const load = async (name) => {
    const r = await loadAs(c[name].token);
    assert.equal(r.code, 200, `${name} did not answer 200: ` + JSON.stringify(r.body));
    if (SHOW) console.log(`\n──── ${name} ────\n` + JSON.stringify(r.body, null, 2));
    return r.body;
  };

  async function makeClient(name, { firstName }) {
    const email = `cp.pg.test.${name}@example.com`;
    const id = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
       VALUES ($1,$2,'Progress',$3,'{}'::jsonb) RETURNING id`,
      [org, firstName, email]
    )).rows[0].id;
    const accountId = (await db.query(
      `INSERT INTO accounts (org_id, kind, email, name, status, client_id, password_hash)
       VALUES ($1,'client',$2,$3,'active',$4,'scrypt$placeholder') RETURNING id`,
      [org, `cp_pg_test_${name}@example.com`, firstName, id]
    )).rows[0].id;
    const token = (await createAccountSession(db, { accountId, orgId: org })).token;
    c[name] = { id, token, accountId };
    return id;
  }

  /* documents (030) is append-only by trigger — "documents are never deleted,
     register a superseding version instead" — which is right for the product
     and impossible for a fixture. The scoped disable/enable is the pattern
     src/http/portal-summary-stage.pg.test.mjs already uses for entitlements and
     contracts, and the try/finally is the load-bearing part: a throw between the
     two leaves the guard OFF for every test that runs after this one in the same
     database. */
  async function withTriggerOff(table, trigger, run) {
    await db.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
    try {
      await run();
    } finally {
      await db.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
    }
  }

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [EMAIL_LIKE]))
      .rows.map((x) => x.id);
    if (ids.length) {
      await db.query(`DELETE FROM crs_results WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM businesses WHERE client_id = ANY($1)`, [ids]);
      await withTriggerOff("documents", "trg_documents_no_delete", async () => {
        await db.query(`DELETE FROM document_versions WHERE document_id IN
                          (SELECT id FROM documents WHERE client_id = ANY($1))`, [ids]);
        await db.query(`DELETE FROM documents WHERE client_id = ANY($1)`, [ids]);
      });
      await db.query(`DELETE FROM paid_service_requests WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM client_waypoints WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM repair_decision_log WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM dispute_items WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM dispute_letters WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM dispute_cases WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM repair_programs WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM cards WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [ACCT_LIKE]);
    await db.query(`DELETE FROM staff WHERE email = $1`, [STAFF_EMAIL]);
  }

  before(async () => {
    if (!HAVE_DB) return;
    org = await resolveDefaultOrg(db);
    await purge();

    // ── MID: mid-round, two pulls ─────────────────────────────────────────
    const mid = await makeClient("mid", { firstName: "Mid" });
    // January baseline — all three bureaus answered.
    await db.query(
      `INSERT INTO crs_results (org_id, client_id, result, outcome_tier, is_demo, created_at)
       VALUES ($1,$2,$3,'REPAIR_ONLY',false,'2026-01-12T00:00:00Z')`,
      [org, mid, JSON.stringify({ scores: { ex: 615, eq: 612, tu: 608 } })]
    );
    // March re-pull — TransUnion did not answer this time. It must stay null on
    // the series point and stay 608 on the panel, dated January.
    await db.query(
      `INSERT INTO crs_results (org_id, client_id, result, outcome_tier, is_demo, created_at)
       VALUES ($1,$2,$3,'REPAIR_ONLY',false,'2026-03-01T00:00:00Z')`,
      [org, mid, JSON.stringify({ scores: { ex: 651, eq: 648 } })]
    );
    await db.query(`UPDATE clients SET outcome_tier = 'REPAIR_ONLY' WHERE id = $1`, [mid]);
    await db.query(
      `INSERT INTO repair_programs (org_id, client_id, program, rounds_cap, price_total)
       VALUES ($1,$2,'full',6,1500.00)`,
      [org, mid]
    );
    const caseId = (await db.query(
      `INSERT INTO dispute_cases (org_id, client_id, bureau, round, status, response_due_at)
       VALUES ($1,$2,'EX','R2','awaiting_response','2026-04-02T00:00:00Z') RETURNING id`,
      [org, mid]
    )).rows[0].id;
    await db.query(
      `INSERT INTO dispute_items (case_id, org_id, client_id, rule_id, severity, round, status)
       VALUES ($1,$2,$3,'M2-001','high','R2','sent'),
              ($1,$2,$3,'M2-002','high','R1','deleted'),
              ($1,$2,$3,'M2-003','med','R1','deleted')`,
      [caseId, org, mid]
    );
    await moveRepairCard(db, { orgId: org, clientId: mid, stageKey: "in_transit" });
    /* A decision log line that WOULD claim a regulator complaint was filed. It
       is written deliberately: the guard has to be proved against a real stored
       row, not against a string a unit test made up. */
    await db.query(
      `INSERT INTO repair_decision_log (org_id, client_id, decision, created_at)
       VALUES ($1,$2,'repair.letters.sent','2026-03-03T00:00:00Z'),
              ($1,$2,'cfpb_complaint_filed','2026-03-04T00:00:00Z'),
              ($1,$2,'cfpb_complaint_mailed','2026-03-05T00:00:00Z'),
              ($1,$2,'state_ag_complaint_sent','2026-03-06T00:00:00Z')`,
      [org, mid]
    );
    await db.query(
      `INSERT INTO documents
         (org_id, client_id, document_key, kind, subtype, title, storage_key, mime_type, generated_at)
       VALUES ($1,$2,$3,'deliverable','credit_analysis_report','Financial Profile Assessment',
               'test/cp/analysis.html','text/html','2026-03-01T00:00:00Z')`,
      [org, mid, `deliverable|credit_analysis_report|${mid}`]
    );
    // The checklist: one overdue client job with a paid alternative, one done.
    await upsertWaypoint(db, {
      orgId: org, clientId: mid, key: "proof_of_address", title: "Proof of address",
      position: 3, ownerKind: "client", dueAt: "2026-02-24T00:00:00Z"
    });
    await upsertWaypoint(db, {
      orgId: org, clientId: mid, key: "run_a_round", title: "Run a round now",
      position: 5, ownerKind: "client",
      paidAlternativePriceCents: 10000,
      paidAlternativeLabel: "Run it for me",
      paidAlternativeKind: "dispute_round"
    });
    await upsertWaypoint(db, {
      orgId: org, clientId: mid, key: "mail_round_2", title: "Mail round 2",
      position: 6, ownerKind: "fundhub"
    });

    // ── R4: a CFPB complaint we built and POSTED ──────────────────────────
    // The whole point of this fixture: the letter is in the post, the row says
    // 'sent', and the page must still never call it filed.
    const r4 = await makeClient("r4", { firstName: "Rfour" });
    const r4Case = (await db.query(
      `INSERT INTO dispute_cases (org_id, client_id, bureau, round, status, response_due_at)
       VALUES ($1,$2,'EX','R4','awaiting_response','2026-05-02T00:00:00Z') RETURNING id`,
      [org, r4]
    )).rows[0].id;
    await db.query(
      `INSERT INTO dispute_letters
         (case_id, org_id, client_id, bureau, round, status, body_text, target,
        send_claimed_at, mailed_at, created_at)
       VALUES ($1,$2,$3,'EX','R4','sent','CFPB complaint body','cfpb',
               '2026-04-03T00:00:00Z','2026-04-04T00:00:00Z','2026-04-01T00:00:00Z')`,
      [r4Case, org, r4]
    );
    await db.query(
      `INSERT INTO repair_decision_log (org_id, client_id, decision, created_at)
       VALUES ($1,$2,'repair.round.escalated','2026-04-01T00:00:00Z'),
              ($1,$2,'cfpb_complaint_mailed','2026-04-04T00:00:00Z')`,
      [org, r4]
    );
    await moveRepairCard(db, { orgId: org, clientId: r4, stageKey: "in_transit" });

    // ── R5: a state AG complaint BUILT but not yet posted ─────────────────
    const r5 = await makeClient("r5", { firstName: "Rfive" });
    const r5Case = (await db.query(
      `INSERT INTO dispute_cases (org_id, client_id, bureau, round, status, response_due_at)
       VALUES ($1,$2,'EQ','R5','awaiting_response','2026-06-02T00:00:00Z') RETURNING id`,
      [org, r5]
    )).rows[0].id;
    // R4 was posted earlier; R5 is only generated. Two rungs, two states.
    await db.query(
      `INSERT INTO dispute_letters
         (case_id, org_id, client_id, bureau, round, status, body_text, target, mailed_at, created_at)
       VALUES ($1,$2,$3,'EQ','R4','sent','CFPB complaint body','cfpb',NULL,'2026-04-01T00:00:00Z'),
              ($1,$2,$3,'EQ','R5','generated','State AG complaint body','state_ag',NULL,'2026-05-01T00:00:00Z')`,
      [r5Case, org, r5]
    );
    await db.query(
      `INSERT INTO repair_decision_log (org_id, client_id, decision, created_at)
       VALUES ($1,$2,'state_ag_complaint_filed','2026-05-01T00:00:00Z')`,
      [org, r5]
    );
    await moveRepairCard(db, { orgId: org, clientId: r5, stageKey: "in_transit" });

    // ── NEW: nothing on file at all ───────────────────────────────────────
    await makeClient("fresh", { firstName: "Fresh" });

    // ── ONEBIZ ────────────────────────────────────────────────────────────
    const oneBiz = await makeClient("onebiz", { firstName: "Onebiz" });
    await db.query(
      `INSERT INTO businesses (org_id, client_id, name, age_months, entity_data)
       VALUES ($1,$2,'Sim Five Holdings LLC',30,$3)`,
      [org, oneBiz, JSON.stringify({ scores: { intelliscore: 42 } })]
    );

    // ── TWOBIZ: the toggle ────────────────────────────────────────────────
    const twoBiz = await makeClient("twobiz", { firstName: "Twobiz" });
    await db.query(
      `INSERT INTO businesses (org_id, client_id, name, age_months, entity_data, created_at)
       VALUES ($1,$2,'First Venture LLC',48,$3,'2026-01-01T00:00:00Z')`,
      [org, twoBiz, JSON.stringify({ commercialScore: { score: 71 } })]
    );
    await db.query(
      `INSERT INTO businesses (org_id, client_id, name, age_months, entity_data, created_at)
       VALUES ($1,$2,'Second Venture LLC',6,'{}'::jsonb,'2026-02-01T00:00:00Z')`,
      [org, twoBiz]
    );

    const staffId = (await db.query(
      `INSERT INTO staff (org_id, name, email, role, status)
       VALUES ($1,'CP Tester',$2,'owner','active') RETURNING id`,
      [org, STAFF_EMAIL]
    )).rows[0].id;
    staffToken = (await createSession(db, { staffId, orgId: org })).token;
  });

  after(async () => {
    if (!HAVE_DB) return;
    await purge();
    await close();
  });

  /* ── AUTH ───────────────────────────────────────────────────────────── */

  test("a client reads their own file and cannot name another", async () => {
    const own = await loadAs(c.mid.token);
    assert.equal(own.code, 200);
    // Naming somebody else's id changes nothing: the query string is never read
    // on a client principal.
    const spoof = await loadAs(c.mid.token, { client_id: c.twobiz.id });
    assert.equal(spoof.code, 200);
    assert.deepEqual(spoof.body.scores.business, own.body.scores.business,
      "a client_id in the query string moved a client onto another file");
    assert.equal(spoof.body.scores.business.length, 0,
      "MID has no business; TWOBIZ's two must not appear");
  });

  test("no session is a 401, not an empty page", async () => {
    const r = res();
    await handler({ method: "GET", query: {}, headers: {} }, r);
    assert.equal(r.code, 401);
  });

  test("POST is refused", async () => {
    const r = res();
    await handler({ method: "POST", query: {}, headers: { authorization: "Bearer " + c.mid.token } }, r);
    assert.equal(r.code, 405);
  });

  /* ── MID ────────────────────────────────────────────────────────────── */

  test("MID: the stage, the round and the cap are the stored rows", async () => {
    const b = await load("mid");
    assert.equal(b.ok, true);
    assert.equal(b.stage.key, "in_transit");
    assert.equal(b.stage.roundCurrent, 2);
    assert.equal(b.stage.roundCap, 6, "rounds_cap comes from repair_programs");
    assert.equal(b.stage.waitingOn, "bureaus");
    assert.ok(b.stage.enteredAt, "a card in a stage has an entered_at");
    assert.equal(b.stage.expectedResponseBy, "2026-04-02T00:00:00.000Z");
  });

  test("MID: two pulls, and a bureau that stopped answering keeps its own date", async () => {
    const b = await load("mid");
    const by = Object.fromEntries(b.scores.personal.map((p) => [p.bureau, p]));
    assert.equal(by.experian.score, 651);
    assert.equal(by.experian.pulledAt, "2026-03-01T00:00:00.000Z");
    assert.equal(by.equifax.score, 648);
    assert.equal(by.transunion.score, 608, "TransUnion's January number is still real");
    assert.equal(by.transunion.pulledAt, "2026-01-12T00:00:00.000Z",
      "and it is dated January, not March");
  });

  test("MID: the series has both pulls and the March point keeps TransUnion null", async () => {
    const b = await load("mid");
    assert.equal(b.movement.series.length, 2);
    assert.equal(b.movement.series[0].at, "2026-01-12T00:00:00.000Z");
    assert.deepEqual(
      [b.movement.series[0].experian, b.movement.series[0].equifax, b.movement.series[0].transunion],
      [615, 612, 608]
    );
    assert.strictEqual(b.movement.series[1].transunion, null,
      "the March pull had no TransUnion score and must not borrow January's");
  });

  test("MID: the middle score moves, and it needs all three to exist", async () => {
    const b = await load("mid");
    assert.equal(b.movement.middleScoreBaseline, 612, "middle of 615/612/608");
    assert.strictEqual(b.movement.middleScoreNow, null,
      "the March pull has two bureaus, and 'middle of three' is undefined over two");
    assert.equal(b.movement.baselineAt, "2026-01-12T00:00:00.000Z");
    assert.equal(b.movement.itemsRemoved, 2);
    assert.equal(b.movement.itemsDisputed, 3);
  });

  test("MID: the checklist carries overdue as a computed fact and the paid price in cents", async () => {
    const b = await load("mid");
    const by = Object.fromEntries(b.waypoints.map((w) => [w.title, w]));
    assert.equal(by["Proof of address"].overdue, true, "due 2026-02-24 and still open");
    assert.strictEqual(by["Proof of address"].paidAlternative, null,
      "no paid alternative is null — it is not free and it is not zero");
    assert.equal(by["Run a round now"].paidAlternative.priceCents, 10000);
    assert.equal(by["Run a round now"].paidAlternative.serviceKey, SERVICE_KEY,
      "the key a screen posts back must be the one api/paid-services.mjs accepts");
    assert.equal(by["Run a round now"].paidAlternative.serviceKey, "paid_round",
      "and that is the value docs/workflows/portal-progress-contract.md:87 specifies");
    assert.strictEqual(by["Mail round 2"].overdue, false, "no due date is not overdue");
  });

  test("MID: nextStep names exactly one waypoint, and it is the client's", async () => {
    const b = await load("mid");
    assert.ok(b.nextStep, "there is open work, so there is a next step");
    assert.equal(b.nextStep.owner, "client");
    const chosen = b.waypoints.find((w) => w.id === b.nextStep.waypointId);
    assert.equal(chosen.title, "Proof of address", "the lowest-positioned open client row");
  });

  test("MID: the deliverable is a pointer, and the personal panels link to it", async () => {
    const b = await load("mid");
    assert.equal(b.deliverables.length, 1);
    assert.equal(b.deliverables[0].subtype, "credit_analysis_report");
    const docId = b.deliverables[0].documentId;
    for (const p of b.scores.personal) {
      if (p.score == null) assert.strictEqual(p.reportDocumentId, null);
      else assert.equal(p.reportDocumentId, docId);
    }
  });

  test("MID: the timeline never says a regulator complaint was filed", async () => {
    const b = await load("mid");
    assert.ok(b.timeline.length >= 4, "all four decision rows reached the timeline");
    for (const line of b.timeline) {
      assert.equal(claimsFiled(line.text), false,
        `the timeline claimed a filing: ${line.text}`);
    }
    /* THE ALLOWLIST, PROVED AGAINST REAL STORED ROWS. Three of the four decision
       rows are strings nobody writes today, including the two the old denylist
       printed verbatim. Each renders as the neutral line, so no regulator is
       named on the timeline at all. */
    for (const line of b.timeline) {
      assert.ok(!/cfpb|attorney general|state ag/i.test(line.text),
        `a regulator reached the timeline: ${line.text}`);
      assert.ok(!/complaint/i.test(line.text),
        `the stored decision name leaked: ${line.text}`);
    }
    const neutral = b.timeline.filter((l) => /progress update/.test(l.text));
    assert.equal(neutral.length, 3,
      "the three unknown decision names all render as the neutral line");
    assert.ok(b.timeline.some((l) => /letters mailed/.test(l.text)),
      "the one allowlisted decision keeps its own words");
  });

  /* ── ROUNDS 4 AND 5: PREPARED, SENT, FILED ───────────────────────────────
   *
   * Owner-set 2026-09-05. "sent" renders as sent and never as filed. "filed"
   * is true only because the client said so, and the payload names who said it.
   * Nothing in this branch writes that report, so `filed` is false everywhere.
   */

  test("R4: a POSTED CFPB complaint reads as sent, and nowhere as filed", async () => {
    const b = await load("r4");
    assert.equal(b.escalations.length, 1, "one rung reached, so one entry");
    const [e] = b.escalations;
    assert.equal(e.round, 4);
    assert.equal(e.target, "cfpb");
    assert.equal(e.state, "sent");
    assert.equal(e.preparedAt, "2026-04-01T00:00:00.000Z");
    assert.equal(e.sentAt, "2026-04-04T00:00:00.000Z");
    assert.equal(e.filed, false);
    assert.equal(e.filedAt, null);
    assert.equal(e.filedReportedBy, null);
    assert.equal(e.caseNumber, null);
  });

  test("R5: a BUILT-not-posted state AG complaint reads as prepared", async () => {
    const b = await load("r5");
    assert.equal(b.escalations.length, 2, "R4 and R5 both have letter rows");
    const r4 = b.escalations.find((x) => x.round === 4);
    const r5 = b.escalations.find((x) => x.round === 5);
    // R4 here is status 'sent' with NO mailed_at — the shape recordComplaintFiling
    // actually writes. Sent, with an unknown date, and no invented one.
    assert.equal(r4.state, "sent");
    assert.equal(r4.sentAt, null, "created_at must not stand in for a mailing date");
    assert.equal(r5.target, "state_ag");
    assert.equal(r5.state, "prepared");
    assert.equal(r5.preparedAt, "2026-05-01T00:00:00.000Z");
    assert.equal(r5.sentAt, null);
    assert.equal(r5.filed, false);
  });

  test("no string ANYWHERE in the R4 or R5 payload asserts a filing", async () => {
    /* THE WHOLE RESPONSE, WALKED. Every string value in the entire JSON body for
       three clients — not just the timeline and not just the escalations. This
       is the test that fails if a FUTURE field starts carrying a phrase.
       Wide on purpose: "filings" and "files" are included so the plural and the
       verb form cannot slip past. */
    const FILING = /\b(filed|filing|filings|files|submitted|submission|lodged)\b/i;
    const REGULATOR = /\b(cfpb|consumer financial protection|attorney general|state ag)\b/i;
    /* TWO STRINGS IN THIS PAYLOAD NAME A REGULATOR, BOTH DELIBERATELY, AND
       NEITHER SAYS ANYTHING HAPPENED:
         stage.roundLabel                      "CFPB complaint" — the rung's name
         paidServices[].components[].label     the price line for the add-on
       They are listed here by exact value rather than waved through by a loose
       pattern, so a THIRD one cannot appear without this test failing. */
    const KNOWN_REGULATOR_STRINGS = new Set([
      "CFPB complaint",
      "State attorney general complaint",
      "CFPB and state attorney general filings",
      // escalations[].target — a machine enum the screen switches on, not copy.
      "cfpb",
      "state_ag"
    ]);
    for (const name of ["r4", "r5", "mid"]) {
      const body = await load(name);
      const strings = [];
      (function walk(v) {
        if (typeof v === "string") { strings.push(v); return; }
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (v && typeof v === "object") { Object.values(v).forEach(walk); }
      })(body);
      assert.ok(strings.length > 0, `${name} returned no strings at all`);
      for (const s of strings) {
        if (KNOWN_REGULATOR_STRINGS.has(s)) continue;
        assert.equal(claimsFiled(s), false,
          `${name}: a value asserts a regulator filing: ${s}`);
        assert.ok(!(FILING.test(s) && REGULATOR.test(s)),
          `${name}: a value pairs a regulator with a filing word: ${s}`);
        assert.ok(!REGULATOR.test(s),
          `${name}: a NEW string names a regulator: "${s}" — decide what it may ` +
          "say and add it to KNOWN_REGULATOR_STRINGS, do not widen a pattern");
      }
      /* The timeline is held to the stricter rule: no filing word at all, and no
         regulator at all. Its words come from the allowlist, so this is what
         keeps the allowlist honest against the real database. */
      for (const line of body.timeline) {
        assert.ok(!FILING.test(line.text),
          `${name}: a timeline line uses a filing word: ${line.text}`);
        assert.ok(!REGULATOR.test(line.text),
          `${name}: a timeline line names a regulator: ${line.text}`);
      }
      /* And the escalation entries themselves: the only place `state` may say
         "sent", and it may never say "filed" unless `filed` is true. */
      for (const e of body.escalations) {
        assert.ok(["prepared", "sent", "filed"].includes(e.state));
        if (e.state === "filed") {
          assert.equal(e.filed, true);
          assert.ok(e.filedAt, "filed with no date is not a filing");
          assert.ok(e.filedReportedBy, "filed with nobody who said so is not a filing");
        }
      }
    }
  });

  test("a client who never reached R4 has an EMPTY escalation list", async () => {
    const b = await load("fresh");
    assert.deepEqual(b.escalations, [],
      "no letter rows means no entry — not two placeholders reading 'not prepared'");
    const mid = await load("mid");
    assert.deepEqual(mid.escalations, [], "mid is on R2 and has no complaint letters");
  });

  test("filed is false for every client, because nothing writes the report yet", async () => {
    for (const name of ["mid", "r4", "r5", "fresh"]) {
      const b = await load(name);
      for (const e of b.escalations) {
        assert.equal(e.filed, false, `${name} round ${e.round} came back filed`);
        assert.equal(e.filedAt, null);
      }
    }
  });

  test("a client-reported filing IS honoured, and the payload says who said so", async () => {
    /* Proves the third state is wired to a real read and not a hardcoded false.
       The ping that writes this is wave 4; the fixture writes the same value by
       hand so the path can be driven now. */
    await db.query(
      `UPDATE clients
          SET custom_fields = jsonb_set(COALESCE(custom_fields,'{}'::jsonb),
              '{escalation_filings}',
              '{"R4":{"filedAt":"2026-04-20T00:00:00Z","reportedBy":"client","caseNumber":"260420-9911"}}'::jsonb)
        WHERE id = $1::uuid`,
      [c.r4.id]
    );
    try {
      const b = await load("r4");
      const [e] = b.escalations;
      assert.equal(e.state, "filed");
      assert.equal(e.filed, true);
      assert.equal(e.filedAt, "2026-04-20T00:00:00.000Z");
      assert.equal(e.filedReportedBy, "client", "the page must be able to say who said so");
      assert.equal(e.caseNumber, "260420-9911");
      // The earlier facts are still there underneath.
      assert.equal(e.sentAt, "2026-04-04T00:00:00.000Z");
      // And it still does not put a filing sentence anywhere in the body.
      assert.ok(b.timeline.every((l) => !claimsFiled(l.text)));
    } finally {
      await db.query(
        `UPDATE clients SET custom_fields = custom_fields - 'escalation_filings'
          WHERE id = $1::uuid`,
        [c.r4.id]
      );
    }
  });

  test("MID: the paid round is offered, priced from pricing.mjs, and not in flight", async () => {
    const b = await load("mid");
    const offer = b.paidServices.find((s) => s.serviceKey === SERVICE_KEY);
    assert.ok(offer, "the round is not offered under the name the write endpoint accepts");
    assert.equal(offer.serviceKey, "paid_round",
      "portal-progress-contract.md:106 names this service, and the screen selects on it");
    assert.ok(offer);
    assert.equal(offer.available, true, "MID holds REPAIR_ONLY, so the round is offered");
    assert.equal(offer.inFlight, false);
    const priced = priceDisputeRound({ creditorLetter: true, escalationFilings: true });
    assert.deepEqual(
      offer.components.map((x) => x.priceCents),
      priced.components.map((x) => x.amount_cents)
    );
    assert.deepEqual(offer.components.map((x) => x.required), [true, false, false]);
  });

  test("MID: an open paid request flips inFlight and closes the button", async () => {
    const before = await load("mid");
    assert.equal(before.paidServices[0].inFlight, false);
    const priced = priceDisputeRound({});
    await requestPaidService(db, {
      orgId: org, clientId: c.mid.id, serviceKind: "dispute_round",
      requestedByKind: "client", requestedByAccountId: c.mid.accountId,
      components: priced.components,
      status: "awaiting_payment", idempotencyKey: "cp-pg-test-round-1"
    });
    const after = await load("mid");
    assert.equal(after.paidServices[0].inFlight, true);
    assert.equal(after.paidServices[0].available, false,
      "the screen refuses a second press from the payload, not from a disabled button");
    await db.query(`DELETE FROM paid_service_requests WHERE idempotency_key = $1`,
      ["cp-pg-test-round-1"]);
  });

  test("MID: a paid round does not touch repair_programs.rounds_cap", async () => {
    const priced = priceDisputeRound({});
    await requestPaidService(db, {
      orgId: org, clientId: c.mid.id, serviceKind: "dispute_round",
      requestedByKind: "client", requestedByAccountId: c.mid.accountId,
      components: priced.components,
      roundNo: 1, status: "awaiting_payment", idempotencyKey: "cp-pg-test-round-2"
    });
    /* MONEY LANDS. 331's paid_state_ck refuses status='paid' without a paid_at,
       and requestPaidService() does not take one — recording a payment is the
       payment handler's job, not the quoting store's. The UPDATE here is what
       that handler will do. */
    await db.query(
      `UPDATE paid_service_requests
          SET status = 'paid', paid_at = now(), amount_paid_cents = price_total_cents
        WHERE idempotency_key = $1`,
      ["cp-pg-test-round-2"]
    );
    const b = await load("mid");
    assert.equal(b.stage.roundCap, 6, "the cap is untouched by a self-serve round");
    assert.equal(b.stage.roundCurrent, 2, "and so is the program's round counter");
    await db.query(`DELETE FROM paid_service_requests WHERE idempotency_key = $1`,
      ["cp-pg-test-round-2"]);
  });

  /* ── NEW ────────────────────────────────────────────────────────────── */

  test("NEW: every score is null end to end, and nothing anywhere is zero", async () => {
    const b = await load("fresh");
    assert.equal(b.scores.personal.length, 3);
    for (const p of b.scores.personal) {
      assert.strictEqual(p.score, null, `${p.bureau} must be null, got ${JSON.stringify(p.score)}`);
      assert.strictEqual(p.pulledAt, null);
      assert.strictEqual(p.reportDocumentId, null);
    }
    assert.deepEqual(b.scores.business, [], "no business on file is an empty array");
    assert.strictEqual(b.movement.middleScoreNow, null);
    assert.strictEqual(b.movement.middleScoreBaseline, null);
    assert.strictEqual(b.movement.baselineAt, null);
    assert.deepEqual(b.movement.series, []);
    assert.equal(b.movement.itemsRemoved, 0, "zero disputed items really is zero, not unknown");
    assert.equal(b.movement.itemsDisputed, 0);
    // The whole payload, walked: no field that means a score is a zero.
    const scoreish = JSON.stringify(b.scores);
    assert.equal(/:0[,}]/.test(scoreish), false, `a zero leaked into scores: ${scoreish}`);
  });

  test("NEW: an unknown stage stays unknown rather than defaulting to intake", async () => {
    const b = await load("fresh");
    assert.strictEqual(b.stage.key, null, "no card means we do not know the stage");
    assert.strictEqual(b.stage.roundCurrent, null);
    assert.strictEqual(b.stage.roundCap, null, "no program means no cap, not 0");
    assert.strictEqual(b.stage.enteredAt, null);
    assert.strictEqual(b.stage.expectedResponseBy, null);
    assert.strictEqual(b.stage.waitingOn, null);
    assert.strictEqual(b.nextStep, null, "no waypoints means nothing is owed by anybody");
    assert.deepEqual(b.waypoints, []);
    assert.deepEqual(b.deliverables, []);
    assert.deepEqual(b.timeline, []);
  });

  test("NEW: a client off the optimisation path is not offered a paid round", async () => {
    const b = await load("fresh");
    assert.equal(b.paidServices[0].available, false);
    assert.equal(b.paidServices[0].inFlight, false);
  });

  test("NEW: referral is not enrolled, and says so without inventing a link", async () => {
    const b = await load("fresh");
    assert.deepEqual(b.referral, { enrolled: false, shareUrl: null, code: null });
  });

  /* ── BUSINESS PANELS ────────────────────────────────────────────────── */

  test("ONEBIZ: one business gives one panel, keyed on the businesses row id", async () => {
    const b = await load("onebiz");
    assert.equal(b.scores.business.length, 1);
    const p = b.scores.business[0];
    assert.equal(p.name, "Sim Five Holdings LLC");
    assert.equal(p.score, 42);
    assert.equal(p.bureau, "experian_business");
    const real = (await db.query(
      `SELECT id FROM businesses WHERE client_id = $1::uuid`, [c.onebiz.id]
    )).rows[0].id;
    assert.equal(p.businessId, real, "the panel key is the primary key");
  });

  test("TWOBIZ: two businesses give two panels and the ids are stable across reads", async () => {
    const first = await load("twobiz");
    assert.equal(first.scores.business.length, 2, "the panel toggles, so both must be present");
    assert.deepEqual(first.scores.business.map((p) => p.name),
      ["First Venture LLC", "Second Venture LLC"]);
    assert.equal(first.scores.business[0].score, 71);
    assert.strictEqual(first.scores.business[1].score, null,
      "a business with no score reads null, never 0");
    assert.strictEqual(first.scores.business[1].pulledAt, null);

    const second = await load("twobiz");
    assert.deepEqual(
      second.scores.business.map((p) => p.businessId),
      first.scores.business.map((p) => p.businessId),
      "businessId must be the same on the next request or the toggle breaks"
    );
  });

  /* A DATE WE DO NOT HAVE IS NULL.
     `businesses.updated_at` is written by a trigger on every edit to the row, so
     it used to repaint the score as freshly pulled whenever anybody changed the
     address. This drives the real endpoint before and after an edit. */
  test("ONEBIZ: a business score carries NO pull date, before or after a row edit", async () => {
    const before = await load("onebiz");
    assert.equal(before.scores.business.length, 1);
    assert.equal(before.scores.business[0].score, 42, "the score is still read");
    assert.strictEqual(before.scores.business[0].pulledAt, null,
      "no per-business pull timestamp exists in this schema, so it must be null");

    const row = (await db.query(
      `SELECT updated_at FROM businesses WHERE client_id = $1::uuid`, [c.onebiz.id]
    )).rows[0];
    await db.query(
      `UPDATE businesses SET age_months = 31 WHERE client_id = $1::uuid`, [c.onebiz.id]
    );
    const bumped = (await db.query(
      `SELECT updated_at FROM businesses WHERE client_id = $1::uuid`, [c.onebiz.id]
    )).rows[0];
    /* Compared as epoch milliseconds on purpose: String(Date) prints only to the
       second and the trigger fires within the same second, which hides the move. */
    assert.notEqual(new Date(bumped.updated_at).getTime(), new Date(row.updated_at).getTime(),
      "the trigger really did move updated_at — this is what used to leak");

    const after = await load("onebiz");
    assert.strictEqual(after.scores.business[0].pulledAt, null,
      "editing the business row must not repaint the score as freshly pulled");
    assert.equal(after.scores.business[0].score, 42);
  });

  test("TWOBIZ: neither business panel invents a pull date", async () => {
    const b = await load("twobiz");
    for (const panel of b.scores.business) {
      assert.strictEqual(panel.pulledAt, null, `${panel.name} carried a pull date`);
    }
    // The personal panels DO have real pull dates — this is not a blanket null.
    const mid = await load("mid");
    assert.ok(mid.scores.personal.some((p) => p.pulledAt !== null),
      "personal panels still carry the crs_results date they were read from");
  });

  test("TWOBIZ: the business panels are not a single blended number", async () => {
    const b = await load("twobiz");
    assert.ok(Array.isArray(b.scores.business));
    assert.notEqual(b.scores.business.length, 1);
  });

  /* ── STAFF ──────────────────────────────────────────────────────────── */

  test("staff with no client_id is a 400, and with one gets that client's page", async () => {
    const bare = await loadAs(staffToken);
    assert.equal(bare.code, 400, "a staff caller who names nobody gets nobody");
    assert.equal(bare.body.error, "client_id_required");

    const bad = await loadAs(staffToken, { client_id: "not-a-uuid" });
    assert.equal(bad.code, 400);
    assert.equal(bad.body.error, "invalid_client_id");

    const named = await loadAs(staffToken, { client_id: c.twobiz.id });
    assert.equal(named.code, 200, JSON.stringify(named.body));
    assert.equal(named.body.scores.business.length, 2, "staff see TWOBIZ's two businesses");
  });

  test("a client id from another org never moves a client off their own file", async () => {
    const other = (await db.query(
      `INSERT INTO orgs (name, slug) VALUES ('CP Other Org','cp-other-org') RETURNING id`
    )).rows[0].id;
    try {
      const stranger = (await db.query(
        `INSERT INTO clients (org_id, first_name, last_name, email)
         VALUES ($1,'Other','Org','cp.pg.test.otherorg@example.com') RETURNING id`,
        [other]
      )).rows[0].id;
      // MID's own session still reads MID — the id is simply never consulted.
      const r = await loadAs(c.mid.token, { client_id: stranger });
      assert.equal(r.code, 200);
      assert.equal(r.body.stage.roundCap, 6, "still MID's file");
      await db.query(`DELETE FROM clients WHERE id = $1`, [stranger]);
    } finally {
      await db.query(`DELETE FROM orgs WHERE id = $1`, [other]);
    }
  });
});
