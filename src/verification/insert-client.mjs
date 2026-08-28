/** Insert a clients row using the real schema (first_name/last_name — no name/status). */
export async function insertClient(db, {
  orgId, email, firstName = "Verify", lastName = "Client",
  phone = null, tags = ["e2e_verify"], consentSms = true, outcomeTier = null
}) {
  const { rows } = await db.query(
    // is_demo is ALWAYS true here, and is not a caller option. Every client this
    // function makes is a verification fixture; there is no legitimate reason for
    // the harness to produce a row the system will treat as a real customer.
    //
    // It was missing until 2026-08-27, and by then 101 of 153 clients in the
    // production database were harness leftovers that every screen, report and
    // export counted as real — along with 1,583 of their messages, documents,
    // payment links and contracts. The wipe (teardownSimulated) could not touch
    // any of it, because that function only deletes clients where is_demo is set.
    // Flag it at birth and the cleanup path works on its own.
    `INSERT INTO clients (
       org_id, email, first_name, last_name, phone, tags, consent_sms, outcome_tier,
       is_demo
     ) VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,true)
     RETURNING *`,
    [orgId, email, firstName, lastName, phone, tags, consentSms, outcomeTier]
  );
  return rows[0];
}
