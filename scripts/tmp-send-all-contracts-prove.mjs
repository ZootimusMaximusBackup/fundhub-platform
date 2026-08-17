#!/usr/bin/env node
/**
 * COMPLIANCE REVIEW REQUIRED — creates + sends every active contract template
 * to the Chris ProveFunding test client, then tries to notify signers by email.
 *
 * Usage: node scripts/tmp-send-all-contracts-prove.mjs
 */
import { loadEnv } from "./load-env.mjs";
loadEnv();

import { db } from "../src/db.mjs";
import { listTemplates, createDraft, send } from "../src/contracts/index.mjs";

const CLIENT_ID = process.env.PROVE_CLIENT_ID || "9af65808-a619-4e65-ae91-239766a006b7";
const BASE_URL = (process.env.PUBLIC_BASE_URL || "https://fundhub.ai").replace(/\/$/, "");

async function main() {
  const client = (
    await db.query(
      `SELECT id, org_id, first_name, last_name, email, phone
         FROM clients WHERE id = $1::uuid LIMIT 1`,
      [CLIENT_ID]
    )
  ).rows[0];
  if (!client) throw new Error(`prove client not found: ${CLIENT_ID}`);

  const staff = (
    await db.query(
      `SELECT id, name, email FROM staff
        WHERE org_id = $1::uuid AND role = 'owner' AND status = 'active'
        ORDER BY created_at ASC LIMIT 1`,
      [client.org_id]
    )
  ).rows[0];
  if (!staff) throw new Error("no active owner staff for org");

  const settings = (
    await db.query(
      `SELECT outbound_enabled FROM messaging_settings WHERE org_id = $1::uuid LIMIT 1`,
      [client.org_id]
    )
  ).rows[0];

  const templates = await listTemplates(db, { orgId: client.org_id, activeOnly: true });
  console.log(JSON.stringify({
    client: {
      id: client.id,
      name: [client.first_name, client.last_name].filter(Boolean).join(" "),
      email: client.email
    },
    staff: { id: staff.id, email: staff.email },
    outbound_enabled: settings?.outbound_enabled ?? null,
    template_count: templates.length,
    base_url: BASE_URL
  }, null, 2));

  const VALUES_BY_KEY = {
    "SOFT-PULL-CONSENT": {
      company_name: "Fundhub",
      consent_days: "90",
      company_email: "support@fundhub.ai"
    },
    "REPAIR-TRIAL-AGREEMENT": {
      company_name: "Fundhub",
      trial_fee: "$200",
      scope: "Prove send — first done-for-you dispute round (placeholder)."
    },
    "CREDIT-REPAIR-AGREEMENT": {
      company_name: "Fundhub",
      monthly_fee: "$1,000",
      term_days: "180",
      scope: "Prove send — full done-for-you credit repair (placeholder)."
    },
    "FUNDING-AGREEMENT": {
      company_name: "Fundhub",
      scope: "Credit repair coordination and funding strategy for ProveFunding (test send).",
      deposit: "$997",
      success_fee: "10% of funded amount",
      fee_due: "within 7 days of funding",
      term_days: "180"
    },
    "REPAIR-AND-FUNDING-AGREEMENT": {
      company_name: "Fundhub",
      deposit: "$3,000",
      repair_fee: "$1,000",
      success_fee: "10% of funded amount",
      fee_due: "within 7 days of funding",
      term_days: "180",
      repair_scope: "Parallel credit repair on limiting bureaus.",
      funding_scope: "Done-for-you funding rounds and inquiry sweeps."
    }
  };

  const results = [];
  for (const t of templates) {
    const row = {
      template_key: t.template_key,
      template_id: t.id,
      name: t.name,
      kind: t.kind,
      source_kind: t.source_kind
    };
    try {
      const values = VALUES_BY_KEY[t.template_key] || {};
      const draft = await createDraft(db, {
        orgId: client.org_id,
        staffId: staff.id,
        clientId: client.id,
        templateId: t.id,
        values,
        title: `${t.name} — prove send ${new Date().toISOString().slice(0, 10)}`
      });
      const out = await send(db, {
        orgId: client.org_id,
        staffId: staff.id,
        id: draft.id,
        baseUrl: BASE_URL
      });
      row.ok = true;
      row.contract_id = out.contract?.id || draft.id;
      row.status = out.contract?.status || null;
      row.sign_url = out.sign_url || out.links?.[0]?.url || null;
      row.notified = out.notified || null;
      row.resent = !!out.resent;
    } catch (e) {
      row.ok = false;
      row.error = e.code || e.name || "error";
      row.message = e.message || String(e);
    }
    results.push(row);
    console.log(row.ok
      ? `OK  ${row.template_key} → ${row.sign_url || row.contract_id}`
      : `FAIL ${row.template_key}: ${row.error} — ${row.message}`);
  }

  const summary = {
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results
  };
  console.log(JSON.stringify(summary, null, 2));
  await db.end?.();
  process.exit(summary.failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try { await db.end?.(); } catch { /* ignore */ }
  process.exit(1);
});
