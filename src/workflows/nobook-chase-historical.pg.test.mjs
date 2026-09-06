/* The no-book chase's exit check, against a real Postgres.
 *
 * WHY A DATABASE TEST AND NOT ONLY THE FAKE. The unit tests in
 * s-nobook-chase.test.mjs prove the decision; they cannot prove the SQL, and the
 * SQL is where this fix lives — a JSON field read, a regular-expression digit
 * strip, and a company scope. A fake that answers the way the author expected
 * proves the author, not the query. On 2026-09-03 the exact opposite mistake
 * shipped: a query that could not match anything, with a green suite behind it,
 * and 51 texts to one customer's phone.
 *
 * The four cases, all of which exist in production right now:
 *   1. the modern row  — booking event with the customer stamped on it
 *   2. the historical row — client_id NULL, email in the payload
 *   3. the historical row — client_id NULL, phone written differently
 *   4. another company's booking for the same address — must NOT count
 *
 * SKIPS unless DATABASE_URL is set. It does not pass quietly.
 */

import { test, before, after } from "node:test";
import assert from "node:assert";

import { db, close } from "../db.mjs";
import { hasBooked } from "./s-nobook-chase.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SLUG = "nobook-historical-test";
const OTHER_SLUG = "nobook-historical-other";

let orgId = null;
let otherOrgId = null;

async function makeClient(org, { email, phone }) {
  const r = await db.query(
    `INSERT INTO clients (org_id, email, phone, first_name, last_name)
     VALUES ($1,$2,$3,'Nobook','Historical') RETURNING id`,
    [org, email, phone]
  );
  return r.rows[0].id;
}

/** A booking event exactly as the adapter wrote them before 2026-09-03. */
async function bookingEvent(org, { clientId = null, payload }) {
  await db.query(
    `INSERT INTO events (org_id, name, version, client_id, payload)
     VALUES ($1,'booking.created',1,$2,$3)`,
    [org, clientId, JSON.stringify(payload)]
  );
}

before(async () => {
  if (!HAS_DB) return;
  orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,'Nobook Historical')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [SLUG]
  )).rows[0].id;
  otherOrgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,'Nobook Historical Other')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [OTHER_SLUG]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  for (const org of [orgId, otherOrgId]) {
    await db.query(`DELETE FROM events WHERE org_id = $1`, [org]);
    await db.query(`DELETE FROM clients WHERE org_id = $1`, [org]);
  }
  await db.query(`DELETE FROM orgs WHERE slug = ANY($1)`, [[SLUG, OTHER_SLUG]]);
  await close();
});

test("nobody has booked yet — the chase is right to keep going",
  { skip: !HAS_DB }, async () => {
    const id = await makeClient(orgId, { email: "none@nobook.test", phone: "+15550000001" });
    assert.equal(await hasBooked(db, id), false);
  });

test("a booking event with the customer stamped on it stops the chase",
  { skip: !HAS_DB }, async () => {
    const id = await makeClient(orgId, { email: "stamped@nobook.test", phone: "+15550000002" });
    await bookingEvent(orgId, { clientId: id, payload: { email: "stamped@nobook.test" } });
    assert.equal(await hasBooked(db, id), true);
  });

test("THE FIX: a booking event with no customer on it, matched by email, stops the chase",
  { skip: !HAS_DB }, async () => {
    // Every booking event in production before 2026-09-03 looks exactly like
    // this, and this is the row every sleeping chase run wakes against.
    const id = await makeClient(orgId, { email: "Historical@Nobook.Test", phone: null });
    await bookingEvent(orgId, {
      clientId: null,
      payload: { email: "historical@nobook.test", startTime: "2026-09-07T18:00:00Z" }
    });
    assert.equal(await hasBooked(db, id), true);
  });

test("THE FIX: matched by phone, however the two are written",
  { skip: !HAS_DB }, async () => {
    const id = await makeClient(orgId, { email: "phoneonly@nobook.test", phone: "+1 (555) 000-1234" });
    await bookingEvent(orgId, {
      clientId: null,
      payload: { email: "a-different-address@example.com", phone: "5550001234" }
    });
    assert.equal(await hasBooked(db, id), true);
  });

test("a short or missing phone number never matches by accident",
  { skip: !HAS_DB }, async () => {
    const id = await makeClient(orgId, { email: "shortphone@nobook.test", phone: "1234" });
    await bookingEvent(orgId, {
      clientId: null,
      payload: { email: "someone-else@example.com", phone: "999-1234" }
    });
    assert.equal(await hasBooked(db, id), false);
  });

test("another company's booking for the same address does not stop this chase",
  { skip: !HAS_DB }, async () => {
    const id = await makeClient(orgId, { email: "shared@nobook.test", phone: "+15550000003" });
    await bookingEvent(otherOrgId, {
      clientId: null,
      payload: { email: "shared@nobook.test", phone: "+15550000003" }
    });
    assert.equal(await hasBooked(db, id), false);
  });

test("a booking event carrying no email and no phone is simply not a match",
  { skip: !HAS_DB }, async () => {
    const id = await makeClient(orgId, { email: "empty@nobook.test", phone: "+15550000004" });
    await bookingEvent(orgId, { clientId: null, payload: { source: "clickfunnels" } });
    assert.equal(await hasBooked(db, id), false);
  });
