// COMPLIANCE REVIEW REQUIRED — dispute / bureau mail helper tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clientReturnAddress,
  mailBureauLetter,
  deliverDisputeLetter,
  resolveFundingLetterPdf,
  resolveInquiryLetterContent
} from "./send.mjs";
import { memoryProvider, createStore } from "../../documents/store.mjs";
import { persistFundingLetterFiles } from "../../underwrite/funding-letter-pdf.mjs";

test("clientReturnAddress refuses missing street (never Fundhub default)", () => {
  assert.equal(clientReturnAddress(null), null);
  assert.equal(clientReturnAddress({ firstName: "Pat", lastName: "Client" }), null);
  assert.equal(clientReturnAddress({ city: "Dallas", state: "TX", zip: "75201" }), null);
});

test("mailBureauLetter refuses missing client return address", async () => {
  const r = await mailBureauLetter({
    bureau: "EX",
    html: "<html>x</html>",
    env: { POSTGRID_API_KEY: "test-key", MESSAGING_DRY_RUN: "0" }
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /return_address/);
});

test("mailBureauLetter prefers PDF and posts via sendLetter", async () => {
  let posted = null;
  const r = await mailBureauLetter({
    bureau: "EX",
    from: {
      first_name: "Pat",
      last_name: "Client",
      address_line1: "12 Oak St",
      address_city: "Dallas",
      address_state: "TX",
      address_zip: "75201"
    },
    pdf: Buffer.from("%PDF-1.4 repair").toString("base64"),
    html: "<html>should not win</html>",
    description: "Repair letter EX",
    env: { POSTGRID_API_KEY: "test-key", MESSAGING_DRY_RUN: "0" },
    fetchImpl: async (_url, init) => {
      posted = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        async json() { return { data: { id: "letter_repair_1" } }; },
        async text() { return JSON.stringify({ data: { id: "letter_repair_1" } }); }
      };
    }
  });
  assert.equal(r.ok, true);
  assert.equal(r.providerId, "letter_repair_1");
  assert.ok(posted.pdf);
  assert.equal(posted.html, undefined);
  assert.equal(posted.from.firstName, "Pat");
  assert.notEqual(String(posted.from.companyName || "").toLowerCase(), "fundhub");
});

test("deliverDisputeLetter is thin wrapper over mailBureauLetter", async () => {
  const r = await deliverDisputeLetter({
    bureau: "TU",
    identity: { firstName: "A", lastName: "B", addressLine1: "1 Main", city: "X", state: "TX", zip: "75001" },
    pdfBase64: Buffer.from("%PDF").toString("base64"),
    env: { POSTGRID_API_KEY: "test-key", MESSAGING_DRY_RUN: "0" },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() { return { data: { id: "letter_wrap" } }; },
      async text() { return JSON.stringify({ data: { id: "letter_wrap" } }); }
    })
  });
  assert.equal(r.ok, true);
  assert.equal(r.providerId, "letter_wrap");
});

test("resolveFundingLetterPdf uses case PDF when present, else null", async () => {
  assert.equal(await resolveFundingLetterPdf(null), null);
  assert.equal(await resolveFundingLetterPdf({ letter_draft_html: "<p>x</p>" }), null);
  assert.equal(await resolveFundingLetterPdf({ letter_pdf: "AAA" }), "AAA");
  assert.equal(
    await resolveFundingLetterPdf({ id: "1" }, { resolveFundingLetterPdf: () => "FROM_W3" }),
    "FROM_W3"
  );
});

test("resolveFundingLetterPdf returns inquiry_removal PDF for case bureau", async () => {
  const inquiryPdf = Buffer.from("%PDF-inquiry-ex").toString("base64");
  const personalPdf = Buffer.from("%PDF-personal-ex").toString("base64");
  const got = await resolveFundingLetterPdf(
    { selected_bureaus_raw: "EX", client_id: "c1" },
    {
      fundingFiles: [
        { type: "personal_info", bureau: "experian", filename: "personal_info_ex.pdf", content: Buffer.from("%PDF-personal-ex") },
        { type: "inquiry_removal", bureau: "experian", filename: "inquiry_ex.pdf", content: Buffer.from("%PDF-inquiry-ex") }
      ]
    }
  );
  assert.equal(got, inquiryPdf);
  assert.notEqual(got, personalPdf);
});

test("resolveFundingLetterPdf falls back to personal_info when no inquiry letter", async () => {
  const personalPdf = Buffer.from("%PDF-pi-tu").toString("base64");
  const got = await resolveFundingLetterPdf(
    { selected_bureaus_raw: "TU" },
    {
      fundingFiles: [
        { type: "personal_info", bureau: "transunion", filename: "personal_info_tu.pdf", content: Buffer.from("%PDF-pi-tu") }
      ]
    }
  );
  assert.equal(got, personalPdf);
});

test("resolveFundingLetterPdf never returns dispute / Metro 2 letter", async () => {
  const disputePdf = Buffer.from("%PDF-dispute-ex");
  const got = await resolveFundingLetterPdf(
    { selected_bureaus_raw: "EX" },
    {
      fundingFiles: [
        { type: "dispute", bureau: "experian", filename: "ex_round1.pdf", content: disputePdf },
        { type: "dispute", bureau: "experian", filename: "ex_round2.pdf", content: Buffer.from("%PDF-r2") }
      ]
    }
  );
  assert.equal(got, null);

  const mixed = await resolveFundingLetterPdf(
    { selected_bureaus_raw: "EX" },
    {
      fundingFiles: [
        { type: "dispute", bureau: "experian", filename: "ex_round1.pdf", content: disputePdf },
        { type: "inquiry_removal", bureau: "experian", filename: "inquiry_ex.pdf", content: Buffer.from("%PDF-ok") }
      ]
    }
  );
  assert.equal(mixed, Buffer.from("%PDF-ok").toString("base64"));
  assert.notEqual(mixed, disputePdf.toString("base64"));
});

test("resolveFundingLetterPdf refuses case column marked as dispute", async () => {
  assert.equal(
    await resolveFundingLetterPdf({
      letter_pdf: "DISPUTE_BYTES",
      letter_type: "dispute",
      filename: "ex_round1.pdf",
      selected_bureaus_raw: "EX"
    }),
    null
  );
});

test("resolveFundingLetterPdf missing pack → null (HTML stub stays)", async () => {
  assert.equal(
    await resolveFundingLetterPdf({ selected_bureaus_raw: "EQ", letter_draft_html: "<p>stub</p>" }),
    null
  );
  const content = await resolveInquiryLetterContent(
    { selected_bureaus_raw: "EQ", letter_draft_html: "<p>stub</p>" },
    {}
  );
  assert.equal(content.source, "html");
  assert.match(content.html, /stub/);
  assert.equal(content.pdf, undefined);
});

test("resolveFundingLetterPdf loads funding PDF from documents store", async () => {
  const orgId = "11111111-1111-1111-1111-111111111111";
  const clientId = "22222222-2222-2222-2222-222222222222";
  const { makeFakeDb } = await import("../../documents/fake-db.mjs");
  const fake = makeFakeDb();
  const store = createStore(memoryProvider());
  const inquiryBytes = Buffer.from("%PDF-stored-inquiry");
  const persisted = await persistFundingLetterFiles(fake, store, {
    orgId,
    clientId,
    files: [
      {
        type: "inquiry_removal",
        bureau: "experian",
        filename: "inquiry_ex.pdf",
        content: inquiryBytes
      },
      {
        type: "dispute",
        bureau: "experian",
        filename: "ex_round1.pdf",
        content: Buffer.from("%PDF-should-not-store")
      }
    ],
    generatedBy: "test-w3"
  });
  assert.equal(persisted.stored.length, 1);
  assert.equal(persisted.stored[0].type, "inquiry_removal");

  const got = await resolveFundingLetterPdf(
    { selected_bureaus_raw: "EX", org_id: orgId, client_id: clientId },
    { db: fake, store }
  );
  assert.equal(got, inquiryBytes.toString("base64"));
});

test("resolveInquiryLetterContent prefers PDF over HTML stub", async () => {
  const pdf = await resolveInquiryLetterContent(
    { letter_draft_html: "<p>stub</p>", letter_pdf: "PDFDATA" },
    {}
  );
  assert.equal(pdf.source, "pdf");
  assert.equal(pdf.pdf, "PDFDATA");

  const html = await resolveInquiryLetterContent(
    { letter_draft_html: "<p>stub</p>" },
    {}
  );
  assert.equal(html.source, "html");
  assert.match(html.html, /stub/);
});
