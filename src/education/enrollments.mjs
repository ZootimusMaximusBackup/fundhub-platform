// Education enrollment requests — the only place rows in `education_enrollments`
// are written or read.
//
// A row here is a REQUEST to enroll, nothing more. It is not a payment, not a
// purchase and not access to any course. Nothing in this repo grants a student
// portal today: there is no lessons table, no player, no entitlement check.
// Do not add code that implies otherwise.
//
// Table: db/migrations/245_education_enrollments.sql.

/** The two program keys /education/ actually sells. Taken from the <select> on
 *  public/education/enroll/index.html, which is the only place a visitor can
 *  choose one. Anything else is a bad request, not a new program — a typo or a
 *  hand-crafted POST must not quietly create a third product. */
export const PROGRAMS = Object.freeze(["credit-mastery", "capital-strategy"]);

export const isProgram = (key) => PROGRAMS.includes(String(key || ""));

/** Thrown for input this module refuses. The caller turns it into a 400. */
export class EnrollmentError extends Error {
  constructor(code) {
    super(code);
    this.name = "EnrollmentError";
    this.code = code;
  }
}

const trim = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);

/**
 * Insert one enrollment request and return the stored row.
 *
 * status is left to the column default ('pending_payment'). Nothing here sets
 * it to anything else, because nothing here takes money.
 */
export async function createEnrollment(db, {
  orgId,
  clientId = null,
  program,
  fullName = null,
  email,
  phone = null,
  smsConsent = false,
  pageUrl = null
} = {}) {
  if (!orgId) throw new EnrollmentError("org_required");
  if (!isProgram(program)) throw new EnrollmentError("unknown_program");

  const addr = trim(email, 160);
  if (!addr) throw new EnrollmentError("email_required");

  const { rows } = await db.query(
    `INSERT INTO education_enrollments
       (org_id, client_id, program, full_name, email, phone, sms_consent, page_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      orgId,
      clientId || null,
      String(program),
      trim(fullName, 120),
      addr.toLowerCase(),
      trim(phone, 40),
      !!smsConsent,
      trim(pageUrl, 500)
    ]
  );
  return rows[0];
}

/**
 * Every enrollment request made from ONE address inside ONE company.
 *
 * orgId is required and is part of the WHERE on purpose: without it this would
 * read across every tenant, and the endpoint that writes these rows is public.
 * There is no "list all enrollments" function here for the same reason.
 */
export async function listEnrollmentsForEmail(db, orgId, email) {
  const addr = trim(email, 160);
  if (!orgId || !addr) return [];
  const { rows } = await db.query(
    `SELECT * FROM education_enrollments
      WHERE org_id = $1 AND lower(email) = $2
      ORDER BY created_at DESC`,
    [orgId, addr.toLowerCase()]
  );
  return rows;
}
