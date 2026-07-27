// Field mapping for the three Phase 1 sources, checked against the REAL
// published header rows. If an agency renames a column, these fail here rather
// than silently loading 8.5M records with an empty phone column.

import { test } from "node:test";
import assert from "node:assert";
import { SOURCES, toRecord, tagsFor } from "./sources.mjs";
import { resolveFields } from "./csv.mjs";
import { syntheticRecordId } from "./warehouse.mjs";

// Header rows as published. Kept verbatim so a drift shows up as a test diff.
const PPP_HEADER = "LoanNumber,DateApproved,SBAOfficeCode,ProcessingMethod,BorrowerName,BorrowerAddress,BorrowerCity,BorrowerState,BorrowerZip,LoanStatusDate,LoanStatus,Term,SBAGuarantyPercentage,InitialApprovalAmount,CurrentApprovalAmount,UndisbursedAmount,FranchiseName,ServicingLenderLocationID,ServicingLenderName,ServicingLenderAddress,ServicingLenderCity,ServicingLenderState,ServicingLenderZip,RuralUrbanIndicator,HubzoneIndicator,LMIIndicator,BusinessAgeDescription,ProjectCity,ProjectCountyName,ProjectState,ProjectZip,CD,JobsReported,NAICSCode,RaceEthnicity,Gender,Veteran,NonProfit,ForgivenessAmount,ForgivenessDate,OriginatingLenderLocationID,OriginatingLender,OriginatingLenderCity,OriginatingLenderState,BusinessType".split(",");

const SBA_HEADER = "AsOfDate,Program,BorrName,BorrStreet,BorrCity,BorrState,BorrZip,BankName,BankFDICNumber,BankNCUANumber,BankStreet,BankCity,BankState,BankZip,GrossApproval,SBAGuaranteedApproval,ApprovalDate,ApprovalFiscalYear,FirstDisbursementDate,DeliveryMethod,subpgmdesc,InitialInterestRate,TermInMonths,NaicsCode,NaicsDescription,FranchiseCode,FranchiseName,ProjectCounty,ProjectState,SBADistrictOffice,CongressionalDistrict,BusinessType,BusinessAge,LoanStatus,PaidInFullDate,ChargeOffDate,GrossChargeOffAmount,RevolverStatus,JobsSupported".split(",");

const FMCSA_HEADER = "DOT_NUMBER,LEGAL_NAME,DBA_NAME,CARRIER_OPERATION,HM_FLAG,PC_FLAG,PHY_STREET,PHY_CITY,PHY_STATE,PHY_ZIP,PHY_COUNTRY,MAILING_STREET,MAILING_CITY,MAILING_STATE,MAILING_ZIP,MAILING_COUNTRY,TELEPHONE,FAX,CELL_PHONE,EMAIL_ADDRESS,MCS150_DATE,MCS150_MILEAGE,MCS150_MILEAGE_YEAR,ADD_DATE,OIC_STATE,NBR_POWER_UNIT,DRIVER_TOTAL".split(",");

const ctx = { sourceFile: "test.csv", rowNumber: 1, raw: null };

test("PPP: every mapped field resolves against the published header", () => {
  const { missing } = resolveFields(PPP_HEADER, SOURCES.ppp.fields);
  assert.deepEqual(missing, []);
});

test("SBA: only the loan number is absent — hence the synthetic-id fallback", () => {
  const { missing } = resolveFields(SBA_HEADER, SOURCES.sba.fields);
  assert.deepEqual(missing, ["sourceRecordId"]);
});

test("FMCSA: every mapped field resolves, including the contact columns", () => {
  const { missing } = resolveFields(FMCSA_HEADER, SOURCES.fmcsa.fields);
  assert.deepEqual(missing, []);
});

test("PPP: maps a row to a record, preferring current over initial approval", () => {
  const r = toRecord(SOURCES.ppp, {
    sourceRecordId: "9550137108", name: "Rivera Hauling LLC",
    street: "1420 N Industrial Blvd", city: "Laredo", state: "TX", zip: "78045",
    initialAmount: "100000", currentAmount: "150000",
    servicingLender: "Cross River Bank", originatingLender: "Celtic Bank",
    loanStatus: "Paid in Full", naics: "484121", employees: "12",
    approvedOn: "5/7/2021", businessType: "Corporation",
  }, ctx);

  assert.equal(r.source, "ppp");
  assert.equal(r.sourceRecordId, "9550137108");
  assert.equal(r.nameKey, "RIVERA HAULING");
  assert.equal(r.loanAmount, 150000);
  assert.equal(r.lender, "Cross River Bank");
  assert.equal(r.approvedOn, "2021-05-07");
  assert.equal(r.attrs.business_type, "Corporation");
  assert.equal(r.phone, null, "PPP carries no contact info");
});

test("SBA: the Program column decides the source tag", () => {
  const base = {
    name: "Acme Freight LLC", street: "1 Main St", city: "Reno", state: "NV", zip: "89502",
    grossApproval: "250000", lender: "Zions Bank", approvedOn: "3/1/2019",
  };
  assert.equal(toRecord(SOURCES.sba, { ...base, program: "7A" }, ctx).source, "sba_7a");
  assert.equal(toRecord(SOURCES.sba, { ...base, program: "7A Standard" }, ctx).source, "sba_7a");
  assert.equal(toRecord(SOURCES.sba, { ...base, program: "504" }, ctx).source, "sba_504");
  assert.equal(toRecord(SOURCES.sba, { ...base, program: "504DL" }, ctx).source, "sba_504");
  assert.deepEqual(tagsFor(SOURCES.sba), ["sba_7a", "sba_504"]);
});

test("SBA: with no loan number, the id is a content hash — stable, not positional", () => {
  const row = {
    program: "7A", name: "Acme Freight LLC", street: "1 Main St", city: "Reno",
    state: "NV", zip: "89502", grossApproval: "250000", approvedOn: "3/1/2019",
  };
  const a = toRecord(SOURCES.sba, row, { sourceFile: "f.csv", rowNumber: 7, raw: null });
  const b = toRecord(SOURCES.sba, row, { sourceFile: "other.csv", rowNumber: 9182, raw: null });

  assert.equal(a.sourceRecordId, b.sourceRecordId,
    "same record re-published at a different row must keep its id");
  assert.match(a.sourceRecordId, /^[0-9a-f]{32}$/);

  // A different loan at the same business is a different record.
  const c = toRecord(SOURCES.sba, { ...row, grossApproval: "999999" }, ctx);
  assert.notEqual(a.sourceRecordId, c.sourceRecordId);
});

test("FMCSA: pulls phone, cell, email and power units — the whole reason it is here", () => {
  const r = toRecord(SOURCES.fmcsa, {
    sourceRecordId: "1234567", name: "RIVERA HAULING, L.L.C.", dbaName: "Rivera Express",
    street: "1420 North Industrial Boulevard, Suite 4", city: "LAREDO", state: "TX", zip: "78045-1234",
    phone: "(956) 723-0100", phoneCell: "956-723-0199", email: "DISPATCH@Rivera.example",
    fleetSize: "27", drivers: "31", carrierOperation: "A",
  }, ctx);

  assert.equal(r.source, "fmcsa");
  assert.equal(r.phone, "9567230100");
  assert.equal(r.phoneCell, "9567230199");
  assert.equal(r.email, "dispatch@rivera.example");
  assert.equal(r.fleetSize, 27);
  assert.equal(r.employees, 31);
  assert.equal(r.dbaName, "Rivera Express");
  assert.equal(r.zip5, "78045");
});

test("FMCSA: falls back to the mailing address when physical is blank", () => {
  const r = toRecord(SOURCES.fmcsa, {
    sourceRecordId: "7", name: "Acme Carriers LLC",
    street: "", city: "", state: "", zip: "",
    mailStreet: "PO Box 47", mailCity: "Reno", mailState: "NV", mailZip: "89502",
    phone: "7754770100",
  }, ctx);

  assert.equal(r.addressKey, "PO BOX 47|89502");
  assert.equal(r.attrs.address_used, "mailing");
});

test("FMCSA: junk contact values are dropped, not stored", () => {
  const r = toRecord(SOURCES.fmcsa, {
    sourceRecordId: "8", name: "Acme Carriers LLC", street: "1 Main St", zip: "89502",
    phone: "5555555555", email: "UNKNOWN", phoneCell: "0000000000",
  }, ctx);
  assert.equal(r.phone, null);
  assert.equal(r.phoneCell, null);
  assert.equal(r.email, null);
});

test("a row with no usable name is rejected, not loaded as 'N/A'", () => {
  assert.equal(toRecord(SOURCES.ppp, { name: "N/A", street: "1 Main St", zip: "89502" }, ctx), null);
  assert.equal(toRecord(SOURCES.fmcsa, { sourceRecordId: "9", name: "" }, ctx), null);
});

test("attrs drop empty values but keep raw when asked", () => {
  const r = toRecord(SOURCES.ppp, {
    name: "Acme LLC", street: "1 Main St", zip: "89502",
    businessType: "", franchise: "Subway",
  }, { sourceFile: "f.csv", rowNumber: 2, raw: { BorrowerName: "Acme LLC" } });

  assert.equal("business_type" in r.attrs, false);
  assert.equal(r.attrs.franchise, "Subway");
  assert.deepEqual(r.attrs.__raw, { BorrowerName: "Acme LLC" });
});

test("syntheticRecordId is deterministic and order-sensitive", () => {
  assert.equal(syntheticRecordId(["a", "b"]), syntheticRecordId(["a", "b"]));
  assert.notEqual(syntheticRecordId(["a", "b"]), syntheticRecordId(["b", "a"]));
});
