import { test } from "node:test";
import assert from "node:assert/strict";
import letterGenMod from "./vendor/letter-generator.cjs";
import { extractPdfText } from "../company-brain/pdf-text.mjs";

const {
  generateLetters,
  generateDisputeLetters,
  generateInquiryLetters,
  generatePersonalInfoLetters,
  collectPersonalInfoItems
} = letterGenMod;

const PERSONAL = {
  name: "Jordan Sample",
  address: "5815 Knoll Krest St\nSan Antonio, TX 78242",
  ssn: "111223333",
  dob: "1963-11-12",
  employer: "Current Co"
};

const SIGNET = {
  creditorName: "SIGNET BANK/VIRGINIA",
  accountIdentifier: "1200119007344443",
  status: "closed",
  isDerogatory: true,
  currentBalance: 4798,
  reportedDate: "2021-09-03",
  closedDate: "2021-10-28",
  currentRatingType: "ChargeOff",
  comments: []
};

function sampleBureaus() {
  return {
    experian: {
      tradelines: [SIGNET],
      inquiryList: [
        { creditorName: "GECS", date: "2024-04-01" },
        { creditorName: "RESIDENTCHECK/IMT RESI", date: "2024-05-12" }
      ],
      names: ["WILLIE L BOOZE"],
      addresses: ["1234 MAIN ST, SAN ANTONIO, TX 78201"],
      employers: ["HAEMONETICS", "HARMONETICS"],
      ssns: [],
      dobs: []
    },
    equifax: {
      tradelines: [],
      inquiryList: [{ creditorName: "WASHINGTON MUTUAL FI", date: "2024-09-01" }],
      names: [],
      addresses: ["ROBSTOWN TX"],
      employers: ["SPL"],
      ssns: ["666265040"],
      dobs: ["1963-11-12"]
    },
    transunion: {
      tradelines: [],
      inquiryList: [],
      names: ["BARBARA M DOTY"],
      addresses: [],
      employers: [],
      ssns: ["666111222"],
      dobs: []
    }
  };
}

async function textOf(letter) {
  const extracted = await extractPdfText(letter.buffer);
  return extracted.text || "";
}

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

function emptyBureaus() {
  return {
    experian: emptyBureau(),
    equifax: emptyBureau(),
    transunion: emptyBureau()
  };
}

function matchingIdentityBureaus() {
  const id = {
    tradelines: [],
    inquiryList: [],
    names: [PERSONAL.name],
    addresses: [PERSONAL.address.replace(/\n/g, ", ")],
    employers: [PERSONAL.employer],
    ssns: [PERSONAL.ssn],
    dobs: [PERSONAL.dob]
  };
  return {
    experian: { ...id },
    equifax: { ...id },
    transunion: { ...id }
  };
}

async function assertRealPdf(letter, minChars = 200) {
  assert.ok(letter && letter.buffer, "missing letter buffer");
  assert.equal(
    letter.buffer.subarray(0, 4).toString(),
    "%PDF",
    `${letter.filename} does not start with %PDF`
  );
  const text = await textOf(letter);
  assert.ok(
    text.length > minChars,
    `${letter.filename} looks header-only (${text.length} chars)`
  );
  assert.doesNotMatch(
    text,
    /fundhub|FundHub/,
    `${letter.filename} contains Fundhub branding`
  );
  return text;
}

test("empty bureau data emits no letters", async () => {
  const none = await generateLetters({
    path: "repair",
    bureaus: {},
    personal: PERSONAL
  });
  assert.equal(none.length, 0);

  const fundable = await generateLetters({
    path: "fundable",
    bureaus: { transunion: { inquiries: 0, inquiryList: [] } },
    personal: PERSONAL
  });
  assert.equal(fundable.length, 0);
});

test("TransUnion with zero inquiries emits no inquiry letter", async () => {
  const letters = await generateInquiryLetters({
    bureaus: sampleBureaus(),
    personal: PERSONAL
  });
  assert.deepEqual(
    letters.map((l) => l.filename).sort(),
    ["inquiry_eq.pdf", "inquiry_ex.pdf"]
  );
  assert.ok(!letters.some((l) => l.filename === "inquiry_tu.pdf"));
});

test("repair path emits one Round 1 bureau letter per bureau with items and skips empty rounds", async () => {
  const letters = await generateDisputeLetters({
    bureaus: sampleBureaus(),
    personal: PERSONAL
  });
  assert.equal(letters.length, 1);
  assert.equal(letters[0].filename, "ex_round1.pdf");
  assert.ok(!letters.some((l) => /round2|round3/.test(l.filename)));
});

test("personal info letters include FCRA 611 bodies and skip bureaus with nothing to fix", async () => {
  const letters = await generatePersonalInfoLetters({
    bureaus: sampleBureaus(),
    personal: PERSONAL
  });
  assert.ok(letters.length >= 2);
  for (const letter of letters) {
    const text = await textOf(letter);
    assert.match(text, /611|1681i/);
    assert.ok(text.length > 400, `${letter.filename} body too short`);
    assert.doesNotMatch(text, /fundhub|FundHub/i);
  }
  const ex = letters.find((l) => l.filename === "personal_info_ex.pdf");
  assert.ok(ex);
  const exText = await textOf(ex);
  assert.match(exText, /WILLIE L BOOZE/);
  assert.match(exText, /NAME VARIATIONS|legal name/i);
});

test("inquiry letters list inquiries and cite FCRA 604", async () => {
  const letters = await generateInquiryLetters({
    bureaus: sampleBureaus(),
    personal: PERSONAL
  });
  const ex = letters.find((l) => l.filename === "inquiry_ex.pdf");
  const text = await textOf(ex);
  assert.match(text, /604|1681b/);
  assert.match(text, /GECS/);
  assert.match(text, /RESIDENTCHECK/);
  assert.match(text, /E\s*N\s*C\s*L\s*O\s*S\s*U\s*R\s*E\s*S/);
  assert.doesNotMatch(text, /fundhub|FundHub/i);
});

test("bureau dispute matches gold SIGNET field pattern", async () => {
  const letters = await generateDisputeLetters({
    bureaus: { experian: { tradelines: [SIGNET] } },
    personal: PERSONAL,
    now: new Date(2026, 6, 25)
  });
  assert.equal(letters.length, 1);
  const text = await textOf(letters[0]);
  assert.equal(letters[0].buffer.subarray(0, 4).toString(), "%PDF");
  assert.match(text, /Jordan Sample/);
  assert.match(text, /5815 Knoll Krest St/);
  assert.match(text, /Experian/);
  assert.match(text, /RE:\s*Formal Dispute/);
  assert.match(text, /SIGNET BANK/);
  assert.match(text, /Account Ending in 4443/);
  assert.match(text, /Metro 2 Field 21 \(Current Balance\)/);
  assert.match(text, /Metro 2 Field 24 \(Date of Account Information\)/);
  assert.match(text, /Metro 2 Field 20 \(Compliance Condition Code\)/);
  assert.match(text, /DISPUTE ITEM 1/);
  assert.match(text, /DISPUTE ITEM 3/);
  assert.doesNotMatch(text, /DISPUTE ITEM 4/);
  assert.match(text, /multiple Metro 2 reporting violations/);
  assert.match(text, /nearly five years ago/);
  assert.match(text, /charge-off rating/);
  assert.match(text, /I am asking Experian to take the following steps/);
  assert.match(text, /1681i\(a\)\(5\)\(A\)/);
  assert.match(text, /Contact SIGNET BANK/);
  assert.match(text, /REQUESTED ACTIONS/);
  assert.match(text, /Sincerely/);
  assert.match(text, /E\s*N\s*C\s*L\s*O\s*S\s*U\s*R\s*E\s*S/);
  assert.match(text, /1681i/);
  assert.doesNotMatch(text, /fundhub|FundHub/i);
  assert.doesNotMatch(text, /To Whom It May Concern[\s\S]*Sincerely,\s*$/);
});

test("round 2 emits only when a tradeline was verified", async () => {
  const letters = await generateDisputeLetters({
    bureaus: {
      experian: {
        tradelines: [{ ...SIGNET, priorOutcome: "verified" }]
      }
    },
    personal: PERSONAL
  });
  assert.ok(letters.some((l) => l.filename === "ex_round2.pdf"));
  const r2 = letters.find((l) => l.filename === "ex_round2.pdf");
  const text = await textOf(r2);
  assert.match(text, /e-OSCAR|method of verification/i);
});

test("generated letter PDFs start with %PDF, have a body, and never say Fundhub", async () => {
  const letters = await generateLetters({
    path: "fundable",
    bureaus: sampleBureaus(),
    personal: PERSONAL
  });
  assert.ok(letters.length > 0);
  for (const letter of letters) {
    assert.equal(letter.buffer.subarray(0, 4).toString(), "%PDF");
    const text = await textOf(letter);
    assert.ok(text.length > 400, `${letter.filename} looks header-only (${text.length} chars)`);
    assert.match(text, /E\s*N\s*C\s*L\s*O\s*S\s*U\s*R\s*E\s*S/);
    assert.doesNotMatch(text, /fundhub|FundHub/);
  }
});

test("smash: three empty bureaus emit zero PDFs", async () => {
  for (const path of ["repair", "fundable"]) {
    const letters = await generateLetters({
      path,
      bureaus: emptyBureaus(),
      personal: PERSONAL
    });
    assert.equal(letters.length, 0, `${path} path emitted ${letters.map((l) => l.filename)}`);
  }
});

test("smash: TransUnion empty inquiries must not emit inquiry_tu; Experian body is real", async () => {
  const letters = await generateInquiryLetters({
    bureaus: {
      transunion: { inquiryList: [] },
      experian: {
        inquiryList: [
          { creditorName: "GECS", date: "2024-04-01" },
          { creditorName: "RESIDENTCHECK/IMT RESI", date: "2024-05-12" }
        ]
      },
      equifax: { inquiryList: [] }
    },
    personal: PERSONAL
  });
  assert.ok(!letters.some((l) => l.filename === "inquiry_tu.pdf"));
  assert.ok(!letters.some((l) => l.filename === "inquiry_eq.pdf"));
  const ex = letters.find((l) => l.filename === "inquiry_ex.pdf");
  assert.ok(ex, "inquiry_ex.pdf missing");
  const text = await assertRealPdf(ex);
  assert.match(text, /604|1681b/);
  assert.match(text, /GECS|RESIDENTCHECK/);
});

test("smash: matching personal info emits zero personal_info PDFs", async () => {
  const letters = await generatePersonalInfoLetters({
    bureaus: matchingIdentityBureaus(),
    personal: PERSONAL
  });
  assert.deepEqual(
    letters.map((l) => l.filename).sort(),
    [],
    `unexpected personal_info files: ${letters.map((l) => l.filename)}`
  );
});

/* WAS: "smash: missing personal null or empty object must not throw", and it
   passed by rendering a PDF addressed and signed "Client" — the literal word.
   That is the defect, not the guarantee, so the test now pins the rule instead
   of the old behaviour: a letter that cannot be truthfully addressed REFUSES.
   The empty-input half of the old test is kept exactly as it was, because a
   bureau file with nothing in it must still yield zero letters and not a throw. */
test("A LETTER WITH NO REAL NAME REFUSES — every writer, every placeholder", async () => {
  const payload = {
    experian: {
      tradelines: [SIGNET],
      inquiryList: [{ creditorName: "GECS", date: "2024-04-01" }],
      names: ["WILLIE L BOOZE"],
      addresses: ["1234 MAIN ST"],
      employers: [],
      ssns: [],
      dobs: []
    }
  };
  const noName = [
    null,
    undefined,
    {},
    { name: "" },
    { name: null },
    { name: "Client" },
    { name: "  client  " },
    { name: "Consumer" },
    { name: "N/A" },
    { name: "[FULL LEGAL NAME]" }
  ];
  for (const personal of noName) {
    const label = JSON.stringify(personal);
    await assert.rejects(
      () => generateLetters({ path: "repair", bureaus: payload, personal }),
      /missing_consumer_name/,
      `a repair pack was built for ${label}`
    );
    await assert.rejects(
      () => generateInquiryLetters({ bureaus: payload, personal }),
      /missing_consumer_name/,
      `an inquiry letter was built for ${label}`
    );
    await assert.rejects(
      () => generatePersonalInfoLetters({ bureaus: payload, personal }),
      /missing_consumer_name/,
      `a personal-info letter was built for ${label}`
    );
  }
  // A real name on the SAME payload still produces real PDFs. Without this the
  // test above would pass just as well if the writers refused everything.
  const good = await generateLetters({ path: "repair", bureaus: payload, personal: PERSONAL });
  assert.ok(good.length > 0, "a named client got no letters");
  for (const letter of good) await assertRealPdf(letter);

  // Nothing to write about is still zero letters and still not a throw.
  for (const fn of [generateLetters, generateDisputeLetters, generateInquiryLetters, generatePersonalInfoLetters]) {
    const none = await fn(null);
    assert.ok(Array.isArray(none));
    assert.equal(none.length, 0);
  }
});

test("the name a bureau is asked to KEEP is never the word Client", async () => {
  // The third name site in the vendor writer: not a letterhead, a claim.
  // Before this fix a bureau was mailed "Please keep only my legal name:
  // Client. Remove every other name."
  const file = {
    experian: {
      tradelines: [], inquiryList: [], names: ["WILLIE L BOOZE"],
      addresses: [], employers: [], ssns: [], dobs: []
    }
  };
  for (const personal of [{ name: "Client" }, { name: null }, { name: "Consumer" }]) {
    const items = collectPersonalInfoItems("experian", file, personal);
    const nameItem = items.find((i) => i.heading === "NAME VARIATIONS");
    assert.equal(
      nameItem,
      undefined,
      `a name claim was made with no name on record: ${JSON.stringify(nameItem?.fix)}`
    );
  }
  const named = collectPersonalInfoItems("experian", file, { name: "Jordan Sample" });
  const claim = named.find((i) => i.heading === "NAME VARIATIONS");
  assert.ok(claim, "a real name produced no name claim");
  assert.match(claim.fix, /Jordan Sample/);
});

test("smash: unicode and apostrophe names still render a real PDF", async () => {
  for (const name of ["O'Brien", "José García", "李", "O’Brien"]) {
    const letters = await generateInquiryLetters({
      bureaus: {
        experian: { inquiryList: [{ creditorName: "GECS", date: "2024-04-01" }] }
      },
      personal: { ...PERSONAL, name }
    });
    assert.equal(letters.length, 1, `no letter for name ${name}`);
    await assertRealPdf(letters[0]);
  }
});

test("smash: 80 inquiries still render under 15s with a real body", async () => {
  const inquiryList = Array.from({ length: 80 }, (_, i) => ({
    creditorName: `INQUIRER ${String(i + 1).padStart(2, "0")}`,
    date: "2024-06-01"
  }));
  const t0 = Date.now();
  const letters = await generateInquiryLetters({
    bureaus: { experian: { inquiryList } },
    personal: PERSONAL
  });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 15000, `inquiry render hung ${elapsed}ms`);
  assert.equal(letters.length, 1);
  const text = await assertRealPdf(letters[0]);
  assert.match(text, /604|1681b|INQUIRER/);
});

test("smash: malformed bureau lists must not throw", async () => {
  const fromStringTrades = await generateDisputeLetters({
    bureaus: { experian: { tradelines: "nope" } },
    personal: PERSONAL
  });
  assert.equal(fromStringTrades.length, 0);

  const inquiry = await generateInquiryLetters({
    bureaus: {
      experian: {
        tradelines: "nope",
        inquiryList: [{ creditorName: "GECS", date: "2024-04-01" }]
      }
    },
    personal: PERSONAL
  });
  assert.equal(inquiry.length, 1);
  await assertRealPdf(inquiry[0]);

  const info = await generatePersonalInfoLetters({
    bureaus: { experian: { names: "WILLIE L BOOZE", addresses: "1234 MAIN ST" } },
    personal: PERSONAL
  });
  assert.ok(Array.isArray(info));
  for (const letter of info) {
    await assertRealPdf(letter);
  }
});

test("smash: derogatory tradeline missing name dates balance is not header-only", async () => {
  const letters = await generateDisputeLetters({
    bureaus: {
      experian: {
        tradelines: [{ isDerogatory: true }]
      }
    },
    personal: PERSONAL
  });
  assert.ok(
    letters.length === 0 || letters.every((l) => l.filename.endsWith("_round1.pdf")),
    `unexpected files: ${letters.map((l) => l.filename)}`
  );
  for (const letter of letters) {
    const text = await assertRealPdf(letter);
    assert.match(text, /1681i|Field 20|REQUESTED ACTIONS|Unknown creditor/i);
  }
});

test("smash: round 2/3 with no priorOutcome never emits an empty R2 PDF", async () => {
  const letters = await generateDisputeLetters({
    bureaus: {
      experian: { tradelines: [SIGNET] },
      transunion: { tradelines: [{ ...SIGNET, priorOutcome: "" }] },
      equifax: { tradelines: [{ ...SIGNET, priorOutcome: undefined }] }
    },
    personal: PERSONAL
  });
  const later = letters.filter((l) => /round[23]/.test(l.filename));
  assert.equal(later.length, 0, `unexpected later-round files: ${later.map((l) => l.filename)}`);
  assert.ok(letters.length >= 1);
  for (const letter of letters) {
    assert.match(letter.filename, /round1\.pdf$/);
    await assertRealPdf(letter);
  }

  const blankOutcome = await generateDisputeLetters({
    bureaus: { experian: { tradelines: [{ ...SIGNET, priorOutcome: "   " }] } },
    personal: PERSONAL
  });
  assert.deepEqual(
    blankOutcome.map((l) => l.filename),
    ["ex_round1.pdf"]
  );
  await assertRealPdf(blankOutcome[0]);

  const padded = await generateDisputeLetters({
    bureaus: { experian: { tradelines: [{ ...SIGNET, priorOutcome: " verified " }] } },
    personal: PERSONAL
  });
  assert.ok(padded.some((l) => l.filename === "ex_round2.pdf"));
  assert.ok(!padded.some((l) => /round3/.test(l.filename)));
  const r2 = padded.find((l) => l.filename === "ex_round2.pdf");
  const r2text = await assertRealPdf(r2);
  assert.match(r2text, /e-OSCAR|method of verification/i);
});

test("smash: every emitted PDF is %PDF, body over 200 chars, never Fundhub", async () => {
  const letters = await generateLetters({
    path: "fundable",
    bureaus: sampleBureaus(),
    personal: PERSONAL
  });
  assert.ok(letters.length > 0);
  for (const letter of letters) {
    await assertRealPdf(letter, 200);
  }
  const repair = await generateLetters({
    path: "repair",
    bureaus: sampleBureaus(),
    personal: PERSONAL
  });
  for (const letter of repair) {
    await assertRealPdf(letter, 200);
  }
});
