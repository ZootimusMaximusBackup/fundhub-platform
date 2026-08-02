// Shared fixture for messaging *.pg.test.mjs files that need the memory provider.
//
// WHY THIS EXISTS. Three suites used to UPDATE the default org's
// message_channel_routing to provider='memory' and "restore" in after(). That
// restore is not safe under concurrent file runs: suite A saves ghl_relay, suite
// B then saves memory (A already flipped it), A restores ghl_relay, B restores
// memory — and the live default org is left pointing at a no-op provider. That
// already happened once against a shared database.
//
// THE FIX. Each suite gets its OWN org. Memory routing is inserted for that org
// only and deleted on teardown. The default org's rows are never touched.
//
// outbox.pg.test.mjs and notify.pg.test.mjs already did this; this module is the
// shared form so the next suite cannot invent a third, weaker pattern.

/**
 * Create (or reuse by slug) an org whose sms/email channels route to `memory`.
 * Optionally copies compliance_rules from the default org — needed when the
 * suite asserts restricted-wording blocks that only exist as seeded rows.
 *
 * @returns {{ orgId: string, staffId: string }}
 */
export async function createMemoryRoutedOrg(db, {
  slug,
  name,
  staffEmail,
  staffName = "Pg Test Staff",
  channels = ["sms", "email"],
  copyComplianceRules = false
} = {}) {
  if (!slug || !name || !staffEmail) {
    throw new Error("createMemoryRoutedOrg requires slug, name, and staffEmail");
  }

  const orgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,$2)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [slug, name]
  )).rows[0].id;

  const existingStaff = await db.query(
    `SELECT id FROM staff WHERE org_id = $1 AND lower(email) = lower($2) LIMIT 1`,
    [orgId, staffEmail]
  );
  const staffId = existingStaff.rows[0]
    ? existingStaff.rows[0].id
    : (await db.query(
        `INSERT INTO staff (org_id, name, role, email, status)
         VALUES ($1,$2,'owner',$3,'active') RETURNING id`,
        [orgId, staffName, staffEmail]
      )).rows[0].id;

  for (const channel of channels) {
    await db.query(
      `INSERT INTO message_channel_routing (org_id, channel, provider, enabled)
       VALUES ($1,$2,'memory',true)
       ON CONFLICT (org_id, channel) DO UPDATE SET provider = 'memory', enabled = true`,
      [orgId, channel]
    );
  }

  if (copyComplianceRules) {
    await db.query(
      `INSERT INTO compliance_rules
         (org_id, rule_set, rule_key, offer_types, platforms, match_type,
          pattern, severity, message, citation, active)
       SELECT $1, rule_set, rule_key, offer_types, platforms, match_type,
              pattern, severity, message, citation, active
         FROM compliance_rules
        WHERE org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)
       ON CONFLICT (org_id, rule_set, rule_key) DO NOTHING`,
      [orgId]
    );
  }

  return { orgId, staffId };
}

/**
 * Remove routing rows and the org itself. Callers must delete dependent rows
 * (clients, messages, sessions, …) first — FK order varies by suite.
 */
export async function destroyMemoryRoutedOrg(db, { orgId, slug } = {}) {
  if (orgId) {
    await db.query(`DELETE FROM message_channel_routing WHERE org_id = $1`, [orgId]);
    await db.query(`DELETE FROM compliance_rules WHERE org_id = $1`, [orgId]);
    await db.query(`DELETE FROM message_templates WHERE org_id = $1`, [orgId]);
    await db.query(`DELETE FROM messaging_settings WHERE org_id = $1`, [orgId]);
    await db.query(`DELETE FROM staff WHERE org_id = $1`, [orgId]);
    await db.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
  } else if (slug) {
    await db.query(
      `DELETE FROM message_channel_routing WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`,
      [slug]
    );
    await db.query(
      `DELETE FROM compliance_rules WHERE org_id IN (SELECT id FROM orgs WHERE slug = $1)`,
      [slug]
    );
    await db.query(`DELETE FROM orgs WHERE slug = $1`, [slug]);
  }
}
