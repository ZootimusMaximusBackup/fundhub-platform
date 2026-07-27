// The three Phase 1 federal sources: where to get them, and how to read them.
//
// Everything source-specific lives here. The ingester (../ingest.mjs) is
// generic — it downloads whatever `resolveFiles()` hands it, maps rows through
// `fields` + `map`, and writes them. Adding a Phase 2 source means adding an
// entry to SOURCES, not touching the pipeline.
//
// ── Two robustness decisions worth understanding ───────────────────────────
//
// 1. FIELD MAPS ARE ALIAS LISTS, MATCHED LOOSELY.
//    Column headers in these releases drift between publications: SBA has
//    shipped the same column as "BorrowerName", "Borrower Name" and
//    "BORROWER_NAME"; FMCSA alternates between "PHY_STREET" and "PHYSICAL
//    STREET". resolveFields() in csv.mjs compares on an alphanumeric-only
//    uppercase token, and each field lists every spelling seen, so a
//    re-publication with cosmetic header changes does not require a code
//    change. Missing columns degrade the record; they never crash the load.
//
// 2. URLS ARE DISCOVERED, NOT HARDCODED.
//    data.sba.gov is a CKAN instance, so the current CSV resources are read
//    from its package API at run time rather than pinned to URLs that rotate
//    every quarterly release. Every source also accepts an explicit override
//    (env var or --url/--file), which is the escape hatch when discovery is
//    unavailable or an operator wants a specific historical release.
//
// ⚠️ CONFIRM BEFORE THE FIRST FULL-SCALE RUN
//    The FMCSA download URL below could not be verified from the build
//    container — data.sba.gov, data.transportation.gov and ai.fmcsa.dot.gov
//    are all blocked by this environment's egress policy. The SBA URLs are
//    discovered from CKAN at run time so they are self-correcting; the FMCSA
//    Socrata dataset id is a documented default that an operator should
//    confirm once (see scripts/marketing/README.md) and, if it has moved,
//    override with MARKETING_FMCSA_URL rather than editing this file.

import { normalizeBusiness } from "./normalize.mjs";
import { DEFAULT_USER_AGENT } from "./fetch.mjs";
import { syntheticRecordId } from "./warehouse.mjs";

/**
 * Ask a CKAN catalog which CSV resources a dataset currently publishes.
 *
 * Keeps us pinned to the DATASET (stable) rather than to file URLs (rotate on
 * every release).
 */
async function ckanResources(baseUrl, packageId, { match, signal, userAgent = DEFAULT_USER_AGENT } = {}) {
  const url = `${baseUrl}/api/3/action/package_show?id=${encodeURIComponent(packageId)}`;
  const res = await fetch(url, { headers: { "user-agent": userAgent, accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`CKAN ${url} -> HTTP ${res.status} ${res.statusText}`);

  const body = await res.json();
  if (!body?.success || !body?.result?.resources) {
    throw new Error(`CKAN ${url} returned no resources`);
  }

  return body.result.resources
    .filter((r) => {
      const fmt = String(r.format || "").toUpperCase();
      const name = String(r.name || r.url || "");
      if (!(fmt === "CSV" || /\.csv(\.gz)?(\?|$)/i.test(String(r.url || "")))) return false;
      return match ? match(name, r) : true;
    })
    .map((r) => ({ url: r.url, name: r.name || r.url.split("/").pop(), bytes: Number(r.size) || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// 1. PPP — Paycheck Protection Program loan-level FOIA release.
//    ~8.5M loans. No contact info; the value is name + address + NAICS + the
//    loan amount as a proxy for business size.
// ---------------------------------------------------------------------------
const PPP = {
  key: "ppp",
  label: "PPP Loan Data (FOIA)",
  authority: "U.S. Small Business Administration",
  landing: "https://data.sba.gov/dataset/ppp-foia",
  envUrl: "MARKETING_PPP_URL",
  estimatedRecords: 8_500_000,
  hasContact: false,

  async resolveFiles(opts = {}) {
    return ckanResources("https://data.sba.gov", "ppp-foia", {
      // Loan-level releases only. The dataset also carries summary/lookup
      // tables (state rollups, NAICS dictionaries) that are not businesses.
      match: (name) => /^public_|ppp/i.test(name) && !/summar|lookup|dictionar|readme/i.test(name),
      ...opts,
    });
  },

  fields: {
    sourceRecordId: ["LoanNumber", "Loan Number", "LoanNbr"],
    name: ["BorrowerName", "Borrower Name", "Name"],
    street: ["BorrowerAddress", "Borrower Address", "BorrowerStreet"],
    city: ["BorrowerCity", "Borrower City"],
    state: ["BorrowerState", "Borrower State"],
    zip: ["BorrowerZip", "Borrower Zip", "BorrowerZipCode"],
    currentAmount: ["CurrentApprovalAmount", "Current Approval Amount"],
    initialAmount: ["InitialApprovalAmount", "Initial Approval Amount", "LoanAmount", "Loan Amount"],
    forgivenessAmount: ["ForgivenessAmount", "Forgiveness Amount"],
    servicingLender: ["ServicingLenderName", "Servicing Lender Name", "Lender"],
    originatingLender: ["OriginatingLender", "Originating Lender", "OriginatingLenderName"],
    loanStatus: ["LoanStatus", "Loan Status"],
    naics: ["NAICSCode", "NAICS Code", "NaicsCode", "NAICS"],
    employees: ["JobsReported", "Jobs Reported", "JobsRetained"],
    approvedOn: ["DateApproved", "Date Approved", "ApprovalDate"],
    businessType: ["BusinessType", "Business Type"],
    franchise: ["FranchiseName", "Franchise Name"],
  },

  map(v) {
    return {
      tag: "ppp",
      input: {
        name: v.name,
        street: v.street,
        city: v.city,
        state: v.state,
        zip: v.zip,
        naics: v.naics,
        employees: v.employees,
        // Current approval is the authoritative figure; initial is the
        // fallback for older releases that predate the column.
        loanAmount: v.currentAmount ?? v.initialAmount,
        lender: v.servicingLender ?? v.originatingLender,
        loanStatus: v.loanStatus,
        approvedOn: v.approvedOn,
        sourceRecordId: v.sourceRecordId,
      },
      attrs: {
        business_type: v.businessType,
        franchise: v.franchise,
        forgiveness_amount: v.forgivenessAmount,
        originating_lender: v.originatingLender,
      },
      // No natural key in some older releases — fall back to content hash.
      identityParts: [v.name, v.street, v.zip, v.approvedOn, v.currentAmount ?? v.initialAmount],
    };
  },
};

// ---------------------------------------------------------------------------
// 2. SBA 7(a) + 504 — the standing loan programs, same FOIA catalog.
//    ~1.9M loans combined. One file family, two source tags: the Program
//    column decides which, so a 504 record is never mislabelled as 7(a).
// ---------------------------------------------------------------------------
const SBA_LOANS = {
  key: "sba",
  label: "SBA 7(a) + 504 Loan Data (FOIA)",
  authority: "U.S. Small Business Administration",
  landing: "https://data.sba.gov/dataset/7-a-504-foia",
  envUrl: "MARKETING_SBA_URL",
  estimatedRecords: 1_900_000,
  hasContact: false,
  // Writes rows tagged sba_7a or sba_504 depending on the Program column.
  emits: ["sba_7a", "sba_504"],

  async resolveFiles(opts = {}) {
    return ckanResources("https://data.sba.gov", "7-a-504-foia", {
      match: (name) => /7\s*a|504|foia/i.test(name) && !/summar|lookup|dictionar|readme/i.test(name),
      ...opts,
    });
  },

  fields: {
    sourceRecordId: ["LoanNumber", "Loan Number", "SBALoanNumber"],
    program: ["Program", "ProgramType", "subpgmdesc", "SubProgram"],
    name: ["BorrName", "Borrower Name", "BorrowerName"],
    street: ["BorrStreet", "Borrower Street", "BorrowerAddress"],
    city: ["BorrCity", "Borrower City"],
    state: ["BorrState", "Borrower State"],
    zip: ["BorrZip", "Borrower Zip"],
    grossApproval: ["GrossApproval", "Gross Approval", "ProjectGrossApproval"],
    sbaGuaranteed: ["SBAGuaranteedApproval", "SBA Guaranteed Approval"],
    lender: ["BankName", "Bank Name", "ThirdPartyLender", "LenderName"],
    lenderCity: ["BankCity", "Bank City"],
    lenderState: ["BankState", "Bank State"],
    loanStatus: ["LoanStatus", "Loan Status"],
    naics: ["NaicsCode", "NAICS Code", "NAICSCode"],
    naicsDescription: ["NaicsDescription", "NAICS Description"],
    employees: ["JobsSupported", "Jobs Supported", "JobsCreated"],
    approvedOn: ["ApprovalDate", "Approval Date"],
    businessType: ["BusinessType", "Business Type"],
    businessAge: ["BusinessAge", "Business Age"],
    deliveryMethod: ["DeliveryMethod", "Delivery Method"],
  },

  map(v) {
    // The Program column carries values like "7A", "504", "504DL",
    // "7A - Standard". Anything mentioning 504 is a 504 loan.
    const program = String(v.program ?? "").toUpperCase();
    const tag = program.includes("504") ? "sba_504" : "sba_7a";

    return {
      tag,
      input: {
        name: v.name,
        street: v.street,
        city: v.city,
        state: v.state,
        zip: v.zip,
        naics: v.naics,
        employees: v.employees,
        loanAmount: v.grossApproval,
        lender: v.lender,
        loanStatus: v.loanStatus,
        approvedOn: v.approvedOn,
        sourceRecordId: v.sourceRecordId,
      },
      attrs: {
        program: v.program,
        delivery_method: v.deliveryMethod,
        business_type: v.businessType,
        business_age: v.businessAge,
        naics_description: v.naicsDescription,
        sba_guaranteed: v.sbaGuaranteed,
        lender_city: v.lenderCity,
        lender_state: v.lenderState,
      },
      identityParts: [tag, v.name, v.street, v.zip, v.approvedOn, v.grossApproval],
    };
  },
};

// ---------------------------------------------------------------------------
// 3. FMCSA motor carrier census — THE HIGH-VALUE SOURCE.
//    ~2.2M carriers, and the only free federal file that ships PHONE, CELL and
//    EMAIL alongside name and address. Everything else in Phase 1 is a mailing
//    list; this one is a callable, emailable list. Ingest it FIRST, because
//    when it overlaps a PPP or SBA record the merge upgrades that record from
//    mail-only to multi-channel.
// ---------------------------------------------------------------------------
const FMCSA = {
  key: "fmcsa",
  label: "FMCSA Motor Carrier Census",
  authority: "Federal Motor Carrier Safety Administration",
  landing: "https://data.transportation.gov",
  envUrl: "MARKETING_FMCSA_URL",
  estimatedRecords: 2_200_000,
  hasContact: true,

  // Socrata bulk CSV export for the Motor Carrier Census dataset. ⚠️ Confirm
  // the dataset id once against the landing page before the first full run;
  // override with MARKETING_FMCSA_URL if it has moved. Unlike the SBA sources
  // there is no CKAN catalog here to self-correct from.
  defaultUrl: "https://data.transportation.gov/api/views/az4n-8mr2/rows.csv?accessType=DOWNLOAD",

  async resolveFiles() {
    const url = process.env.MARKETING_FMCSA_URL || FMCSA.defaultUrl;
    return [{ url, name: "fmcsa_census.csv", bytes: null }];
  },

  fields: {
    sourceRecordId: ["DOT_NUMBER", "DOT Number", "DOTNumber", "USDOT_NUMBER", "USDOT Number"],
    name: ["LEGAL_NAME", "Legal Name", "LegalName", "CARRIER_NAME"],
    dbaName: ["DBA_NAME", "DBA Name", "DBAName"],
    street: ["PHY_STREET", "Physical Street", "PHYSICAL_STREET", "PHY_ADDRESS"],
    city: ["PHY_CITY", "Physical City", "PHYSICAL_CITY"],
    state: ["PHY_STATE", "Physical State", "PHYSICAL_STATE"],
    zip: ["PHY_ZIP", "Physical Zip", "PHYSICAL_ZIP"],
    mailStreet: ["MAILING_STREET", "Mailing Street"],
    mailCity: ["MAILING_CITY", "Mailing City"],
    mailState: ["MAILING_STATE", "Mailing State"],
    mailZip: ["MAILING_ZIP", "Mailing Zip"],
    phone: ["TELEPHONE", "Telephone", "PHONE", "Phone"],
    phoneCell: ["CELL_PHONE", "Cell Phone", "CELLPHONE", "MOBILE_PHONE"],
    fax: ["FAX", "Fax"],
    email: ["EMAIL_ADDRESS", "Email Address", "EMAIL", "Email"],
    fleetSize: ["NBR_POWER_UNIT", "Power Units", "POWER_UNITS", "NBRPOWERUNIT", "TOTAL_POWER_UNITS"],
    drivers: ["DRIVER_TOTAL", "Drivers", "TOTAL_DRIVERS", "NBR_DRIVER"],
    carrierOperation: ["CARRIER_OPERATION", "Carrier Operation"],
    mcs150Date: ["MCS150_DATE", "MCS 150 Date"],
    mcs150Mileage: ["MCS150_MILEAGE", "MCS 150 Mileage"],
    addedOn: ["ADD_DATE", "Add Date"],
  },

  map(v) {
    // Prefer the physical address; fall back to mailing. A carrier with only a
    // mailing address is still mailable, and dropping it would throw away a
    // record that already carries a phone number.
    const hasPhysical = Boolean(v.street && String(v.street).trim());
    return {
      tag: "fmcsa",
      input: {
        name: v.name,
        dbaName: v.dbaName,
        street: hasPhysical ? v.street : v.mailStreet,
        city: hasPhysical ? v.city : v.mailCity,
        state: hasPhysical ? v.state : v.mailState,
        zip: hasPhysical ? v.zip : v.mailZip,
        phone: v.phone,
        phoneCell: v.phoneCell,
        email: v.email,
        // Power units = trucks. The single best size signal in this file, and
        // the one that predicts financing need.
        fleetSize: v.fleetSize,
        employees: v.drivers,
        sourceRecordId: v.sourceRecordId,
      },
      attrs: {
        carrier_operation: v.carrierOperation,
        drivers: v.drivers,
        fax: v.fax,
        mcs150_date: v.mcs150Date,
        mcs150_mileage: v.mcs150Mileage,
        added_on: v.addedOn,
        address_used: hasPhysical ? "physical" : "mailing",
      },
      identityParts: [v.sourceRecordId, v.name, v.street],
    };
  },
};

export const SOURCES = { ppp: PPP, sba: SBA_LOANS, fmcsa: FMCSA };

/** Every source tag a given source can write. */
export function tagsFor(source) {
  return source.emits ?? [source.key];
}

/**
 * Turn one raw CSV row into the record the warehouse writes, or null if it is
 * unusable (no resolvable business name).
 */
export function toRecord(source, values, { sourceFile, rowNumber, raw }) {
  const mapped = source.map(values);
  const normalized = normalizeBusiness(mapped.input);
  if (!normalized) return null;

  const attrs = {};
  for (const [k, val] of Object.entries(mapped.attrs ?? {})) {
    if (val !== null && val !== undefined && String(val).trim() !== "") attrs[k] = String(val);
  }
  if (raw) attrs.__raw = raw;

  return {
    ...normalized,
    source: mapped.tag,
    // Most releases carry a natural key (PPP LoanNumber, FMCSA DOT_NUMBER).
    // Older SBA FOIA files do not, so fall back to a content hash — stable
    // across a re-publication that shuffles row order, which a row-number key
    // would not be.
    sourceRecordId:
      normalized.sourceRecordId ||
      syntheticRecordId(mapped.identityParts.map((p) => (p == null ? "" : String(p)))),
    sourceFile,
    sourceRow: rowNumber,
    attrs,
  };
}
