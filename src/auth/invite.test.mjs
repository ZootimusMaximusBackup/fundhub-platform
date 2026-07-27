import { test } from "node:test";
import assert from "node:assert";
import {
  inviteStaff, acceptInvite, resetPassword, requestPasswordReset,
  setPasswordWithToken, suspendStaff, roleIsKnown, INVITER_ROLES
} from "./invite.mjs";
import { hashToken } from "./session.mjs";
import { verifyPassword } from "./hash.mjs";
import { _resetOrgCache } from "./org.mjs";

const OWNER = { id: "owner-1", org_id: "org-1", role: "owner" };
const PASSWORD = "a perfectly fine passphrase";

function fakeDb({ existingStaff = null, catalogShape = true, roleKnown = true, consumed = undefined } = {}) {
  const calls = [];
  return {
    calls,
    stmts: () => calls.map((c) => c.sql),
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/information_schema\.columns/.test(sql)) return { rows: [{ ok: catalogShape }] };
      if (/FROM staff_roles/.test(sql)) return { rows: roleKnown ? [{ "?column?": 1 }] : [] };
      if (/SELECT id, status, name, role FROM staff/.test(sql)) return { rows: existingStaff ? [existingStaff] : [] };
      if (/SELECT id, status FROM staff/.test(sql)) return { rows: existingStaff ? [existingStaff] : [] };
      if (/INSERT INTO staff /.test(sql)) {
        return { rows: [{ id: "staff-new", email: params[3], name: params[1], role: params[2], status: "invited" }] };
      }
      if (/UPDATE staff\s+SET name/.test(sql)) {
        return { rows: [{ id: existingStaff?.id, email: "x@y.z", name: params[1], role: params[2], status: "invited" }] };
      }
      if (/UPDATE password_resets\s+SET used_at = now\(\)\s+WHERE token_hash/.test(sql)) {
        return { rows: consumed === undefined ? [{ staff_id: "staff-1", org_id: "org-1", kind: params[1] || "invite" }] : (consumed ? [consumed] : []) };
      }
      if (/UPDATE staff\s+SET password_hash/.test(sql)) {
        return { rows: [{ id: "staff-1", org_id: "org-1", email: "a@b.c", name: "A", role: "closer", status: "active" }] };
      }
      if (/UPDATE staff SET status = 'suspended'/.test(sql)) {
        return { rows: existingStaff === null ? [] : [{ id: params[0], email: "a@b.c", status: "suspended" }] };
      }
      return { rows: [] };
    }
  };
}

// ---------------------------------------------------------------- invites

test("only owner/admin may invite", async () => {
  _resetOrgCache();
  assert.deepEqual(INVITER_ROLES, ["owner", "admin"]);
  for (const role of ["closer", "funding_advisor", "setter", "", null, undefined]) {
    const out = await inviteStaff(fakeDb(), { actor: { id: "s", org_id: "org-1", role }, email: "new@fundhub.test" });
    assert.equal(out.status, 403, `role ${String(role)} must not invite`);
  }
  const noActor = await inviteStaff(fakeDb(), { email: "new@fundhub.test" });
  assert.equal(noActor.status, 403);
  for (const role of ["owner", "admin", "OWNER", " Admin "]) {
    const out = await inviteStaff(fakeDb(), { actor: { id: "s", org_id: "org-1", role: role.trim() }, email: "new@fundhub.test" });
    assert.equal(out.ok, true, `role ${role} should invite`);
  }
});

test("an owner cannot invite into another org", async () => {
  _resetOrgCache();
  const out = await inviteStaff(fakeDb(), {
    actor: { id: "o", org_id: "org-OTHER", role: "owner" }, email: "new@fundhub.test"
  });
  assert.equal(out.status, 403);
});

test("invite creates an invited staff row with NO password and returns one token", async () => {
  _resetOrgCache();
  const db = fakeDb();
  const out = await inviteStaff(db, { actor: OWNER, email: " New.Hire@FundHub.TEST ", name: "New Hire", role: "closer" });

  assert.equal(out.ok, true);
  assert.match(out.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(out.staff.status, "invited");

  const insertStaff = db.calls.find((c) => /INSERT INTO staff /.test(c.sql));
  assert.equal(insertStaff.params[3], "new.hire@fundhub.test", "email normalised");
  assert.match(insertStaff.sql, /VALUES \(\$1,\$2,\$3,\$4,'invited'\)/);
  assert.ok(!/password_hash/.test(insertStaff.sql), "an invite never sets a password");

  const insertToken = db.calls.find((c) => /INSERT INTO password_resets/.test(c.sql));
  assert.equal(insertToken.params[2], hashToken(out.token), "stores the hash");
  assert.equal(insertToken.params[0], "org-1");
  assert.ok(!JSON.stringify(insertToken.params).includes(out.token), "cleartext token never bound");
});

test("invite rejects a bad email and an unknown role", async () => {
  _resetOrgCache();
  for (const email of ["", "   ", "no-at-sign", null]) {
    const out = await inviteStaff(fakeDb(), { actor: OWNER, email });
    assert.equal(out.status, 400, `email ${String(email)}`);
  }
  const unknown = await inviteStaff(fakeDb({ roleKnown: false }), { actor: OWNER, email: "a@b.co", role: "wizard" });
  assert.equal(unknown.error, "unknown_role");
});

test("role validation is skipped when the catalog is absent or foreign-shaped", async () => {
  _resetOrgCache();
  const out = await inviteStaff(fakeDb({ catalogShape: false, roleKnown: false }), {
    actor: OWNER, email: "a@b.co", role: "anything"
  });
  assert.equal(out.ok, true, "a differently-shaped staff_roles must not block onboarding");
  assert.equal(await roleIsKnown(fakeDb({ catalogShape: false }), "org-1", "closer"), null);
  assert.equal(await roleIsKnown(fakeDb({ roleKnown: true }), "org-1", "closer"), true);
  assert.equal(await roleIsKnown(fakeDb({ roleKnown: false }), "org-1", "nope"), false);
  assert.equal(await roleIsKnown(fakeDb(), "org-1", null), null);
});

test("re-inviting an ACTIVE account is refused — that would be a covert reset", async () => {
  _resetOrgCache();
  const out = await inviteStaff(fakeDb({ existingStaff: { id: "staff-9", status: "active" } }), {
    actor: OWNER, email: "dana@fundhub.test"
  });
  assert.equal(out.status, 409);
  assert.equal(out.error, "already_active");
});

test("re-inviting an invited account reuses the row and kills the older token", async () => {
  _resetOrgCache();
  const db = fakeDb({ existingStaff: { id: "staff-9", status: "invited", name: "Old", role: "closer" } });
  const out = await inviteStaff(db, { actor: OWNER, email: "dana@fundhub.test", name: "New" });
  assert.equal(out.ok, true);
  assert.ok(!db.stmts().some((s) => /INSERT INTO staff /.test(s)), "no duplicate staff row");
  const invalidate = db.calls.find((c) => /UPDATE password_resets SET used_at/.test(c.sql) && /kind = 'invite'/.test(c.sql));
  assert.ok(invalidate, "previous unused invites are burned");
});

// ------------------------------------------------------- accept / reset

test("acceptInvite sets a hashed password and only accepts invite tokens", async () => {
  const db = fakeDb({ consumed: { staff_id: "staff-1", org_id: "org-1", kind: "invite" } });
  const out = await acceptInvite(db, { token: "t".repeat(43), password: PASSWORD });
  assert.equal(out.ok, true);

  const consume = db.calls.find((c) => /UPDATE password_resets/.test(c.sql) && /token_hash = \$1/.test(c.sql));
  assert.equal(consume.params[1], "invite", "an invite endpoint will not redeem a reset token");
  assert.match(consume.sql, /used_at IS NULL/, "single use");
  assert.match(consume.sql, /expires_at > now\(\)/, "expiring");

  const update = db.calls.find((c) => /UPDATE staff\s+SET password_hash/.test(c.sql));
  const stored = update.params[1];
  assert.match(stored, /^\$scrypt\$/);
  assert.notEqual(stored, PASSWORD);
  assert.equal(await verifyPassword(PASSWORD, stored), true, "the stored verifier really is this password");
});

test("resetPassword narrows to reset tokens", async () => {
  const db = fakeDb({ consumed: { staff_id: "staff-1", org_id: "org-1", kind: "reset" } });
  await resetPassword(db, { token: "t".repeat(43), password: PASSWORD });
  const consume = db.calls.find((c) => /UPDATE password_resets/.test(c.sql) && /token_hash = \$1/.test(c.sql));
  assert.equal(consume.params[1], "reset");
});

test("setting a password revokes every existing session", async () => {
  const db = fakeDb({ consumed: { staff_id: "staff-1", org_id: "org-1", kind: "reset" } });
  await resetPassword(db, { token: "t".repeat(43), password: PASSWORD });
  assert.ok(db.stmts().some((s) => /UPDATE sessions SET revoked_at/.test(s)));
});

test("a used, expired or wrong-kind token is refused", async () => {
  const db = fakeDb({ consumed: null });
  const out = await setPasswordWithToken(db, { token: "t".repeat(43), password: PASSWORD });
  assert.equal(out.ok, false);
  assert.equal(out.status, 400);
  assert.equal(out.error, "invalid_or_expired_token");
  assert.ok(!db.stmts().some((s) => /UPDATE staff\s+SET password_hash/.test(s)), "no password written");
});

test("a weak password is refused before the token is consumed", async () => {
  const db = fakeDb();
  const out = await setPasswordWithToken(db, { token: "t".repeat(43), password: "short" });
  assert.equal(out.error, "weak_password");
  assert.match(out.detail, /at least 12/);
  assert.equal(db.calls.length, 0, "a rejected password must not burn the token");
});

test("a missing token is a 400", async () => {
  for (const token of [null, "", undefined, 42]) {
    const out = await setPasswordWithToken(fakeDb(), { token, password: PASSWORD });
    assert.equal(out.error, "token_required");
  }
});

test("redeeming a token cannot reactivate a suspended account", async () => {
  const db = fakeDb({ consumed: { staff_id: "staff-1", org_id: "org-1", kind: "reset" } });
  await resetPassword(db, { token: "t".repeat(43), password: PASSWORD });
  const update = db.calls.find((c) => /UPDATE staff\s+SET password_hash/.test(c.sql));
  assert.match(update.sql, /CASE WHEN status = 'suspended' THEN status ELSE 'active' END/);
});

// ------------------------------------------------------------- resets

test("requestPasswordReset never reveals whether the address exists", async () => {
  _resetOrgCache();
  const missing = await requestPasswordReset(fakeDb({ existingStaff: null }), { email: "ghost@fundhub.test" });
  assert.deepEqual(missing, { ok: true, token: null });

  _resetOrgCache();
  const suspended = await requestPasswordReset(fakeDb({ existingStaff: { id: "s", status: "suspended" } }), { email: "x@y.z" });
  assert.deepEqual(suspended, { ok: true, token: null }, "suspended staff cannot reset their way back in");

  _resetOrgCache();
  const real = await requestPasswordReset(fakeDb({ existingStaff: { id: "s", status: "active" } }), { email: "x@y.z" });
  assert.equal(real.ok, true);
  assert.match(real.token, /^[A-Za-z0-9_-]{43}$/);
});

test("a new reset token burns any earlier unused one", async () => {
  _resetOrgCache();
  const db = fakeDb({ existingStaff: { id: "s", status: "active" } });
  await requestPasswordReset(db, { email: "x@y.z" });
  assert.ok(db.calls.some((c) => /UPDATE password_resets SET used_at/.test(c.sql) && /kind = 'reset'/.test(c.sql)));
});

// ------------------------------------------------------------ suspend

test("suspendStaff requires owner/admin, refuses self, and kills sessions", async () => {
  const denied = await suspendStaff(fakeDb(), { actor: { role: "closer" }, staffId: "x" });
  assert.equal(denied.status, 403);

  const self = await suspendStaff(fakeDb(), { actor: OWNER, staffId: OWNER.id });
  assert.equal(self.status, 400);
  assert.equal(self.error, "cannot_suspend_self");

  const db = fakeDb({ existingStaff: { id: "staff-9" } });
  const out = await suspendStaff(db, { actor: OWNER, staffId: "staff-9" });
  assert.equal(out.ok, true);
  assert.ok(db.stmts().some((s) => /UPDATE sessions SET revoked_at/.test(s)), "live sessions die with the account");

  const missing = await suspendStaff(fakeDb({ existingStaff: null }), { actor: OWNER, staffId: "nope" });
  assert.equal(missing.status, 404);
});
