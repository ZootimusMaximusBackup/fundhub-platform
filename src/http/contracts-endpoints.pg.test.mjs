// The contract endpoints, against a real Postgres and real sessions.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLERS. package.json's test
// glob is "src/**/*.test.mjs" and "scripts/**/*.test.mjs"; a test placed under
// api/ is never collected and passes forever by never running (CLAUDE.md §12).
// The handlers are imported from here — the same arrangement, and the same
// reason, as src/http/pii.pg.test.mjs and src/http/finance-soft-pull.pg.test.mjs.
//
// WHAT THIS PINS THAT THE MODULE TESTS CANNOT. src/contracts/*.pg.test.mjs prove
// the module and the tables behave. That leaves the questions only a caller can
// ask: can somebody with no session reach any of this; can a staff role that may
// not write contract wording write it anyway; can a session for one company
// reach another company's contracts; and — the one that matters most — can an
// anonymous request get a signature recorded without a valid link.
//
// Every call carries a token minted for a real `sessions` row. There is no
// injection seam, deliberately.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { signContractUrl } from "../contracts/signed-link.mjs";
import writeHandler from "../../api/contracts.mjs";
import readHandlerFn from "../../api/read/contracts.mjs";
import signHandler from "../../api/contracts/sign.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SECRET = "E".repeat(48);
const CLIENT_EMAIL_LIKE = "contract.http.test.%@example.com";
const STAFF_EMAIL_LIKE = "contract_http_test_%@example.com";
const KEY_LIKE = "CTHTTP-%";
const FOREIGN_ORG_SLUG = "cthttp-test-other-co";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

async function withTriggerDisabled(table, trigger, fn) {
  await db.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  try { return await fn(); }
  finally { await db.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`); }
}

describe("/api/contracts endpoints", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, foreignOrg, foreignClient, n = 0;
  const staff = {};          // role → { id, token }
  let priorSecret;

  const post = async (bodyObj, token, headers = {}) => {
    const r = res();
    await writeHandler({
      method: "POST", query: {}, body: bodyObj,
      headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...headers }
    }, r);
    return r;
  };

  const read = async (query, token) => {
    const r = res();
    await readHandlerFn({
      method: "GET", query, headers: token ? { authorization: "Bearer " + token } : {}
    }, r);
    return r;
  };

  const callSign = async (query, { method = "GET", body = null, ip = null, ua = null } = {}) => {
    const r = res();
    await signHandler({
      method, query, body,
      headers: ua ? { "user-agent": ua } : {},
      socket: { remoteAddress: ip }
    }, r);
    return r;
  };

  /* The query string of a real signed link, as the page would send it. */
  const linkQuery = (contractId, ttlSeconds = undefined, now = undefined) => {
    const link = signContractUrl({ contractId, secret: SECRET, ttlSeconds, now });
    const u = new URL(link.url, "http://x.invalid");
    return { id: contractId, exp: u.searchParams.get("exp"), sig: u.searchParams.get("sig") };
  };

  const purge = async () => {
    const ids = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE])).rows.map((r) => r.id);
    if (ids.length) {
      await withTriggerDisabled("contracts", "trg_contracts_no_delete", () =>
        db.query(`DELETE FROM contracts WHERE client_id = ANY($1)`, [ids]));
      await withTriggerDisabled("documents", "trg_documents_no_delete", () =>
        withTriggerDisabled("document_versions", "trg_document_versions_no_delete", async () => {
          await db.query(`UPDATE documents SET current_version_id = NULL WHERE client_id = ANY($1)`, [ids]);
          await db.query(
            `DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE client_id = ANY($1))`, [ids]);
          await db.query(`DELETE FROM documents WHERE client_id = ANY($1)`, [ids]);
        }));
      await db.query(`DELETE FROM events WHERE client_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await withTriggerDisabled("contract_templates", "trg_contract_templates_no_delete", () =>
      db.query(`DELETE FROM contract_templates WHERE template_key LIKE $1`, [KEY_LIKE]));
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
    await db.query(`DELETE FROM orgs WHERE slug = $1`, [FOREIGN_ORG_SLUG]);
  };

  before(async () => {
    /* The handlers read the secret from the environment — there is no injection
       seam on an endpoint, which is the point of testing at this level. */
    priorSecret = process.env.CONTRACT_URL_SECRET;
    process.env.CONTRACT_URL_SECRET = SECRET;

    org = await resolveDefaultOrg(db);
    await purge();

    /* Both sides of both gates need a witness: an owner who may do everything,
       and a setter — a full ROLE_SETS.STAFF member — who may send but may NOT
       write contract wording or void. If that distinction ever collapses, this
       is where it shows. */
    for (const role of ["owner", "admin", "setter", "closer"]) {
      const id = (await db.query(
        `INSERT INTO staff (org_id, name, role, email, status)
         VALUES ($1,$2,$3,$4,'active') RETURNING id`,
        [org, `Contract Httptest ${role}`, role, `contract_http_test_${role}@example.com`])).rows[0].id;
      staff[role] = { id, token: (await createSession(db, { staffId: id, orgId: org })).token };
    }

    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Katherine','Johnson','contract.http.test.kj@example.com') RETURNING id`, [org])).rows[0].id;

    // A second company, with its own consumer and its own owner.
    foreignOrg = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Other Co') RETURNING id`, [FOREIGN_ORG_SLUG])).rows[0].id;
    foreignClient = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Foreign','Client','contract.http.test.foreign@example.com') RETURNING id`,
      [foreignOrg])).rows[0].id;
    const fid = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Contract Httptest foreign','owner','contract_http_test_foreign@example.com','active')
       RETURNING id`, [foreignOrg])).rows[0].id;
    staff.foreign = { id: fid, token: (await createSession(db, { staffId: fid, orgId: foreignOrg })).token };
  });

  after(async () => {
    await purge();
    if (priorSecret === undefined) delete process.env.CONTRACT_URL_SECRET;
    else process.env.CONTRACT_URL_SECRET = priorSecret;
    await close();
  });

  /* A template + a sent contract, made through the ENDPOINTS rather than the
     module, so the fixture itself exercises the path under test. */
  async function sentContract(token = staff.owner.token) {
    n += 1;
    const t = await post({
      action: "create_template", template_key: `CTHTTP-${n}`, name: `Http ${n}`,
      body: "Fee {{field.fee}} for {{contact.full_name}}.",
      manual_fields: [{ key: "fee", label: "Fee", required: true }]
    }, staff.owner.token);
    assert.equal(t.code, 200, JSON.stringify(t.body));
    const d = await post({
      action: "create_draft", client_id: client, template_id: t.body.template.id,
      values: { fee: "10%" }
    }, token);
    assert.equal(d.code, 200, JSON.stringify(d.body));
    const s = await post({ action: "send", id: d.body.contract.id }, token);
    assert.equal(s.code, 200, JSON.stringify(s.body));
    return { template: t.body.template, contract: s.body.contract, link: s.body.link };
  }

  // ── auth ──────────────────────────────────────────────────────────────────

  describe("the staff endpoints refuse anybody who is not signed in", () => {
    test("no token is 401 on both the write and the read", async () => {
      assert.equal((await post({ action: "preview", template_id: client }, null)).code, 401);
      assert.equal((await read({ view: "templates" }, null)).code, 401);
    });

    test("a junk token is 401", async () => {
      assert.equal((await post({ action: "preview" }, "not-a-token")).code, 401);
    });

    test("the write endpoint is POST only and the read endpoint is GET only", async () => {
      const a = res();
      await writeHandler({ method: "GET", query: {}, headers: {} }, a);
      assert.equal(a.code, 405);
      assert.equal(a.headers.allow, "POST");

      const b = res();
      await readHandlerFn({ method: "POST", query: {}, headers: {} }, b);
      assert.equal(b.code, 405);
    });
  });

  // ── the two gates ─────────────────────────────────────────────────────────

  describe("who may write contract wording", () => {
    test("an owner may, and an admin may", async () => {
      for (const role of ["owner", "admin"]) {
        n += 1;
        const r = await post({
          action: "create_template", template_key: `CTHTTP-G${n}`, name: `Gate ${n}`, body: "Words."
        }, staff[role].token);
        assert.equal(r.code, 200, `${role} was refused: ${JSON.stringify(r.body)}`);
      }
    });

    test("a setter and a closer may NOT — they are ROLE_SETS.STAFF, which is not enough", async () => {
      for (const role of ["setter", "closer"]) {
        const r = await post({
          action: "create_template", template_key: "CTHTTP-NOPE", name: "Nope", body: "Words."
        }, staff[role].token);
        assert.equal(r.code, 403, `${role} got through`);
        assert.deepEqual(r.body.required, ["owner", "admin"]);
      }
      const rows = (await db.query(
        `SELECT count(*)::int AS n FROM contract_templates WHERE template_key = 'CTHTTP-NOPE'`)).rows[0].n;
      assert.equal(rows, 0, "a refused create must not have written a row");
    });

    test("but a setter and a closer MAY send — that is the ordinary case", async () => {
      const { contract } = await sentContract(staff.setter.token);
      assert.equal(contract.status, "sent");
      const again = await sentContract(staff.closer.token);
      assert.equal(again.contract.status, "sent");
    });

    test("voiding is owner/admin, and a refused void changes nothing", async () => {
      const { contract } = await sentContract();
      const refused = await post({ action: "void", id: contract.id, reason: "nope" }, staff.setter.token);
      assert.equal(refused.code, 403);
      assert.equal((await db.query(`SELECT status FROM contracts WHERE id=$1`, [contract.id])).rows[0].status, "sent");

      const ok = await post({ action: "void", id: contract.id, reason: "Client withdrew" }, staff.owner.token);
      assert.equal(ok.code, 200);
      assert.equal(ok.body.contract.status, "void");
    });

    test("a rename is refused outright rather than silently ignored", async () => {
      n += 1;
      const t = await post({
        action: "create_template", template_key: `CTHTTP-R${n}`, name: "Rename me", body: "Words."
      }, staff.owner.token);
      const r = await post({
        action: "save_template", id: t.body.template.id, template_key: "CTHTTP-SOMETHINGELSE",
        name: "Rename me", body: "Words."
      }, staff.owner.token);
      assert.equal(r.code, 409);
      assert.equal(r.body.error, "rename_refused");
    });

    test("an unknown action is refused and lists what is allowed", async () => {
      const r = await post({ action: "delete_everything" }, staff.owner.token);
      assert.equal(r.code, 400);
      assert.equal(r.body.error, "unknown_action");
      assert.ok(Array.isArray(r.body.allowed));
    });

    test("a malformed id is a 400, never a 500 out of Postgres", async () => {
      for (const body of [{ action: "send", id: "zzz" }, { action: "save_draft", id: "zzz" },
                          { action: "preview", template_id: "zzz" },
                          { action: "create_draft", client_id: "zzz", template_id: "zzz" }]) {
        const r = await post(body, staff.owner.token);
        assert.equal(r.code, 400, JSON.stringify(r.body));
      }
    });
  });

  // ── org scoping ───────────────────────────────────────────────────────────

  describe("one company cannot reach another company's contracts", () => {
    test("the queue and the single read both come back empty-handed", async () => {
      const { contract } = await sentContract();
      const one = await read({ id: contract.id }, staff.foreign.token);
      assert.equal(one.code, 404);
      const list = await read({ view: "contracts" }, staff.foreign.token);
      assert.equal(list.code, 200);
      assert.equal(list.body.items.some((r) => r.id === contract.id), false);
    });

    test("and cannot send it either", async () => {
      const { contract } = await sentContract();
      const r = await post({ action: "send", id: contract.id }, staff.foreign.token);
      assert.equal(r.code, 404);
    });

    test("a draft cannot be created for another company's client", async () => {
      n += 1;
      const t = await post({
        action: "create_template", template_key: `CTHTTP-X${n}`, name: "Cross", body: "Words."
      }, staff.owner.token);
      const r = await post({
        action: "create_draft", client_id: foreignClient, template_id: t.body.template.id
      }, staff.owner.token);
      assert.equal(r.code, 404);
      assert.equal(r.body.error, "client_not_found");
    });
  });

  // ── the read surface ──────────────────────────────────────────────────────

  describe("/api/read/contracts", () => {
    test("serves the library, the queue and one contract with its wording", async () => {
      const { template, contract } = await sentContract();

      const lib = await read({ view: "templates" }, staff.closer.token);
      assert.equal(lib.code, 200);
      const mine = lib.body.items.find((r) => r.id === template.id);
      assert.ok(mine, "the template is missing from the library");
      assert.ok(Array.isArray(mine.manual_fields));

      const queue = await read({ view: "contracts", client_id: client }, staff.closer.token);
      assert.ok(queue.body.items.some((r) => r.id === contract.id));

      const one = await read({ id: contract.id }, staff.closer.token);
      assert.equal(one.code, 200);
      assert.match(one.body.contract.rendered_body, /Fee 10% for Katherine Johnson\./);
      assert.equal(one.body.integrity.ok, true);
      assert.ok(one.body.copy_hash);
    });

    test("never returns a storage key, whatever it selected", async () => {
      const { contract } = await sentContract();
      const one = await read({ id: contract.id }, staff.owner.token);
      assert.equal(JSON.stringify(one.body).includes("storage_key"), false);
    });

    test("reports a tampered contract to the CRM rather than hiding it", async () => {
      const { contract } = await sentContract();
      await withTriggerDisabled("contracts", "trg_contracts_frozen", () =>
        db.query(`UPDATE contracts SET rendered_body = 'edited' WHERE id = $1`, [contract.id]));
      const one = await read({ id: contract.id }, staff.owner.token);
      assert.equal(one.body.integrity.ok, false);
      assert.equal(one.body.integrity.reason, "content_changed");
    });

    test("a bad id or client id is a 400, and an unknown one is a 404", async () => {
      assert.equal((await read({ id: "zzz" }, staff.owner.token)).code, 400);
      assert.equal((await read({ view: "contracts", client_id: "zzz" }, staff.owner.token)).code, 400);
      assert.equal((await read({ id: "00000000-0000-0000-0000-000000000000" }, staff.owner.token)).code, 404);
    });
  });

  // ── the client endpoint ───────────────────────────────────────────────────

  describe("/api/contracts/sign — the anonymous half", () => {
    test("a valid link renders the words, with no session anywhere", async () => {
      const { contract } = await sentContract();
      const r = await callSign(linkQuery(contract.id));
      assert.equal(r.code, 200);
      assert.match(r.body.contract.body, /Fee 10%/);
      assert.equal(r.body.contract.can_sign, true);
      assert.equal(r.headers["cache-control"], "private, no-store");
    });

    test("a forged signature is an undifferentiated 404", async () => {
      const { contract } = await sentContract();
      const q = linkQuery(contract.id);
      const r = await callSign({ ...q, sig: "0".repeat(64) });
      assert.equal(r.code, 404);
      assert.deepEqual(r.body, { ok: false, error: "not_found" });
    });

    test("a link for one contract does not open another", async () => {
      const a = await sentContract();
      const b = await sentContract();
      const r = await callSign({ ...linkQuery(a.contract.id), id: b.contract.id });
      assert.equal(r.code, 404);
    });

    test("an unknown id, a malformed id and a draft all answer the same 404", async () => {
      n += 1;
      const t = await post({
        action: "create_template", template_key: `CTHTTP-DR${n}`, name: "Draft", body: "Words."
      }, staff.owner.token);
      const d = await post({
        action: "create_draft", client_id: client, template_id: t.body.template.id }, staff.owner.token);

      const unknown = await callSign(linkQuery("00000000-0000-0000-0000-000000000000"));
      const malformed = await callSign({ id: "zzz", exp: "1", sig: "x" });
      const draft = await callSign(linkQuery(d.body.contract.id));
      for (const r of [unknown, malformed, draft]) {
        assert.equal(r.code, 404);
        assert.deepEqual(r.body, { ok: false, error: "not_found" });
      }
    });

    test("an expired link says so — the one deliberate exception, and it is benign", async () => {
      const { contract } = await sentContract();
      const q = linkQuery(contract.id, 60, () => Date.now() - 3600 * 1000);
      const r = await callSign(q);
      assert.equal(r.code, 410);
      assert.equal(r.body.error, "link_expired");
    });

    test("signing through the endpoint records the IP the request came from", async () => {
      const { contract } = await sentContract();
      const q = linkQuery(contract.id);
      const r = await callSign(q, {
        method: "POST", body: { signer_name: "Katherine Johnson", agreed: true },
        ip: "198.51.100.22", ua: "Mozilla/5.0 (endpoint test)"
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      const row = (await db.query(`SELECT * FROM contracts WHERE id = $1`, [contract.id])).rows[0];
      assert.equal(row.status, "signed");
      assert.equal(row.signer_name, "Katherine Johnson");
      assert.equal(row.signer_ip, "198.51.100.22");
      assert.equal(row.signer_user_agent, "Mozilla/5.0 (endpoint test)");
    });

    test("an unticked box is refused and writes nothing", async () => {
      const { contract } = await sentContract();
      const r = await callSign(linkQuery(contract.id), {
        method: "POST", body: { signer_name: "Katherine Johnson", agreed: false } });
      assert.equal(r.code, 400);
      assert.equal((await db.query(`SELECT signed_at FROM contracts WHERE id=$1`, [contract.id])).rows[0].signed_at, null);
    });

    test("A FORGED LINK CANNOT SIGN, even with a perfect body", async () => {
      const { contract } = await sentContract();
      const r = await callSign({ ...linkQuery(contract.id), sig: "f".repeat(64) }, {
        method: "POST", body: { signer_name: "Katherine Johnson", agreed: true } });
      assert.equal(r.code, 404);
      assert.equal((await db.query(`SELECT signed_at FROM contracts WHERE id=$1`, [contract.id])).rows[0].signed_at, null);
    });

    test("a tampered contract is refused with 409 through the endpoint too", async () => {
      const { contract } = await sentContract();
      await withTriggerDisabled("contracts", "trg_contracts_frozen", () =>
        db.query(`UPDATE contracts SET rendered_body = rendered_body || '!' WHERE id = $1`, [contract.id]));
      const r = await callSign(linkQuery(contract.id), {
        method: "POST", body: { signer_name: "Katherine Johnson", agreed: true } });
      assert.equal(r.code, 409);
      assert.equal(r.body.error, "content_changed");
    });

    test("only GET and POST are answered", async () => {
      const { contract } = await sentContract();
      const r = await callSign(linkQuery(contract.id), { method: "DELETE" });
      assert.equal(r.code, 405);
      assert.equal(r.headers.allow, "GET, POST");
    });

    test("the signed copy stays readable on the same link afterwards", async () => {
      const { contract } = await sentContract();
      const q = linkQuery(contract.id);
      await callSign(q, { method: "POST", body: { signer_name: "Katherine Johnson", agreed: true } });
      const after = await callSign(q);
      assert.equal(after.code, 200);
      assert.equal(after.body.contract.status, "signed");
      assert.equal(after.body.contract.signer_name, "Katherine Johnson");
      assert.equal(after.body.contract.can_sign, false);
    });
  });
});
