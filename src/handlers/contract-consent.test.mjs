// Unit tests for src/handlers/contract-consent.mjs — the handler that turns a
// signed soft-pull authorization into a consent record.
//
// This is a compliance-flagged path: the rows this handler writes are what
// src/finance/soft-pulls.mjs reads before a credit pull. The failure modes worth
// proving are therefore the ones that would OPEN the gate by accident, and the
// list comes straight from the decision that reversed src/handlers/
// contract-signed.mjs:41-48 ("two writers for one permission is how a
// revocation stops biting"):
//
//   1. only the soft-pull instrument writes anything at all
//   2. a replay writes NO second row, ever
//   3. a withdrawal keeps biting — a stale signature cannot re-grant
//   4. the stored words are the server's disclosure, never the contract body
//   5. the row is attributed, named, dated and points at the signed paper
//   6. a term on the paper becomes a real expiry, and an unreadable one refuses
//
// NO DATABASE. The fake below is an in-memory client_consents plus the one
// contracts row the handler reads. Anything the handler asks for that is not
// routed lands in `other`, which several tests assert is empty.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  onContractSignedConsent,
  loadSoftPullContract,
  isSoftPullInstrument,
  consentTerm,
  consentGuard,
  register,
  CONSENT_KIND,
  INSTRUMENT_KIND,
  INSTRUMENT_SUBTYPE
} from "./contract-consent.mjs";
import { emit } from "../events/bus.mjs";
import { clearHandlers, getHandlers } from "../events/registry.mjs";
import { registerAll, _resetRegistered } from "../register-all.mjs";
import { CURRENT_SOFT_PULL_VERSION, SOFT_PULL_DISCLOSURES } from "../consent/disclosures.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const CONTRACT = "33333333-3333-4333-8333-333333333333";
const SIGNED_DOC = "44444444-4444-4444-8444-444444444444";
const STAFF = "66666666-6666-4666-8666-666666666666";

const SIGNED_AT = new Date("2026-08-19T15:04:05Z");
const DISCLOSURE = SOFT_PULL_DISCLOSURES[CURRENT_SOFT_PULL_VERSION];

/* The words a consumer actually read on the paper. Nothing in this string may
   ever reach client_consents — that is claim 4 above, and the reason the
   handler's column list leaves rendered_body out entirely. */
const CONTRACT_BODY =
  "SOFT PULL AUTHORIZATION\n\nI am asking Fundhub to look at my credit report.";

function contractRow(over = {}) {
  return {
    id: CONTRACT,
    org_id: ORG,
    client_id: CLIENT,
    template_key: "SOFT-PULL-CONSENT",
    title: "Soft Pull Authorization",
    kind: "authorization",
    subtype: "soft_pull_consent",
    status: "signed",
    merge_values: { company_name: "Fundhub", consent_days: "90" },
    sent_by: STAFF,
    signed_at: SIGNED_AT,
    signer_name: "Dana Reeves",
    signed_document_id: SIGNED_DOC,
    ...over
  };
}

/* fakeDb — contracts (read only) and client_consents (read and write).

   The guard query is `count(*) FILTER (...)`, so it is answered by filtering
   the array rather than by a canned number: a test that seeds a revoked row has
   to move the real counter, or it is not testing the guard. */
function fakeDb({ contracts = [contractRow()], consents = [] } = {}) {
  const state = { contracts, consents: [...consents], sql: [], other: [] };
  let n = 0;

  state.query = async (rawSql, params = []) => {
    const sql = String(rawSql);
    state.sql.push({ sql, params });

    if (/INSERT INTO events/i.test(sql)) {
      return { rows: [{ id: `evt-${++n}` }] };
    }

    if (/FROM contracts/i.test(sql)) {
      const [id, orgId] = params;
      const hit = state.contracts.find(
        (c) => c.id === id && String(c.org_id) === String(orgId)
      );
      return { rows: hit ? [hit] : [] };
    }

    if (/count\(\*\) FILTER/i.test(sql) && /FROM client_consents/i.test(sql)) {
      const [orgId, clientId, kind, documentId, signedAt] = params;
      const mine = state.consents.filter(
        (c) => String(c.org_id) === String(orgId)
          && String(c.client_id) === String(clientId)
          && c.kind === kind
      );
      const since = new Date(signedAt).getTime();
      return { rows: [{
        from_this_document: String(
          mine.filter((c) => c.document_id && String(c.document_id) === String(documentId)).length
        ),
        withdrawn_since: String(
          mine.filter((c) => c.revoked_at && new Date(c.revoked_at).getTime() >= since).length
        )
      }] };
    }

    if (/INSERT INTO client_consents/i.test(sql)) {
      const [org_id, client_id, kind, consent_text, consent_version,
             granted_by_kind, granted_by_account_id, granted_by_staff_id,
             capture_method, granted_name, captured_ip, captured_user_agent,
             document_id, expires_at] = params;
      const row = {
        id: `consent-${++n}`, org_id, client_id, kind, consent_text, consent_version,
        granted_by_kind, granted_by_account_id, granted_by_staff_id,
        capture_method, granted_name, captured_ip, captured_user_agent,
        document_id, granted_at: new Date(), expires_at,
        revoked_at: null, revoked_reason: null, revoked_by_kind: null,
        revoked_by_account_id: null, revoked_by_staff_id: null,
        created_at: new Date(), updated_at: new Date()
      };
      state.consents.push(row);
      return { rows: [row] };
    }

    state.other.push({ sql, params });
    return { rows: [] };
  };

  return state;
}

const signedEvent = (payload = {}) => ({
  id: "evt-contract-signed-1",
  name: "contract.signed",
  orgId: ORG,
  clientId: CLIENT,
  payload: { contract_id: CONTRACT, client_id: CLIENT, ...payload }
});

/** A consent row already on file, of the shape /api/consent/capture writes. */
const existingConsent = (over = {}) => ({
  id: "consent-existing", org_id: ORG, client_id: CLIENT, kind: CONSENT_KIND,
  consent_text: DISCLOSURE.text, consent_version: DISCLOSURE.version,
  granted_by_kind: "staff", granted_by_account_id: null, granted_by_staff_id: STAFF,
  capture_method: "checkbox", granted_name: null,
  captured_ip: null, captured_user_agent: null,
  document_id: null, granted_at: new Date("2026-08-01T00:00:00Z"), expires_at: null,
  revoked_at: null,
  ...over
});

const insertsIn = (db) => db.sql.filter((q) => /INSERT INTO client_consents/i.test(q.sql));

// ---------------------------------------------------------------------------
// 1. it is actually wired up
// ---------------------------------------------------------------------------

describe("registration", () => {
  let savedInngestKey;

  beforeEach(() => {
    // The bus fans out to Inngest when this is set, and a unit test must never
    // reach a live workflow engine. Removed for the duration and put back.
    savedInngestKey = process.env.INNGEST_EVENT_KEY;
    delete process.env.INNGEST_EVENT_KEY;
    clearHandlers();
    _resetRegistered();
  });

  afterEach(() => {
    if (savedInngestKey === undefined) delete process.env.INNGEST_EVENT_KEY;
    else process.env.INNGEST_EVENT_KEY = savedInngestKey;
    clearHandlers();
    _resetRegistered();
  });

  test("registerAll() puts this handler on contract.signed", () => {
    /* `includes`, not a length. contract.signed now has TWO listeners on
       purpose — contract-signed.mjs hands over the countersigned copy and makes
       the task, this one writes the consent — and asserting a count here would
       break the next time a third is added for an unrelated reason. */
    assert.equal(getHandlers("contract.signed").length, 0, "nothing should listen before boot");
    registerAll();
    assert.ok(
      getHandlers("contract.signed").includes(onContractSignedConsent),
      "a signed soft-pull authorization would record no consent"
    );
  });

  test("register() alone is enough, and registering twice adds one handler", () => {
    register();
    register();
    assert.equal(
      getHandlers("contract.signed").filter((f) => f === onContractSignedConsent).length, 1
    );
  });

  test("emitting contract.signed through the real bus records the consent", async () => {
    const db = fakeDb();
    register();

    const res = await emit(db, "contract.signed", signedEvent().payload, {
      orgId: ORG,
      clientId: CLIENT,
      idempotencyKey: `contract.signed:${CONTRACT}`,
      throwOnHandlerError: true
    });

    assert.equal(res.deduped, false);
    assert.equal(db.consents.length, 1, "the signature reached the bus and wrote nothing");
    assert.equal(db.consents[0].kind, CONSENT_KIND);
  });
});

// ---------------------------------------------------------------------------
// 2. only the soft-pull instrument counts
// ---------------------------------------------------------------------------

describe("what counts as the soft-pull instrument", () => {
  test("the pair is authorization + soft_pull_consent", () => {
    assert.equal(INSTRUMENT_KIND, "authorization");
    assert.equal(INSTRUMENT_SUBTYPE, "soft_pull_consent");
    assert.ok(isSoftPullInstrument({ kind: "authorization", subtype: "soft_pull_consent" }));
    assert.ok(isSoftPullInstrument({ kind: " Authorization ", subtype: "SOFT_PULL_CONSENT" }));
  });

  test("a funding agreement writes no consent", async () => {
    const db = fakeDb({ contracts: [contractRow({
      template_key: "FUNDING-AGREEMENT", kind: "contract", subtype: "funding_agreement"
    })] });
    const res = await onContractSignedConsent(signedEvent(), db);

    assert.equal(res.recorded, false);
    assert.equal(res.reason, "not_the_soft_pull_instrument");
    assert.deepEqual(insertsIn(db), []);
  });

  test("the TEMPLATE KEY is not the gate — a mislabelled contract grants nothing", async () => {
    /* contracts.template_key is a snapshot label and src/contracts/templates.mjs
       lets an org pick any key it likes. A contract that merely borrowed the
       name 'SOFT-PULL-CONSENT' must not unlock a credit pull. */
    const db = fakeDb({ contracts: [contractRow({
      template_key: "SOFT-PULL-CONSENT", kind: "contract", subtype: "funding_agreement"
    })] });
    const res = await onContractSignedConsent(signedEvent(), db);

    assert.equal(res.recorded, false);
    assert.equal(res.reason, "not_the_soft_pull_instrument");
    assert.deepEqual(db.consents, []);
  });

  test("an authorization with no subtype is refused, not guessed at", async () => {
    // The safe direction of being wrong: no consent row, and the pull gate stays
    // shut and says so out loud.
    for (const subtype of [null, "", "   ", "authorisation_of_something"]) {
      const db = fakeDb({ contracts: [contractRow({ subtype })] });
      const res = await onContractSignedConsent(signedEvent(), db);
      assert.equal(res.recorded, false, `subtype ${JSON.stringify(subtype)} got through`);
      assert.deepEqual(insertsIn(db), []);
    }
  });

  test("a contract that is no longer signed grants nothing", async () => {
    // A signature that was later voided must not grant permission on a replay.
    const db = fakeDb({ contracts: [contractRow({ status: "void" })] });
    const res = await onContractSignedConsent(signedEvent(), db);
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "not_signed");
    assert.deepEqual(db.consents, []);
  });
});

// ---------------------------------------------------------------------------
// 3. what the row actually says
// ---------------------------------------------------------------------------

describe("the consent row", () => {
  test("is written with the server's words, the signer's name and the signed paper", async () => {
    const db = fakeDb();
    const res = await onContractSignedConsent(signedEvent(), db);

    assert.equal(res.recorded, true);
    assert.equal(db.consents.length, 1);
    const row = db.consents[0];

    assert.equal(row.org_id, ORG);
    assert.equal(row.client_id, CLIENT);
    assert.equal(row.kind, CONSENT_KIND);
    assert.equal(row.capture_method, "signature");
    assert.equal(row.granted_name, "Dana Reeves", "a signature consent must carry the signed name");
    assert.equal(row.document_id, SIGNED_DOC, "the consent does not point at the paper");
    assert.equal(row.granted_by_kind, "staff");
    assert.equal(row.granted_by_staff_id, STAFF, "attribution is not the staff member who sent it");
    assert.equal(row.granted_by_account_id, null);
  });

  test("THE WORDS COME FROM THE SERVER, never from the contract body", async () => {
    /* THE MOST IMPORTANT TEST IN THIS FILE. If the contract's own text could
       become the consent text, whoever edits a template would be editing what
       consumers are recorded as having agreed to. */
    const db = fakeDb({ contracts: [contractRow({ rendered_body: CONTRACT_BODY })] });
    await onContractSignedConsent(signedEvent(), db);

    const ins = insertsIn(db)[0];
    assert.equal(ins.params[3], DISCLOSURE.text, "the stored words are not the server's own copy");
    assert.equal(ins.params[4], CURRENT_SOFT_PULL_VERSION);
    assert.ok(!ins.params.some((p) => typeof p === "string" && p.includes("I am asking Fundhub")),
      "the contract body reached the consent row");
  });

  test("the contract body is never even read out of the database", async () => {
    // The column list leaves rendered_body out, so the words cannot leak by
    // accident later either.
    const db = fakeDb();
    await onContractSignedConsent(signedEvent(), db);
    const read = db.sql.find((q) => /FROM contracts/i.test(q.sql));
    assert.ok(!/rendered_body/i.test(read.sql), "the handler selected the signed agreement's words");
    assert.ok(!/signature_statement/i.test(read.sql));
  });

  test("ip and user agent are left null rather than dressed up as web evidence", async () => {
    const db = fakeDb();
    await onContractSignedConsent(signedEvent(), db);
    const row = db.consents[0];
    assert.equal(row.captured_ip, null);
    assert.equal(row.captured_user_agent, null);
  });

  test("no query is issued that this test file does not account for", async () => {
    const db = fakeDb();
    await onContractSignedConsent(signedEvent(), db);
    assert.deepEqual(db.other, [], "the handler touched something nothing here routes");
  });
});

// ---------------------------------------------------------------------------
// 4. how long the permission lasts
// ---------------------------------------------------------------------------

describe("the term on the paper", () => {
  test("consent_days becomes a real expiry, measured from the signature", async () => {
    const db = fakeDb();
    await onContractSignedConsent(signedEvent(), db);
    const expiry = db.consents[0].expires_at;
    assert.ok(expiry instanceof Date);
    assert.equal(expiry.getTime(), SIGNED_AT.getTime() + 90 * 86_400_000);
  });

  test("an instrument that names no term does not expire", async () => {
    // NULL means "does not expire" (099). It is honest here: nothing on the
    // paper said the permission would end.
    const db = fakeDb({ contracts: [contractRow({ merge_values: { company_name: "Fundhub" } })] });
    const res = await onContractSignedConsent(signedEvent(), db);
    assert.equal(res.recorded, true);
    assert.equal(db.consents[0].expires_at, null);
  });

  test("a term we cannot read is a REFUSAL, not a null", async () => {
    /* Writing null because "ninety" would not parse turns a 90-day permission
       into a permanent one. That is the most expensive direction to be wrong in
       on this table, so it fails closed instead. */
    /* `[]` is on this list because it found a real hole rather than confirming
       a guess: `String([])` is the empty string, so an array read as "no term
       at all" and wrote a permanent permission. See SHAPE BEFORE VALUE in
       consentTerm(). "0x5A" and "1e3" are here for the same reason in the other
       direction — Number() reads them as 90 and 1000. */
    for (const bad of ["ninety", "90 days", "0", "-5", "12.5", "0x5A", "1e3",
                       {}, [], [90], true]) {
      const db = fakeDb({ contracts: [contractRow({
        merge_values: { consent_days: bad }
      })] });
      const res = await onContractSignedConsent(signedEvent(), db);
      assert.equal(res.recorded, false, `consent_days ${JSON.stringify(bad)} was accepted`);
      assert.equal(res.reason, "consent_term_unreadable");
      assert.deepEqual(db.consents, []);
    }
  });

  test("consentTerm reports three states, not two", () => {
    assert.deepEqual(consentTerm({ consent_days: "90" }), { state: "days", days: 90 });
    assert.deepEqual(consentTerm({ consent_days: 90 }), { state: "days", days: 90 });
    assert.deepEqual(consentTerm({}), { state: "absent", days: null });
    assert.deepEqual(consentTerm(null), { state: "absent", days: null });
    assert.deepEqual(consentTerm({ consent_days: "  " }), { state: "absent", days: null });
    assert.deepEqual(consentTerm({ consent_days: "soon" }), { state: "unreadable", days: null });
    assert.deepEqual(consentTerm({ consent_days: [] }), { state: "unreadable", days: null });
  });

  test("a day count too large to be a date is refused, not thrown", async () => {
    // Reaches captureConsent as an Invalid Date otherwise, which throws and puts
    // a permanently-broken event on the retry queue forever.
    const db = fakeDb({ contracts: [contractRow({
      merge_values: { consent_days: "999999999999" }
    })] });
    const res = await onContractSignedConsent(signedEvent(), db);
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "consent_term_unreadable");
    assert.deepEqual(db.consents, []);
  });

  test("a term that already ran out records nothing", async () => {
    // Only reachable on a very late retry. The permission is spent; writing it
    // would also break client_consents_expiry_ck.
    const longAgo = new Date(Date.now() - 400 * 86_400_000);
    const db = fakeDb({ contracts: [contractRow({ signed_at: longAgo })] });
    const res = await onContractSignedConsent(signedEvent(), db);
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "consent_term_already_expired");
    assert.deepEqual(db.consents, []);
  });
});

// ---------------------------------------------------------------------------
// 5. replay
// ---------------------------------------------------------------------------

describe("idempotency", () => {
  test("the same signature twice writes ONE consent row", async () => {
    const db = fakeDb();
    const first = await onContractSignedConsent(signedEvent(), db);
    const second = await onContractSignedConsent(signedEvent(), db);

    assert.equal(first.recorded, true);
    assert.equal(second.recorded, false);
    assert.equal(second.reason, "already_recorded");
    assert.equal(db.consents.length, 1);
  });

  test("ten replays are still one consent row", async () => {
    const db = fakeDb();
    for (let i = 0; i < 10; i++) await onContractSignedConsent(signedEvent(), db);
    assert.equal(db.consents.length, 1);
  });

  test("a consent already pointing at this paper stops it, whoever wrote it", async () => {
    // /api/consent/capture can be given the signed document id too. One paper,
    // one consent record, regardless of which writer got there first.
    const db = fakeDb({ consents: [existingConsent({ document_id: SIGNED_DOC })] });
    const res = await onContractSignedConsent(signedEvent(), db);
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "already_recorded");
    assert.equal(db.consents.length, 1);
  });

  test("the guard reads the same key the row is written with", async () => {
    const db = fakeDb();
    await onContractSignedConsent(signedEvent(), db);
    const guard = db.sql.find((q) => /count\(\*\) FILTER/i.test(q.sql));
    assert.equal(guard.params[0], ORG);
    assert.equal(guard.params[1], CLIENT);
    assert.equal(guard.params[2], CONSENT_KIND);
    assert.equal(guard.params[3], SIGNED_DOC, "the guard is not keyed on the signed paper");
  });

  test("consentGuard converts Postgres bigint counts to numbers", async () => {
    // count() comes back as a string. A truthiness check on "0" is true, which
    // would refuse everything; a `> 0` on a string would compare loosely.
    const db = { query: async () => ({ rows: [{ from_this_document: "0", withdrawn_since: "2" }] }) };
    const out = await consentGuard(db, {
      orgId: ORG, clientId: CLIENT, documentId: SIGNED_DOC, signedAt: SIGNED_AT
    });
    assert.deepEqual(out, { fromThisDocument: 0, withdrawnSince: 2 });
  });
});

// ---------------------------------------------------------------------------
// 6. a withdrawal keeps biting
// ---------------------------------------------------------------------------

describe("a withdrawal keeps biting", () => {
  test("a revoked consent from this paper is not re-granted by a replay", async () => {
    const db = fakeDb({ consents: [existingConsent({
      document_id: SIGNED_DOC,
      revoked_at: new Date(SIGNED_AT.getTime() + 3_600_000)
    })] });
    const res = await onContractSignedConsent(signedEvent(), db);

    assert.equal(res.recorded, false, "a replay silently re-granted a withdrawn permission");
    assert.equal(res.reason, "already_recorded");
    assert.equal(db.consents.length, 1);
    assert.ok(db.consents[0].revoked_at, "the withdrawal was overwritten");
  });

  test("a withdrawal of a consent captured ELSEWHERE also blocks the signature", async () => {
    /* The case the document-level check cannot see: consent taken on a phone
       call (document_id null), later withdrawn, and then a stale contract.signed
       replayed on top of it. */
    const db = fakeDb({ consents: [existingConsent({
      document_id: null,
      revoked_at: new Date(SIGNED_AT.getTime() + 86_400_000)
    })] });
    const res = await onContractSignedConsent(signedEvent(), db);

    assert.equal(res.recorded, false);
    assert.equal(res.reason, "withdrawn_after_signature");
    assert.equal(db.consents.length, 1, "a withdrawn permission was quietly restored");
  });

  test("a withdrawal at the very instant of signing still wins", async () => {
    // The boundary is >=, deliberately: a revocation stamped at the same moment
    // is not evidence that the signature came second.
    const db = fakeDb({ consents: [existingConsent({
      document_id: null, revoked_at: new Date(SIGNED_AT.getTime())
    })] });
    const res = await onContractSignedConsent(signedEvent(), db);
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "withdrawn_after_signature");
  });

  test("a withdrawal BEFORE the signature does not block it — that is a re-consent", async () => {
    /* Somebody who withdrew and then signed a fresh authorization has given
       permission again. Blocking that would make a withdrawal permanent, which
       is not what a withdrawal is. */
    const db = fakeDb({ consents: [existingConsent({
      document_id: null, revoked_at: new Date(SIGNED_AT.getTime() - 86_400_000)
    })] });
    const res = await onContractSignedConsent(signedEvent(), db);

    assert.equal(res.recorded, true);
    assert.equal(db.consents.length, 2);
  });

  test("a live consent from elsewhere does not stop the signature being recorded", async () => {
    // Two consents are two events. 099 has no unique index for exactly this
    // reason, and collapsing them would decide that one of them never happened.
    const db = fakeDb({ consents: [existingConsent()] });
    const res = await onContractSignedConsent(signedEvent(), db);
    assert.equal(res.recorded, true);
    assert.equal(db.consents.length, 2);
  });

  test("another client's withdrawal is not this client's problem", async () => {
    const db = fakeDb({ consents: [existingConsent({
      client_id: "77777777-7777-4777-8777-777777777777",
      revoked_at: new Date(SIGNED_AT.getTime() + 86_400_000)
    })] });
    const res = await onContractSignedConsent(signedEvent(), db);
    assert.equal(res.recorded, true);
  });
});

// ---------------------------------------------------------------------------
// 7. rows and events that are missing something
// ---------------------------------------------------------------------------

describe("events and rows that are missing something", () => {
  test("no contract id touches nothing", async () => {
    const db = fakeDb();
    const res = await onContractSignedConsent({ orgId: ORG, payload: {} }, db);
    assert.deepEqual(res, { recorded: false, reason: "no_contract" });
    assert.equal(db.sql.length, 0);
  });

  test("no org id touches nothing", async () => {
    const db = fakeDb();
    const res = await onContractSignedConsent({ payload: { contract_id: CONTRACT } }, db);
    assert.deepEqual(res, { recorded: false, reason: "no_contract" });
    assert.equal(db.sql.length, 0);
  });

  test("an empty event object does not throw", async () => {
    const db = fakeDb();
    const res = await onContractSignedConsent({}, db);
    assert.equal(res.recorded, false);
    assert.equal(db.sql.length, 0);
  });

  test("an event naming another company's contract finds nothing", async () => {
    const db = fakeDb();
    const res = await onContractSignedConsent(
      { orgId: OTHER_ORG, payload: { contract_id: CONTRACT } }, db
    );
    assert.deepEqual(res, { recorded: false, reason: "contract_not_found" });
    assert.deepEqual(db.consents, []);
  });

  test("the contract read is scoped by the event's org", async () => {
    const db = fakeDb();
    await onContractSignedConsent(signedEvent(), db);
    const read = db.sql.find((q) => /FROM contracts/i.test(q.sql));
    assert.match(read.sql, /org_id = \$2::uuid/);
    assert.deepEqual(read.params, [CONTRACT, ORG]);
  });

  test("loadSoftPullContract refuses a half-specified subject", async () => {
    const db = fakeDb();
    assert.equal(await loadSoftPullContract(db, { orgId: ORG }), null);
    assert.equal(await loadSoftPullContract(db, { contractId: CONTRACT }), null);
    assert.equal(await loadSoftPullContract(db, {}), null);
    assert.equal(db.sql.length, 0);
  });

  test("no signed document means no consent — there is no paper to point at", async () => {
    /* sign.mjs completes a contract even when the signed PDF fails to render.
       Two things break at once: the record would evidence nothing, and the
       replay guard would have no key. */
    const db = fakeDb({ contracts: [contractRow({ signed_document_id: null })] });
    const res = await onContractSignedConsent(signedEvent(), db);
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "no_signed_document");
    assert.deepEqual(db.consents, []);
  });

  test("no signer name means no consent — a signature consent must carry one", async () => {
    for (const name of [null, "", "   "]) {
      const db = fakeDb({ contracts: [contractRow({ signer_name: name })] });
      const res = await onContractSignedConsent(signedEvent(), db);
      assert.equal(res.recorded, false);
      assert.equal(res.reason, "no_signer_name");
    }
  });

  test("no signed_at means no consent — the withdrawal rule needs the moment", async () => {
    const db = fakeDb({ contracts: [contractRow({ signed_at: null })] });
    const res = await onContractSignedConsent(signedEvent(), db);
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "no_signed_at");
    assert.deepEqual(db.consents, []);
  });

  test("nobody accountable means no consent row", async () => {
    // An unattributed consent is not evidence of anything, and 099 refuses it at
    // the table besides. A clean stop beats a throw the queue can never resolve.
    const db = fakeDb({ contracts: [contractRow({ sent_by: null })] });
    const res = await onContractSignedConsent(signedEvent(), db);
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "no_attributable_staff");
    assert.deepEqual(db.consents, []);
  });

  test("a contract row with no client writes nothing", async () => {
    const db = fakeDb({ contracts: [contractRow({ client_id: null })] });
    const res = await onContractSignedConsent(signedEvent(), db);
    assert.equal(res.recorded, false);
    assert.equal(res.reason, "no_client");
    assert.deepEqual(db.consents, []);
  });
});
