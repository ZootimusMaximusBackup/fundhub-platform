"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const handlerPath = require.resolve("../deliver-letters");
const ghlPath = require.resolve("../ghl-contact-service");
const ldPath = require.resolve("../letter-delivery");

let ghlResult;
let deliverResult;
let deliverCalledWith;
let ghlCalled;

function loadHandler() {
  delete require.cache[handlerPath];
  delete require.cache[ghlPath];
  delete require.cache[ldPath];
  ghlCalled = false;
  require.cache[ghlPath] = {
    id: ghlPath,
    filename: ghlPath,
    loaded: true,
    exports: {
      getGHLContact: async () => {
        ghlCalled = true;
        return ghlResult;
      }
    }
  };
  require.cache[ldPath] = {
    id: ldPath,
    filename: ldPath,
    loaded: true,
    exports: {
      deliverLetters: async params => {
        deliverCalledWith = params;
        return deliverResult;
      }
    }
  };
  return require("../deliver-letters");
}

function makeReq(body, method = "POST", headers = {}) {
  return { method, headers, body };
}
function makeRes() {
  return {
    statusCode: 0,
    body: null,
    _headers: {},
    setHeader(k, v) {
      this._headers[k] = v;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    end() {
      return this;
    }
  };
}

describe("deliver-letters handler", () => {
  beforeEach(() => {
    ghlResult = {
      ok: true,
      contact: {
        firstName: "Chris",
        lastName: "S",
        city: "Gilbert",
        state: "AZ",
        postalCode: "85233",
        address1: "1005 W Hudson Way"
      }
    };
    deliverResult = { ok: true, letters: { generated: 6, uploaded: 6 }, ghlUpdated: true };
    deliverCalledWith = null;
    ghlCalled = false;
    delete process.env.DELIVER_LETTERS_SECRET;
    delete process.env.CONTEXT_FETCHER_SECRET;
  });
  afterEach(() => {
    delete require.cache[handlerPath];
    delete require.cache[ghlPath];
    delete require.cache[ldPath];
  });

  it("405 on non-POST", async () => {
    const res = makeRes();
    await loadHandler()(makeReq({}, "GET"), res);
    assert.equal(res.statusCode, 405);
  });

  it("empty body → 0 files (no invent, no outbound)", async () => {
    const res = makeRes();
    await loadHandler()(makeReq({}), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.delivered, 0);
    assert.equal(res.body.letters.generated, 0);
    assert.equal(deliverCalledWith, null);
    assert.equal(ghlCalled, false);
  });

  it("FAILS CLOSED (401) in production with no secret", async () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const res = makeRes();
    try {
      await loadHandler()(makeReq({ contactId: "c1" }), res);
      assert.equal(res.statusCode, 401);
    } finally {
      if (orig === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = orig;
    }
  });

  it("specs-only (contactId, no bureau data) → 0 letters, never calls deliverLetters", async () => {
    const res = makeRes();
    await loadHandler()(makeReq({ contactId: "GrpVLpkbfK0SxVuSYWMT", type: "repair" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.delivered, 0);
    assert.equal(res.body.letters.generated, 0);
    assert.equal(res.body.note, "specs_only_no_bureau_data");
    assert.equal(deliverCalledWith, null);
    assert.equal(ghlCalled, false);
  });

  it("bureau name filter alone is not credit data → 0 letters", async () => {
    const res = makeRes();
    await loadHandler()(
      makeReq({ contactId: "c1", type: "funding", bureaus: ["experian", "equifax"] }),
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.delivered, 0);
    assert.equal(deliverCalledWith, null);
    assert.equal(ghlCalled, false);
  });

  it("with bureauData passes real bureaus into deliverLetters (no invent)", async () => {
    const bureauData = {
      experian: {
        tradelines: [{ creditor: "Cap One", balance: 100, limit: 500 }],
        inquiries: [],
        personalInfo: {}
      }
    };
    const res = makeRes();
    await loadHandler()(
      makeReq({ contactId: "Abc123_id", type: "repair", bureauData }),
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(deliverCalledWith);
    assert.equal(deliverCalledWith.contactId, "Abc123_id");
    assert.equal(deliverCalledWith.personal.name, "Chris S");
    assert.equal(typeof deliverCalledWith.personal.address, "string");
    assert.match(deliverCalledWith.personal.address, /Gilbert, AZ 85233/);
    assert.equal(deliverCalledWith.crsDocuments.package, "repair");
    assert.ok(deliverCalledWith.crsDocuments.letters.length > 0);
    assert.ok(deliverCalledWith.crsDocuments.letters.some(l => l.fieldKey.endsWith("__tu")));
    assert.deepEqual(deliverCalledWith.bureaus, bureauData);
    assert.equal(ghlCalled, true);
  });

  it("502 when GHL lookup fails (only when bureau data present)", async () => {
    ghlResult = { ok: false, error: "nope" };
    const res = makeRes();
    await loadHandler()(
      makeReq({
        contactId: "c1",
        bureauData: { experian: { tradelines: [{ id: "1" }] } }
      }),
      res
    );
    assert.equal(res.statusCode, 502);
    assert.equal(deliverCalledWith, null);
  });
});
