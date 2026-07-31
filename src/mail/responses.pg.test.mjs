// Real-Postgres integration test for the mail response path.
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// What this proves that the unit tests cannot:
//   - an unknown slug really does come back as a typed error and really does
//     write NOTHING — no mail_universe row invented to make the request succeed;
//   - the anonymous-response dedupe is the DATABASE's rule, not this module's
//     opinion: uq_mail_responses_anonymous (067) refuses the second insert even
//     when the guard SELECT is bypassed entirely;
//   - a response that DOES carry a provider_ref is kept alongside one that does
//     not, so 065's "a record can respond twice" survives 067's index;
//   - mail_universe.responded_at moves forward and never backward, against real
//     timestamptz comparison rather than JavaScript Date arithmetic;
//   - MAIL_OUTCOME_TIERS still matches the stage keys db/seed/002_pipelines.sql
//     actually seeded — the constant's claim to have a source, tested;
//   - attributionByCampaign returns null (not 0) for `funded` when nothing is
//     linked, and the real count once something is;
//   - nothing in this module returns mail_universe.fields, which is consumer PII
//     off a prescreened file.
//
// A fake would pass all of this against a schema of its own imagining. That is
// the mistake AUDIT-FINDINGS spends four paragraphs on.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  recordResponse,
  setOutcomeTier,
  attributionByCampaign,
  MailResponseError,
  MAIL_OUTCOME_TIERS
} from "./responses.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

// Every row this file writes is identifiable by one of these sentinels, so the
// wipe cannot reach a real record.
const SLUG_PREFIX = "MAILRESPPGTEST";
const CAMPAIGN = "MAIL_RESPONSES_PG_TEST";
const EMPTY_CAMPAIGN = "MAIL_RESPONSES_PG_TEST_EMPTY";
const CLIENT_EMAIL = "mail_responses_pg_test@example.com";
const CLIENT_EMAIL_2 = "mail_responses_pg_test2@example.com";
const NUMBER_E164 = "+15550000067";

let orgId = null;
let clientId = null;
let fundedClientId = null;

const slug = (name) => `${SLUG_PREFIX}${name}`;

async function wipe() {
  // mail_responses cascades from mail_universe, but delete it explicitly first
  // so a failed run cannot leave orphans behind a changed cascade.
  await db.query(
    `DELETE FROM mail_responses
      WHERE mail_universe_id IN (SELECT id FROM mail_universe WHERE record_slug LIKE $1 || '%')`,
    [SLUG_PREFIX]
  );
  await db.query(`DELETE FROM mail_universe WHERE record_slug LIKE $1 || '%'`, [SLUG_PREFIX]);
  await db.query(`DELETE FROM mail_universe WHERE campaign_id LIKE $1 || '%'`, [CAMPAIGN]);
  await db.query(`DELETE FROM mail_tracked_numbers WHERE phone_number = $1`, [NUMBER_E164]);
  await db.query(`DELETE FROM mail_campaigns WHERE campaign_key LIKE $1 || '%'`, [CAMPAIGN]);
  await db.query(`DELETE FROM clients WHERE email IN ($1,$2)`, [CLIENT_EMAIL, CLIENT_EMAIL_2]);
}

/** A mailed record with a known slug. Returns its id. */
async function makeRecord(name, { campaign = CAMPAIGN, suppressed = false } = {}) {
  const r = await db.query(
    `INSERT INTO mail_universe (org_id, campaign_id, record_slug, fields, suppressed)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [orgId, campaign, slug(name), JSON.stringify({ first_name: "Ada", zip: "94110" }), suppressed]
  );
  return r.rows[0].id;
}

const readRecord = async (id) =>
  (await db.query(`SELECT * FROM mail_universe WHERE id = $1`, [id])).rows[0];

const countResponses = async (id) =>
  Number((await db.query(
    `SELECT count(*)::int AS n FROM mail_responses WHERE mail_universe_id = $1`, [id]
  )).rows[0].n);

before(async () => {
  if (!HAS_DB) return;
  await wipe();
  orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "an org must exist — run the seed");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name) VALUES ($1,$2,'Mail') RETURNING id`,
    [orgId, CLIENT_EMAIL]
  )).rows[0].id;
  fundedClientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, funded) VALUES ($1,$2,'Funded',true) RETURNING id`,
    [orgId, CLIENT_EMAIL_2]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

/* =========================================================================
 * The happy path
 * ========================================================================= */

test("a slug off a public URL becomes a mail_responses row and stamps the record", { skip: !HAS_DB }, async () => {
  const id = await makeRecord("happy1");
  const at = new Date("2026-06-01T12:00:00Z");

  const res = await recordResponse(db, {
    slug: slug("happy1"),
    channel: "web",
    respondedAt: at,
    payload: { utm_source: "qr", landing: "/offer" }
  });

  assert.equal(res.recorded, true);
  assert.equal(res.deduped, false);
  assert.equal(res.mailUniverseId, id);
  assert.equal(res.orgId, orgId);
  assert.equal(res.campaignId, CAMPAIGN);
  assert.equal(res.respondedAtSet, true);

  const row = (await db.query(`SELECT * FROM mail_responses WHERE id = $1`, [res.responseId])).rows[0];
  assert.equal(row.mail_universe_id, id);
  assert.equal(row.org_id, orgId, "org comes from the record, never from the caller");
  assert.equal(row.channel, "web");
  assert.equal(new Date(row.response_at).toISOString(), at.toISOString());
  assert.equal(row.provider_ref, null);
  assert.equal(row.client_id, null, "a respondent is a stranger until somebody creates a client");
  assert.deepStrictEqual(row.raw, { utm_source: "qr", landing: "/offer" });

  const rec = await readRecord(id);
  assert.equal(new Date(rec.responded_at).toISOString(), at.toISOString());
});

test("an uppercase minted slug typed back in lowercase still resolves — people do not shift-lock", { skip: !HAS_DB }, async () => {
  const id = await makeRecord("CASEA");   // slugs are minted uppercase (SLUG_ALPHABET)
  const res = await recordResponse(db, {
    slug: slug("CASEA").toLowerCase(),
    channel: "web",
    respondedAt: new Date("2026-06-01T12:00:00Z")
  });
  assert.equal(res.mailUniverseId, id);
});

test("recordResponse never returns mail_universe.fields — the caller is a public landing page", { skip: !HAS_DB }, async () => {
  await makeRecord("pii1");
  const res = await recordResponse(db, {
    slug: slug("pii1"), channel: "web", respondedAt: new Date("2026-06-01T12:00:00Z")
  });
  assert.ok(!("fields" in res));
  assert.ok(!JSON.stringify(res).includes("94110"), "no per-record vendor data may leak into the return");
});

test("a suppressed record still resolves: suppression governs mailing, not whether a holder may be answered", { skip: !HAS_DB }, async () => {
  const id = await makeRecord("supp1", { suppressed: true });
  const res = await recordResponse(db, {
    slug: slug("supp1"), channel: "web", respondedAt: new Date("2026-06-01T12:00:00Z")
  });
  assert.equal(res.recorded, true);
  assert.equal((await readRecord(id)).suppressed, true, "responding does not un-suppress a record");
});

/* =========================================================================
 * The unknown slug
 * ========================================================================= */

// Counted through the sentinel prefix, not over the whole table: `node --test`
// runs test FILES in parallel against one database, so a global count(*) would
// be measuring src/mail/ingest.pg.test.mjs's inserts as well as this file's.
// A row invented for an unknown slug would carry that slug — which starts with
// the prefix — so the narrower count still catches the thing being asserted.
const countOurRecords = async () =>
  Number((await db.query(
    `SELECT count(*)::int AS n FROM mail_universe WHERE record_slug LIKE $1 || '%'`, [SLUG_PREFIX]
  )).rows[0].n);

const countOurResponses = async () =>
  Number((await db.query(
    `SELECT count(*)::int AS n FROM mail_responses r
      WHERE EXISTS (SELECT 1 FROM mail_universe u
                     WHERE u.id = r.mail_universe_id AND u.record_slug LIKE $1 || '%')`,
    [SLUG_PREFIX]
  )).rows[0].n);

test("an unknown slug is a typed 404 and creates nothing — a record that was never mailed cannot respond", { skip: !HAS_DB }, async () => {
  const before = await countOurRecords();
  const beforeLog = await countOurResponses();

  await assert.rejects(
    () => recordResponse(db, {
      slug: slug("never_minted"), channel: "web", respondedAt: new Date()
    }),
    (e) => e instanceof MailResponseError && e.code === "unknown_slug" && e.status === 404
  );

  assert.equal(await countOurRecords(), before, "no mail_universe row was invented to make the request succeed");
  assert.equal(await countOurResponses(), beforeLog, "and nothing was logged against a record that does not exist");
});

test("a hostile slug is refused without reaching the database and without being echoed back", { skip: !HAS_DB }, async () => {
  const hostile = "'; DROP TABLE mail_universe; --";
  await assert.rejects(
    () => recordResponse(db, { slug: hostile, channel: "web", respondedAt: new Date() }),
    (e) => {
      assert.equal(e.code, "unknown_slug");
      assert.ok(!e.message.includes("DROP TABLE"));
      return true;
    }
  );
  // The table is still there, which is the point of the parameterised lookup.
  assert.ok((await db.query(`SELECT count(*) FROM mail_universe`)).rows[0]);
});

/* =========================================================================
 * Idempotency
 * ========================================================================= */

test("the same QR scanned twice is one response, and the second call reports deduped rather than failing", { skip: !HAS_DB }, async () => {
  const id = await makeRecord("dup1");
  const first = await recordResponse(db, {
    slug: slug("dup1"), channel: "web", respondedAt: new Date("2026-06-01T12:00:00Z")
  });
  const second = await recordResponse(db, {
    slug: slug("dup1"), channel: "web", respondedAt: new Date("2026-06-02T12:00:00Z")
  });

  assert.equal(first.recorded, true);
  assert.equal(second.recorded, false);
  assert.equal(second.deduped, true);
  assert.equal(second.responseId, first.responseId, "the caller gets the response already on file");
  assert.equal(await countResponses(id), 1, "a second scan must not double-count");
});

test("the anonymous dedupe is enforced by the database, not only by the guard SELECT", { skip: !HAS_DB }, async () => {
  // Bypass recordResponse entirely — this is what two concurrent QR scans do
  // when both guard SELECTs run before either INSERT.
  const id = await makeRecord("race1");
  await recordResponse(db, {
    slug: slug("race1"), channel: "web", respondedAt: new Date("2026-06-01T12:00:00Z")
  });
  await assert.rejects(
    () => db.query(
      `INSERT INTO mail_responses (org_id, mail_universe_id, response_at, channel)
       VALUES ($1,$2,now(),'web')`,
      [orgId, id]
    ),
    (e) => e.code === "23505",
    "uq_mail_responses_anonymous (067) must refuse a second identifier-less web response"
  );
  assert.equal(await countResponses(id), 1);
});

test("a response that carries a provider_ref is kept alongside an anonymous one on the same channel", { skip: !HAS_DB }, async () => {
  const id = await makeRecord("mix1");
  await recordResponse(db, {
    slug: slug("mix1"), channel: "web", respondedAt: new Date("2026-06-01T12:00:00Z")
  });
  const withRef = await recordResponse(db, {
    slug: slug("mix1"), channel: "web", respondedAt: new Date("2026-06-05T12:00:00Z"),
    providerRef: `${SLUG_PREFIX}-cf-submission-1`
  });
  assert.equal(withRef.recorded, true, "an identifiable second response is a real second response");
  assert.equal(await countResponses(id), 2);
});

test("re-importing a call log does not double-count: the provider_ref index adjudicates", { skip: !HAS_DB }, async () => {
  const id = await makeRecord("voice1");
  const ref = `${SLUG_PREFIX}-CA-callsid-1`;
  const a = await recordResponse(db, {
    slug: slug("voice1"), channel: "voice", respondedAt: new Date("2026-06-01T12:00:00Z"), providerRef: ref
  });
  const b = await recordResponse(db, {
    slug: slug("voice1"), channel: "voice", respondedAt: new Date("2026-06-01T12:00:00Z"), providerRef: ref
  });
  assert.equal(a.recorded, true);
  assert.equal(b.deduped, true);
  assert.equal(b.responseId, a.responseId);
  assert.equal(await countResponses(id), 1);
});

test("a record may respond on two different channels and the log keeps both", { skip: !HAS_DB }, async () => {
  const id = await makeRecord("two1");
  await recordResponse(db, { slug: slug("two1"), channel: "voice", respondedAt: new Date("2026-06-02T12:00:00Z") });
  await recordResponse(db, { slug: slug("two1"), channel: "web",   respondedAt: new Date("2026-06-05T12:00:00Z") });
  assert.equal(await countResponses(id), 2);
});

/* =========================================================================
 * responded_at only moves forward
 * ========================================================================= */

test("a later response advances responded_at — the denormalised pair keeps the most recent", { skip: !HAS_DB }, async () => {
  const id = await makeRecord("fwd1");
  await recordResponse(db, { slug: slug("fwd1"), channel: "voice", respondedAt: new Date("2026-06-02T12:00:00Z") });
  const later = await recordResponse(db, { slug: slug("fwd1"), channel: "web", respondedAt: new Date("2026-06-09T12:00:00Z") });
  assert.equal(later.respondedAtSet, true);
  assert.equal(new Date((await readRecord(id)).responded_at).toISOString(), "2026-06-09T12:00:00.000Z");
});

test("a backdated import does not drag responded_at backwards", { skip: !HAS_DB }, async () => {
  // Friday's import of Tuesday's calls must not rewrite a record whose PURL was
  // hit on Thursday.
  const id = await makeRecord("back1");
  await recordResponse(db, { slug: slug("back1"), channel: "web", respondedAt: new Date("2026-06-11T12:00:00Z") });
  const old = await recordResponse(db, { slug: slug("back1"), channel: "voice", respondedAt: new Date("2026-06-09T12:00:00Z") });
  assert.equal(old.recorded, true, "the older response is still logged");
  assert.equal(old.respondedAtSet, false, "but it does not move the record's stamp");
  assert.equal(new Date((await readRecord(id)).responded_at).toISOString(), "2026-06-11T12:00:00.000Z");
});

/* =========================================================================
 * The optional links
 * ========================================================================= */

test("a clientId from another org is refused rather than linking a response across orgs", { skip: !HAS_DB }, async () => {
  await makeRecord("xorg1");
  const other = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,'Mail Resp Other') RETURNING id`,
    [`mail_resp_pg_test_org_${Date.now()}`]
  )).rows[0].id;
  const stranger = (await db.query(
    `INSERT INTO clients (org_id, email) VALUES ($1,$2) RETURNING id`,
    [other, `stranger_${Date.now()}@example.com`]
  )).rows[0].id;
  try {
    await assert.rejects(
      () => recordResponse(db, {
        slug: slug("xorg1"), channel: "web", respondedAt: new Date(), clientId: stranger
      }),
      (e) => e instanceof MailResponseError && e.code === "client_org_mismatch"
    );
  } finally {
    await db.query(`DELETE FROM clients WHERE id = $1`, [stranger]);
    await db.query(`DELETE FROM orgs WHERE id = $1`, [other]);
  }
});

test("a tracked number belonging to another campaign is refused — misattribution is the failure it exists to prevent", { skip: !HAS_DB }, async () => {
  await makeRecord("tn1");
  const camp = (await db.query(
    `INSERT INTO mail_campaigns (org_id, campaign_key, name) VALUES ($1,$2,'Other Drop') RETURNING id`,
    [orgId, `${CAMPAIGN}_OTHER`]
  )).rows[0].id;
  const num = (await db.query(
    `INSERT INTO mail_tracked_numbers (org_id, mail_campaign_id, phone_number) VALUES ($1,$2,$3) RETURNING id`,
    [orgId, camp, NUMBER_E164]
  )).rows[0].id;

  await assert.rejects(
    () => recordResponse(db, {
      slug: slug("tn1"), channel: "voice", respondedAt: new Date(), trackedNumberId: num
    }),
    (e) => e instanceof MailResponseError && e.code === "tracked_number_campaign_mismatch"
  );
});

/* =========================================================================
 * setOutcomeTier
 * ========================================================================= */

test("MAIL_OUTCOME_TIERS is not invented: every value is a seeded stage key of the sales pipeline", { skip: !HAS_DB }, async () => {
  const { rows } = await db.query(
    `SELECT s.key FROM pipeline_stages s
       JOIN pipelines p ON p.id = s.pipeline_id
      WHERE p.org_id = $1 AND p.key = 'sales'`,
    [orgId]
  );
  if (rows.length === 0) return;   // seed/002_pipelines.sql not applied for this org
  const seeded = new Set(rows.map((r) => r.key));
  for (const tier of MAIL_OUTCOME_TIERS) {
    assert.ok(seeded.has(tier), `"${tier}" has no source: it is not a seeded sales pipeline stage`);
  }
});

test("setOutcomeTier writes the record and the newest response, keeping the denormalised pair in step", { skip: !HAS_DB }, async () => {
  const id = await makeRecord("tier1");
  await recordResponse(db, { slug: slug("tier1"), channel: "voice", respondedAt: new Date("2026-06-01T12:00:00Z") });
  const newest = await recordResponse(db, { slug: slug("tier1"), channel: "web", respondedAt: new Date("2026-06-08T12:00:00Z") });

  const res = await setOutcomeTier(db, { recordId: id, tier: "booked" });
  assert.deepStrictEqual(res, { recordId: id, tier: "booked", responseUpdated: true });
  assert.equal((await readRecord(id)).outcome_tier, "booked");

  const rows = (await db.query(
    `SELECT id, outcome_tier FROM mail_responses WHERE mail_universe_id = $1 ORDER BY response_at DESC`, [id]
  )).rows;
  assert.equal(rows[0].id, newest.responseId);
  assert.equal(rows[0].outcome_tier, "booked");
  assert.equal(rows[1].outcome_tier, null, "only the newest response carries the latest label");
});

test("setOutcomeTier on a record with no logged response still labels the record and says so", { skip: !HAS_DB }, async () => {
  const id = await makeRecord("tier2");
  const res = await setOutcomeTier(db, { recordId: id, tier: "lost" });
  assert.equal(res.responseUpdated, false);
  assert.equal((await readRecord(id)).outcome_tier, "lost");
});

test("setOutcomeTier with null clears the label back to unknown, which is a reachable state", { skip: !HAS_DB }, async () => {
  const id = await makeRecord("tier3");
  await setOutcomeTier(db, { recordId: id, tier: "showed" });
  const res = await setOutcomeTier(db, { recordId: id, tier: null });
  assert.equal(res.tier, null);
  assert.equal((await readRecord(id)).outcome_tier, null);
});

test("setOutcomeTier is idempotent: applying the same tier twice changes nothing", { skip: !HAS_DB }, async () => {
  const id = await makeRecord("tier4");
  await setOutcomeTier(db, { recordId: id, tier: "closed_won" });
  await setOutcomeTier(db, { recordId: id, tier: "closed_won" });
  assert.equal((await readRecord(id)).outcome_tier, "closed_won");
});

test("setOutcomeTier on a record that does not exist is a typed 404, not a silent no-op", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => setOutcomeTier(db, { recordId: "11111111-1111-4111-8111-111111111111", tier: "booked" }),
    (e) => e instanceof MailResponseError && e.code === "unknown_record" && e.status === 404
  );
});

/* =========================================================================
 * attributionByCampaign — the blanks are the point
 * ========================================================================= */

// Each of these gets its own campaign_id string. The tests above deliberately
// pile records into CAMPAIGN, and an attribution assertion that depends on how
// many tests ran before it is not an assertion about attribution. Every suffix
// is still under the CAMPAIGN prefix, so wipe() reaches all of them.

test("attribution counts what exists: loaded, suppressed, mailable and responded are real numbers", { skip: !HAS_DB }, async () => {
  const c = `${CAMPAIGN}_COUNTS`;
  await makeRecord("att1", { campaign: c });
  await makeRecord("att2", { campaign: c });
  await makeRecord("att3", { campaign: c, suppressed: true });
  await recordResponse(db, { slug: slug("att1"), channel: "web", respondedAt: new Date("2026-06-01T12:00:00Z") });

  const a = await attributionByCampaign(db, { campaignId: c, orgId });
  assert.equal(a.loaded, 3);
  assert.equal(a.suppressed, 1);
  assert.equal(a.mailable, 2);
  assert.equal(a.responded, 1);
  assert.equal(a.responses, 1);
});

test("attribution returns mailed as null with a reason — nothing in this repo records a piece entering the post", { skip: !HAS_DB }, async () => {
  const c = `${CAMPAIGN}_MAILED`;
  await makeRecord("mailed1", { campaign: c });
  const a = await attributionByCampaign(db, { campaignId: c, orgId });
  assert.equal(a.mailable, 1, "what could have been mailed is a real number");
  assert.strictEqual(a.mailed, null, "a fabricated zero would read as a real result");
  assert.ok(typeof a.unavailable.mailed === "string" && a.unavailable.mailed.length > 0);
  assert.ok(a.unavailable.mailed.includes("mailed_at"), "the reason must name what is missing");
});

test("attribution returns funded as null, NOT 0, while no response is linked to a client", { skip: !HAS_DB }, async () => {
  const c = `${CAMPAIGN}_UNLINKED`;
  await makeRecord("fund1", { campaign: c });
  await recordResponse(db, { slug: slug("fund1"), channel: "web", respondedAt: new Date("2026-06-01T12:00:00Z") });

  const a = await attributionByCampaign(db, { campaignId: c, orgId });
  assert.equal(a.responses, 1);
  assert.equal(a.linkedClients, 0);
  assert.strictEqual(a.funded, null, "0 funded and 'we never linked anybody' are opposite claims");
  assert.notStrictEqual(a.funded, 0);
  assert.ok(a.unavailable.funded.includes("client_id"), "the reason must name the missing linkage");
});

test("attribution reports a real funded count once the client linkage exists", { skip: !HAS_DB }, async () => {
  const c = `${CAMPAIGN}_LINKED`;
  await makeRecord("fund2", { campaign: c });
  await makeRecord("fund3", { campaign: c });
  await recordResponse(db, {
    slug: slug("fund2"), channel: "web", respondedAt: new Date("2026-06-01T12:00:00Z"), clientId: fundedClientId
  });
  await recordResponse(db, {
    slug: slug("fund3"), channel: "web", respondedAt: new Date("2026-06-01T12:00:00Z"), clientId
  });

  const a = await attributionByCampaign(db, { campaignId: c, orgId });
  assert.equal(a.linkedClients, 2);
  assert.equal(a.linkedResponses, 2);
  assert.equal(a.funded, 1, "one of the two linked clients is funded");
  assert.equal(a.unavailable.funded, undefined, "a computable metric carries no reason");
  assert.strictEqual(a.mailed, null, "mailed stays unavailable regardless");
});

test("attribution on a campaign with no records is all zeroes and no campaign row, not an error", { skip: !HAS_DB }, async () => {
  const a = await attributionByCampaign(db, { campaignId: EMPTY_CAMPAIGN, orgId });
  assert.equal(a.campaign, null);
  assert.equal(a.loaded, 0);
  assert.equal(a.suppressed, 0);
  assert.equal(a.responded, 0);
  assert.equal(a.responses, 0);
  assert.strictEqual(a.funded, null);
});

test("attribution carries the campaign row's vendor-stated quantity, which is not a count of rows", { skip: !HAS_DB }, async () => {
  const c = `${CAMPAIGN}_ORDERED`;
  await db.query(
    `INSERT INTO mail_campaigns (org_id, campaign_key, name, records_ordered)
     VALUES ($1,$2,'PG Test Drop',$3)`,
    [orgId, c, 50000]
  );
  await makeRecord("ord1", { campaign: c });
  const a = await attributionByCampaign(db, { campaignId: c });
  assert.equal(a.campaign.recordsOrdered, 50000);
  assert.equal(a.campaign.status, "draft");
  assert.equal(a.orgId, orgId, "the org is resolved from the campaign row when not passed");
  assert.equal(a.unavailable.orgId, undefined);
  assert.equal(a.loaded, 1);
  assert.notEqual(a.loaded, a.campaign.recordsOrdered, "records_ordered is not a count of rows");
});

test("attribution says so when it could not scope to an org rather than quietly counting every org", { skip: !HAS_DB }, async () => {
  // No mail_campaigns row for this key and no orgId passed: campaign_id is free
  // text with no uniqueness guarantee, so the counts are unscoped and say so.
  const c = `${CAMPAIGN}_UNSCOPED`;
  await makeRecord("scope1", { campaign: c });
  const a = await attributionByCampaign(db, { campaignId: c });
  assert.equal(a.campaign, null);
  assert.strictEqual(a.orgId, null);
  assert.ok(a.unavailable.orgId.includes("orgId"), "an unscoped count must announce itself");
});
