// End-to-end tests for GET /api/documents-download — minting a FRESH signed
// link for a document that was saved some time ago.
//
// Drives the real Netlify handler against real Postgres, for the same reason
// documents-upload.pg.test.mjs does: the behaviour that matters is all at the
// seam between the routing table, the principal gates, and the SQL that scopes
// by org. A unit test with a fake db would prove the code I wrote runs, not
// that one company is actually unable to reach another company's file.
//
// LIVES UNDER src/http/, NOT api/. npm test's glob is src/** and scripts/**
// only, so a test placed beside the handler never runs (CLAUDE.md §12).
//
// THE TESTS THAT MATTER MOST are the four isolation cases:
//   * staff at company B cannot mint a link for company A's document
//   * a client cannot mint a link for another client's document in their OWN org
//   * neither can, even holding the exact uuid — the refusal is not guessable
//   * both refusals are the SAME 404 as an id that does not exist, so the
//     endpoint cannot be walked as an oracle for which documents are real
//
// Everything else here is the bug report: a link minted at upload time expires,
// and before this endpoint existed there was no second link.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { createAccount, createAccountSession } from "../auth/account-session.mjs";
import { signDocumentUrl, DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS } from "../documents/signed-url.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SECRET = "test-document-url-secret-that-is-long-enough-32";
const EMAIL_TAG = "download.fixture";
const OTHER_ORG_SLUG = "download-fixture-org";

const PDF_BYTES = Buffer.from("%PDF-1.4\n%fixture pdf body for download tests\n%%EOF");

describe("opening a saved document", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, otherOrg;
  let clientId, siblingClientId, otherOrgClientId;
  let staffToken, setterToken, otherOrgStaffToken;
  let clientToken, siblingClientToken;
  let handler, priorSecret;

  const call = (path, init = {}) =>
    handler(new Request("https://site.netlify.app" + path, { host: "site.netlify.app", ...init }), {});

  const get = (token, path) =>
    call(path, { method: "GET", headers: token ? { authorization: "Bearer " + token } : {} });

  const mint = (token, documentId) =>
    get(token, "/api/documents-download?id=" + encodeURIComponent(documentId));

  /* upload() puts a real file through the real write path, so the rows under
     test are shaped exactly as production's are rather than hand-inserted. */
  const upload = async (token, ownerClientId, filename) => {
    const form = new FormData();
    form.append("file", new Blob([PDF_BYTES], { type: "application/pdf" }), filename);
    if (ownerClientId) form.append("client_id", ownerClientId);
    const r = await call("/api/documents-upload", {
      method: "POST",
      headers: { authorization: "Bearer " + token },
      body: form
    });
    const body = await r.json();
    assert.equal(r.status, 200, "fixture upload failed: " + JSON.stringify(body));
    return body.documents[0];
  };

  before(async () => {
    priorSecret = process.env.DOCUMENT_URL_SECRET;
    process.env.DOCUMENT_URL_SECRET = SECRET;
    delete process.env.DOCUMENT_STORE_PROVIDER; // memory provider — no storage vendor needed
    ({ default: handler } = await import("../../netlify/functions/api.mjs"));

    org = await resolveDefaultOrg(db);
    await purge();

    const staff = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Download Fixture Staff','admin','active') RETURNING id`,
      [org, `${EMAIL_TAG}.staff@example.com`])).rows[0];
    staffToken = (await createSession(db, { staffId: staff.id, orgId: org })).token;

    // A role INSIDE ROLE_SETS.STAFF but nowhere near the top of it — proves the
    // gate is the documented set and not "admin and owner only" by accident.
    const setter = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Download Fixture Setter','setter','active') RETURNING id`,
      [org, `${EMAIL_TAG}.setter@example.com`])).rows[0];
    setterToken = (await createSession(db, { staffId: setter.id, orgId: org })).token;

    clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Download','Fixture',$2) RETURNING id`,
      [org, `${EMAIL_TAG}.client@example.com`])).rows[0].id;
    const acct = await createAccount(db, {
      orgId: org, kind: "client", email: `${EMAIL_TAG}.account@example.com`,
      password: "download-fixture-password", clientId
    });
    clientToken = (await createAccountSession(db, { accountId: acct.id, orgId: org })).token;

    /* A SECOND CLIENT IN THE SAME ORG. This is the one an org_id clause alone
       does not protect: both clients share a company, so scoping only by org
       would let either open the other's credit report and photo ID. */
    siblingClientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Download','Sibling',$2) RETURNING id`,
      [org, `${EMAIL_TAG}.sibling@example.com`])).rows[0].id;
    const siblingAcct = await createAccount(db, {
      orgId: org, kind: "client", email: `${EMAIL_TAG}.sibling.account@example.com`,
      password: "download-fixture-password", clientId: siblingClientId
    });
    siblingClientToken = (await createAccountSession(db, {
      accountId: siblingAcct.id, orgId: org })).token;

    // A whole second company.
    otherOrg = (await db.query(
      `INSERT INTO orgs (name, slug) VALUES ('Download Fixture Org',$1) RETURNING id`,
      [OTHER_ORG_SLUG])).rows[0].id;
    otherOrgClientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Download','OtherOrg',$2) RETURNING id`,
      [otherOrg, `${EMAIL_TAG}.otherorg@example.com`])).rows[0].id;
    const otherStaff = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Download Other Org Staff','admin','active') RETURNING id`,
      [otherOrg, `${EMAIL_TAG}.otherstaff@example.com`])).rows[0];
    otherOrgStaffToken = (await createSession(db, {
      staffId: otherStaff.id, orgId: otherOrg })).token;
  });

  async function purge() {
    const ids = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1`, [`${EMAIL_TAG}%`])).rows.map((r) => r.id);
    await db.query(`DELETE FROM events WHERE payload->>'client_id' = ANY($1::text[])`,
      [ids.map(String)]).catch(() => {});
    if (ids.length) {
      await db.query(`ALTER TABLE documents DISABLE TRIGGER trg_documents_no_delete`);
      await db.query(`ALTER TABLE document_versions DISABLE TRIGGER trg_document_versions_no_delete`);
      try {
        // documents.current_version_id points AT document_versions, so it has to
        // be cleared before a version row can go — fk_documents_current_version.
        await db.query(`UPDATE documents SET current_version_id = NULL WHERE client_id = ANY($1)`, [ids]);
        await db.query(`DELETE FROM document_versions WHERE document_id IN
                         (SELECT id FROM documents WHERE client_id = ANY($1))`, [ids]);
        await db.query(`DELETE FROM documents WHERE client_id = ANY($1)`, [ids]);
      } finally {
        await db.query(`ALTER TABLE documents ENABLE TRIGGER trg_documents_no_delete`);
        await db.query(`ALTER TABLE document_versions ENABLE TRIGGER trg_document_versions_no_delete`);
      }
    }
    await db.query(`DELETE FROM account_sessions WHERE account_id IN
                     (SELECT id FROM accounts WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM sessions WHERE staff_id IN
                     (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM clients WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM orgs WHERE slug = $1`, [OTHER_ORG_SLUG]);
  }

  after(async () => {
    await purge();
    if (priorSecret === undefined) delete process.env.DOCUMENT_URL_SECRET;
    else process.env.DOCUMENT_URL_SECRET = priorSecret;
    await close();
  });

  // ── the route exists at all ──────────────────────────────────────────────
  // The failure this repo has shipped twice: a finished handler absent from the
  // ROUTES map in netlify/functions/api.mjs, 404 everywhere, every other test
  // green. A 404 here with a valid session would mean exactly that.

  test("the route is reachable — an authenticated call is not a 404 from the router", async () => {
    const r = await mint(staffToken, "00000000-0000-4000-8000-000000000000");
    assert.notEqual(r.status, 405, "the router did not accept GET on this path");
    const body = await r.json();
    assert.equal(body.error, "not_found", "expected the handler's own 404, not the router's");
    assert.equal(body.path, undefined, "this was the router's 404 — the route is not registered");
  });

  // ── auth ─────────────────────────────────────────────────────────────────

  test("no session at all is refused", async () => {
    const r = await get(null, "/api/documents-download?id=" + clientId);
    assert.equal(r.status, 401);
  });

  test("a non-GET method is refused", async () => {
    const r = await call("/api/documents-download?id=" + clientId,
      { method: "POST", headers: { authorization: "Bearer " + staffToken } });
    assert.equal(r.status, 405);
  });

  test("a malformed id is the caller's error, not a 500", async () => {
    const r = await mint(staffToken, "not-a-uuid");
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, "invalid_id");
  });

  test("a missing id is refused before any query runs", async () => {
    const r = await get(staffToken, "/api/documents-download");
    assert.equal(r.status, 400);
  });

  // ── the happy paths — the bug, fixed ─────────────────────────────────────

  test("staff can mint a fresh link for a client's saved document, and it returns the bytes", async () => {
    const doc = await upload(staffToken, clientId, "staff-mint.pdf");

    const r = await mint(staffToken, doc.id);
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.ok(body.document && body.document.download && body.document.download.url,
      "no signed download url in the response");

    const dl = await call(body.document.download.path);
    assert.equal(dl.status, 200, "the freshly minted link did not resolve");
    assert.ok(Buffer.from(await dl.arrayBuffer()).equals(PDF_BYTES),
      "the bytes behind the fresh link are not the bytes that were saved");
  });

  test("a client can mint a fresh link for their OWN document and open it", async () => {
    const doc = await upload(clientToken, null, "client-own.pdf");

    const r = await mint(clientToken, doc.id);
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.document.client_id, clientId);

    const dl = await call(body.document.download.path);
    assert.equal(dl.status, 200);
    assert.ok(Buffer.from(await dl.arrayBuffer()).equals(PDF_BYTES));
  });

  test("an ordinary staff role inside ROLE_SETS.STAFF is admitted, not just admin", async () => {
    const doc = await upload(staffToken, clientId, "setter-view.pdf");
    const r = await mint(setterToken, doc.id);
    assert.equal(r.status, 200, "a setter is in ROLE_SETS.STAFF and must be let in");
  });

  test("THE BUG: a link that has expired is dead, and this endpoint mints a live replacement", async () => {
    const doc = await upload(clientToken, null, "expired-then-fresh.pdf");

    // A link exactly as the upload reply minted it, but issued long enough ago
    // that its 15-minute life is over. This is the state every saved file was
    // permanently in before this endpoint existed.
    const stale = signDocumentUrl({
      documentId: doc.id,
      versionId: doc.current_version_id,
      secret: SECRET,
      now: () => Date.now() - (DEFAULT_TTL_SECONDS + 60) * 1000
    });
    const dead = await call(stale.path);
    assert.equal(dead.status, 404, "an expired link should no longer resolve");

    const r = await mint(clientToken, doc.id);
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    const alive = await call(body.document.download.path);
    assert.equal(alive.status, 200, "the replacement link did not work");
    assert.ok(Buffer.from(await alive.arrayBuffer()).equals(PDF_BYTES));
  });

  test("two mints of the same document both work — the link is not single-use", async () => {
    const doc = await upload(clientToken, null, "twice.pdf");
    for (const n of [1, 2]) {
      const body = await (await mint(clientToken, doc.id)).json();
      const dl = await call(body.document.download.path);
      assert.equal(dl.status, 200, `mint ${n} did not resolve`);
    }
  });

  // ── multi-tenant isolation — the point of this endpoint's gate ───────────

  test("ISOLATION: staff at another company cannot mint a link for this company's document", async () => {
    const doc = await upload(staffToken, clientId, "cross-org.pdf");

    const r = await mint(otherOrgStaffToken, doc.id);
    assert.equal(r.status, 404,
      "a staff session at a DIFFERENT company minted a link for this company's document");
    const body = await r.json();
    assert.equal(body.ok, false);
    assert.equal(body.document, undefined, "a cross-company call leaked document metadata");
  });

  test("ISOLATION: the cross-company refusal is byte-identical to an unknown id", async () => {
    // Otherwise the endpoint answers "that document exists, just not for you",
    // which is a working inventory oracle across every company on the platform.
    const doc = await upload(staffToken, clientId, "oracle-check.pdf");

    const real = await mint(otherOrgStaffToken, doc.id);
    const fake = await mint(otherOrgStaffToken, "00000000-0000-4000-8000-000000000001");
    assert.equal(real.status, fake.status);
    assert.deepEqual(await real.json(), await fake.json(),
      "the two refusals differ, so existence is observable across companies");
  });

  test("ISOLATION: a client cannot mint a link for another client in their OWN company", async () => {
    const doc = await upload(clientToken, null, "sibling-should-not-see.pdf");

    const r = await mint(siblingClientToken, doc.id);
    assert.equal(r.status, 404,
      "one client minted a download link for another client's document");
    assert.equal((await r.json()).document, undefined);
  });

  test("ISOLATION: a client cannot reach a document belonging to another company", async () => {
    const doc = await upload(otherOrgStaffToken, otherOrgClientId, "other-org-doc.pdf");
    const r = await mint(clientToken, doc.id);
    assert.equal(r.status, 404);
  });

  test("ISOLATION: staff at another company cannot reach it either way round", async () => {
    const doc = await upload(otherOrgStaffToken, otherOrgClientId, "reverse-cross-org.pdf");
    const r = await mint(staffToken, doc.id);
    assert.equal(r.status, 404,
      "this company's staff minted a link for the OTHER company's document");
  });

  // ── what must never come back ───────────────────────────────────────────

  test("the storage key never appears in the response", async () => {
    // Under Vercel Blob the storage key IS a permanent public URL — a bearer
    // credential with no expiry that outlives any session. It is stripped by
    // the column list AND again by shapeDocument(); this asserts the whole
    // serialized body, not just the top level.
    const doc = await upload(staffToken, clientId, "no-key-leak.pdf");
    const raw = await (await mint(staffToken, doc.id)).text();
    assert.ok(!/storage_key/.test(raw), "storage_key appeared in the response body");
    assert.ok(!/memory:\/\//.test(raw), "a raw storage key value appeared in the response body");
  });

  test("the answer is narrowed — no metadata, checksum or generated_by reaches the caller", async () => {
    /* getDocument() returns the registry's FULL public column set, which carries
       `metadata` — for an upload that holds the original filename and an
       `uploaded_by` object naming the STAFF MEMBER's id — plus `checksum`,
       `generated_by`, `signature_ref` and `org_id`. This endpoint answers a
       CLIENT as well as staff, and a consumer opening their own bank statement
       has no reason to learn which employee filed it. */
    const doc = await upload(staffToken, clientId, "narrow-shape.pdf");
    const body = await (await mint(clientToken, doc.id)).json();
    const allowed = new Set([
      "id", "client_id", "title", "document_key", "kind", "subtype",
      "mime_type", "byte_size", "current_version", "download"
    ]);
    const extra = Object.keys(body.document).filter((k) => !allowed.has(k));
    assert.deepEqual(extra, [],
      "new fields reached the caller without a decision: " + extra.join(", "));
  });

  test("the response is marked private and uncacheable", async () => {
    const doc = await upload(staffToken, clientId, "no-cache.pdf");
    const r = await mint(staffToken, doc.id);
    assert.match(String(r.headers.get("cache-control")), /no-store/,
      "a signed link is a bearer credential and must not sit in a shared cache");
  });

  // ── fail closed ─────────────────────────────────────────────────────────

  test("with no signing secret configured, no link is minted", async () => {
    const doc = await upload(staffToken, clientId, "no-secret.pdf");
    const prior = process.env.DOCUMENT_URL_SECRET;
    delete process.env.DOCUMENT_URL_SECRET;
    try {
      const r = await mint(staffToken, doc.id);
      assert.notEqual(r.status, 200, "a link was minted with no signing secret");
      const raw = await r.text();
      assert.ok(!/sig=/.test(raw), "something that looks like a signed link came back anyway");
    } finally {
      process.env.DOCUMENT_URL_SECRET = prior;
    }
  });

  // ── the TTL is the module's, chosen once, not caller-supplied ───────────

  test("the caller cannot ask for a longer-lived link than the endpoint chose", async () => {
    const doc = await upload(staffToken, clientId, "ttl-fixed.pdf");
    const r = await get(staffToken,
      `/api/documents-download?id=${doc.id}&ttlSeconds=${MAX_TTL_SECONDS}&ttl=${MAX_TTL_SECONDS}`);
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));

    const life = body.document.download.expiresAt - Math.floor(Date.now() / 1000);
    assert.ok(life <= DEFAULT_TTL_SECONDS + 5 && life > 0,
      `link lives ${life}s; the endpoint fixes it at ${DEFAULT_TTL_SECONDS}s and takes no ttl from the query`);
  });

  /* =====================================================================
     The portal's own list — GET /api/read/portal-summary
     =====================================================================
     The client portal has ALWAYS been built to render a download link:
     paintDocs() in public/app/client-portal.html reads d.download.url and falls
     back to plain text when it is absent. It was absent on every row, because
     this endpoint wrote its own SELECT over `documents` and signed nothing.

     Nested inside the outer describe on purpose: it reuses the same fixtures,
     and the outer `after` owns close() — a second top-level describe would shut
     the pool while this one was still using it. */
  describe("GET /api/read/portal-summary — the list the portal already renders", () => {
    const summary = (token, q) =>
      get(token, "/api/read/portal-summary" + (q || ""));

    test("a client's own documents come back WITH a working link", async () => {
      const doc = await upload(clientToken, null, "portal-list.pdf");

      const body = await (await summary(clientToken)).json();
      assert.equal(body.ok, true, JSON.stringify(body));
      const row = (body.documents || []).find((d) => d.id === doc.id);
      assert.ok(row, "the client's own document is missing from their portal summary");
      assert.ok(row.download && row.download.url,
        "no download link on the row — paintDocs() would fall back to plain text");

      const dl = await call(row.download.path || row.download.url);
      assert.equal(dl.status, 200, "the link in the portal list did not resolve");
      assert.ok(Buffer.from(await dl.arrayBuffer()).equals(PDF_BYTES),
        "the bytes behind the portal's link are not the bytes that were saved");
    });

    test("staff previewing a client's portal get the same working link", async () => {
      const doc = await upload(staffToken, clientId, "portal-staff-preview.pdf");
      const body = await (await summary(staffToken, "?client_id=" + clientId)).json();
      const row = (body.documents || []).find((d) => d.id === doc.id);
      assert.ok(row && row.download && row.download.url, "staff preview lost the link");
    });

    test("ISOLATION: a client's summary never contains another client's document", async () => {
      const mine = await upload(clientToken, null, "mine-only.pdf");

      const body = await (await summary(siblingClientToken)).json();
      assert.equal(body.ok, true, JSON.stringify(body));
      const ids = (body.documents || []).map((d) => d.id);
      assert.ok(!ids.includes(mine.id),
        "one client's portal summary listed another client's document");
    });

    test("ISOLATION: staff at another company cannot pull this company's client", async () => {
      const r = await summary(otherOrgStaffToken, "?client_id=" + clientId);
      assert.equal(r.status, 404,
        "a staff session at a DIFFERENT company read this company's client summary");
    });

    test("the narrowed row shape holds — no metadata, checksum or storage key reaches a client", async () => {
      /* listClientLibrary selects the registry's FULL public column set. Handed
         straight through, a client would receive `metadata` — which for an
         upload carries the original filename and an uploaded_by object naming
         the STAFF MEMBER's id — plus checksum, generated_by and org_id. None of
         that was in this response before and none of it belongs to a consumer.
         The endpoint narrows the rows back down; this is the assertion that
         notices if somebody stops narrowing them. */
      await upload(staffToken, clientId, "shape-check.pdf");
      const r = await summary(clientToken);
      const raw = await r.text();
      assert.ok(!/storage_key/.test(raw), "storage_key reached the portal payload");
      assert.ok(!/memory:\/\//.test(raw), "a raw storage key value reached the portal payload");

      const row = (JSON.parse(raw).documents || [])[0];
      assert.ok(row, "no documents came back at all");
      const allowed = new Set([
        "id", "document_key", "kind", "subtype", "title", "mime_type", "byte_size",
        "generated_at", "delivered_at", "delivery_channel", "delivery_status",
        "signature_required", "signed_at", "created_at", "download"
      ]);
      const extra = Object.keys(row).filter((k) => !allowed.has(k));
      assert.deepEqual(extra, [],
        "new fields reached the client portal without a decision: " + extra.join(", "));
    });

    test("with no signing secret, the summary still loads — it just carries no links", async () => {
      // The page must not go blank because a link could not be signed. Scores,
      // pre-qual and the upload doors all ride on this same response.
      await upload(staffToken, clientId, "portal-no-secret.pdf");
      const prior = process.env.DOCUMENT_URL_SECRET;
      delete process.env.DOCUMENT_URL_SECRET;
      try {
        const r = await summary(clientToken);
        const body = await r.json();
        assert.equal(r.status, 200, "the whole portal summary died over a missing secret");
        assert.equal(body.ok, true);
        assert.ok(Array.isArray(body.documents) && body.documents.length > 0,
          "the document list vanished along with the links");
        for (const d of body.documents) {
          assert.equal(d.download, null, "a link was minted with no signing secret");
        }
      } finally {
        process.env.DOCUMENT_URL_SECRET = prior;
      }
    });
  });
});
