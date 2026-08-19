import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildLetterPack, buildLetterPackForClient, personalFromClient, bureausFromEngine, PACK_REASON } from "./letter-pack.mjs";
import { mergeBureauReports } from "../finance/crs-map.mjs";
import { extractPdfText } from "../company-brain/pdf-text.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX = path.resolve(HERE, "../../vendor/underwriteiq-full/api/lite/crs/sandbox");

/** A stored pull in the shape crs_results.result really carries: result.bureaus. */
function mergedSandboxPull() {
  const load = (n) => JSON.parse(readFileSync(path.join(SANDBOX, n), "utf8"));
  return mergeBureauReports({
    reports: { TU: load("tu.json"), EX: load("exp.json"), EQ: load("efx.json") },
    requestIds: { TU: "tu-1", EX: "ex-1", EQ: "eq-1" },
    environment: "sandbox"
  });
}

// Unit tests stay letter-only — never call live Claude.
delete process.env.ANTHROPIC_API_KEY;

const PERSONAL = {
  name: "Jordan Sample",
  address: "5815 Knoll Krest St\nSan Antonio, TX 78242",
  employer: "Current Co",
  dob: "1963-11-12",
  ssn: "111223333"
};

const ENGINE = {
  normalized: {
    tradelines: [
      {
        source: "experian",
        creditorName: "SIGNET BANK/VIRGINIA",
        status: "closed",
        isDerogatory: true,
        accountIdentifier: "1200119007344443",
        currentBalance: 4798,
        reportedDate: "2021-09-03",
        closedDate: "2021-10-28",
        currentRatingType: "ChargeOff"
      }
    ],
    inquiries: [
      { source: "experian", creditorName: "GECS", date: "2024-04-01" },
      { source: "equifax", creditorName: "RESIDENTCHECK/IMT RESI", date: "2024-05-28" }
    ],
    identity: {
      names: [
        { first: "WILLIE", middle: "L", last: "BOOZE", source: "experian" },
        { first: "BARBARA", middle: "M", last: "DOTY", source: "transunion" }
      ],
      addresses: [
        { line1: "1234 MAIN ST", city: "SAN ANTONIO", state: "TX", zip: "78201", source: "experian" }
      ],
      employers: [{ name: "HAEMONETICS", source: "experian" }],
      ssns: [{ value: "666265040", source: "equifax" }],
      dobs: [{ value: "1963-11-12", source: "equifax" }]
    }
  }
};

// CHANGED 2026-08-19: this test used to assert reason === "empty_pack" here.
// That was the bug — "no engine result was supplied" and "the engine ran and
// found nothing to send" reported the same string, so nobody could tell a broken
// pipeline from a clean client. See the PACK_REASON block in letter-pack.mjs.
test("no engine result reports no_engine_result, not a bare empty_pack", async () => {
  const pack = await buildLetterPack({
    personal: { name: "Chris Sample", address: "1 Main St" },
    pack: "funding"
  });
  assert.equal(pack.files.filter((f) => /inquiry_|personal_info_|round/.test(f.filename)).length, 0);
  assert.equal(pack.reason, PACK_REASON.NO_ENGINE_RESULT);
  assert.notEqual(pack.reason, PACK_REASON.EMPTY_PACK);
});

test("engine result that yields nothing still reports the benign empty_pack", async () => {
  const pack = await buildLetterPack({
    crsResult: { outcome: "REPAIR_ONLY", normalized: { tradelines: [], inquiries: [], identity: {} } },
    personal: { name: "Chris Sample", address: "1 Main St" },
    pack: "funding"
  });
  assert.equal(pack.files.length, 0);
  assert.equal(pack.reason, PACK_REASON.EMPTY_PACK);
});

test("funding pack returns openable inquiry, personal-info, and bureau dispute PDFs", async () => {
  const pack = await buildLetterPack({
    crsResult: ENGINE,
    personal: PERSONAL,
    pack: "funding"
  });
  const letters = pack.files.filter((f) => /inquiry_|personal_info_|round/.test(f.filename));
  assert.ok(letters.length >= 3, `expected funding letters, got ${letters.map((f) => f.filename)}`);
  assert.ok(pack.files.some((f) => /round1/.test(f.filename)), "gold funding pack includes bureau dispute letters");
  assert.ok(!letters.some((f) => /inquiry_tu/.test(f.filename)), "TransUnion has no inquiries");
  for (const f of letters) {
    assert.match(f.filename, /\.pdf$/);
    assert.equal(f.contentType, "application/pdf");
    const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content);
    assert.equal(buf.subarray(0, 4).toString(), "%PDF");
    const text = (await extractPdfText(buf)).text || "";
    assert.ok(text.length > 400, `${f.filename} looks empty`);
    assert.doesNotMatch(text, /fundhub|FundHub/);
  }
});

test("repair pack returns openable Round 1 dispute PDFs", async () => {
  const pack = await buildLetterPack({
    crsResult: ENGINE,
    personal: PERSONAL,
    pack: "repair"
  });
  assert.ok(pack.files.some((f) => /round1/.test(f.filename)));
  assert.ok(!pack.files.some((f) => /round2|round3/.test(f.filename)));
  const dispute = pack.files.find((f) => /round1/.test(f.filename));
  const buf = Buffer.isBuffer(dispute.content) ? dispute.content : Buffer.from(dispute.content);
  assert.equal(buf.subarray(0, 4).toString(), "%PDF");
  const text = (await extractPdfText(buf)).text || "";
  assert.match(text, /Field 21/);
  assert.match(text, /SIGNET BANK/);
  assert.doesNotMatch(text, /fundhub|FundHub/);
});

test("personalFromClient joins name and address", () => {
  const p = personalFromClient({
    first_name: "Chris",
    last_name: "Full",
    custom_fields: { address: "1100 Lynhurst Ln" }
  });
  assert.equal(p.name, "Chris Full");
  assert.equal(p.address, "1100 Lynhurst Ln");
});

test("bureausFromEngine groups tradelines by source", () => {
  const by = bureausFromEngine({
    normalized: {
      tradelines: [{ source: "experian", creditorName: "CapOne", status: "chargeoff", isDerogatory: true }],
      inquiries: [{ source: "experian" }, { source: "experian" }]
    }
  });
  assert.equal(by.experian.tradelines.length, 1);
  assert.equal(by.experian.inquiries, 2);
  assert.equal(by.experian.inquiryList.length, 2);
});

test("without crsResult does not call Claude", async () => {
  let called = false;
  const pack = await buildLetterPack({
    personal: PERSONAL,
    pack: "funding",
    generateDeliverablesFn: async () => {
      called = true;
      return { documents: {} };
    }
  });
  assert.equal(called, false);
  assert.equal(pack.deliverableCount, 0);
  assert.equal(pack.deliverableSkip, "no_engine");
});

test("funding letters without the four analysis PDFs are not a complete pack", async () => {
  const pack = await buildLetterPack({
    crsResult: ENGINE,
    personal: PERSONAL,
    pack: "funding"
  });
  assert.ok(pack.files.some((f) => /inquiry_|personal_info_/.test(f.filename)));
  assert.equal(pack.reason, "missing_funding_analysis");
});

function fakePackDb({ client, crs } = {}) {
  return {
    async query(sql) {
      if (/FROM clients/.test(sql)) return { rows: client ? [client] : [] };
      if (/FROM crs_results/.test(sql)) return { rows: crs ? [{ result: crs }] : [] };
      return { rows: [] };
    }
  };
}

test("missing client row skips without throw", async () => {
  const out = await buildLetterPackForClient(fakePackDb({}), { clientId: "cl-missing", pack: "funding" });
  assert.equal(out.reason, "no_client");
  assert.equal(out.files.length, 0);
  assert.equal(out.engineSkip, "no_client");
});

test("missing CRS skips engine without throw", async () => {
  const out = await buildLetterPackForClient(
    fakePackDb({ client: { first_name: "A", last_name: "B", custom_fields: {}, outcome_tier: "FULL_FUNDING" } }),
    { clientId: "cl-1", pack: "funding" }
  );
  assert.equal(out.engineSkip, "no_crs_result");
  assert.equal(out.engineOutcome, null);
  // "no pull on file yet" is a normal early state, so it is named plainly and is
  // NOT dressed up as an engine error.
  assert.equal(out.reason, PACK_REASON.NO_CRS_RESULT);
});

const SANDBOX_CLIENT = {
  first_name: "Barbara",
  last_name: "Doty",
  custom_fields: { address: "1100 Lynhurst Ln", city: "Denton", state: "TX", zip: "76205" },
  outcome_tier: null
};

test("a stored pull WITH result.bureaus builds real letters through the tier engine", async () => {
  const out = await buildLetterPackForClient(
    fakePackDb({ client: SANDBOX_CLIENT, crs: mergedSandboxPull() }),
    { clientId: "cl-real", pack: "funding" }
  );
  assert.equal(out.engineSkip, null, `engine must run clean, got ${out.engineSkip}`);
  assert.ok(out.engineOutcome, "engine must return a tier");
  const letters = out.files.filter((f) => /inquiry_|personal_info_|round/.test(f.filename));
  assert.ok(letters.length >= 3, `expected letters, got ${out.files.map((f) => f.filename)}`);
  for (const f of letters) {
    const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content);
    assert.equal(buf.subarray(0, 4).toString(), "%PDF");
  }
});

// The exact failure the demo seed hit: crs_results.result had no `bureaus` key,
// so runTierEngineFromCrsResult threw and the pack came back empty. The point of
// this test is that the empty pack now SAYS WHY.
test("a stored pull WITHOUT result.bureaus names the engine fault, not empty_pack", async () => {
  const noBureaus = { outcome: "FULL_FUNDING", tradelines: [{ creditorName: "Chase", bureau: "EX" }] };
  const out = await buildLetterPackForClient(
    fakePackDb({ client: SANDBOX_CLIENT, crs: noBureaus }),
    { clientId: "cl-nobureaus", pack: "funding" }
  );
  assert.equal(out.files.length, 0);
  assert.notEqual(out.reason, PACK_REASON.EMPTY_PACK);
  assert.match(out.reason, /^engine_error: /);
  assert.match(out.reason, /no bureau reports to score/);
  assert.match(out.engineSkip, /no bureau reports to score/);
});

test("an engine that throws is reported as engine_error with its message", async () => {
  const out = await buildLetterPackForClient(
    fakePackDb({ client: SANDBOX_CLIENT, crs: { ok: true } }),
    { clientId: "cl-boom", pack: "funding" },
    { runEngine: () => { throw new Error("engine exploded"); } }
  );
  assert.equal(out.reason, "engine_error: engine exploded");
  assert.equal(out.engineSkip, "engine exploded");
});

test("REGRESSION: clients.outcome_tier is not stamped onto the engine", async () => {
  const out = await buildLetterPackForClient(
    fakePackDb({
      client: { first_name: "A", last_name: "B", custom_fields: {}, outcome_tier: "FULL_FUNDING" },
      crs: { ok: true }
    }),
    { clientId: "cl-1", pack: "funding" },
    { runEngine: () => ({ outcome: "REPAIR_ONLY", normalized: {} }) }
  );
  assert.equal(out.engineOutcome, "REPAIR_ONLY");
});
