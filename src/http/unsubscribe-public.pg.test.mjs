/* GET/POST /api/public/unsubscribe — the door behind the unsubscribe link.
 *
 * COMPLIANCE REVIEW REQUIRED. This endpoint captures a withdrawal of consent.
 *
 * Proven broken live on 2026-08-18 before this existed: /unsubscribe,
 * /unsubscribe.html, /api/unsubscribe and /api/public/unsubscribe all answered
 * 404, while 173 email templates told the reader they could unsubscribe.
 *
 * A pg test rather than a unit test because the thing being proven is the ROW.
 * A handler that answers 200 and writes no opt_outs row is exactly the failure
 * this endpoint exists to fix, and only a database can tell those apart.
 */
import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import handler from "../../api/public/unsubscribe.mjs";
import { signUnsubscribeUrl } from "../messaging/unsubscribe.mjs";
import { isOptedOut } from "../lib/opt-out.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG_SLUG = "t5-unsubscribe-test";
const SECRET = "unsub-endpoint-secret-0123456789abcdef0123456789ab";

let org = null;
let client = null;

/* The handler reads its secret from process.env, because that is where a
   deployed function gets it. Set for this file only and restored after. */
let priorSecret;
before(async () => {
  priorSecret = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  process.env.UNSUBSCRIBE_TOKEN_SECRET = SECRET;
  if (!HAS_DB) return;
  await purge();
  org = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,'T5 Unsubscribe Test Co') RETURNING id`, [ORG_SLUG])).rows[0].id;
  client = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email)
     VALUES ($1,'Unsub','Subject','unsub.subject@example.com') RETURNING id`, [org])).rows[0].id;
});

after(async () => {
  if (priorSecret === undefined) delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
  else process.env.UNSUBSCRIBE_TOKEN_SECRET = priorSecret;
  await purge();
  await close();
});

async function purge() {
  if (!HAS_DB) return;
  const r = await db.query(`SELECT id FROM orgs WHERE slug = $1`, [ORG_SLUG]);
  const id = r.rows[0]?.id;
  if (!id) return;
  await db.query(`DELETE FROM opt_outs WHERE org_id = $1`, [id]);
  await db.query(`DELETE FROM clients WHERE org_id = $1`, [id]);
  await db.query(`DELETE FROM orgs WHERE id = $1`, [id]);
}

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

const query = () => Object.fromEntries(
  new URL(signUnsubscribeUrl({ orgId: org, clientId: client, secret: SECRET }).url,
    "http://x.invalid").searchParams);

const call = async (method, q, body) => {
  const r = res();
  await handler({ method, headers: {}, query: q || {}, body: body || {} }, r);
  return r;
};

test("a GET on a valid link reports the state and DOES NOT unsubscribe anybody",
  { skip: !HAS_DB }, async () => {
    /* THE ONE THAT MATTERS MOST. Mail security scanners fetch every URL in a
       message before the person ever sees it. A GET that wrote the row would
       unsubscribe people who never pressed anything, and nothing downstream
       could tell those apart from a real click. */
    const r = await call("GET", query());
    assert.equal(r.code, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.already_unsubscribed, false);
    assert.equal(await isOptedOut(db, client, "email"), false,
      "a GET must never write an opt-out — a scanner opened this link, not a person");
  });

test("a POST records the opt-out, on the email channel, from the link", { skip: !HAS_DB }, async () => {
  const r = await call("POST", {}, query());
  assert.equal(r.code, 200);
  assert.equal(r.body.unsubscribed, true);

  const rows = (await db.query(
    `SELECT channel, source, opted_in_at FROM opt_outs WHERE org_id = $1 AND client_id = $2`,
    [org, client])).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channel, "email");
  assert.equal(rows[0].opted_in_at, null, "the opt-out has to be live to mean anything");
  assert.equal(rows[0].source, "unsubscribe_link",
    "recorded apart from a STOP reply and from the provider's own signal");
});

test("the send gate now blocks that client's email", { skip: !HAS_DB }, async () => {
  // The whole point. A row nobody reads would be theatre.
  assert.equal(await isOptedOut(db, client, "email"), true);
  assert.equal(await isOptedOut(db, client, "sms"), false,
    "they stopped our email, not their texts");
});

test("pressing it twice is not an error and does not stack rows", { skip: !HAS_DB }, async () => {
  const r = await call("POST", {}, query());
  assert.equal(r.code, 200);
  const n = (await db.query(
    `SELECT count(*)::int AS c FROM opt_outs WHERE org_id = $1`, [org])).rows[0].c;
  assert.equal(n, 1);
});

test("a GET after unsubscribing says so, so the page does not offer a dead button",
  { skip: !HAS_DB }, async () => {
    const r = await call("GET", query());
    assert.equal(r.body.already_unsubscribed, true);
  });

test("a tampered link is refused and writes nothing", { skip: !HAS_DB }, async () => {
  const q = query();
  q.client = "44444444-4444-4444-8444-444444444444";
  const r = await call("POST", {}, q);
  assert.equal(r.code, 400);
  assert.equal(r.body.error, "invalid_or_expired");
  const n = (await db.query(
    `SELECT count(*)::int AS c FROM opt_outs WHERE org_id = $1`, [org])).rows[0].c;
  assert.equal(n, 1, "still only the one genuine opt-out");
});

test("a forged or expired link gets ONE answer, never a hint about which", async () => {
  /* Distinguishing "bad signature" from "expired" from "no such client" turns
     the endpoint into an oracle for which client ids exist. */
  const bad = [
    {},
    { org: "x", client: "y", channel: "email", exp: "1", sig: "z" },
    { org: org || "o", client: client || "c", channel: "email", exp: "9999999999", sig: "deadbeef" }
  ];
  const seen = new Set();
  for (const q of bad) {
    const r = await call("POST", {}, q);
    assert.equal(r.code, 400);
    seen.add(r.body.error + "|" + r.body.message);
  }
  assert.equal(seen.size, 1, "one answer for every kind of bad link");
});

test("the refusal tells the reader another way out, rather than just failing", async () => {
  const r = await call("POST", {}, {});
  assert.match(r.body.message, /STOP/,
    "a dead link must not be a dead end — replying STOP now works too");
});

test("anything that is not GET or POST is refused", async () => {
  for (const m of ["PUT", "PATCH", "DELETE"]) {
    const r = await call(m, query.length ? {} : {});
    assert.equal(r.code, 405);
  }
});
