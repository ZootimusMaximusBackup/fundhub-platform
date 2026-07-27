// Shared canonicalizer for the marketing warehouse.
//
// Every ingester runs its rows through here before touching Postgres, so that
// three federal agencies that spell the same business three different ways
// still produce ONE record. This module is the reason the warehouse dedupes.
//
// The contract: canonicalName("ABC LLC") === canonicalName("A.B.C., L.L.C.").
//
// Two forms come out of every field:
//   display  — the source's own casing/punctuation. Goes on the mail piece.
//   key      — uppercase, unpunctuated, suffix-stripped. Machine-only, never
//              shown to a human, used solely for the dedup index.
//
// Deliberately dependency-free and deterministic: no network, no locale, no
// randomness, so the same file ingested twice produces byte-identical keys.

// ---------------------------------------------------------------------------
// Null-ish values as they actually appear in federal CSVs. Agencies do not use
// empty cells consistently — PPP redacts small-loan borrower names to "N/A",
// FMCSA writes "UNKNOWN" and "NONE" into contact columns. Treating these as
// real strings is how you end up mailing 40,000 businesses named "N/A".
// ---------------------------------------------------------------------------
const NULLISH = new Set([
  "", "N/A", "NA", "N.A.", "NONE", "NULL", "NIL", "UNKNOWN", "UNK",
  "NOT AVAILABLE", "NOT APPLICABLE", "NO DATA", "NOT PROVIDED", "NOT REPORTED",
  "-", "--", "---", ".", "0", "00000", "XXX", "XXXX", "XXXXX", "TBD",
  "WITHHELD", "REDACTED", "NAME NOT AVAILABLE", "NAMENOTAVAILABLE",
]);

// Legal-entity suffixes, stripped from the END of a name, repeatedly.
// "ABC CO INC" and "ABC, INCORPORATED" both reduce to "ABC".
const LEGAL_SUFFIXES = new Set([
  "LLC", "LLLP", "LLP", "LP", "LC", "PLLC", "PLC", "PC", "PA",
  "INC", "INCORPORATED", "CORP", "CORPORATION",
  "CO", "COMPANY", "COMPANIES",
  "LTD", "LIMITED", "GMBH", "SA", "SAS", "NV", "BV", "AG", "AB", "OY", "PTY",
  "TRUST", "ESTATE",
  "DBA", "AKA", "FKA",
  "THE",
]);

// A leading article carries no identity. "THE ACME CORP" === "ACME CORP".
const LEADING_NOISE = new Set(["THE", "A", "AN"]);

// USPS Publication 28 street suffixes, long form -> standard abbreviation.
// Only the suffixes that actually show up at volume; the long tail falls
// through unchanged, which is harmless because both sides fall through alike.
const STREET_SUFFIX = new Map(Object.entries({
  ALLEE: "ALY", ALLEY: "ALY", ALLY: "ALY", ALY: "ALY",
  ANEX: "ANX", ANNEX: "ANX", ANNX: "ANX", ANX: "ANX",
  ARCADE: "ARC", ARC: "ARC",
  AVENUE: "AVE", AVEN: "AVE", AVENU: "AVE", AVN: "AVE", AVNUE: "AVE", AV: "AVE", AVE: "AVE",
  BAYOU: "BYU", BEACH: "BCH", BCH: "BCH", BEND: "BND", BND: "BND",
  BLUFF: "BLF", BLUF: "BLF", BLF: "BLF",
  BOTTOM: "BTM", BOTTM: "BTM", BTM: "BTM",
  BOULEVARD: "BLVD", BOUL: "BLVD", BOULV: "BLVD", BLVD: "BLVD",
  BRANCH: "BR", BRNCH: "BR", BR: "BR",
  BRIDGE: "BRG", BRDGE: "BRG", BRG: "BRG",
  BROOK: "BRK", BRK: "BRK", BURG: "BG", BYPASS: "BYP", BYP: "BYP",
  CAMP: "CP", CP: "CP", CANYON: "CYN", CANYN: "CYN", CNYN: "CYN", CYN: "CYN",
  CAPE: "CPE", CPE: "CPE", CAUSEWAY: "CSWY", CSWY: "CSWY",
  CENTER: "CTR", CENTRE: "CTR", CENTR: "CTR", CENT: "CTR", CNTR: "CTR", CTR: "CTR",
  CIRCLE: "CIR", CIRC: "CIR", CIRCL: "CIR", CRCL: "CIR", CIR: "CIR",
  CLIFF: "CLF", CLF: "CLF", CLUB: "CLB", CLB: "CLB",
  COMMON: "CMN", CORNER: "COR", COR: "COR",
  COURSE: "CRSE", CRSE: "CRSE", COURT: "CT", CRT: "CT", CT: "CT",
  COVE: "CV", CV: "CV", CREEK: "CRK", CRK: "CRK",
  CRESCENT: "CRES", CRES: "CRES", CREST: "CRST", CROSSING: "XING", CRSSNG: "XING", XING: "XING",
  CROSSROAD: "XRD", CURVE: "CURV",
  DALE: "DL", DAM: "DM", DIVIDE: "DV", DV: "DV",
  DRIVE: "DR", DRIV: "DR", DRV: "DR", DR: "DR",
  ESTATE: "EST", EST: "EST", ESTATES: "ESTS", ESTS: "ESTS",
  EXPRESSWAY: "EXPY", EXPRESS: "EXPY", EXPW: "EXPY", EXPY: "EXPY",
  EXTENSION: "EXT", EXTN: "EXT", EXT: "EXT",
  FALL: "FALL", FALLS: "FLS", FLS: "FLS", FERRY: "FRY", FRRY: "FRY", FRY: "FRY",
  FIELD: "FLD", FLD: "FLD", FIELDS: "FLDS", FLDS: "FLDS",
  FLAT: "FLT", FLT: "FLT", FORD: "FRD", FRD: "FRD", FOREST: "FRST", FRST: "FRST",
  FORGE: "FRG", FRG: "FRG", FORK: "FRK", FRK: "FRK", FORT: "FT", FRT: "FT", FT: "FT",
  FREEWAY: "FWY", FRWAY: "FWY", FRWY: "FWY", FWY: "FWY",
  GARDEN: "GDN", GARDENS: "GDNS", GDNS: "GDNS", GATEWAY: "GTWY", GTWY: "GTWY",
  GLEN: "GLN", GLN: "GLN", GREEN: "GRN", GRN: "GRN", GROVE: "GRV", GRV: "GRV",
  HARBOR: "HBR", HARB: "HBR", HARBR: "HBR", HBR: "HBR",
  HAVEN: "HVN", HVN: "HVN", HEIGHTS: "HTS", HT: "HTS", HTS: "HTS",
  HIGHWAY: "HWY", HIGHWY: "HWY", HIWAY: "HWY", HIWY: "HWY", HWAY: "HWY", HWY: "HWY",
  HILL: "HL", HL: "HL", HILLS: "HLS", HLS: "HLS", HOLLOW: "HOLW", HOLW: "HOLW",
  INLET: "INLT", ISLAND: "IS", IS: "IS", ISLANDS: "ISS", ISLE: "ISLE",
  JUNCTION: "JCT", JCTION: "JCT", JCT: "JCT",
  KEY: "KY", KY: "KY", KNOLL: "KNL", KNL: "KNL", KNOLLS: "KNLS",
  LAKE: "LK", LK: "LK", LAKES: "LKS", LKS: "LKS", LANDING: "LNDG", LNDG: "LNDG",
  LANE: "LN", LN: "LN", LIGHT: "LGT", LOAF: "LF", LOCK: "LCK", LODGE: "LDG", LDG: "LDG",
  LOOP: "LOOP", MALL: "MALL", MANOR: "MNR", MNR: "MNR",
  MEADOW: "MDW", MEADOWS: "MDWS", MDWS: "MDWS", MEWS: "MEWS",
  MILL: "ML", MILLS: "MLS", MISSION: "MSN", MOTORWAY: "MTWY",
  MOUNT: "MT", MT: "MT", MOUNTAIN: "MTN", MNTAIN: "MTN", MTIN: "MTN", MTN: "MTN",
  NECK: "NCK", ORCHARD: "ORCH", ORCH: "ORCH", OVAL: "OVAL", OVERPASS: "OPAS",
  PARK: "PARK", PARKS: "PARK", PARKWAY: "PKWY", PARKWY: "PKWY", PKWAY: "PKWY", PKY: "PKWY", PKWY: "PKWY",
  PASS: "PASS", PASSAGE: "PSGE", PATH: "PATH", PIKE: "PIKE", PINE: "PNE", PINES: "PNES",
  PLACE: "PL", PL: "PL", PLAIN: "PLN", PLAINS: "PLNS",
  PLAZA: "PLZ", PLZA: "PLZ", PLZ: "PLZ",
  POINT: "PT", PT: "PT", POINTS: "PTS", PORT: "PRT", PRT: "PRT",
  PRAIRIE: "PR", RADIAL: "RADL", RAMP: "RAMP", RANCH: "RNCH", RNCH: "RNCH",
  RAPID: "RPD", RAPIDS: "RPDS", REST: "RST", RIDGE: "RDG", RDGE: "RDG", RDG: "RDG",
  RIVER: "RIV", RVR: "RIV", RIV: "RIV",
  ROAD: "RD", RD: "RD", ROADS: "RDS", RDS: "RDS",
  ROUTE: "RTE", RTE: "RTE", ROW: "ROW", RUE: "RUE", RUN: "RUN",
  SHOAL: "SHL", SHOALS: "SHLS", SHORE: "SHR", SHR: "SHR", SHORES: "SHRS",
  SKYWAY: "SKWY", SPRING: "SPG", SPRNG: "SPG", SPG: "SPG",
  SPRINGS: "SPGS", SPGS: "SPGS", SPUR: "SPUR",
  SQUARE: "SQ", SQR: "SQ", SQU: "SQ", SQ: "SQ",
  STATION: "STA", STATN: "STA", STA: "STA",
  STRAVENUE: "STRA", STREAM: "STRM", STRM: "STRM",
  STREET: "ST", STRT: "ST", STR: "ST", ST: "ST", STREETS: "STS",
  SUMMIT: "SMT", SUMIT: "SMT", SMT: "SMT",
  TERRACE: "TER", TERR: "TER", TER: "TER",
  THROUGHWAY: "TRWY", TRACE: "TRCE", TRCE: "TRCE", TRACK: "TRAK", TRAK: "TRAK",
  TRAFFICWAY: "TRFY", TRAIL: "TRL", TRAILS: "TRL", TRL: "TRL",
  TRAILER: "TRLR", TRLR: "TRLR", TUNNEL: "TUNL", TUNL: "TUNL",
  TURNPIKE: "TPKE", TURNPK: "TPKE", TRNPK: "TPKE", TPKE: "TPKE",
  UNDERPASS: "UPAS", UNION: "UN", UN: "UN", UNIONS: "UNS",
  VALLEY: "VLY", VALLY: "VLY", VLLY: "VLY", VLY: "VLY", VALLEYS: "VLYS",
  VIADUCT: "VIA", VIEW: "VW", VW: "VW", VIEWS: "VWS",
  VILLAGE: "VLG", VILL: "VLG", VILLG: "VLG", VLG: "VLG", VILLAGES: "VLGS",
  VILLE: "VL", VL: "VL", VISTA: "VIS", VIST: "VIS", VIS: "VIS",
  WALK: "WALK", WALL: "WALL", WAY: "WAY", WY: "WAY", WAYS: "WAYS",
  WELL: "WL", WELLS: "WLS", WLS: "WLS",
}));

// Directionals, long form -> abbreviation. Applied anywhere in the line, so
// "NORTH WEST MAIN STREET" and "NW MAIN ST" converge.
const DIRECTIONAL = new Map(Object.entries({
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
  NORTHERN: "N", SOUTHERN: "S", EASTERN: "E", WESTERN: "W",
}));

// Secondary-unit designators. All collapse to STE: for business prospecting,
// "#200", "SUITE 200", "STE 200" and "UNIT 200" are the same mail stop, and
// treating them as different is a pure duplicate-generator.
const UNIT_DESIGNATOR = new Set([
  "STE", "SUITE", "STES", "UNIT", "APT", "APARTMENT", "RM", "ROOM",
  "SPC", "SPACE", "SLIP", "LOT", "TRLR", "OFC", "OFFICE", "DEPT", "DEPARTMENT",
  "NO", "NUM", "NUMBER", "BOX",
]);

// Ordinals, so "1ST AVE" and "FIRST AVE" converge on the digit form.
const ORDINAL_WORDS = new Map(Object.entries({
  FIRST: "1ST", SECOND: "2ND", THIRD: "3RD", FOURTH: "4TH", FIFTH: "5TH",
  SIXTH: "6TH", SEVENTH: "7TH", EIGHTH: "8TH", NINTH: "9TH", TENTH: "10TH",
  ELEVENTH: "11TH", TWELFTH: "12TH", THIRTEENTH: "13TH", FOURTEENTH: "14TH",
  FIFTEENTH: "15TH", SIXTEENTH: "16TH", SEVENTEENTH: "17TH", EIGHTEENTH: "18TH",
  NINETEENTH: "19TH", TWENTIETH: "20TH",
}));

const STATE_BY_NAME = new Map(Object.entries({
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA",
  COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE", "DISTRICT OF COLUMBIA": "DC",
  FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL",
  INDIANA: "IN", IOWA: "IA", KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA",
  MAINE: "ME", MARYLAND: "MD", MASSACHUSETTS: "MA", MICHIGAN: "MI",
  MINNESOTA: "MN", MISSISSIPPI: "MS", MISSOURI: "MO", MONTANA: "MT",
  NEBRASKA: "NE", NEVADA: "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND", OHIO: "OH", OKLAHOMA: "OK", OREGON: "OR",
  PENNSYLVANIA: "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT",
  VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV",
  WISCONSIN: "WI", WYOMING: "WY",
  "PUERTO RICO": "PR", GUAM: "GU", "VIRGIN ISLANDS": "VI",
  "AMERICAN SAMOA": "AS", "NORTHERN MARIANA ISLANDS": "MP",
}));

const VALID_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY","PR","GU","VI","AS","MP","AA","AE","AP",
]);

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Strip diacritics and fold to a comparable uppercase byte range. */
function fold(s) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

/**
 * Trim a raw CSV cell to display text, or null if the source meant "empty".
 * This is the gate that keeps "N/A" out of the name column.
 */
export function cleanText(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (NULLISH.has(fold(s))) return null;
  return s;
}

/**
 * Canonical business-name key. THE core dedup primitive.
 *
 *   canonicalName("ABC LLC")          === "ABC"
 *   canonicalName("A.B.C., L.L.C.")   === "ABC"
 *   canonicalName("The ABC Company")  === "ABC"
 *
 * Returns "" when the input carries no usable identity.
 */
export function canonicalName(raw) {
  const text = cleanText(raw);
  if (!text) return "";

  let s = fold(text);

  // "&" is a word, not punctuation: "SMITH & SONS" === "SMITH AND SONS".
  s = s.replace(/&/g, " AND ");

  // Periods and apostrophes vanish WITHOUT leaving a gap. This is the single
  // most important rule here: it is what turns "A.B.C." into "ABC" (rather
  // than "A B C") and "L.L.C." into the strippable token "LLC".
  s = s.replace(/[.'’`]/g, "");

  // Every other separator becomes a gap.
  s = s.replace(/[^A-Z0-9]+/g, " ").trim();
  if (!s) return "";

  let tokens = s.split(" ").filter(Boolean).map((t) => ORDINAL_WORDS.get(t) ?? t);

  // Drop a leading article.
  while (tokens.length > 1 && LEADING_NOISE.has(tokens[0])) tokens.shift();

  // Strip legal suffixes off the tail, repeatedly: "ABC CO INC" -> "ABC".
  // Guard on length so a business genuinely named "The Company" survives.
  const stripped = [...tokens];
  while (stripped.length > 1 && LEGAL_SUFFIXES.has(stripped[stripped.length - 1])) {
    stripped.pop();
  }
  if (stripped.length) tokens = stripped;

  return tokens.join(" ");
}

/**
 * Canonical street line: USPS-standardized, unpunctuated, unit designators
 * folded to STE.
 *
 *   canonicalStreet("123 North Main Street, Suite 200") === "123 N MAIN ST STE 200"
 *   canonicalStreet("123 N. Main St. #200")             === "123 N MAIN ST STE 200"
 */
export function canonicalStreet(raw) {
  const text = cleanText(raw);
  if (!text) return "";

  let s = fold(text);
  s = s.replace(/&/g, " AND ");
  s = s.replace(/[.'’`]/g, "");
  // "#200" is a unit designator glued to its identifier — split it before the
  // punctuation sweep eats the "#".
  s = s.replace(/#\s*/g, " STE ");
  s = s.replace(/[^A-Z0-9]+/g, " ").trim();
  if (!s) return "";

  const tokens = s.split(" ").filter(Boolean);
  const out = [];

  for (let i = 0; i < tokens.length; i++) {
    let t = tokens[i];

    // "POST OFFICE BOX" / "P O BOX" -> "PO BOX"
    if (t === "POST" && tokens[i + 1] === "OFFICE") { out.push("PO"); i += 1; continue; }
    if (t === "P" && tokens[i + 1] === "O") { out.push("PO"); i += 1; continue; }

    t = ORDINAL_WORDS.get(t) ?? t;
    t = DIRECTIONAL.get(t) ?? t;

    // Fold every secondary-unit word to STE, but never collapse "PO BOX":
    // a PO box IS the delivery point, not a sub-unit of one.
    if (UNIT_DESIGNATOR.has(t)) {
      if (t === "BOX" && out[out.length - 1] === "PO") { out.push("BOX"); continue; }
      // Drop a dangling designator with nothing after it ("123 MAIN ST STE").
      if (i === tokens.length - 1) continue;
      if (out[out.length - 1] !== "STE") out.push("STE");
      continue;
    }

    out.push(STREET_SUFFIX.get(t) ?? t);
  }

  return out.join(" ").replace(/\s+/g, " ").trim();
}

/** Canonical city token string. Handles the ST/SAINT split. */
export function canonicalCity(raw) {
  const text = cleanText(raw);
  if (!text) return "";
  let s = fold(text).replace(/[.'’`]/g, "").replace(/[^A-Z0-9]+/g, " ").trim();
  if (!s) return "";
  return s
    .split(" ")
    .filter(Boolean)
    .map((t) => (t === "SAINT" ? "ST" : t))
    .map((t) => ORDINAL_WORDS.get(t) ?? t)
    .join(" ");
}

/** Two-letter USPS state code, or null. Accepts full state names. */
export function normalizeState(raw) {
  const text = cleanText(raw);
  if (!text) return null;
  const s = fold(text).replace(/[^A-Z ]+/g, "").trim();
  if (VALID_STATES.has(s)) return s;
  const mapped = STATE_BY_NAME.get(s);
  return mapped ?? null;
}

/** First five digits of a ZIP, or null. Rejects the all-zeros placeholder. */
export function normalizeZip5(raw) {
  const text = cleanText(raw);
  if (!text) return null;
  const digits = String(text).replace(/\D/g, "");
  if (digits.length < 5) {
    // Some agencies drop the leading zero on New England ZIPs when the column
    // gets round-tripped through a spreadsheet as a number.
    if (digits.length === 3 || digits.length === 4) return digits.padStart(5, "0");
    return null;
  }
  const z = digits.slice(0, 5);
  return z === "00000" ? null : z;
}

/**
 * 10-digit NANP phone, digits only, or null.
 * Rejects the placeholder patterns federal files are full of (555-555-5555,
 * 000-000-0000, 111-111-1111) — mailing those is how you burn a dialer.
 */
export function normalizePhone(raw) {
  const text = cleanText(raw);
  if (!text) return null;
  let d = String(text).replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return null;
  if (/^(\d)\1{9}$/.test(d)) return null;         // 0000000000, 1111111111
  if (d.startsWith("0") || d.startsWith("1")) return null;  // invalid NANP area code
  if (d.slice(3, 6) === "555") return null;        // 555 exchange = fictional
  if (d.startsWith("555")) return null;
  return d;
}

/** Lowercased email, or null if it is not plausibly deliverable. */
export function normalizeEmail(raw) {
  const text = cleanText(raw);
  if (!text) return null;
  const s = text.toLowerCase().replace(/\s+/g, "");
  // Deliberately permissive but structural: one @, a dot in the domain, no
  // stray separators. Federal contact columns contain a lot of free text.
  if (!/^[^@\s,;:<>()[\]\\]+@[^@\s,;:<>()[\]\\]+\.[a-z]{2,}$/.test(s)) return null;
  if (s.length > 254) return null;
  return s;
}

/** NAICS as up to 6 digits, or null. Federal files pad, truncate, and float. */
export function normalizeNaics(raw) {
  const text = cleanText(raw);
  if (!text) return null;
  const d = String(text).replace(/\D/g, "");
  if (d.length < 2) return null;
  return d.slice(0, 6);
}

/** Money -> Number, or null. Strips $ and thousands separators. */
export function normalizeAmount(raw) {
  const text = cleanText(raw);
  if (text === null) return null;
  const s = String(text).replace(/[$,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Non-negative integer, or null. */
export function normalizeInt(raw) {
  const n = normalizeAmount(raw);
  if (n === null) return null;
  const i = Math.trunc(n);
  return i >= 0 && i <= 2147483647 ? i : null;
}

/** ISO date string (YYYY-MM-DD), or null. Accepts M/D/YYYY and ISO input. */
export function normalizeDate(raw) {
  const text = cleanText(raw);
  if (!text) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(text);
  if (m) {
    const yy = Number(m[3]);
    const year = yy > 50 ? 1900 + yy : 2000 + yy;
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

/**
 * The address half of the dedup key.
 *
 * Keyed on street + ZIP rather than street + city, because ZIP is a code and
 * city is a spelling ("ST LOUIS" / "SAINT LOUIS" / "ST. LOUIS"). City+state is
 * the fallback when ZIP is missing.
 *
 * Returns "" when there is no usable street line. That is intentional: every
 * addressless record for a given name then collapses onto ONE master row
 * rather than fanning out into near-duplicates, and "" is a real value that
 * the unique index can actually constrain (a NULL could not).
 */
export function addressKey({ street, city, state, zip } = {}) {
  const st = canonicalStreet(street);
  if (!st) return "";
  const z = normalizeZip5(zip);
  if (z) return `${st}|${z}`;
  const c = canonicalCity(city);
  const s = normalizeState(state);
  if (c && s) return `${st}|${c}-${s}`;
  if (s) return `${st}|${s}`;
  return `${st}|`;
}

/**
 * Run one source row through the full canonicalizer.
 *
 * Input is the loosely-typed record an ingester's field mapper produced;
 * output is exactly the shape the upsert writes. Returns null when the row has
 * no usable business name, because a record we cannot name is a record we
 * cannot mail.
 */
export function normalizeBusiness(input) {
  const name = cleanText(input.name);
  const nameKey = canonicalName(name);
  if (!nameKey) return null;

  const street = cleanText(input.street);
  const city = cleanText(input.city);
  const state = normalizeState(input.state);
  const zip5 = normalizeZip5(input.zip);

  return {
    name,
    dbaName: cleanText(input.dbaName),
    nameKey,
    addressKey: addressKey({ street, city, state, zip: zip5 }),
    addressLine1: street,
    city,
    state,
    zip5,
    phone: normalizePhone(input.phone),
    phoneCell: normalizePhone(input.phoneCell),
    email: normalizeEmail(input.email),
    naics: normalizeNaics(input.naics),
    fleetSize: normalizeInt(input.fleetSize),
    employees: normalizeInt(input.employees),
    loanAmount: normalizeAmount(input.loanAmount),
    lender: cleanText(input.lender),
    loanStatus: cleanText(input.loanStatus),
    approvedOn: normalizeDate(input.approvedOn),
    sourceRecordId: cleanText(input.sourceRecordId),
  };
}
