// Postgres-backed tests for the consent gate.
//
// THE CLAIMS HERE CANNOT BE PROVEN WITHOUT A REAL DATABASE, and each is a claim
// about the SCHEMA rather than about the module:
//
//   1. AN UNATTRIBUTED OR WORDLESS CONSENT IS REFUSED BY THE TABLE, not only by
//      src/consent/index.mjs. consent.test.mjs proves the module refuses before
//      it queries — that is a promise about one function. This file proves the
//      promise holds against a writer that never came through it: a script, a
//      psql session, a future module that forgot. A rule enforced only by the
//      code that usually writes is a convention, not a control. Same position
//      077 and soft-pulls.pg.test.mjs take one layer up.
//
//   2. THE VALIDITY PREDICATE IS EVALUATED BY POSTGRES, against Postgres's own
//      clock. The unit test can only check that the SQL contains now(); only a
//      real database can say that a consent expiring one second ago actually
//      stops passing the gate.
//
//   3. A REVOCATION CANNOT BE UNDONE. The trigger in 099 is the control, and a
//      trigger is not testable with a fake.
//
//   4. THE SOFT-PULL GATE IS REAL END TO END: requestSoftPull() against a live
//      database refuses a client with no consent, succeeds once consent exists,
//      and refuses again the instant it is revoked — with the assertion made
//      against the soft_pull_requests ROWS, not against a return value. A return
//      value is the function's account of what it did; the rows are what it did.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs. See the trap in
// CLAUDE.md §12: with DATABASE_URL unset these skip and the suite reports zero
// failures, so a green `npm test` is not evidence any of this ran.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import {
  captureConsent,
  revokeConsent,
  hasValidConsent,
  consentStatus,
  listConsents,
  ConsentError
} from "./index.mjs";
import { requestSoftPull, SoftPullError } from "../finance/soft-pulls.mjs";
import {
  SOFT_PULL_DISCLOSURES,
  CURRENT_SOFT_PULL_VERSION,
  DISPUTE_AUTH_DISCLOSURES,
  CURRENT_DISPUTE_AUTH_VERSION
} from "./disclosures.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const CLIENT_EMAIL_LIKE = "consent.pg.test.%@example.com";
const STAFF_EMAIL_LIKE = "consent_pg_test_%@example.com";

const TEXT = SOFT_PULL_DISCLOSURES[CURRENT_SOFT_PULL_VERSION].text;

describe("consent gate", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, otherClient, staffId, accountId;

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      // client_consents and soft_pull_requests both cascade from clients.
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  }

  const mkClient = async (slug) => (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email)
     VALUES ($1,'Consent',$2,$3) RETURNING id`,
    [org, slug, `consent.pg.test.${slug}@example.com`]
  )).rows[0].id;

  const wipe = async () => {
    await db.query(`DELETE FROM soft_pull_requests WHERE client_id = ANY($1)`, [[client, otherClient]]);
    // No delete guard on client_consents — see 099. The only production delete
    // path is the cascade from clients, and that is deliberate.
    await db.query(`DELETE FROM client_consents WHERE client_id = ANY($1)`, [[client, otherClient]]);
  };

  const grant = (over = {}) => captureConsent(db, {
    orgId: org, clientId: client, kind: "soft_pull_consent",
    consentText: TEXT, consentVersion: CURRENT_SOFT_PULL_VERSION,
    grantedBy: { kind: "client", id: accountId },
    captureMethod: "typed", grantedName: "Consent Pgtest Client",
    ...over
  });

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();

    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Consent Pgtest Closer','closer','consent_pg_test_closer@example.com','active')
       RETURNING id`, [org])).rows[0].id;

    client = await mkClient("subject");
    otherClient = await mkClient("bystander");

    // 044's accounts_active_needs_hash: an active account must be able to
    // authenticate. Nothing here signs in, so it stays 'invited'.
    accountId = (await db.query(
      `INSERT INTO accounts (org_id, kind, email, name, status, client_id)
       VALUES ($1,'client','consent_pg_test_acct@example.com','Consent Pgtest Client','invited',$2)
       RETURNING id`, [org, client])).rows[0].id;
  });

  after(async () => { await purge(); await close(); });

  // ── 1. the table refuses what the module refuses ─────────────────────────

  describe("the schema is the control, not the module", () => {
    test("an unattributed consent is refused BY THE TABLE", async () => {
      await wipe();
      // Straight SQL, deliberately bypassing src/consent/index.mjs entirely.
      // This is the writer the module cannot protect against.
      await assert.rejects(
        () => db.query(
          `INSERT INTO client_consents
             (org_id, client_id, kind, consent_text, granted_by_kind, capture_method)
           VALUES ($1,$2,'soft_pull_consent',$3,'client','checkbox')`,
          [org, client, TEXT]
        ),
        (e) => {
          assert.match(e.message, /client_consents_granter_ck/,
            `refused for the wrong reason: ${e.message}`);
          return true;
        }
      );
    });

    test("a granter kind that disagrees with the id column is refused", async () => {
      await wipe();
      await assert.rejects(() => db.query(
        `INSERT INTO client_consents
           (org_id, client_id, kind, consent_text, granted_by_kind,
            granted_by_staff_id, capture_method)
         VALUES ($1,$2,'soft_pull_consent',$3,'client',$4,'checkbox')`,
        [org, client, TEXT, staffId]
      ), (e) => /client_consents_granter_ck/.test(e.message));
    });

    test("naming BOTH a staff member and an account is refused", async () => {
      await wipe();
      await assert.rejects(() => db.query(
        `INSERT INTO client_consents
           (org_id, client_id, kind, consent_text, granted_by_kind,
            granted_by_account_id, granted_by_staff_id, capture_method)
         VALUES ($1,$2,'soft_pull_consent',$3,'client',$4,$5,'checkbox')`,
        [org, client, TEXT, accountId, staffId]
      ), (e) => /client_consents_granter_ck/.test(e.message));
    });

    test("a whitespace-only consent text is refused as hard as an empty one", async () => {
      await wipe();
      // THE REGEX, NOT btrim(). btrim's default trim set is the SPACE CHARACTER
      // ONLY, so E'\t\n' survives the btrim form and lands looking like an
      // answer. 077's header records that this exact bug shipped once.
      for (const bad of ["", "   ", "\t", "\n", "\t\n", " \t\n "]) {
        await assert.rejects(() => db.query(
          `INSERT INTO client_consents
             (org_id, client_id, kind, consent_text, granted_by_kind,
              granted_by_account_id, capture_method)
           VALUES ($1,$2,'soft_pull_consent',$3,'client',$4,'checkbox')`,
          [org, client, bad, accountId]
        ), (e) => /client_consents_text_ck/.test(e.message),
          `a consent text of ${JSON.stringify(bad)} was accepted by the table`);
      }
    });

    test("an invented capture method is refused by the CHECK", async () => {
      await wipe();
      for (const bad of ["verbal", "inferred", "imported", "click", ""]) {
        await assert.rejects(() => db.query(
          `INSERT INTO client_consents
             (org_id, client_id, kind, consent_text, granted_by_kind,
              granted_by_account_id, capture_method, granted_name)
           VALUES ($1,$2,'soft_pull_consent',$3,'client',$4,$5,'A Name')`,
          [org, client, TEXT, accountId, bad]
        ), undefined, `capture_method ${JSON.stringify(bad)} was accepted`);
      }
    });

    test("a typed consent with no name is refused by the table", async () => {
      await wipe();
      for (const method of ["typed", "signature"]) {
        await assert.rejects(() => db.query(
          `INSERT INTO client_consents
             (org_id, client_id, kind, consent_text, granted_by_kind,
              granted_by_account_id, capture_method)
           VALUES ($1,$2,'soft_pull_consent',$3,'client',$4,$5)`,
          [org, client, TEXT, accountId, method]
        ), (e) => /client_consents_method_ck/.test(e.message),
          `a ${method} consent with no name was accepted`);
      }
    });

    test("an expiry before the grant is refused", async () => {
      await wipe();
      await assert.rejects(() => db.query(
        `INSERT INTO client_consents
           (org_id, client_id, kind, consent_text, granted_by_kind,
            granted_by_account_id, capture_method, granted_at, expires_at)
         VALUES ($1,$2,'soft_pull_consent',$3,'client',$4,'checkbox', now(), now() - interval '1 day')`,
        [org, client, TEXT, accountId]
      ), (e) => /client_consents_expiry_ck/.test(e.message));
    });

    test("a half-written revocation — a time with no reason or no revoker — is refused", async () => {
      await wipe();
      const c = await grant();
      // Taking permission away is the direction that most needs attribution.
      for (const set of [
        `revoked_at = now()`,
        `revoked_at = now(), revoked_reason = 'x'`,
        `revoked_at = now(), revoked_reason = 'x', revoked_by_kind = 'client'`,
        `revoked_reason = 'x'`
      ]) {
        await assert.rejects(
          () => db.query(`UPDATE client_consents SET ${set} WHERE id = $1`, [c.id]),
          undefined, `a revocation of the shape "${set}" was accepted`);
      }
    });

    test("an unknown consent kind is refused", async () => {
      await wipe();
      await assert.rejects(() => db.query(
        `INSERT INTO client_consents
           (org_id, client_id, kind, consent_text, granted_by_kind,
            granted_by_account_id, capture_method)
         VALUES ($1,$2,'vibes',$3,'client',$4,'checkbox')`,
        [org, client, TEXT, accountId]
      ));
    });
  });

  // ── 2. validity is evaluated by Postgres, against Postgres's clock ───────

  describe("validity against the database clock", () => {
    test("a live consent passes", async () => {
      await wipe();
      await grant();
      assert.equal(await hasValidConsent(db, {
        orgId: org, clientId: client, kind: "soft_pull_consent" }), true);
    });

    test("a consent that expired one second ago does not pass", async () => {
      await wipe();
      // granted_at must precede expires_at (the CHECK), so this is written
      // directly with both in the past — a consent that WAS valid and is no
      // longer. now() is Postgres's, which is the only clock entitled to decide.
      await db.query(
        `INSERT INTO client_consents
           (org_id, client_id, kind, consent_text, granted_by_kind,
            granted_by_account_id, capture_method,
            granted_at, expires_at)
         VALUES ($1,$2,'soft_pull_consent',$3,'client',$4,'checkbox',
                 now() - interval '2 days', now() - interval '1 second')`,
        [org, client, TEXT, accountId]
      );
      const s = await consentStatus(db, { orgId: org, clientId: client, kind: "soft_pull_consent" });
      assert.equal(s.valid, false);
      assert.equal(s.reason, "expired");
    });

    test("a consent expiring in the future still passes", async () => {
      await wipe();
      await grant({ expiresAt: new Date(Date.now() + 86_400_000) });
      assert.equal(await hasValidConsent(db, {
        orgId: org, clientId: client, kind: "soft_pull_consent" }), true);
    });

    test("a consent for another org does not answer for this one", async () => {
      await wipe();
      await grant();
      // The gate must be scoped, and this is the assertion that proves the
      // WHERE clause carries the org rather than merely mentioning it.
      assert.equal(await hasValidConsent(db, {
        orgId: "00000000-0000-0000-0000-000000000000",
        clientId: client, kind: "soft_pull_consent" }), false);
    });

    test("a consent for another client does not answer for this one", async () => {
      await wipe();
      await grant();
      assert.equal(await hasValidConsent(db, {
        orgId: org, clientId: otherClient, kind: "soft_pull_consent" }), false);
    });

    test("the newest valid consent wins when several exist", async () => {
      await wipe();
      await db.query(
        `INSERT INTO client_consents
           (org_id, client_id, kind, consent_text, consent_version, granted_by_kind,
            granted_by_account_id, capture_method, granted_at, expires_at)
         VALUES ($1,$2,'soft_pull_consent',$3,'old','client',$4,'checkbox',
                 now() - interval '400 days', now() - interval '35 days')`,
        [org, client, TEXT, accountId]
      );
      const fresh = await grant();
      const s = await consentStatus(db, { orgId: org, clientId: client, kind: "soft_pull_consent" });
      assert.equal(s.valid, true);
      assert.equal(s.consent.id, fresh.id, "an expired older consent outranked the live one");
    });

    test("several consents per client are allowed — there is no unique index to block renewal", async () => {
      await wipe();
      await grant();
      await grant();          // would throw if 099 carried a unique index
      const rows = await listConsents(db, { orgId: org, clientId: client });
      assert.equal(rows.length, 2);
    });
  });

  // ── 3. revocation is a one-way door ─────────────────────────────────────

  describe("revocation", () => {
    test("a revoked consent stops passing the gate immediately", async () => {
      await wipe();
      const c = await grant();
      assert.equal(await hasValidConsent(db, {
        orgId: org, clientId: client, kind: "soft_pull_consent" }), true);

      await revokeConsent(db, {
        orgId: org, consentId: c.id, reason: "client withdrew on a call",
        revokedBy: { kind: "client", id: accountId }
      });

      assert.equal(await hasValidConsent(db, {
        orgId: org, clientId: client, kind: "soft_pull_consent" }), false,
        "a revoked consent still opened the gate");
    });

    test("the revocation cannot be undone — the trigger refuses", async () => {
      await wipe();
      const c = await grant();
      await revokeConsent(db, {
        orgId: org, consentId: c.id, reason: "withdrew",
        revokedBy: { kind: "client", id: accountId }
      });

      await assert.rejects(
        () => db.query(`UPDATE client_consents SET revoked_at = NULL, revoked_reason = NULL,
                          revoked_by_kind = NULL, revoked_by_account_id = NULL WHERE id = $1`, [c.id]),
        (e) => {
          assert.match(e.message, /cannot be edited or undone/);
          return true;
        }
      );
    });

    test("the revocation's reason and timestamp cannot be rewritten", async () => {
      await wipe();
      const c = await grant();
      await revokeConsent(db, {
        orgId: org, consentId: c.id, reason: "the real reason",
        revokedBy: { kind: "client", id: accountId }
      });
      await assert.rejects(
        () => db.query(`UPDATE client_consents SET revoked_reason = 'a nicer reason' WHERE id = $1`, [c.id]),
        (e) => /cannot be edited or undone/.test(e.message));
    });

    test("revoking through another org's scope does nothing", async () => {
      await wipe();
      const c = await grant();
      await assert.rejects(() => revokeConsent(db, {
        orgId: "00000000-0000-0000-0000-000000000000",
        consentId: c.id, reason: "not mine to revoke",
        revokedBy: { kind: "staff", id: staffId }
      }), (e) => e instanceof ConsentError && e.status === 409);

      // And the consent is untouched.
      assert.equal(await hasValidConsent(db, {
        orgId: org, clientId: client, kind: "soft_pull_consent" }), true);
    });

    test("consenting again after a revocation is a NEW row, and it works", async () => {
      await wipe();
      const first = await grant();
      await revokeConsent(db, {
        orgId: org, consentId: first.id, reason: "withdrew",
        revokedBy: { kind: "client", id: accountId }
      });
      const second = await grant();

      assert.notEqual(second.id, first.id);
      assert.equal(await hasValidConsent(db, {
        orgId: org, clientId: client, kind: "soft_pull_consent" }), true);

      // The withdrawal is still on the record. A history that hides it is not one.
      const history = await listConsents(db, { orgId: org, clientId: client });
      assert.equal(history.length, 2);
      assert.ok(history.some((h) => h.revoked_at !== null),
        "the revocation disappeared from the history once a new consent was given");
    });

    test("the consent facts are immutable — the words cannot be rewritten later", async () => {
      await wipe();
      const c = await grant();
      await assert.rejects(
        () => db.query(`UPDATE client_consents SET consent_text = 'something else' WHERE id = $1`, [c.id]),
        (e) => {
          assert.match(e.message, /immutable/);
          return true;
        }
      );
      for (const col of ["capture_method = 'checkbox'", "granted_at = now()",
                         "expires_at = now() + interval '1 year'", "granted_name = 'Someone Else'"]) {
        await assert.rejects(
          () => db.query(`UPDATE client_consents SET ${col} WHERE id = $1`, [c.id]),
          (e) => /immutable/.test(e.message), `${col} was allowed to change`);
      }
    });
  });

  // ── 4. the soft-pull gate, end to end, against the rows ─────────────────

  describe("requestSoftPull is gated on consent", () => {
    const ask = () => requestSoftPull(db, {
      orgId: org, clientId: client,
      requestedBy: { kind: "staff", id: staffId },
      reason: "closer refreshing the waterfall"
    });

    const ledger = async () => (await db.query(
      `SELECT * FROM soft_pull_requests WHERE client_id = $1 ORDER BY requested_at, id`, [client]
    )).rows;

    test("with no consent on file the request is refused and NO ROW is written", async () => {
      await wipe();
      await assert.rejects(ask, (e) => {
        assert.ok(e instanceof SoftPullError);
        assert.equal(e.status, 403);
        assert.equal(e.code, "consent_required");
        return true;
      });
      // Against the ROWS, not the return value. This is the assertion that
      // would catch a guard that inserts and then raises.
      assert.deepEqual(await ledger(), [],
        "a consumer-credit event was recorded for somebody who never consented");
    });

    test("with consent the request succeeds and the row lands queued", async () => {
      await wipe();
      await grant();
      const out = await ask();
      assert.equal(out.created, true);

      const rows = await ledger();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "queued");
      assert.equal(rows[0].requested_by_staff_id, staffId);
    });

    test("revoking consent stops the NEXT request immediately, with no restart in between", async () => {
      await wipe();
      const c = await grant();
      await ask();
      const before = (await ledger()).length;
      assert.equal(before, 1);

      // Close the open request so guard 2 is not what refuses the second ask —
      // otherwise this test would pass even with the consent gate removed.
      await db.query(
        `UPDATE soft_pull_requests SET status='cancelled', state_reason='test', resolved_at=now()
          WHERE client_id = $1`, [client]);

      await revokeConsent(db, {
        orgId: org, consentId: c.id, reason: "client withdrew",
        revokedBy: { kind: "client", id: accountId }
      });

      await assert.rejects(ask, (e) => e.status === 403 && e.code === "consent_required");
      assert.equal((await ledger()).length, before,
        "a pull was recorded after the client withdrew consent");
    });

    test("an expired consent refuses too, and says so", async () => {
      await wipe();
      await db.query(
        `INSERT INTO client_consents
           (org_id, client_id, kind, consent_text, granted_by_kind,
            granted_by_account_id, capture_method, granted_at, expires_at)
         VALUES ($1,$2,'soft_pull_consent',$3,'client',$4,'checkbox',
                 now() - interval '400 days', now() - interval '1 day')`,
        [org, client, TEXT, accountId]
      );
      await assert.rejects(ask, (e) => {
        assert.equal(e.status, 403);
        assert.match(e.message, /expired/);
        return true;
      });
      assert.deepEqual(await ledger(), []);
    });

    test("another client's consent does not authorise this client's pull", async () => {
      await wipe();
      // Consent for the bystander only.
      await captureConsent(db, {
        orgId: org, clientId: otherClient, kind: "soft_pull_consent",
        consentText: TEXT, grantedBy: { kind: "staff", id: staffId },
        captureMethod: "checkbox"
      });
      await assert.rejects(ask, (e) => e.code === "consent_required");
      assert.deepEqual(await ledger(), []);
    });
  });

  describe("dispute_authorization kind", () => {
    const DISPUTE_TEXT = DISPUTE_AUTH_DISCLOSURES[CURRENT_DISPUTE_AUTH_VERSION].text;

    test("captureConsent writes a live dispute_authorization row", async () => {
      await wipe();
      const c = await captureConsent(db, {
        orgId: org, clientId: client, kind: "dispute_authorization",
        consentText: DISPUTE_TEXT,
        consentVersion: CURRENT_DISPUTE_AUTH_VERSION,
        grantedBy: { kind: "client", id: accountId },
        captureMethod: "signature", grantedName: "Consent Pgtest Client"
      });
      assert.equal(c.kind, "dispute_authorization");
      assert.equal(c.consent_version, CURRENT_DISPUTE_AUTH_VERSION);
      assert.equal(await hasValidConsent(db, {
        orgId: org, clientId: client, kind: "dispute_authorization" }), true);
      assert.equal(await hasValidConsent(db, {
        orgId: org, clientId: client, kind: "soft_pull_consent" }), false,
        "dispute authorization opened the soft-pull gate");
    });

    test("the kind check permits dispute_authorization and refuses an invented kind", async () => {
      await wipe();
      await db.query(
        `INSERT INTO client_consents
           (org_id, client_id, kind, consent_text, granted_by_kind,
            granted_by_account_id, capture_method, granted_name)
         VALUES ($1,$2,'dispute_authorization',$3,'client',$4,'signature','Consent Pgtest Client')`,
        [org, client, DISPUTE_TEXT, accountId]
      );
      await assert.rejects(
        () => db.query(
          `INSERT INTO client_consents
             (org_id, client_id, kind, consent_text, granted_by_kind,
              granted_by_account_id, capture_method, granted_name)
           VALUES ($1,$2,'vibes',$3,'client',$4,'signature','Consent Pgtest Client')`,
          [org, client, DISPUTE_TEXT, accountId]
        ),
        (e) => {
          assert.match(e.message, /client_consents_kind_check/,
            `refused for the wrong reason: ${e.message}`);
          return true;
        }
      );
    });
  });
});
