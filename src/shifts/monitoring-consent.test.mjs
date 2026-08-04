import { test } from "node:test";
import assert from "node:assert";
import { grantMonitoringConsent, revokeMonitoringConsent, CONSENT_FORM_VERSION } from "./monitoring-consent.mjs";

function fakeDb(row) {
  return {
    async query(sql, params) {
      if (/monitoring_consent_at = now/.test(sql)) {
        return { rows: [{ ...row, id: params[0], org_id: params[1], monitoring_consent_at: "2026-08-04T12:00:00Z" }] };
      }
      if (/monitoring_consent_at = NULL/.test(sql)) {
        return { rows: [{ ...row, id: params[0], org_id: params[1], monitoring_consent_at: null }] };
      }
      return { rows: [] };
    }
  };
}
const BASE = { name: "Jordan", email: "j@x.com", role: "closer", status: "active", hubstaff_user_id: null };

test("grant sets timestamp", async () => {
  const out = await grantMonitoringConsent(fakeDb(BASE), { orgId: "22222222-2222-4222-8222-222222222222", staffId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(out.ok, true);
  assert.equal(out.form_version, CONSENT_FORM_VERSION);
  assert.ok(out.staff.monitoring_consent_at);
});

test("revoke clears to NULL", async () => {
  const out = await revokeMonitoringConsent(fakeDb(BASE), { orgId: "22222222-2222-4222-8222-222222222222", staffId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(out.staff.monitoring_consent_at, null);
});
