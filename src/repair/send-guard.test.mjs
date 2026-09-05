// COMPLIANCE REVIEW REQUIRED — dispute logic. The double-mailing guard, at the
// unit level.
//
// The real proof is src/repair/send-double-mail.pg.test.mjs, which posts the
// same payload twice against a real Postgres and counts the mailings. These
// pin the DECISION the send loop makes on each answer the database can give,
// which is the part a fake db can honestly show:
//
//   refuse on positive evidence, and never refuse on absence of evidence.
//
// That second half matters. A letter id that names no row must still be mailed,
// because it always was — the guard is not allowed to start silently dropping
// sends it has no evidence against.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sendRepairLetters, isPreTransmissionRefusal } from "./send.mjs";

const IDS = {
  orgId: "22222222-2222-4222-8222-222222222222",
  clientId: "33333333-3333-4333-8333-333333333333",
  staffId: "44444444-4444-4444-8444-444444444444",
  letterId: "55555555-5555-4555-8555-555555555555"
};

const FROM = {
  first_name: "Pat",
  last_name: "Client",
  address_line1: "12 Oak St",
  address_city: "Dallas",
  address_state: "TX",
  address_zip: "75201"
};

const isClaim = (sql) => /UPDATE dispute_letters d SET status = 'sending'/.test(
  String(sql).replace(/\s+/g, " ")
);

/** A db whose dispute_letters row answers however the test wants. */
function letterDb({ claimRows = [], row = null } = {}) {
  return {
    async query(sql) {
      const s = String(sql).replace(/\s+/g, " ");
      if (isClaim(s)) return { rows: claimRows };
      if (/SELECT status, mailed_at FROM dispute_letters/.test(s)) return { rows: row ? [row] : [] };
      return { rows: [] };
    }
  };
}

function send(db, mailSender) {
  return sendRepairLetters(db, {
    orgId: IDS.orgId,
    clientId: IDS.clientId,
    staffId: IDS.staffId,
    mail: true,
    from: FROM,
    letters: [{ bureau: "EX", html: "<html>x</html>", letterId: IDS.letterId }],
    mailSender
  });
}

test("a letter the database says is already mailed is not handed to the provider", async () => {
  let calls = 0;
  const db = letterDb({ claimRows: [], row: { status: "sent", mailed_at: new Date() } });
  const result = await send(db, async () => { calls += 1; return { ok: true, providerId: "x" }; });
  assert.equal(calls, 0, "the mailer must not be called");
  assert.equal(result.ok, false);
  assert.equal(result.results[0].error, "already_mailed");
});

test("the claim is taken BEFORE the provider is called, not after", async () => {
  const order = [];
  const db = {
    async query(sql) {
      if (isClaim(sql)) {
        order.push("claim");
        return { rows: [{ prior_status: "ready" }] };
      }
      return { rows: [] };
    }
  };
  await send(db, async () => { order.push("mail"); return { ok: true, providerId: "ltr_1" }; });
  assert.deepEqual(order.slice(0, 2), ["claim", "mail"],
    "claiming after the call would not close the window between two callers");
});

test("a unique violation on the mailing index refuses the send", async () => {
  let calls = 0;
  const db = {
    async query(sql) {
      if (isClaim(sql)) {
        const err = new Error("duplicate key value violates unique constraint");
        err.code = "23505";
        throw err;
      }
      return { rows: [] };
    }
  };
  const result = await send(db, async () => { calls += 1; return { ok: true, providerId: "x" }; });
  assert.equal(calls, 0);
  assert.equal(result.results[0].error, "already_mailed_duplicate_letter");
});

test("a database failure on the claim refuses the letter rather than mailing it", async () => {
  let calls = 0;
  const db = {
    async query(sql) {
      if (isClaim(sql)) throw new Error("connection terminated unexpectedly");
      return { rows: [] };
    }
  };
  const result = await send(db, async () => { calls += 1; return { ok: true, providerId: "x" }; });
  assert.equal(calls, 0, "if we cannot tell whether it is safe to send, we do not send");
  assert.equal(result.results[0].error, "claim_failed");
});

test("a letter id that names no row is mailed, exactly as it was before the guard", async () => {
  let calls = 0;
  const db = letterDb({ claimRows: [], row: null });
  const result = await send(db, async () => { calls += 1; return { ok: true, providerId: "ltr_1" }; });
  assert.equal(calls, 1, "absence of evidence is not evidence of a double send");
  assert.equal(result.ok, true);
});

test("only a provably pre-transmission refusal is treated as one", () => {
  assert.equal(isPreTransmissionRefusal("POSTGRID_API_KEY unset — letter not sent"), true);
  assert.equal(isPreTransmissionRefusal("destination_address_missing"), true);
  assert.equal(isPreTransmissionRefusal("return_address_required — consumer address only"), true);
  assert.equal(isPreTransmissionRefusal("bureau_mail_address_incomplete"), true);
  assert.equal(isPreTransmissionRefusal("private_carrier_forbidden_for_po_box"), true);
  assert.equal(isPreTransmissionRefusal("postgrid_http_502"), false,
    "an HTTP error may have mailed the letter, so the claim must be kept");
  assert.equal(isPreTransmissionRefusal("mail_failed"), false);
  assert.equal(isPreTransmissionRefusal(undefined), false);
});
