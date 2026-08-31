// THE PAYOUT GATE CANNOT BE OPENED WITHOUT THE DOCUMENT. This file is what
// holds that.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): the behaviour asserted here decides
// when a partner becomes payable.
//
// WHAT WENT WRONG, so the shape of these assertions makes sense.
// 042_partners.sql refuses to move a partner_payouts run to 'processing' or
// 'paid' while partners.agreement_signed_at is NULL, and calls that hold the
// mirror of the affiliate partner-license hold in 033. 030_documents.sql names
// the document both holds are named after — `contract / partner_license`. Every
// piece of that chain shipped EXCEPT the document: nothing in db/ ever seeded a
// partner licence, so the only way a partner could ever be paid was for somebody
// to write a timestamp into that column by hand, with no signed words behind it
// and no record of who decided. A gate whose key does not exist is not a
// control. db/migrations/283_partner_license_template.sql mints the key and
// src/contracts/partner-license.mjs is the lock.
//
// WHY THESE ARE STUBS AND NOT A DATABASE. Every *.pg.test.mjs skips when
// DATABASE_URL is unset, and a guard that skips is not a guard — the same
// reasoning src/contracts/offer-fee-language.test.mjs records. The claim being
// held here is "no document, no UPDATE", and the honest way to prove a statement
// was never issued is to watch every statement the module issues. A stub db
// records them all; the real database cannot report the query that did not run.
// src/contracts/partner-license.pg.test.mjs runs the same chain against real
// Postgres, including 042's trigger actually raising.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PARTNER_LICENSE_TEMPLATE_KEY,
  PARTNER_LICENSE_SUBTYPE,
  PARTNER_ID_MERGE_KEY,
  PARTNER_SHARE_PCT,
  PARTNER_ENTRY_REFUND_DAYS,
  getPartnerLicenseTemplate,
  findSignedPartnerLicense,
  stampPartnerAgreement
} from "./partner-license.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const OTHER_PARTNER = "33333333-3333-4333-8333-333333333333";
const SIGNED_AT = new Date("2026-08-20T15:04:05.000Z");

/**
 * A db that answers the four reads this module makes and records every
 * statement, so a test can assert on the statement that was NOT issued.
 */
function stubDb({ partner = undefined, licence = null, template = null } = {}) {
  const calls = [];
  const db = {
    calls,
    /** Every statement, whitespace-flattened, in the order it was issued. */
    sql: () => calls.map((c) => c.text),
    updates: () => calls.filter((c) => /^UPDATE/i.test(c.text)),
    async query(text, params = []) {
      const flat = String(text).replace(/\s+/g, " ").trim();
      calls.push({ text: flat, params });

      if (/^UPDATE partners/i.test(flat)) {
        // Mirrors the real row: the guarded UPDATE matches nothing when the
        // column is already set.
        if (partner && partner.agreement_signed_at) return { rows: [] };
        return { rows: [{ id: PARTNER, agreement_signed_at: params[2] }] };
      }
      if (/^SELECT id, agreement_signed_at FROM partners/i.test(flat)) {
        return { rows: partner === undefined ? [] : [partner] };
      }
      if (/^SELECT agreement_signed_at FROM partners/i.test(flat)) {
        return { rows: partner === undefined ? [] : [partner] };
      }
      if (/FROM contracts/i.test(flat)) {
        return { rows: licence ? [licence] : [] };
      }
      if (/FROM contract_templates/i.test(flat)) {
        return { rows: template ? [template] : [] };
      }
      throw new Error(`stubDb: unexpected statement ${flat}`);
    }
  };
  return db;
}

const aPartner = (over = {}) => ({ id: PARTNER, agreement_signed_at: null, ...over });
const aTemplate = (over = {}) => ({
  id: "44444444-4444-4444-8444-444444444444",
  template_key: PARTNER_LICENSE_TEMPLATE_KEY,
  subtype: PARTNER_LICENSE_SUBTYPE,
  active: true,
  ...over
});
const aSignedLicence = (over = {}) => ({
  id: "55555555-5555-4555-8555-555555555555",
  template_key: PARTNER_LICENSE_TEMPLATE_KEY,
  status: "signed",
  signed_at: SIGNED_AT,
  is_demo: false,
  merge_values: { [PARTNER_ID_MERGE_KEY]: PARTNER },
  ...over
});

/* ─────────────────────────────────────────────────────────────────────────
   The names other code matches on. A rename here is a silent no-op in the
   seeded SQL, so it is pinned rather than trusted.
   ───────────────────────────────────────────────────────────────────────── */

describe("the names the gate and the document agree on", () => {
  test("the template key is the one db/migrations/283 seeds", () => {
    assert.equal(PARTNER_LICENSE_TEMPLATE_KEY, "PARTNER-LICENSE");
  });

  test("the subtype is the one 030_documents.sql names", () => {
    // 030 lists `partner_license` under contract subtypes with the comment
    // "the affiliate portal gates payouts on this one".
    assert.equal(PARTNER_LICENSE_SUBTYPE, "partner_license");
  });

  test("the owner-set numbers are recorded, not typed into a sentence twice", () => {
    assert.equal(PARTNER_SHARE_PCT, 50);
    assert.equal(PARTNER_ENTRY_REFUND_DAYS, 3);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   THE CENTRAL CLAIM: the stamp needs the document.
   ───────────────────────────────────────────────────────────────────────── */

describe("the gate cannot be satisfied with no template present", () => {
  test("no partner licence copy anywhere: refused, and nothing is written", async () => {
    const db = stubDb({ partner: aPartner(), licence: null, template: null });

    await assert.rejects(
      () => stampPartnerAgreement(db, { orgId: ORG, partnerId: PARTNER }),
      (err) => {
        assert.equal(err.code, "partner_license_template_missing");
        assert.equal(err.status, 409);
        // The message is read by a staff member, not a developer.
        assert.match(err.message, /partner license wording/i);
        return true;
      }
    );

    assert.deepEqual(
      db.updates(), [],
      "the payout gate was opened with no partner licence in existence — " +
      "stampPartnerAgreement wrote to partners anyway"
    );
  });

  test("copy exists but this partner never signed it: refused, nothing written", async () => {
    const db = stubDb({ partner: aPartner(), licence: null, template: aTemplate() });

    await assert.rejects(
      () => stampPartnerAgreement(db, { orgId: ORG, partnerId: PARTNER }),
      (err) => {
        assert.equal(err.code, "partner_license_not_signed");
        assert.equal(err.status, 409);
        return true;
      }
    );

    assert.deepEqual(db.updates(), [], "an unsigned partner was made payable");
  });

  test("the two refusals are told apart, because they need different people", async () => {
    // One is an org nobody seeded the copy into; the other is a partner nobody
    // sent it to. Collapsing them into one message sends the wrong person
    // looking.
    const noCopy = stubDb({ partner: aPartner(), template: null });
    const notSent = stubDb({ partner: aPartner(), template: aTemplate() });

    const a = await stampPartnerAgreement(noCopy, { orgId: ORG, partnerId: PARTNER })
      .catch((e) => e.code);
    const b = await stampPartnerAgreement(notSent, { orgId: ORG, partnerId: PARTNER })
      .catch((e) => e.code);

    assert.notEqual(a, b);
  });

  test("an archived template still counts as present — the fault is the sending", async () => {
    // activeOnly:false on the second lookup. An org that switched the copy off
    // has copy; what it does not have is a signed one.
    const db = stubDb({ partner: aPartner(), template: aTemplate({ active: false }) });
    await assert.rejects(
      () => stampPartnerAgreement(db, { orgId: ORG, partnerId: PARTNER }),
      (err) => err.code === "partner_license_not_signed"
    );
  });

  test("a partner who is not on file is a 404, checked before anything else", async () => {
    const db = stubDb({ partner: undefined });
    await assert.rejects(
      () => stampPartnerAgreement(db, { orgId: ORG, partnerId: PARTNER }),
      (err) => err.code === "partner_not_found" && err.status === 404
    );
    assert.deepEqual(db.updates(), []);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   What a signed licence is allowed to do — and what it must not.
   ───────────────────────────────────────────────────────────────────────── */

describe("a signed partner licence, and only that, opens the gate", () => {
  test("the stamp is the moment on the document, never now()", async () => {
    const db = stubDb({ partner: aPartner(), licence: aSignedLicence() });
    const out = await stampPartnerAgreement(db, { orgId: ORG, partnerId: PARTNER });

    assert.equal(out.stamped, true);
    assert.equal(out.contractId, aSignedLicence().id);
    assert.equal(String(out.agreementSignedAt), String(SIGNED_AT));

    const [update] = db.updates();
    assert.ok(update, "nothing was written");
    assert.equal(update.params[2], SIGNED_AT,
      "the stamp did not come from the document — a partner's money became payable " +
      "at a moment nobody signed anything");
    assert.doesNotMatch(update.text, /now\(\)\s*::?\s*timestamptz|= now\(\), updated_at/,
      "agreement_signed_at was set from the clock rather than from the signature");
  });

  test("the write refuses to race: the UPDATE checks the column is still empty", async () => {
    const db = stubDb({ partner: aPartner(), licence: aSignedLicence() });
    await stampPartnerAgreement(db, { orgId: ORG, partnerId: PARTNER });
    const [update] = db.updates();
    assert.match(update.text, /agreement_signed_at IS NULL/,
      "two callers at once could each move the date a partner became payable");
  });

  test("already stamped is left exactly alone", async () => {
    const was = new Date("2026-01-02T03:04:05.000Z");
    const db = stubDb({ partner: aPartner({ agreement_signed_at: was }), licence: aSignedLicence() });

    const out = await stampPartnerAgreement(db, { orgId: ORG, partnerId: PARTNER });

    assert.equal(out.stamped, false);
    assert.equal(out.agreementSignedAt, was);
    assert.deepEqual(
      db.updates(), [],
      "re-running onboarding moved the moment a partner became payable"
    );
  });

  test("a demo licence is not a licence", async () => {
    // 148_demo_mode.sql exists because on 2026-08-27 all 44 contracts in the
    // production database were test artifacts showing as real signed
    // agreements. The exclusion is in the SQL, so this asserts on the SQL.
    const db = stubDb({ partner: aPartner(), licence: aSignedLicence() });
    await stampPartnerAgreement(db, { orgId: ORG, partnerId: PARTNER });
    const read = db.sql().find((s) => /FROM contracts/.test(s));
    assert.match(read, /is_demo = false/, "a seeded demo contract could make a partner payable");
  });

  test("the licence has to be this partner's, and it has to be signed", async () => {
    const db = stubDb({ partner: aPartner(), licence: aSignedLicence() });
    await stampPartnerAgreement(db, { orgId: ORG, partnerId: PARTNER });
    const read = db.sql().find((s) => /FROM contracts/.test(s));

    assert.match(read, /template_key = \$2/, "any contract at all would have opened the gate");
    assert.match(read, /status = 'signed'/, "a sent-but-unsigned licence would have opened the gate");
    assert.match(read, /signed_at IS NOT NULL/);
    assert.match(read, /merge_values->>\$3 = \$4/,
      "another partner's signed licence would have opened this partner's gate");
    assert.match(read, /org_id = \$1/);
  });

  test("the oldest signature wins, so a re-sign cannot move the date forward", async () => {
    const db = stubDb({ partner: aPartner(), licence: aSignedLicence() });
    await stampPartnerAgreement(db, { orgId: ORG, partnerId: PARTNER });
    const read = db.sql().find((s) => /FROM contracts/.test(s));
    assert.match(read, /ORDER BY signed_at ASC/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   The two lookups on their own.
   ───────────────────────────────────────────────────────────────────────── */

describe("the lookups answer honestly rather than helpfully", () => {
  test("no template is null, not a thrown error and not a fabricated row", async () => {
    const db = stubDb({ template: null });
    assert.equal(await getPartnerLicenseTemplate(db, { orgId: ORG }), null);
  });

  test("no signed licence is null", async () => {
    const db = stubDb({ licence: null });
    assert.equal(await findSignedPartnerLicense(db, { orgId: ORG, partnerId: PARTNER }), null);
  });

  test("both refuse to guess which company or which partner", async () => {
    const db = stubDb({});
    await assert.rejects(() => getPartnerLicenseTemplate(db, {}), (e) => e.code === "org_required");
    await assert.rejects(
      () => findSignedPartnerLicense(db, { orgId: ORG }), (e) => e.code === "partner_required");
    await assert.rejects(
      () => stampPartnerAgreement(db, { partnerId: PARTNER }), (e) => e.code === "org_required");
    await assert.rejects(
      () => stampPartnerAgreement(db, { orgId: ORG }), (e) => e.code === "partner_required");
    assert.deepEqual(db.updates(), []);
  });

  test("the partner id travels as a parameter, never spliced into the SQL", async () => {
    const db = stubDb({ licence: null });
    await findSignedPartnerLicense(db, { orgId: ORG, partnerId: OTHER_PARTNER });
    const [call] = db.calls;
    assert.ok(!call.text.includes(OTHER_PARTNER));
    assert.ok(call.params.includes(OTHER_PARTNER));
  });
});
