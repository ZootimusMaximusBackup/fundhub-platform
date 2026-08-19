/* Draft vs published, and the address a partner is shown. (T10-01)
 *
 * WHAT WENT WRONG LIVE, 2026-08-18/19. A partner's Home screen showed
 * "Your page · https://fundhub.ai/sites/<their id>/apply". They clicked it and
 * got a 404. Their only page was a draft. Nothing on Home had ever said so, and
 * the link under those words actually pointed at Brand Studio, not at the
 * address printed on screen.
 *
 * The 404 was RIGHT. A draft is not public. So the fix is on the screen that
 * promised it — and this file exists to nail down the rule the screen now
 * reports, plus the security property the public page has to keep while it
 * gives a partner a useful message.
 *
 * THE SECURITY PROPERTY, stated plainly: /sites/... has no sign-in. Anyone can
 * ask it about any uuid. If a real partner id answered differently from a made
 * up one — even only by saying "there is a draft here" — a stranger could walk
 * uuids and harvest the list of real partners. So every miss returns the SAME
 * bytes. The test below asserts that byte-for-byte, because a well-meaning
 * "helpful" message added later is exactly how this leak comes back.
 *
 * A pg test, not a unit test, because the thing under test is the ROW: draft vs
 * published is a column value, and only a database can tell those two apart.
 *
 * WHERE THIS ACTUALLY RUNS. Nowhere that can fail a merge. The blocking CI job
 * runs with no DATABASE_URL on purpose, so everything below skips there; the
 * Postgres job that does run it is marked continue-on-error. So the properties
 * that must never regress unnoticed are ALSO covered, without a database, in
 * src/http/partner-galaxy-banner.test.mjs — the wording of the not-found page and
 * every rule the Home banner follows. This file is the deeper check, not the gate.
 *
 * THREE OF THESE ARE MARKED "REGRESSION GUARD". That is honest labelling: they
 * pass against the old code too, because they pin behaviour that was already
 * correct and that the fix now leans on. They are not evidence that anything was
 * fixed. The tests that do bite are the two miss-page ones here, and all of the
 * banner ones in the file named above.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { asPartner } from "../partners/rls.mjs";
import { createAccount, createAccountSession } from "../auth/account-session.mjs";
import { handler as siteHandler, NOT_LIVE_HTML } from "../../netlify/functions/partner-site.mjs";
import pagesApi from "../../api/partner-pages.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const MARK = "t10publish";
/* A uuid that belongs to nobody. The enumeration probe uses it. */
const NOBODY = "00000000-0000-4000-8000-0000000abcff";

describe("partner page publishing and the public address", {
  skip: !HAVE_DB ? "no DATABASE_URL" : false
}, () => {
  let org, partnerId, pageId, partnerToken;

  /* Ask the public site for an address, the way the internet does. */
  const getSite = async (pid, slug) => {
    const res = await siteHandler(new Request(`https://fundhub.ai/sites/${pid}/${slug}`));
    return { status: res.status, type: res.headers.get("content-type"), body: await res.text() };
  };

  /* Call the signed-in Brand Studio API the way the browser does. */
  const api = async (method, { query = {}, body = {} } = {}) => {
    const r = { code: null, body: null, headers: {} };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.setHeader = (k, v) => { r.headers[k] = v; return r; };
    await pagesApi(
      { method, headers: { authorization: "Bearer " + partnerToken }, query, body },
      r
    );
    return r;
  };

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();

    partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status)
       VALUES ($1,$2,$3,'active') RETURNING id`,
      [org, `${MARK} partner`, `${MARK}-partner`]
    )).rows[0].id;

    await db.query(
      `INSERT INTO partner_brand (org_id, partner_id, entity_name)
       VALUES ($1,$2,$3)`,
      [org, partnerId, `${MARK} Capital`]
    );

    /* The owner has turned the marketing suite on for this partner — same as
       the live partner in the audit. Publishing is therefore allowed; nobody
       had pressed it, which is the whole finding.

       WRITTEN INSIDE A PARTNER SCOPE, ON PURPOSE. partner_module_settings is one
       of the tables 046 put row-level security on: a write is only allowed if the
       transaction has said which partner it is acting as. A bare db.query() here
       works when the test connects as the database owner and is REFUSED when it
       connects as fundhub_app, which is the unprivileged role production uses —
       and that refusal cancelled every test in this file. Setting up through
       asPartner() means this file is exercised the way the live app runs. */
    await asPartner(partnerId, (tx) => tx.query(
      `INSERT INTO partner_module_settings (org_id, partner_id, marketing_suite_enabled)
       VALUES ($1,$2,true)
       ON CONFLICT (partner_id) DO UPDATE SET marketing_suite_enabled = true`,
      [org, partnerId]
    ));

    pageId = (await db.query(
      `INSERT INTO partner_pages (org_id, partner_id, funnel_key, title, slug, status, body_json)
       VALUES ($1,$2,'apply',$3,'apply','draft',$4::jsonb) RETURNING id`,
      [org, partnerId, `${MARK} Apply`,
        JSON.stringify({ sections: [{ type: "hero", headline: `${MARK} headline` }] })]
    )).rows[0].id;

    const staff = (await db.query(
      `SELECT id FROM staff WHERE org_id = $1 AND role = 'owner' LIMIT 1`, [org]
    )).rows[0];
    const acct = await createAccount(db, {
      orgId: org, kind: "partner", email: `${MARK}@example.com`,
      password: "a-long-enough-password-1", invitedBy: staff.id, partnerId
    });
    partnerToken = (await createAccountSession(db, { accountId: acct.id, orgId: org })).token;
  });

  async function purge() {
    await db.query(`DELETE FROM account_sessions WHERE account_id IN
      (SELECT id FROM accounts WHERE email LIKE $1)`, [`${MARK}%`]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [`${MARK}%`]);
    const pids = (await db.query(
      `SELECT id FROM partners WHERE slug LIKE $1`, [`${MARK}%`])).rows.map((r) => r.id);
    if (pids.length) {
      await db.query(`DELETE FROM partner_pages WHERE partner_id = ANY($1)`, [pids]);
      await db.query(`DELETE FROM partner_brand WHERE partner_id = ANY($1)`, [pids]);
      // Same row-level security as the insert above: an unscoped DELETE here does
      // not error, it just removes nothing, and the leftover row then breaks the
      // next run. Scoped per partner so the clean-up really cleans up.
      for (const pid of pids) {
        await asPartner(pid, (tx) => tx.query(
          `DELETE FROM partner_module_settings WHERE partner_id = $1`, [pid]));
      }
      await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [pids]);
    }
  }

  after(async () => { await purge(); await close(); });

  /* REGRESSION GUARD, NOT PROOF OF THE FIX. This was already true before this
     change and it passes against the old code — it is here because the whole
     unit rests on it. If a "helpful" tweak ever starts serving drafts, this is
     what catches it. */
  test("REGRESSION GUARD: a draft page is NOT served to the public", async () => {
    const r = await getSite(partnerId, "apply");
    assert.equal(r.status, 404, "a draft must never be public");
    assert.ok(!r.body.includes(`${MARK} headline`),
      "the draft's own words must not appear on a public page");
  });

  test("the miss page says what a draft is and where Publish lives", async () => {
    const r = await getSite(partnerId, "apply");
    assert.match(r.body, /draft/i, "a partner landing here is told what a draft is");
    assert.match(r.body, /Brand Studio/, "and where to go");
    assert.match(r.body, /Publish/, "and which control to press");
  });

  test("SECURITY: a real partner id is indistinguishable from a made-up one", async () => {
    /* THE ONE THAT MATTERS MOST. Three misses, three different underlying
       truths — a draft sits at the first address, the partner is real but has
       no such page at the second, and the third partner does not exist at all.
       All three must be the same reply, or this endpoint becomes a way to find
       out who Fundhub's partners are. */
    const draftHere = await getSite(partnerId, "apply");          // real partner, draft
    const realNoSuchPage = await getSite(partnerId, "nosuchpage"); // real partner, no page
    const notAPartner = await getSite(NOBODY, "apply");            // nobody at all

    for (const r of [draftHere, realNoSuchPage, notAPartner]) {
      assert.equal(r.status, 404);
      assert.equal(r.type, "text/html; charset=utf-8");
      assert.equal(r.body, NOT_LIVE_HTML);
    }
    assert.equal(draftHere.body, notAPartner.body,
      "byte-identical: nothing here reveals that this partner id is real");
    assert.equal(realNoSuchPage.body, notAPartner.body,
      "byte-identical: nothing here reveals that this partner id is real");
    assert.ok(!draftHere.body.includes(partnerId),
      "the miss page must not echo the partner id back");
  });

  /* REGRESSION GUARD, NOT PROOF OF THE FIX. The API already reported NULL here
     before this change; nothing in this unit touched api/partner-pages.mjs. It is
     pinned because the Home banner now depends on it: if this ever starts
     reporting an address for a draft, Home goes back to promising a 404. */
  test("REGRESSION GUARD: Brand Studio reports live_path as NULL while the page is a draft",
    async () => {
    /* This is the field the Home banner now reads. If it ever starts reporting
       an address for a draft, Home goes back to promising a 404. */
    const r = await api("GET", { query: { partner_id: partnerId } });
    assert.equal(r.code, 200);
    const page = r.body.items.find((p) => p.id === pageId);
    assert.equal(page.status, "draft");
    assert.equal(page.live_path, null);
    assert.equal(page.live_url, null);
  });

  /* REGRESSION GUARD, NOT PROOF OF THE FIX. Publishing already worked; the bug
     was that Home said it had happened when it had not. Pinned because it is the
     promise the banner now makes on the partner's behalf. */
  test("REGRESSION GUARD: pressing Publish makes that exact address live", async () => {
    const patch = await api("PATCH", { body: { id: pageId, status: "published" } });
    assert.equal(patch.code, 200, JSON.stringify(patch.body));
    assert.equal(patch.body.page.status, "published");

    const listed = await api("GET", { query: { partner_id: partnerId } });
    const page = listed.body.items.find((p) => p.id === pageId);
    assert.equal(page.live_path, `/sites/${partnerId}/apply`,
      "the address Home shows is the address the public page answers on");

    const r = await getSite(partnerId, "apply");
    assert.equal(r.status, 200);
    assert.match(r.body, new RegExp(`${MARK} headline`));
  });

  test("SECURITY: a made-up id is still a plain miss after a real page goes live",
    async () => {
      /* Publishing is the partner's own outward act, so a 200 on THEIR address
         reveals only what they chose to reveal. Everyone else's uuid must still
         come back with the same nothing. */
      const notAPartner = await getSite(NOBODY, "apply");
      assert.equal(notAPartner.status, 404);
      assert.equal(notAPartner.body, NOT_LIVE_HTML);

      const realNoSuchPage = await getSite(partnerId, "nosuchpage");
      assert.equal(realNoSuchPage.body, notAPartner.body,
        "a real partner's missing page still looks exactly like nobody's");
    });
});
