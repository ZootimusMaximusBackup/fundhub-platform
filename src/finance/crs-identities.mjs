// THE CRS IDENTITY GATE.
//
// Two keys open a live pull: CRS_API_HOST must be the production host, AND
// CRS_ALLOW_LIVE must be an explicit on value (1 / true / yes / on). Missing
// either one fails closed. Same shape as the messaging fence — one forgotten
// env value is how a real pull happens on someone's file by mistake.
//
// The sandbox host never needs CRS_ALLOW_LIVE. It accepts only the three exact
// synthetic identities from the vendor's Postman fixtures. A changed name,
// birth date, Social Security number, email, or address fails before login or
// an order can leave.
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

/** The bureaus this repo can order. Live order list is `activeBureausFromEnv`. */
export const BUREAUS = Object.freeze(["TU", "EX", "EQ"]);

/** Live soft-pull bureau list. Unset = TU+EX+EQ. Owner 2026-08-24: TU on. */
export function activeBureausFromEnv(env = process.env) {
  const raw = env?.CRS_ACTIVE_BUREAUS;
  if (raw == null || String(raw).trim() === "") return [...BUREAUS];
  const picked = String(raw)
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((b) => BUREAUS.includes(b));
  return picked.length ? picked : [...BUREAUS];
}

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

/** Calendar date for CRS, or null. Never "Sat Sep 02".
 *  Postgres DATE comes back as a Date; String(date).slice(0,10) is weekday text
 *  and the bureau rejects it. Only YYYY-MM-DD leaves this function. */
export function isoBirthDate(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const day = value.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
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

/** Env var that must be an explicit on value before the production host is reachable. */
export const CRS_ALLOW_LIVE = "CRS_ALLOW_LIVE";

/** Explicit on values only. Missing, empty, or anything else fails closed. */
const MEANS_LIVE = new Set(["1", "true", "yes", "on"]);

/**
 * livePullAllowed — true only when CRS_ALLOW_LIVE is an explicit on value.
 * Unset, empty, "0", "false", "maybe", or typos all mean no.
 */
export function livePullAllowed(env = process.env) {
  const raw = env?.[CRS_ALLOW_LIVE];
  if (raw === undefined || raw === null || String(raw).trim() === "") return false;
  return MEANS_LIVE.has(String(raw).trim().toLowerCase());
}

/**
 * assertIdentityAllowed — the gate. Throws, or returns nothing.
 *
 * Called by the CRS client on EVERY order, not by the code that chooses the
 * identity. That is deliberate: the chooser can be bypassed by a new caller,
 * and the point of this function is that no caller can reach the network
 * without passing it.
 *
 * Production also requires CRS_ALLOW_LIVE. Host alone is never enough.
 */
export function assertIdentityAllowed({
  host, bureau, identity, env = process.env
} = {}) {
  const h = normalizeHost(host);

  if (isProductionHost(h)) {
    if (!livePullAllowed(env)) {
      throw new CrsIdentityError(
        "refusing the CRS production host — CRS_ALLOW_LIVE is not explicitly on",
        { status: 500, code: "production_host_refused" }
      );
    }
  } else if (!isSandboxHost(h)) {
    throw new CrsIdentityError(
      `refusing an unrecognised CRS host ${JSON.stringify(h || "")} — ` +
      `CRS_API_HOST must be ${CRS_SANDBOX_HOST} (or ${CRS_PRODUCTION_HOST} with CRS_ALLOW_LIVE on)`,
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

  if (isSandboxHost(h)) {
    if (!matchesSandboxIdentity(bureau, identity)) {
      throw new CrsIdentityError(
        `refusing a non-test identity on the CRS sandbox — only the exact ` +
        `published ${bureau} fixture is allowed`,
        { status: 400, code: "identity_not_allowed_on_sandbox" }
      );
    }
    return;
  }

  // Production host + CRS_ALLOW_LIVE on. Test fixtures must never leave sandbox.
  if (sandboxBureauFor(identity)) {
    throw new CrsIdentityError(
      "refusing a sandbox test identity on the CRS production host",
      { status: 400, code: "test_identity_on_production" }
    );
  }

  if (!isoBirthDate(identity.birthDate)) {
    throw new CrsIdentityError(
      "refusing a credit pull — date of birth is missing or not YYYY-MM-DD",
      { status: 400, code: "dob_invalid" }
    );
  }
}

/**
 * identityForBureau — sandbox fixture, or the real identity on a live host.
 *
 * Sandbox ignores any provided identity and returns the vendor fixture.
 * Production returns the provided identity only when CRS_ALLOW_LIVE is on.
 */
export function identityForBureau({
  host, bureau, identity = null, env = process.env
} = {}) {
  if (!BUREAUS.includes(bureau)) {
    throw new CrsIdentityError(
      `bureau must be one of: ${BUREAUS.join(", ")}`,
      { status: 400, code: "unknown_bureau" }
    );
  }
  if (isSandboxHost(host)) return SANDBOX_TEST_IDENTITIES[bureau];
  if (isProductionHost(host)) {
    if (!livePullAllowed(env)) {
      throw new CrsIdentityError(
        "refusing the CRS production host — CRS_ALLOW_LIVE is not explicitly on",
        { status: 500, code: "production_host_refused" }
      );
    }
    if (!identity || !ssnDigits(identity.ssn)) return null;
    const birthDate = isoBirthDate(identity.birthDate);
    const normalized = { ...identity, birthDate };
    assertIdentityAllowed({ host, bureau, identity: normalized, env });
    return normalized;
  }
  throw new CrsIdentityError(
    `unrecognised CRS host ${JSON.stringify(normalizeHost(host) || "")}`,
    { status: 500, code: "unknown_host" }
  );
}
