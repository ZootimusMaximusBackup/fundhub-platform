// Real-Postgres tests for slug assignment and the reverse lookup.
// SKIPS unless DATABASE_URL is set.
//
// The claims that only a real database can settle are all here: that a slug is
// never rewritten once assigned, that the UNIQUE index on record_slug is what
// adjudicates a collision (and that losing to it retries rather than failing the
// batch), and that an unknown or hostile slug comes back as null from a live
// query rather than as an error.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { assignSlugs, lookupBySlug, generateSlug, isValidSlug } from "./slugs.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

const CAMPAIGN = "slugs_pg_test_campaign";
const OTHER_CAMPAIGN = "slugs_pg_test_other_campaign";
const VENDOR_SLUG = "slugs_pg_test_vendor_0001";

let orgId = null;

async function wipe() {
  await db.query(`DELETE FROM mail_universe WHERE campaign_id = ANY($1::text[])`, [[CAMPAIGN, OTHER_CAMPAIGN]]);
  await db.query(`DELETE FROM mail_universe WHERE record_slug = $1`, [VENDOR_SLUG]);
}

async function addRecord(campaign, fields, slug = null) {
  const r = await db.query(
    `INSERT INTO mail_universe (org_id, campaign_id, record_slug, fields)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
    [orgId, campaign, slug, JSON.stringify(fields)]
  );
  return r.rows[0].id;
}

async function slugOf(id) {
  const r = await db.query(`SELECT record_slug FROM mail_universe WHERE id = $1`, [id]);
  return r.rows[0]?.record_slug ?? null;
}

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

test("assignSlugs: every record in the campaign that has no slug gets one, and it is a well-formed slug", { skip: !HAS_DB }, async () => {
  const ids = [
    await addRecord(CAMPAIGN, { Name: "A" }),
    await addRecord(CAMPAIGN, { Name: "B" }),
    await addRecord(CAMPAIGN, { Name: "C" })
  ];

  const res = await assignSlugs(db, { campaignId: CAMPAIGN });
  assert.equal(res.assigned, 3);
  assert.equal(res.skipped, 0);

  const slugs = [];
  for (const id of ids) {
    const slug = await slugOf(id);
    assert.ok(isValidSlug(slug), `${slug} is not a well-formed slug`);
    slugs.push(slug);
  }
  assert.equal(new Set(slugs).size, 3, "three records must not share a name");
});

test("assignSlugs: re-running assigns nothing, because a slug that may already be printed is never rewritten", { skip: !HAS_DB }, async () => {
  const before = await db.query(
    `SELECT id, record_slug FROM mail_universe WHERE campaign_id = $1 ORDER BY id`, [CAMPAIGN]
  );

  const res = await assignSlugs(db, { campaignId: CAMPAIGN });
  assert.equal(res.assigned, 0, "the second pass has nothing to assign");

  const after = await db.query(
    `SELECT id, record_slug FROM mail_universe WHERE campaign_id = $1 ORDER BY id`, [CAMPAIGN]
  );
  assert.deepEqual(after.rows, before.rows, "a re-run must not renumber a single piece of mail");
});

test("assignSlugs: a vendor-issued slug survives the pass untouched", { skip: !HAS_DB }, async () => {
  const id = await addRecord(CAMPAIGN, { Name: "Vendor numbered" }, VENDOR_SLUG);

  const res = await assignSlugs(db, { campaignId: CAMPAIGN });
  assert.equal(res.assigned, 0);
  assert.equal(await slugOf(id), VENDOR_SLUG, "the vendor's own PURL is what is printed on the piece");
});

test("assignSlugs: losing a race to the unique index retries instead of failing the batch", { skip: !HAS_DB }, async () => {
  const id = await addRecord(CAMPAIGN, { Name: "Collides once" });

  // The first draw is a slug the table already holds, so Postgres raises a real
  // 23505 against the real unique index. The second draw is fresh.
  let call = 0;
  const generate = () => (call++ === 0 ? VENDOR_SLUG : generateSlug());

  const res = await assignSlugs(db, { recordIds: [id], generate });
  assert.equal(res.assigned, 1, "the record still gets a slug");
  assert.equal(res.retries, 1, "and the collision was retried, not swallowed and not thrown");
  assert.ok(isValidSlug(await slugOf(id)));
});

test("assignSlugs: record ids scoped to a campaign do not touch a record belonging to another campaign", { skip: !HAS_DB }, async () => {
  const otherId = await addRecord(OTHER_CAMPAIGN, { Name: "Somebody else's drop" });

  const res = await assignSlugs(db, { campaignId: CAMPAIGN, recordIds: [otherId] });
  assert.equal(res.assigned, 0);
  assert.equal(res.skipped, 1);
  assert.equal(await slugOf(otherId), null, "a mis-scoped id must not silently name another campaign's record");
});

test("lookupBySlug: a minted slug resolves to exactly its own record", { skip: !HAS_DB }, async () => {
  const id = await addRecord(CAMPAIGN, { Name: "Resolve me" });
  await assignSlugs(db, { recordIds: [id] });
  const slug = await slugOf(id);

  const row = await lookupBySlug(db, { slug });
  assert.equal(row.id, id);
  assert.equal(row.record_slug, slug);
  assert.equal(row.campaign_id, CAMPAIGN);
  assert.equal(row.suppressed, false, "the lookup reports the suppression state, it does not filter on it");
});

test("lookupBySlug: a slug typed in the wrong case off a printed page still resolves", { skip: !HAS_DB }, async () => {
  const id = await addRecord(CAMPAIGN, { Name: "Typed by hand" });
  await assignSlugs(db, { recordIds: [id] });
  const slug = await slugOf(id);

  const row = await lookupBySlug(db, { slug: `  ${slug.toLowerCase()}  ` });
  assert.equal(row.id, id, "case and stray whitespace are not a wrong answer");
});

test("lookupBySlug: an unknown slug is null rather than an exception, because a mistyped URL is a 404", { skip: !HAS_DB }, async () => {
  assert.equal(await lookupBySlug(db, { slug: "ZZZZZZZZZZZZ" }), null);
  assert.equal(await lookupBySlug(db, { slug: "slugs_pg_test_never_issued" }), null);
});

test("lookupBySlug: a SQL payload arriving from a public URL returns null and leaves the table intact", { skip: !HAS_DB }, async () => {
  const before = await db.query(`SELECT count(*)::int AS n FROM mail_universe WHERE campaign_id = $1`, [CAMPAIGN]);

  assert.equal(await lookupBySlug(db, { slug: "' OR 1=1 --" }), null);
  assert.equal(await lookupBySlug(db, { slug: "'; DROP TABLE mail_universe; --" }), null);

  const after = await db.query(`SELECT count(*)::int AS n FROM mail_universe WHERE campaign_id = $1`, [CAMPAIGN]);
  assert.equal(after.rows[0].n, before.rows[0].n);
});

test("lookupBySlug: a suppressed record still resolves, because suppression governs mailing and not answering", { skip: !HAS_DB }, async () => {
  const id = await addRecord(CAMPAIGN, { Name: "Suppressed but holding a letter" });
  await assignSlugs(db, { recordIds: [id] });
  await db.query(
    `UPDATE mail_universe SET suppressed = true, suppression_reason = 'existing_client' WHERE id = $1`, [id]
  );

  const row = await lookupBySlug(db, { slug: await slugOf(id) });
  assert.equal(row.id, id);
  assert.equal(row.suppressed, true);
});
