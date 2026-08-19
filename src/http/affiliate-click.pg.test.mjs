/* POST /api/public/affiliate-click — does a click actually land, and can this
 * endpoint be used to find out who the affiliates are? (T10-04)
 *
 * A pg test, not a unit test, because the thing being proven is the ROW. An
 * endpoint that answers 200 and writes nothing is exactly the failure this
 * exists to prevent, and only a database can tell those two apart.
 *
 * It goes through netlify/functions/api.mjs rather than importing the handler
 * directly, because a handler file is not a route: a handler missing from the
 * ROUTES map 404s locally and deployed, and that has shipped broken twice.
 * Calling the real front door proves the map entry as well as the handler.
 *
 * EVERY TEST BUILDS ITS OWN DATA. There is no shared affiliate and no shared
 * dead code: newAffiliate() and deadCode() hand each test a code nothing else
 * in this file will ever touch, so every assertion is about rows that test
 * wrote. They previously shared one affiliate and one dead code, which meant
 * "exactly one row exists" was true only because of the order the tests
 * happened to run in — a real assertion resting on an accident. Keep it this
 * way: if a test needs a code, it makes one.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { hashIp, hashUserAgent, parseAffiliateClickBody } from "../../api/public/affiliate-click.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const MARK = "t10affclick";

describe("public affiliate click", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, handler, priorSalt;
  let seq = 0;

  const post = async (body, headers = {}) =>
    handler(new Request("https://x/api/public/affiliate-click", {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json", host: "x" }, headers),
      body: JSON.stringify(body)
    }), {});
  const json = async (r) => { try { return JSON.parse(await r.text()); } catch { return null; } };

  const clicksFor = async (trackingId) => (await db.query(
    `SELECT affiliate_id, tracking_id_used, source, ip_hash, user_agent_hash
       FROM affiliate_link_clicks
      WHERE upper(tracking_id_used) = upper($1)
      ORDER BY occurred_at DESC`, [trackingId])).rows;

  // A fresh affiliate, with its own code, for whichever test asks. Nothing is
  // shared, so no test can be reading a row another test wrote.
  const newAffiliate = async () => {
    const row = (await db.query(
      `INSERT INTO affiliates (org_id, name, status) VALUES ($1,$2,'active')
       RETURNING id, tracking_id`, [org, `${MARK}-partner-${++seq}`])).rows[0];
    return { id: row.id, code: row.tracking_id };
  };
  // A code no affiliate holds. Unique per call for the same reason.
  const deadCode = () => `${MARK}-NO-SUCH-CODE-${++seq}`;

  before(async () => {
    ({ default: handler } = await import("../../netlify/functions/api.mjs"));
    priorSalt = process.env.CLICK_HASH_SALT;
    delete process.env.CLICK_HASH_SALT;
    org = await resolveDefaultOrg(db);
    await purge();
  });

  after(async () => {
    if (priorSalt === undefined) delete process.env.CLICK_HASH_SALT;
    else process.env.CLICK_HASH_SALT = priorSalt;
    await purge();
    await close();
  });

  async function purge() {
    if (!HAVE_DB) return;
    await db.query(`DELETE FROM affiliate_link_clicks WHERE tracking_id_used LIKE $1`, [`${MARK}%`]);
    await db.query(`DELETE FROM affiliate_link_clicks WHERE affiliate_id IN
      (SELECT id FROM affiliates WHERE name LIKE $1)`, [`${MARK}%`]);
    await db.query(`DELETE FROM affiliates WHERE name LIKE $1`, [`${MARK}%`]);
  }

  test("the route exists — a POST is not a 404", async () => {
    const aff = await newAffiliate();
    const r = await post({ ref: aff.code });
    assert.notEqual(r.status, 404,
      "public/affiliate-click is missing from the ROUTES map in netlify/functions/api.mjs");
    assert.equal(r.status, 200);
  });

  test("a click on a real code is recorded against that affiliate", async () => {
    const aff = await newAffiliate();
    await post({ ref: aff.code, source: "start-page" });
    const rows = await clicksFor(aff.code);
    assert.equal(rows.length, 1, "one click posted, one row written");
    assert.equal(rows[0].affiliate_id, aff.id);
    assert.equal(rows[0].source, "start-page");
  });

  test("the code is matched case-insensitively, the way the link is typed", async () => {
    const aff = await newAffiliate();
    const r = await post({ ref: String(aff.code).toLowerCase() });
    assert.equal(r.status, 200);
    const rows = await clicksFor(aff.code);
    assert.equal(rows.length, 1, "the lower-cased code wrote exactly one row");
    assert.equal(rows[0].affiliate_id, aff.id, "a lower-cased code still resolves");
  });

  test("an unknown code is still recorded, with affiliate_id NULL", async () => {
    const dead = deadCode();
    const r = await post({ ref: dead });
    assert.equal(r.status, 200);
    const rows = await clicksFor(dead);
    assert.equal(rows.length, 1, "a dead code is a fact worth keeping, not a discard");
    assert.strictEqual(rows[0].affiliate_id, null,
      "affiliate_id must stay NULL — unknown, never back-filled to somebody");
    assert.equal(rows[0].tracking_id_used, dead, "the code used is kept verbatim");
  });

  test("it does not leak whether a code exists", async () => {
    // THE ENUMERATION TEST. If a real code and a made-up one answered
    // differently in any way, anyone could walk the code space and read out the
    // partner roster — a list of businesses and their relationship to this
    // company. Status and body must be identical.
    const aff = await newAffiliate();
    const real = await post({ ref: aff.code });
    const fake = await post({ ref: deadCode() });
    assert.equal(real.status, fake.status);
    assert.deepEqual(await json(real), await json(fake));
  });

  test("no code at all is a bad request, and writes nothing", async () => {
    const before = (await db.query(
      `SELECT COUNT(*)::int AS n FROM affiliate_link_clicks`)).rows[0].n;
    const r = await post({ source: "start-page" });
    assert.equal(r.status, 400);
    assert.equal((await json(r)).error, "ref_required");
    const after_ = (await db.query(
      `SELECT COUNT(*)::int AS n FROM affiliate_link_clicks`)).rows[0].n;
    assert.equal(after_, before, "a rejected request writes no row");
  });

  test("GET is refused — this endpoint only ever writes", async () => {
    const r = await handler(new Request("https://x/api/public/affiliate-click",
      { headers: { host: "x" } }), {});
    assert.equal(r.status, 405);
  });

  test("no raw IP and no raw user agent are ever stored", async () => {
    const aff = await newAffiliate();
    const ua = "Mozilla/5.0 (t10 click test)";
    const ip = "203.0.113.7";
    await post({ ref: aff.code }, { "user-agent": ua, "x-forwarded-for": ip });
    const row = (await clicksFor(aff.code))[0];

    // With no salt configured the IP is NOT recorded at all. An unsalted hash of
    // an IPv4 address is reversible by brute force, so it would be the address.
    assert.strictEqual(row.ip_hash, null, "no salt configured means not recorded, not weakly hashed");

    // The user agent is a hash, never the string.
    assert.ok(row.user_agent_hash, "a user agent hash was stored");
    assert.notEqual(row.user_agent_hash, ua);
    assert.match(row.user_agent_hash, /^[0-9a-f]{32}$/);

    const all = (await db.query(
      `SELECT * FROM affiliate_link_clicks WHERE tracking_id_used = $1`, [aff.code])).rows;
    for (const r of all) {
      for (const v of Object.values(r)) {
        assert.notEqual(String(v), ip, "a raw IP address must never reach a column");
        assert.notEqual(String(v), ua, "a raw user agent must never reach a column");
      }
    }
  });

  test("with a salt configured the IP hash is a hash, not the address", () => {
    // Pure, so it needs no database and no HTTP.
    assert.strictEqual(hashIp("203.0.113.7", {}), null, "no salt, no value");
    const h = hashIp("203.0.113.7", { CLICK_HASH_SALT: "a-real-salt" });
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.notEqual(h, "203.0.113.7");
    // Different salts must not agree, or the salt is doing nothing.
    assert.notEqual(h, hashIp("203.0.113.7", { CLICK_HASH_SALT: "another-salt" }));
    assert.strictEqual(hashUserAgent(""), null);
  });

  test("the code is read from ref, code or a1, and length-capped", () => {
    assert.equal(parseAffiliateClickBody({ ref: " AFF-000001 " }).code, "AFF-000001");
    assert.equal(parseAffiliateClickBody({ code: "AFF-2" }).code, "AFF-2");
    assert.equal(parseAffiliateClickBody({ a1: "AFF-3" }).code, "AFF-3");
    assert.equal(parseAffiliateClickBody({}, { ref: "AFF-4" }).code, "AFF-4");
    assert.equal(parseAffiliateClickBody({}).ok, false);
    assert.equal(parseAffiliateClickBody({ ref: "x".repeat(500) }).code.length, 64);
  });
});
