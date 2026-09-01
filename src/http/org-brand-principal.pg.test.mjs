/* /api/org-brand answers with the CALLER's brand, not the caller's org's.
 *
 * WHAT CHANGED, AND WHAT IT REPLACED (owner-set 2026-08-31). A white-label
 * partner used to sign in and see Fundhub's colours, type and wordmark on every
 * CRM screen: shell.js paints from /api/org-brand, and that endpoint read the
 * org row for everybody. Every partner sits in the SHARED default org, so an
 * org-keyed lookup is one answer for all of them — which is why the fix is to
 * resolve from the PRINCIPAL instead. docs/BRAND-THEMING-SPEC.md carries the
 * decision and the two approaches that were rejected.
 *
 * WHAT THIS FILE PINS, in the order the risks matter:
 *
 *   1. Fundhub staff are UNAFFECTED. Proven by comparing a staff GET against a
 *      direct read of v_org_brand_effective, key by key — not by eyeballing one
 *      field. This is the assertion that must never be softened.
 *   2. Partner A gets A's brand and NEVER B's, and the partner id is taken from
 *      the session, so a query string cannot move it.
 *   3. A partner with no partner_brand row falls back to the ORG row, whole.
 *      v_partner_brand_effective LEFT JOINs and COALESCEs, so it hands back what
 *      looks like a full answer for a partner who has saved nothing — the
 *      endpoint has to test for the row itself.
 *   4. Affiliates and clients still get the org row.
 *   5. The wordmark, and only the wordmark, waits for approval.
 *
 * WHY THIS FILE LIVES UNDER src/http/. package.json's test glob is "src/**" and
 * "scripts/**" only; a test under api/ is silently never collected.
 *
 * Skipped without DATABASE_URL, like every other *.pg.test.mjs.
 */

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { createAccount, loginAccount } from "../auth/account-session.mjs";
import { createSession } from "../auth/session.mjs";
import handler from "../../api/org-brand.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TAG = "orgbrand-principal";
const PW = "org-brand-principal-password-for-tests";

/* Two partners, two brands that could not be mistaken for each other or for
   Fundhub's. A's is the deliberately awful single-hue ramp — the shape a real
   brand guideline very often has, and the one that used to flatten every status
   badge to the same colour. */
const BRAND_A = {
  ink: "#0B1F3A", paper: "#F4F7FB",
  ramp: ["#0A2A55", "#12467F", "#1A62A9", "#2F80C9", "#5FA3DC", "#9BC6EC"],
  display_face: "Rubik", mono_face: "Roboto Mono",
  entity_name: "Single Hue Capital",
  wordmark_url: "https://a.example.com/a-mark.svg"
};
const BRAND_B = {
  ink: "#2B1A05", paper: "#FFF8EE",
  ramp: ["#7A3B00", "#9C5A10", "#BE7A22", "#D89A46", "#EBBB77", "#F7D9A8"],
  display_face: "Lora", mono_face: "IBM Plex Mono",
  entity_name: "Bravo Funding Group",
  wordmark_url: "https://b.example.com/b-mark.svg"
};

const BRAND_KEYS = ["org_id", "slug", "entity_name", "wordmark_url", "ink",
  "paper", "ramp", "display_face", "mono_face"];

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("/api/org-brand — whose brand the caller gets",
  { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {

    let org, staffId, staffToken, partnerA, partnerB;
    let tokenA, tokenB, tokenNoBrand, tokenAffiliate, tokenClient;
    let clientId, affiliateId, partnerNoBrand;

    const call = async ({ method = "GET", body = {}, query = {}, token } = {}) => {
      const r = res();
      await handler(
        { method, query, body, headers: token ? { authorization: "Bearer " + token } : {} },
        r
      );
      return r;
    };

    async function wipe() {
      await db.query(
        `DELETE FROM account_sessions WHERE account_id IN
           (SELECT id FROM accounts WHERE email LIKE $1)`, [`${TAG}%`]);
      await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [`${TAG}%`]);
      await db.query(
        `DELETE FROM partner_brand WHERE partner_id IN
           (SELECT id FROM partners WHERE slug LIKE $1)`, [`${TAG}%`]);
      await db.query(`DELETE FROM partners WHERE slug LIKE $1`, [`${TAG}%`]);
      await db.query(`DELETE FROM affiliates WHERE name LIKE $1`, [`${TAG}%`]);
      await db.query(`DELETE FROM clients WHERE email LIKE $1`, [`${TAG}%`]);
    }

    /* Written straight to the table rather than through /api/partner-brand, so
       this file tests the READ and cannot be made to pass by a change to the
       other endpoint. approval_status is set here for the same reason — the
       PUT refuses it, deliberately (FORBIDDEN in api/partner-brand.mjs). */
    async function setBrand(partnerId, b, approval) {
      await db.query(
        `INSERT INTO partner_brand
           (org_id, partner_id, ink, paper, ramp, display_face, mono_face,
            entity_name, wordmark_url, approval_status, approved_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,
                 CASE WHEN $10 = 'approved' THEN now() ELSE NULL END)
         ON CONFLICT (partner_id) DO UPDATE SET
           ink = EXCLUDED.ink, paper = EXCLUDED.paper, ramp = EXCLUDED.ramp,
           display_face = EXCLUDED.display_face, mono_face = EXCLUDED.mono_face,
           entity_name = EXCLUDED.entity_name, wordmark_url = EXCLUDED.wordmark_url,
           approval_status = EXCLUDED.approval_status,
           approved_at = EXCLUDED.approved_at`,
        [org, partnerId, b.ink, b.paper, JSON.stringify(b.ramp), b.display_face,
          b.mono_face, b.entity_name, b.wordmark_url, approval]);
    }

    before(async () => {
      org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
      await wipe();
      await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${TAG}%`]);

      staffId = (await db.query(
        `INSERT INTO staff (org_id, email, name, role, status)
         VALUES ($1,$2,'Brand Owner','owner','active') RETURNING id`,
        [org, `${TAG}-owner@example.com`])).rows[0].id;
      staffToken = (await createSession(db, { staffId, orgId: org })).token;

      const mkPartner = async (n) => (await db.query(
        `INSERT INTO partners (org_id, name, slug, status)
         VALUES ($1,$2,$3,'active') RETURNING id`,
        [org, `${TAG} ${n}`, `${TAG}-${n}`])).rows[0].id;
      partnerA = await mkPartner("a");
      partnerB = await mkPartner("b");
      partnerNoBrand = await mkPartner("nobrand");

      await setBrand(partnerA, BRAND_A, "approved");
      await setBrand(partnerB, BRAND_B, "approved");
      // partnerNoBrand deliberately gets NO partner_brand row at all.

      // 044's signup policy makes 'partner' invite-only, so these are created
      // the way seed-role-accounts.mjs creates one: invited by a staff id.
      const mkAccount = async (kind, tag, ids) => {
        await createAccount(db, {
          orgId: org, kind, email: `${TAG}-${tag}@example.com`, password: PW,
          invitedBy: staffId, ...ids
        });
        return (await loginAccount(db, { email: `${TAG}-${tag}@example.com`, password: PW })).token;
      };

      tokenA = await mkAccount("partner", "a", { partnerId: partnerA });
      tokenB = await mkAccount("partner", "b", { partnerId: partnerB });
      tokenNoBrand = await mkAccount("partner", "nobrand", { partnerId: partnerNoBrand });

      affiliateId = (await db.query(
        `INSERT INTO affiliates (org_id, name, status)
         VALUES ($1,$2,'active') RETURNING id`,
        [org, `${TAG} aff`])).rows[0].id;
      tokenAffiliate = await mkAccount("affiliate", "aff", { affiliateId });

      clientId = (await db.query(
        `INSERT INTO clients (org_id, first_name, last_name, email)
         VALUES ($1,'Brand','Client',$2) RETURNING id`,
        [org, `${TAG}-client@example.com`])).rows[0].id;
      tokenClient = await mkAccount("client", "client", { clientId });
    });

    after(async () => {
      await wipe();
      await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${TAG}%`]);
      await close();
    });

    const orgRow = async () => (await db.query(
      `SELECT * FROM v_org_brand_effective WHERE org_id = $1`, [org])).rows[0];

    // ── 1. Fundhub staff, unaffected ───────────────────────────────────────

    test("a staff session gets the ORG brand, key for key", async () => {
      const r = await call({ token: staffToken });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      const expected = await orgRow();
      /* Every key, compared. A spot check on one field would pass while the
         wordmark or the ramp quietly came from somewhere else. */
      for (const k of BRAND_KEYS) {
        assert.deepEqual(r.body.brand[k], expected[k],
          `staff got a different ${k} than v_org_brand_effective — the org lane moved`);
      }
    });

    test("a staff session is not moved by a partner_id in the query string", async () => {
      /* There is no preview parameter, on purpose. If one were ever added by
         accident this is what would catch it. */
      const r = await call({ token: staffToken, query: { partner_id: partnerA } });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.notEqual(r.body.brand.ink, BRAND_A.ink,
        "a query string moved a staff session onto a partner's brand");
      assert.deepEqual(r.body.brand.ink, (await orgRow()).ink);
    });

    // ── 2. A partner gets their own, and only their own ─────────────────────

    test("partner A gets partner A's brand, not Fundhub's", async () => {
      const r = await call({ token: tokenA });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.brand.ink, BRAND_A.ink);
      assert.equal(r.body.brand.paper, BRAND_A.paper);
      assert.deepEqual(r.body.brand.ramp, BRAND_A.ramp);
      assert.equal(r.body.brand.display_face, BRAND_A.display_face);
      assert.equal(r.body.brand.mono_face, BRAND_A.mono_face);
      assert.equal(r.body.brand.entity_name, BRAND_A.entity_name);

      const fundhub = await orgRow();
      assert.notEqual(r.body.brand.ink, fundhub.ink,
        "the partner is still being painted with the org's ink");
    });

    test("partner B gets B's brand and never A's", async () => {
      const r = await call({ token: tokenB });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.brand.ink, BRAND_B.ink);
      assert.equal(r.body.brand.entity_name, BRAND_B.entity_name);
      assert.notEqual(r.body.brand.ink, BRAND_A.ink,
        "partner B received partner A's brand — cross-tenant disclosure");
      assert.notEqual(r.body.brand.entity_name, BRAND_A.entity_name);
      assert.notEqual(r.body.brand.wordmark_url, BRAND_A.wordmark_url);
    });

    test("a partner cannot ask for another partner's brand with a query string", async () => {
      const r = await call({ token: tokenB, query: { partner_id: partnerA } });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.brand.ink, BRAND_B.ink,
        "the partner id came from the URL instead of the session");
      assert.notEqual(r.body.brand.entity_name, BRAND_A.entity_name);
    });

    test("the response carries no partner field beyond the CRM brand shape", async () => {
      /* v_partner_brand_effective also holds domain, support_email, voice,
         entity_address and the funnel list. None of it is needed to paint a
         page, so none of it is in the answer. */
      const r = await call({ token: tokenA });
      const extra = Object.keys(r.body.brand).filter((k) => !BRAND_KEYS.includes(k));
      assert.deepEqual(extra, [],
        "the partner branch is returning fields the CRM does not paint with: " + extra.join(", "));
    });

    // ── 3. Fail closed to the org row ──────────────────────────────────────

    test("a partner with NO brand row gets the org brand, whole", async () => {
      const r = await call({ token: tokenNoBrand });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      const expected = await orgRow();
      for (const k of BRAND_KEYS) {
        assert.deepEqual(r.body.brand[k], expected[k],
          `a partner with no brand row got a different ${k} than the org row — ` +
          `that is the half-painted screen this must never produce`);
      }
    });

    test("v_partner_brand_effective would have hidden that — it answers anyway", () => {
      /* Stated as a test so the reason the endpoint uses EXISTS cannot be
         refactored away by somebody who reads the view as authoritative. */
      return db.query(
        `SELECT ink, paper, approval_status FROM v_partner_brand_effective WHERE partner_id = $1`,
        [partnerNoBrand]).then(({ rows }) => {
        assert.equal(rows.length, 1,
          "the view stopped LEFT JOINing — re-read api/org-brand.mjs before trusting it");
        assert.equal(rows[0].ink, "#0A0A0A",
          "the view no longer COALESCEs a missing row to Fundhub's values");
      });
    });

    // ── 4. Everybody else is untouched ─────────────────────────────────────

    test("an affiliate gets the org brand unchanged", async () => {
      const r = await call({ token: tokenAffiliate });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      const expected = await orgRow();
      for (const k of BRAND_KEYS) assert.deepEqual(r.body.brand[k], expected[k]);
    });

    test("a client gets the org brand unchanged", async () => {
      const r = await call({ token: tokenClient });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      const expected = await orgRow();
      for (const k of BRAND_KEYS) assert.deepEqual(r.body.brand[k], expected[k]);
    });

    // ── 5. The wordmark, and only the wordmark, waits for approval ─────────

    test("an APPROVED wordmark paints", async () => {
      await setBrand(partnerA, BRAND_A, "approved");
      const r = await call({ token: tokenA });
      assert.equal(r.body.brand.wordmark_url, BRAND_A.wordmark_url);
    });

    test("a DRAFT wordmark does not paint, but the colours and type still do", async () => {
      await setBrand(partnerA, BRAND_A, "draft");
      const r = await call({ token: tokenA });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.brand.wordmark_url, null,
        "an unreviewed wordmark reached Fundhub-hosted chrome — it can carry " +
        "somebody else's registered trademark");
      assert.equal(r.body.brand.ink, BRAND_A.ink,
        "the colours stopped painting too — only the wordmark waits for approval");
      assert.equal(r.body.brand.display_face, BRAND_A.display_face);
      assert.equal(r.body.brand.entity_name, BRAND_A.entity_name);
    });

    test("a wordmark IN REVIEW does not paint either", async () => {
      await setBrand(partnerA, BRAND_A, "review");
      const r = await call({ token: tokenA });
      assert.equal(r.body.brand.wordmark_url, null);
      assert.equal(r.body.brand.ink, BRAND_A.ink);
      await setBrand(partnerA, BRAND_A, "approved"); // leave the fixture as found
    });

    // ── The write lane did not move ────────────────────────────────────────

    test("a partner still cannot WRITE the org brand", async () => {
      const before = await orgRow();
      const r = await call({ method: "PUT", token: tokenA, body: { ink: "#FF0000" } });
      assert.equal(r.code, 403, JSON.stringify(r.body));
      assert.deepEqual((await orgRow()).ink, before.ink,
        "a partner repainted the org row — Fundhub staff screens are exposed");
    });

    test("an owner writing the org brand still gets the ORG row back", async () => {
      const before = await orgRow();
      const r = await call({
        method: "PUT", token: staffToken, body: { entity_name: before.entity_name }
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.brand.org_id, org);
      assert.notEqual(r.body.brand.ink, BRAND_A.ink);
    });
  });
