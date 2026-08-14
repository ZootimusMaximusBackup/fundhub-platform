const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deliverLetters,
  deliverLettersAsync,
  generateLettersFromCRS
} = require("../letter-delivery");

// ============================================================================
// deliverLetters - path determination tests
// ============================================================================
test("deliverLetters returns repair path for non-fundable", async () => {
  // This will fail at GHL contact creation due to missing API key,
  // but we can still verify path determination
  const originalKey = process.env.GHL_PRIVATE_API_KEY;
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.GHL_PRIVATE_API_KEY;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const result = await deliverLetters({
    contactId: null,
    bureaus: {},
    underwrite: { fundable: false },
    personal: {}
  });

  // Restore
  if (originalKey) process.env.GHL_PRIVATE_API_KEY = originalKey;
  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  assert.equal(result.path, "repair");
});

test("deliverLetters returns fundable path for fundable", async () => {
  const originalKey = process.env.GHL_PRIVATE_API_KEY;
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.GHL_PRIVATE_API_KEY;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const result = await deliverLetters({
    contactId: null,
    bureaus: {},
    underwrite: { fundable: true },
    personal: {}
  });

  // Restore
  if (originalKey) process.env.GHL_PRIVATE_API_KEY = originalKey;
  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  assert.equal(result.path, "fundable");
});

test("deliverLetters defaults to repair path when underwrite is empty", async () => {
  const originalKey = process.env.GHL_PRIVATE_API_KEY;
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.GHL_PRIVATE_API_KEY;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const result = await deliverLetters({
    contactId: null,
    bureaus: {},
    underwrite: {},
    personal: {}
  });

  // Restore
  if (originalKey) process.env.GHL_PRIVATE_API_KEY = originalKey;
  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  assert.equal(result.path, "repair");
});

// ============================================================================
// deliverLetters - letter generation tests
// ============================================================================
test("deliverLetters generates correct number of letters for repair path", async () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const result = await deliverLetters({
    contactId: "test-contact-id",
    bureaus: {},
    underwrite: { fundable: false },
    personal: { name: "Test User" }
  });

  // Restore
  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  // Repair path with no accounts: suppression emits no letters
  assert.equal(result.letters.generated, 0);
});

test("deliverLetters generates correct number of letters for fundable path", async () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const result = await deliverLetters({
    contactId: "test-contact-id",
    bureaus: {},
    underwrite: { fundable: true },
    personal: { name: "Test User" }
  });

  // Restore
  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  // Fundable path with no inquiries or personal-info items: no letters
  assert.equal(result.letters.generated, 0);
});

// ============================================================================
// deliverLetters - upload failure handling
// ============================================================================
test("deliverLetters reports upload failures when token missing", async () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const result = await deliverLetters({
    contactId: "test-contact-id",
    bureaus: {},
    underwrite: { fundable: true },
    personal: {}
  });

  // Restore
  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  assert.equal(result.letters.uploaded, 0);
  assert.equal(result.letters.failed, 0);
});

// ============================================================================
// deliverLetters - GHL skip handling
// ============================================================================
test("deliverLetters skips GHL update when no contactId and no contactData", async () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const result = await deliverLetters({
    contactId: null,
    contactData: null,
    bureaus: {},
    underwrite: {},
    personal: {}
  });

  // Restore
  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  assert.equal(result.ghlSkipped, true);
  assert.equal(result.ghlUpdated, false);
});

// ============================================================================
// deliverLetters - result structure tests
// ============================================================================
test("deliverLetters includes duration in result", async () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const result = await deliverLetters({
    contactId: null,
    bureaus: {},
    underwrite: {},
    personal: {}
  });

  // Restore
  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  assert.ok(typeof result.duration === "number");
  assert.ok(result.duration >= 0);
});

test("deliverLetters includes urls object in result", async () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const result = await deliverLetters({
    contactId: "test-id",
    bureaus: {},
    underwrite: {},
    personal: {}
  });

  // Restore
  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  assert.ok(result.urls !== undefined);
  assert.ok(typeof result.urls === "object");
});

// ============================================================================
// deliverLettersAsync tests
// ============================================================================
test("deliverLettersAsync returns immediately with async flag", () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const result = deliverLettersAsync({
    contactId: "test-contact-id",
    bureaus: {},
    underwrite: {},
    personal: {}
  });

  // Restore
  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  assert.equal(result.ok, true);
  assert.equal(result.async, true);
  assert.ok(result.message.includes("background"));
});

test("deliverLettersAsync does not block execution", async () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const start = Date.now();
  const result = deliverLettersAsync({
    contactId: "test-contact-id",
    bureaus: {},
    underwrite: {},
    personal: {}
  });
  const elapsed = Date.now() - start;

  // Restore
  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  // Should return in less than 50ms (not waiting for letter generation)
  assert.ok(elapsed < 50);
  assert.equal(result.ok, true);
});

// ============================================================================
// deliverLetters - error handling tests
// ============================================================================
test("deliverLetters handles null bureaus gracefully", async () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const result = await deliverLetters({
    contactId: "test-id",
    bureaus: null,
    underwrite: {},
    personal: {}
  });

  // Restore
  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  // Empty bureaus → W1 suppression → no letters
  assert.equal(result.ok, true);
  assert.equal(result.letters.generated, 0);
});

test("deliverLetters handles null personal gracefully", async () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const result = await deliverLetters({
    contactId: "test-id",
    bureaus: {},
    underwrite: {},
    personal: null
  });

  // Restore
  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  // Empty personal + empty bureaus → no letters
  assert.equal(result.ok, true);
  assert.equal(result.letters.generated, 0);
});

test("deliverLetters handles null underwrite gracefully", async () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const result = await deliverLetters({
    contactId: "test-id",
    bureaus: {},
    underwrite: null,
    personal: {}
  });

  // Restore
  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  // Should default to repair path
  assert.equal(result.ok, true);
  assert.equal(result.path, "repair");
});

// ============================================================================
// CRS Letter Delivery Tests
// ============================================================================

const SIGNET = {
  creditorName: "SIGNET BANK/VIRGINIA",
  accountIdentifier: "4443",
  status: "closed",
  isDerogatory: true,
  currentBalance: 4798,
  reportedDate: "2021-09-03",
  closedDate: "2021-10-28",
  currentRatingType: "ChargeOff",
  comments: []
};

test("deliverLetters uses CRS path when crsDocuments provided", async () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const crsDocuments = {
    package: "funding",
    letters: [
      {
        type: "inquiry_removal",
        bureau: "experian",
        round: null,
        fieldKey: "funding_letter_url__inquiry_cleanup__ex"
      },
      {
        type: "personal_info",
        bureau: "experian",
        round: null,
        fieldKey: "funding_letter_url__personal_info_cleanup__ex"
      },
      {
        type: "personal_info",
        bureau: "transunion",
        round: null,
        fieldKey: "funding_letter_url__personal_info_cleanup__tu"
      }
    ]
  };

  // Specs alone (no tradelines/inquiries) → 0 letters, never header-only
  const emptyResult = await deliverLetters({
    contactId: "test-crs",
    crsDocuments,
    personal: { name: "Test User", address: "123 Main St" }
  });

  assert.equal(emptyResult.ok, true);
  assert.equal(emptyResult.path, "fundable");
  assert.equal(emptyResult.letters.generated, 0);

  const result = await deliverLetters({
    contactId: "test-crs",
    crsDocuments,
    personal: { name: "Jordan Sample", address: "123 Main St" },
    bureaus: {
      experian: {
        inquiryList: [{ creditorName: "GECS", date: "2024-04-01" }],
        names: ["Jordan Sample"]
      },
      transunion: {
        names: ["BARBARA M DOTY"]
      }
    }
  });

  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  assert.equal(result.ok, true);
  assert.equal(result.path, "fundable");
  // inquiry ex + personal tu (ex name matches → no personal_info_ex)
  assert.equal(result.letters.generated, 2);
});

test("deliverLetters uses CRS repair path correctly", async () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const crsDocuments = {
    package: "repair",
    letters: [
      { type: "dispute", bureau: "experian", round: 1, fieldKey: "repair_letter_url__round_1__ex" },
      {
        type: "dispute",
        bureau: "transunion",
        round: 1,
        fieldKey: "repair_letter_url__round_1__tu"
      },
      { type: "dispute", bureau: "equifax", round: 1, fieldKey: "repair_letter_url__round_1__eq" },
      { type: "dispute", bureau: "experian", round: 2, fieldKey: "repair_letter_url__round_2__ex" },
      {
        type: "dispute",
        bureau: "transunion",
        round: 2,
        fieldKey: "repair_letter_url__round_2__tu"
      },
      { type: "dispute", bureau: "equifax", round: 2, fieldKey: "repair_letter_url__round_2__eq" },
      { type: "dispute", bureau: "experian", round: 3, fieldKey: "repair_letter_url__round_3__ex" },
      {
        type: "dispute",
        bureau: "transunion",
        round: 3,
        fieldKey: "repair_letter_url__round_3__tu"
      },
      { type: "dispute", bureau: "equifax", round: 3, fieldKey: "repair_letter_url__round_3__eq" },
      {
        type: "personal_info",
        bureau: "experian",
        round: null,
        fieldKey: "repair_letter_url__personal_info_dispute__ex"
      },
      {
        type: "personal_info",
        bureau: "transunion",
        round: null,
        fieldKey: "repair_letter_url__personal_info_dispute__tu"
      },
      {
        type: "personal_info",
        bureau: "equifax",
        round: null,
        fieldKey: "repair_letter_url__personal_info_dispute__eq"
      }
    ]
  };

  // Specs with no accounts → 0 (do not invent Round 1–3 header PDFs)
  const emptyResult = await deliverLetters({
    contactId: "test-crs-repair",
    crsDocuments,
    personal: { name: "Test User" }
  });
  assert.equal(emptyResult.ok, true);
  assert.equal(emptyResult.path, "repair");
  assert.equal(emptyResult.letters.generated, 0);

  const result = await deliverLetters({
    contactId: "test-crs-repair",
    crsDocuments,
    personal: { name: "Jordan Sample" },
    bureaus: {
      experian: { tradelines: [SIGNET], names: ["Jordan Sample"] },
      transunion: {
        tradelines: [{ ...SIGNET, priorOutcome: "verified" }],
        names: ["BARBARA M DOTY"]
      },
      equifax: { tradelines: [SIGNET], names: ["Jordan Sample"] }
    }
  });

  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  assert.equal(result.ok, true);
  assert.equal(result.path, "repair");
  // Round 1 ex + eq; Round 2 tu (verified); personal tu only
  assert.equal(result.letters.generated, 4);
});

test("generateLettersFromCRS empty item list emits 0 letters", async () => {
  const specs = [
    { type: "dispute", bureau: "experian", round: 1, fieldKey: "r1" },
    { type: "inquiry_removal", bureau: "experian", round: null, fieldKey: "inq" },
    { type: "personal_info", bureau: "experian", round: null, fieldKey: "pi" }
  ];

  const { letters, fieldKeyMap } = await generateLettersFromCRS(specs, { name: "Test" }, {});

  assert.equal(letters.length, 0);
  assert.deepEqual(fieldKeyMap, {});
});

test("generateLettersFromCRS produces correct filenames and fieldKeyMap", async () => {
  const specs = [
    {
      type: "inquiry_removal",
      bureau: "experian",
      round: null,
      fieldKey: "funding_letter_url__inquiry_cleanup__ex"
    },
    {
      type: "personal_info",
      bureau: "transunion",
      round: null,
      fieldKey: "funding_letter_url__personal_info_cleanup__tu"
    },
    { type: "dispute", bureau: "equifax", round: 2, fieldKey: "repair_letter_url__round_2__eq" }
  ];

  const { letters, fieldKeyMap } = await generateLettersFromCRS(
    specs,
    { name: "Jordan Sample" },
    {
      experian: { inquiryList: [{ creditorName: "GECS", date: "2024-04-01" }] },
      transunion: { names: ["BARBARA M DOTY"] },
      equifax: {
        tradelines: [{ ...SIGNET, priorOutcome: "verified" }]
      }
    }
  );

  assert.equal(letters.length, 3);
  // Order: disputes first, then inquiry, then personal
  assert.equal(letters[0].filename, "eq_round2.pdf");
  assert.equal(letters[1].filename, "inquiry_ex.pdf");
  assert.equal(letters[2].filename, "personal_info_tu.pdf");

  assert.equal(fieldKeyMap["eq_round2"], "repair_letter_url__round_2__eq");
  assert.equal(fieldKeyMap["inquiry_ex"], "funding_letter_url__inquiry_cleanup__ex");
  assert.equal(fieldKeyMap["personal_info_tu"], "funding_letter_url__personal_info_cleanup__tu");
});

test("generateLettersFromCRS produces valid PDF buffers", async () => {
  const specs = [{ type: "inquiry_removal", bureau: "experian", round: null, fieldKey: "test" }];

  const { letters } = await generateLettersFromCRS(
    specs,
    {
      name: "Jane Doe",
      address: "456 Oak Ave"
    },
    {
      experian: { inquiryList: [{ creditorName: "GECS", date: "2024-04-01" }] }
    }
  );

  assert.equal(letters.length, 1);
  assert.ok(Buffer.isBuffer(letters[0].buffer));
  assert.ok(letters[0].buffer.length > 100); // PDF should be > 100 bytes
  // Check PDF magic bytes
  assert.equal(letters[0].buffer.slice(0, 5).toString(), "%PDF-");
});

test("generateLettersFromCRS skips unknown bureaus", async () => {
  const specs = [
    { type: "dispute", bureau: "unknown_bureau", round: 1, fieldKey: "test" },
    { type: "inquiry_removal", bureau: "experian", round: null, fieldKey: "test2" }
  ];

  const { letters } = await generateLettersFromCRS(
    specs,
    {},
    {
      experian: { inquiryList: [{ creditorName: "GECS", date: "2024-04-01" }] }
    }
  );

  assert.equal(letters.length, 1); // only experian letter generated
  assert.equal(letters[0].filename, "inquiry_ex.pdf");
});

test("deliverLetters ignores crsDocuments when letters array is empty", async () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const result = await deliverLetters({
    contactId: "test-empty-crs",
    crsDocuments: { package: "hold", letters: [] },
    bureaus: {},
    underwrite: { fundable: true },
    personal: {}
  });

  if (originalToken) process.env.BLOB_READ_WRITE_TOKEN = originalToken;

  // Should fall back to legacy path since crsDocuments.letters is empty
  assert.equal(result.ok, true);
  assert.equal(result.path, "fundable");
  assert.equal(result.letters.generated, 0);
});

// ============================================================================
// updateLetterUrlsFromCRS — regression for the double-translation bug (06-29)
// The urls passed in are keyed by filename; fieldKeyMap translates them to FINAL
// GHL field keys. The function must write those final keys straight through
// (via updateContactCustomFields), NOT re-route through updateLetterUrls which
// re-maps from shorthand keys and would drop every CRS letter URL + null path.
// ============================================================================
test("updateLetterUrlsFromCRS writes translated GHL field keys (not shorthand)", () => {
  const ghlPath = require.resolve("../ghl-contact-service");
  const ldPath = require.resolve("../letter-delivery");

  let captured = null;
  const origGhl = require.cache[ghlPath];
  const origLd = require.cache[ldPath];
  delete require.cache[ghlPath];
  delete require.cache[ldPath];
  require.cache[ghlPath] = {
    id: ghlPath,
    filename: ghlPath,
    loaded: true,
    exports: {
      // updateLetterUrlsFromCRS must call THIS one with the final field keys.
      updateContactCustomFields: (contactId, fields) => {
        captured = { fn: "updateContactCustomFields", contactId, fields };
        return Promise.resolve({ ok: true });
      },
      // If the bug regresses, the call would route here and re-map from shorthand.
      updateLetterUrls: (contactId, fields) => {
        captured = { fn: "updateLetterUrls", contactId, fields };
        return Promise.resolve({ ok: true });
      },
      createOrUpdateContact: () => Promise.resolve({ ok: true })
    }
  };

  const { updateLetterUrlsFromCRS } = require("../letter-delivery");

  const urls = {
    inquiry_ex: "https://blob/inquiry_ex.pdf",
    inquiry_tu: "https://blob/inquiry_tu.pdf"
  };
  const fieldKeyMap = {
    inquiry_ex: "funding_letter_url__inquiry_cleanup__ex",
    inquiry_tu: "funding_letter_url__inquiry_cleanup__tu"
  };

  return updateLetterUrlsFromCRS("contact123", urls, fieldKeyMap, "funding").then(() => {
    // Restore module cache before assertions can throw.
    delete require.cache[ghlPath];
    delete require.cache[ldPath];
    if (origGhl) require.cache[ghlPath] = origGhl;
    if (origLd) require.cache[ldPath] = origLd;

    assert.ok(captured, "a GHL write should have happened");
    assert.equal(
      captured.fn,
      "updateContactCustomFields",
      "must NOT route through updateLetterUrls"
    );
    // Final GHL field keys present (TU included via the bug #51 fix upstream).
    assert.equal(
      captured.fields["funding_letter_url__inquiry_cleanup__ex"],
      "https://blob/inquiry_ex.pdf"
    );
    assert.equal(
      captured.fields["funding_letter_url__inquiry_cleanup__tu"],
      "https://blob/inquiry_tu.pdf"
    );
    // analyzer_path must be the real path, not null.
    assert.equal(captured.fields.analyzer_path, "funding");
    assert.equal(captured.fields.letters_ready, "true");
    assert.equal(captured.fields.analyzer_status, "complete");
  });
});
