/** Insert a clients row using the real schema (first_name/last_name — no name/status). */
export async function insertClient(db, {
  orgId, email, firstName = "Verify", lastName = "Client",
  phone = null, tags = ["e2e_verify"], consentSms = true, outcomeTier = null
}) {
  const { rows } = await db.query(
    `INSERT INTO clients (
       org_id, email, first_name, last_name, phone, tags, consent_sms, outcome_tier
     ) VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8)
     RETURNING *`,
    [orgId, email, firstName, lastName, phone, tags, consentSms, outcomeTier]
  );
  return rows[0];
}
