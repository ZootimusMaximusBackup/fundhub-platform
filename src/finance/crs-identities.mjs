// THE CRS SANDBOX IDENTITY GATE.
//
// This project is sandbox-only. The production host and every unknown host are
// refused. The sandbox host accepts only the three exact synthetic identities
// from the vendor's Postman fixtures. A changed name, birth date, Social
// Security number, email, or address fails before login or an order can leave.
//
// The fixture Social Security numbers are in the 666-xx-xxxx range, which the
// Social Security Administration has never issued. Tests pin that invariant so
// a real identity cannot silently replace one of these fixtures.

export class CrsIdentityError extends Error {
  constructor(message, { status = 400, code = null } = {}) {
    super(message);
    this.name = "CrsIdentityError";
    this.status = status;
    this.code = code;
  }
}

export const CRS_SANDBOX_HOST = "api-sandbox.stitchcredit.com";
export const CRS_PRODUCTION_HOST = "mware.crscreditapi.com";

/** The bureaus this repo orders, in the order it orders them. */
export const BUREAUS = Object.freeze(["TU", "EX", "EQ"]);

/* normalizeHost — "https://Api-Sandbox.StitchCredit.com:443/api" → the hostname.
   Config gets pasted by hand, so a scheme, a port or a trailing path is an
   ordinary thing to find in it. None of those change which machine is being
   talked to, and treating "host with a port" as unrecognised would fail closed
   on a correct value — which teaches people to work around the gate. */
export function normalizeHost(raw) {
  let s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split("/")[0];
  s = s.split("@").pop();
  s = s.replace(/:\d+$/, "");
  return s;
}

export function isSandboxHost(host) {
  return normalizeHost(host) === CRS_SANDBOX_HOST;
}

export function isProductionHost(host) {
  return normalizeHost(host) === CRS_PRODUCTION_HOST;
}

/* CRS ships one canned person per bureau — the sandbox will not return a file
   for Barbara Doty on Equifax. So the identity is per bureau, not per pull, and
   a tri-bureau sandbox pull is three different invented people. That is a
   property of the vendor's fixtures, not a modelling choice, and it is why a
   sandbox pull cannot be read as "this client's tri-merge". */
export const SANDBOX_TEST_IDENTITIES = Object.freeze({
  TU: Object.freeze({
    firstName: "BARBARA",
    middleName: "M",
    lastName: "DOTY",
    suffix: "",
    birthDate: "1966-01-04",
    ssn: "666321120",
    email: "example@atdata.com",
    addresses: Object.freeze([Object.freeze({
      borrowerResidencyType: "Current",
      addressLine1: "1100 LYNHURST LN",
      addressLine2: "",
      city: "DENTON",
      state: "TX",
      postalCode: "762058006"
    })])
  }),
  EX: Object.freeze({
    firstName: "WILLIE",
    middleName: "L",
    lastName: "BOOZE",
    suffix: "",
    birthDate: "1963-11-12",
    ssn: "666265040",
    addresses: Object.freeze([Object.freeze({
      borrowerResidencyType: "Current",
      addressLine1: "5815 KNOLL KREST ST",
      addressLine2: "",
      city: "SAN ANTONIO",
      state: "TX",
      postalCode: "782421118"
    })])
  }),
  EQ: Object.freeze({
    firstName: "JOHN",
    middleName: "V",
    lastName: "BIALOGLOW",
    suffix: "",
    birthDate: "1958-12-04",
    ssn: "666154480",
    addresses: Object.freeze([Object.freeze({
      borrowerResidencyType: "Current",
      addressLine1: "2224 AHAMAKA RD",
      addressLine2: "",
      city: "WAHIAWA",
      state: "HI",
      postalCode: "967865236"
    })])
  })
});

/** The SSA has never issued an SSN beginning 666, and has said it never will. */
export const NEVER_ISSUED_SSN_PREFIX = "666";

export function ssnDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

/* Exact comparison of every field that can be sent to CRS. Formatting an SSN
   with dashes is harmless; every other fixture value must match verbatim. */
export function matchesSandboxIdentity(bureau, identity) {
  const canned = SANDBOX_TEST_IDENTITIES[bureau];
  if (!canned || !identity) return false;

  const comparable = (value) => ({
    firstName: String(value?.firstName ?? ""),
    middleName: String(value?.middleName ?? ""),
    lastName: String(value?.lastName ?? ""),
    suffix: String(value?.suffix ?? ""),
    birthDate: String(value?.birthDate ?? ""),
    ssn: ssnDigits(value?.ssn),
    email: String(value?.email ?? ""),
    addresses: (Array.isArray(value?.addresses) ? value.addresses : []).map((address) => ({
      borrowerResidencyType: String(address?.borrowerResidencyType ?? ""),
      addressLine1: String(address?.addressLine1 ?? ""),
      addressLine2: String(address?.addressLine2 ?? ""),
      city: String(address?.city ?? ""),
      state: String(address?.state ?? ""),
      postalCode: String(address?.postalCode ?? "")
    }))
  });

  return JSON.stringify(comparable(identity)) === JSON.stringify(comparable(canned));
}

/** Which sandbox fixture, if any, this identity is. Null for a real person. */
export function sandboxBureauFor(identity) {
  if (!identity) return null;
  const ssn = ssnDigits(identity.ssn);
  if (!ssn) return null;
  for (const bureau of BUREAUS) {
    if (ssnDigits(SANDBOX_TEST_IDENTITIES[bureau].ssn) === ssn) return bureau;
  }
  return null;
}

/**
 * assertIdentityAllowed — the gate. Throws, or returns nothing.
 *
 * Called by the CRS client on EVERY order, not by the code that chooses the
 * identity. That is deliberate: the chooser can be bypassed by a new caller,
 * and the point of this function is that no caller can reach the network
 * without passing it.
 */
export function assertIdentityAllowed({ host, bureau, identity } = {}) {
  const h = normalizeHost(host);

  if (isProductionHost(h)) {
    throw new CrsIdentityError(
      "refusing the CRS production host — this client is sandbox-only",
      { status: 500, code: "production_host_refused" }
    );
  }
  if (!isSandboxHost(h)) {
    throw new CrsIdentityError(
      `refusing an unrecognised CRS host ${JSON.stringify(h || "")} — ` +
      `CRS_API_HOST must be ${CRS_SANDBOX_HOST}`,
      { status: 500, code: "unknown_host" }
    );
  }
  if (!BUREAUS.includes(bureau)) {
    throw new CrsIdentityError(
      `bureau must be one of: ${BUREAUS.join(", ")}`,
      { status: 400, code: "unknown_bureau" }
    );
  }
  if (!identity || !ssnDigits(identity.ssn)) {
    throw new CrsIdentityError(
      "an identity with an SSN is required to order a credit report",
      { status: 400, code: "identity_required" }
    );
  }
  if (!matchesSandboxIdentity(bureau, identity)) {
    throw new CrsIdentityError(
      `refusing a non-test identity on the CRS sandbox — only the exact ` +
      `published ${bureau} fixture is allowed`,
      { status: 400, code: "identity_not_allowed_on_sandbox" }
    );
  }
}

/** Select the vendor fixture for a sandbox bureau. Every other host fails. */
export function identityForBureau({ host, bureau } = {}) {
  if (!BUREAUS.includes(bureau)) {
    throw new CrsIdentityError(
      `bureau must be one of: ${BUREAUS.join(", ")}`,
      { status: 400, code: "unknown_bureau" }
    );
  }
  if (isSandboxHost(host)) return SANDBOX_TEST_IDENTITIES[bureau];
  if (isProductionHost(host)) {
    throw new CrsIdentityError(
      "refusing the CRS production host — this client is sandbox-only",
      { status: 500, code: "production_host_refused" }
    );
  }
  throw new CrsIdentityError(
    `unrecognised CRS host ${JSON.stringify(normalizeHost(host) || "")}`,
    { status: 500, code: "unknown_host" }
  );
}
