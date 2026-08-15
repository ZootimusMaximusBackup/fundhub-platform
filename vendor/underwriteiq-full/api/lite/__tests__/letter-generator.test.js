const test = require("node:test");
const assert = require("node:assert/strict");
const {
  generateLetters,
  generateDisputeLetters,
  generateInquiryLetters,
  generatePersonalInfoLetters,
  BUREAUS
} = require("../letter-generator");

test("BUREAUS contains all three bureaus", () => {
  assert.ok(BUREAUS.experian);
  assert.ok(BUREAUS.transunion);
  assert.ok(BUREAUS.equifax);
});

test("BUREAUS has correct prefixes", () => {
  assert.equal(BUREAUS.experian.prefix, "ex");
  assert.equal(BUREAUS.transunion.prefix, "tu");
  assert.equal(BUREAUS.equifax.prefix, "eq");
});

test("BUREAUS has correct names", () => {
  assert.equal(BUREAUS.experian.name, "Experian");
  assert.equal(BUREAUS.transunion.name, "TransUnion");
  assert.equal(BUREAUS.equifax.name, "Equifax");
});

test("BUREAUS has addresses", () => {
  assert.ok(BUREAUS.experian.address.includes("Allen, TX"));
  assert.ok(BUREAUS.transunion.address.includes("Chester, PA"));
  assert.ok(BUREAUS.equifax.address.includes("Atlanta, GA"));
});

test("generateLetters suppresses empty item lists", async () => {
  const repair = await generateLetters({
    path: "repair",
    bureaus: {},
    personal: { name: "John Doe" },
    underwrite: { fundable: false }
  });
  assert.equal(repair.length, 0);

  const fundable = await generateLetters({
    path: "fundable",
    bureaus: {
      experian: { inquiries: 0 },
      transunion: { inquiries: 0 },
      equifax: { inquiries: 0 }
    },
    personal: { name: "Jane Doe" },
    underwrite: { fundable: true }
  });
  assert.equal(fundable.length, 0);
});

test("generateLetters returns buffers for each letter it does emit", async () => {
  const result = await generateLetters({
    path: "fundable",
    bureaus: {
      experian: { inquiryList: [{ creditorName: "GECS", date: "2024-04-01" }] }
    },
    personal: { name: "Jane Doe", address: "1 Main St" },
    underwrite: {}
  });

  assert.ok(result.length >= 1);
  result.forEach(letter => {
    assert.ok(letter.filename);
    assert.ok(Buffer.isBuffer(letter.buffer));
    assert.equal(letter.buffer.slice(0, 4).toString(), "%PDF");
  });
});

test("generateDisputeLetters emits Round 1 only when accounts exist", async () => {
  const empty = await generateDisputeLetters({
    bureaus: {},
    personal: { name: "Test User" },
    underwrite: {}
  });
  assert.equal(empty.length, 0);

  const result = await generateDisputeLetters({
    bureaus: {
      experian: {
        tradelines: [
          {
            creditorName: "SIGNET BANK/VIRGINIA",
            status: "closed",
            isDerogatory: true,
            currentBalance: 4798,
            reportedDate: "2021-09-03",
            closedDate: "2021-10-28",
            accountIdentifier: "4443"
          }
        ]
      }
    },
    personal: { name: "Test" },
    underwrite: {}
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].filename, "ex_round1.pdf");
  assert.ok(Buffer.isBuffer(result[0].buffer));
});

test("generateInquiryLetters skips a bureau with zero inquiries", async () => {
  const result = await generateInquiryLetters({
    bureaus: {
      experian: { inquiryList: [{ creditorName: "GECS", date: "2024-04-01" }] },
      transunion: { inquiryList: [] },
      equifax: { inquiryList: [{ creditorName: "CAPONE", date: "2024-05-01" }] }
    },
    personal: { name: "Test User" }
  });

  const filenames = result.map(r => r.filename).sort();
  assert.deepEqual(filenames, ["inquiry_eq.pdf", "inquiry_ex.pdf"]);
});

test("generatePersonalInfoLetters skips a bureau with no variations", async () => {
  const result = await generatePersonalInfoLetters({
    bureaus: {
      experian: { names: ["Jordan Sample"] },
      transunion: { names: ["BARBARA M DOTY"] },
      equifax: {}
    },
    personal: { name: "Jordan Sample" }
  });

  assert.ok(result.some(r => r.filename === "personal_info_tu.pdf"));
  assert.ok(!result.some(r => r.filename === "personal_info_ex.pdf"));
});

test("generated PDFs have valid PDF header", async () => {
  const result = await generateLetters({
    path: "fundable",
    bureaus: {
      experian: { inquiryList: [{ creditorName: "GECS", date: "2024-04-01" }] }
    },
    personal: { name: "Test", address: "1 Main" },
    underwrite: {}
  });

  result.forEach(letter => {
    const header = letter.buffer.slice(0, 4).toString();
    assert.equal(header, "%PDF");
  });
});

function emptyBureau() {
  return {
    tradelines: [],
    inquiryList: [],
    inquiries: 0,
    names: [],
    addresses: [],
    employers: [],
    ssns: [],
    dobs: []
  };
}

test("smash: three empty bureaus emit zero PDFs", async () => {
  const bureaus = {
    experian: emptyBureau(),
    equifax: emptyBureau(),
    transunion: emptyBureau()
  };
  const repair = await generateLetters({
    path: "repair",
    bureaus,
    personal: { name: "Jordan Sample" }
  });
  assert.equal(repair.length, 0);
  const fundable = await generateLetters({
    path: "fundable",
    bureaus,
    personal: { name: "Jordan Sample" }
  });
  assert.equal(fundable.length, 0);
});

test("smash: TransUnion empty inquiries must not emit inquiry_tu", async () => {
  const letters = await generateInquiryLetters({
    bureaus: {
      transunion: { inquiryList: [] },
      experian: { inquiryList: [{ creditorName: "GECS", date: "2024-04-01" }] },
      equifax: { inquiryList: [] }
    },
    personal: { name: "Jordan Sample" }
  });
  assert.ok(!letters.some(l => l.filename === "inquiry_tu.pdf"));
  const ex = letters.find(l => l.filename === "inquiry_ex.pdf");
  assert.ok(ex);
  assert.equal(ex.buffer.slice(0, 4).toString(), "%PDF");
  assert.ok(ex.buffer.length > 200);
});

test("smash: matching personal info emits zero personal_info PDFs", async () => {
  const personal = {
    name: "Jordan Sample",
    address: "5815 Knoll Krest St, San Antonio, TX 78242",
    ssn: "111223333",
    dob: "1963-11-12",
    employer: "Current Co"
  };
  const id = {
    tradelines: [],
    inquiryList: [],
    names: [personal.name],
    addresses: [personal.address],
    employers: [personal.employer],
    ssns: [personal.ssn],
    dobs: [personal.dob]
  };
  const letters = await generatePersonalInfoLetters({
    bureaus: { experian: { ...id }, equifax: { ...id }, transunion: { ...id } },
    personal
  });
  assert.equal(letters.length, 0);
});

test("smash: missing personal null or empty object must not throw", async () => {
  const bureaus = {
    experian: {
      tradelines: [
        {
          creditorName: "SIGNET BANK/VIRGINIA",
          status: "closed",
          isDerogatory: true,
          currentBalance: 4798,
          reportedDate: "2021-09-03",
          closedDate: "2021-10-28",
          accountIdentifier: "4443"
        }
      ],
      inquiryList: [{ creditorName: "GECS", date: "2024-04-01" }],
      names: ["WILLIE L BOOZE"],
      addresses: ["1234 MAIN ST"]
    }
  };
  for (const personal of [null, {}, undefined]) {
    const letters = await generateLetters({ path: "repair", bureaus, personal });
    assert.ok(Array.isArray(letters));
    letters.forEach(letter => {
      assert.equal(letter.buffer.slice(0, 4).toString(), "%PDF");
    });
  }
  for (const fn of [generateLetters, generateDisputeLetters, generateInquiryLetters, generatePersonalInfoLetters]) {
    const none = await fn(null);
    assert.ok(Array.isArray(none));
  }
});

test("smash: malformed bureau lists must not throw", async () => {
  const fromStringTrades = await generateDisputeLetters({
    bureaus: { experian: { tradelines: "nope" } },
    personal: { name: "Jordan Sample" }
  });
  assert.equal(fromStringTrades.length, 0);

  const inquiry = await generateInquiryLetters({
    bureaus: {
      experian: {
        tradelines: "nope",
        inquiryList: [{ creditorName: "GECS", date: "2024-04-01" }]
      }
    },
    personal: { name: "Jordan Sample" }
  });
  assert.equal(inquiry.length, 1);
  assert.equal(inquiry[0].buffer.slice(0, 4).toString(), "%PDF");

  const info = await generatePersonalInfoLetters({
    bureaus: { experian: { names: "WILLIE L BOOZE", addresses: "1234 MAIN ST" } },
    personal: { name: "Jordan Sample" }
  });
  assert.ok(Array.isArray(info));
});

test("smash: unicode and apostrophe names still render a PDF", async () => {
  for (const name of ["O'Brien", "José García", "李", "O’Brien"]) {
    const letters = await generateInquiryLetters({
      bureaus: {
        experian: { inquiryList: [{ creditorName: "GECS", date: "2024-04-01" }] }
      },
      personal: { name, address: "1 Main St" }
    });
    assert.equal(letters.length, 1, `no letter for name ${name}`);
    assert.equal(letters[0].buffer.slice(0, 4).toString(), "%PDF");
  }
});

test("smash: 80 inquiries still render under 15s", async () => {
  const inquiryList = Array.from({ length: 80 }, (_, i) => ({
    creditorName: `INQUIRER ${String(i + 1).padStart(2, "0")}`,
    date: "2024-06-01"
  }));
  const t0 = Date.now();
  const letters = await generateInquiryLetters({
    bureaus: { experian: { inquiryList } },
    personal: { name: "Jordan Sample" }
  });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 15000, `inquiry render hung ${elapsed}ms`);
  assert.equal(letters.length, 1);
  assert.equal(letters[0].buffer.slice(0, 4).toString(), "%PDF");
  assert.ok(letters[0].buffer.length > 200);
});

test("smash: derogatory tradeline missing name dates balance is not a blank PDF", async () => {
  const letters = await generateDisputeLetters({
    bureaus: { experian: { tradelines: [{ isDerogatory: true }] } },
    personal: { name: "Jordan Sample" }
  });
  letters.forEach(letter => {
    assert.equal(letter.buffer.slice(0, 4).toString(), "%PDF");
    assert.ok(letter.buffer.length > 200, `${letter.filename} looks empty`);
    assert.ok(/round1/.test(letter.filename));
  });
});

test("smash: round 2/3 with no priorOutcome never emits R2", async () => {
  const signet = {
    creditorName: "SIGNET BANK/VIRGINIA",
    status: "closed",
    isDerogatory: true,
    currentBalance: 4798,
    reportedDate: "2021-09-03",
    closedDate: "2021-10-28",
    accountIdentifier: "4443"
  };
  const letters = await generateDisputeLetters({
    bureaus: {
      experian: { tradelines: [signet] },
      transunion: { tradelines: [{ ...signet, priorOutcome: "" }] }
    },
    personal: { name: "Jordan Sample" }
  });
  assert.ok(!letters.some(l => /round[23]/.test(l.filename)));
  assert.ok(letters.length >= 1);
  letters.forEach(letter => {
    assert.equal(letter.buffer.slice(0, 4).toString(), "%PDF");
  });

  const blankOutcome = await generateDisputeLetters({
    bureaus: { experian: { tradelines: [{ ...signet, priorOutcome: "   " }] } },
    personal: { name: "Jordan Sample" }
  });
  assert.deepEqual(blankOutcome.map(l => l.filename), ["ex_round1.pdf"]);

  const padded = await generateDisputeLetters({
    bureaus: { experian: { tradelines: [{ ...signet, priorOutcome: " verified " }] } },
    personal: { name: "Jordan Sample" }
  });
  assert.ok(padded.some(l => l.filename === "ex_round2.pdf"));
});
