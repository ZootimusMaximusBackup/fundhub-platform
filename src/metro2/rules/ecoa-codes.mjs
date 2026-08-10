// Exhibit 10 — ECOA Code (Field 37). Knowledge base § 1.10.
//
// Field 37 says what the consumer's legal relationship to the account is. Get
// it wrong and the report attributes someone else's debt to the consumer:
// reporting ECOA 1 (individual, primary contractual responsibility) where the
// consumer is only an authorized user (3) makes the whole tradeline the
// consumer's liability on paper when it is not.
//
// THE OBSOLETE CODES MATTER. 0, 4 and 6 were withdrawn in September 2003 and a
// furnisher still sending them in 2026 is furnishing data the format has not
// accepted for over twenty years. They are kept in this table — marked obsolete
// — precisely so a check can recognise and report one. Delete them and the
// engine goes blind to a real defect.

export const ECOA_CODES = Object.freeze({
  "1": { meaning: "Individual (primary contractual responsibility)", obsolete: false, contractuallyLiable: true },
  "2": { meaning: "Joint contractual liability", obsolete: false, contractuallyLiable: true },
  "3": { meaning: "Authorized user (no contractual responsibility)", obsolete: false, contractuallyLiable: false, authorizedUser: true },
  "5": { meaning: "Co-maker or guarantor", obsolete: false, contractuallyLiable: true },
  "7": { meaning: "Maker (but co-maker/guarantor liable if default)", obsolete: false, contractuallyLiable: true },
  T: { meaning: "Terminated association", obsolete: false, contractuallyLiable: false },
  W: { meaning: "Business/commercial", obsolete: false, contractuallyLiable: true },
  X: { meaning: "Deceased (requires legally-sufficient death notice)", obsolete: false, requiresDeathNotice: true },
  Z: { meaning: "Delete consumer from account", obsolete: false, deletionInstruction: true }
});

/**
 * Withdrawn September 2003 (§ 1.10). Reporting one of these is itself the
 * finding — the format stopped accepting them a generation ago.
 */
export const OBSOLETE_ECOA_CODES = Object.freeze({
  "0": { meaning: "Obsolete — withdrawn September 2003", obsolete: true },
  "4": { meaning: "Obsolete — withdrawn September 2003", obsolete: true },
  "6": { meaning: "Obsolete — withdrawn September 2003", obsolete: true }
});

export const ECOA_OBSOLETE_SINCE = "2003-09";

/** Every code the format has ever carried, current and withdrawn. */
export const ALL_ECOA_CODES = Object.freeze({ ...ECOA_CODES, ...OBSOLETE_ECOA_CODES });

/** The code that removes an authorized user from a bankrupt account (§ 1.10). Drives M2-026. */
export const ECOA_DELETE_CONSUMER = "Z";

/** Authorized user, with no contractual responsibility. */
export const ECOA_AUTHORIZED_USER = "3";

export function isEcoaCode(code) {
  return typeof code === "string" && Object.hasOwn(ALL_ECOA_CODES, code);
}

export function isObsoleteEcoaCode(code) {
  return typeof code === "string" && Object.hasOwn(OBSOLETE_ECOA_CODES, code);
}

export function ecoaDef(code) {
  return isEcoaCode(code) ? ALL_ECOA_CODES[code] : null;
}
