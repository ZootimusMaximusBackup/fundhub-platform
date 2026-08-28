import { test } from "node:test";
import assert from "node:assert";
import {
  newToken, hashToken, normalizeIp, ttlMs, DEFAULT_TTL_MS,
  createSession, verifySession, revokeSession, revokeAllForStaff, expireSessions
} from "./session.mjs";
import { _resetOrgCache } from "./org.mjs";

// Fake db: records every statement so tests can assert on what was sent.
function fakeDb(handlers = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      for (const [re, rows] of handlers) if (re.test(sql)) return { rows: typeof rows === "function" ? rows(params) : rows };
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      return { rows: [] };
    }
  };
}

test("tokens are 32 random bytes, never sequential", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const t = newToken();
    assert.equal(Buffer.from(t, "base64url").length, 32, "must be 32 bytes of entropy");
    assert.match(t, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(!seen.has(t), "tokens must never repeat");
    seen.add(t);
  }
  // Adjacent tokens must share no common prefix beyond chance.
  const [a, b] = [newToken(), newToken()];
  assert.notEqual(a.slice(0, 8), b.slice(0, 8));
});

test("hashToken is sha256 hex and is not reversible to the token", () => {
  const t = newToken();
  const h = hashToken(t);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(!h.includes(t));
  assert.equal(hashToken(t), h, "stable");
  assert.notEqual(hashToken(newToken()), h);
});

test("normalizeIp keeps valid addresses and nulls anything inet would reject", () => {
  assert.equal(normalizeIp("203.0.113.9"), "203.0.113.9");
  assert.equal(normalizeIp("2001:db8::1"), "2001:db8::1");
  assert.equal(normalizeIp("203.0.113.9, 70.41.3.18"), "203.0.113.9", "first hop of x-forwarded-for");
  assert.equal(normalizeIp("203.0.113.9:44321"), "203.0.113.9", "strips port");
  assert.equal(normalizeIp("[2001:db8::1]"), "2001:db8::1", "unwraps brackets");
  assert.equal(normalizeIp("not-an-ip"), null);
  assert.equal(normalizeIp(""), null);
  assert.equal(normalizeIp(null), null);
  assert.equal(normalizeIp(undefined), null);
});

test("ttl defaults to 7 days and honours SESSION_TTL_DAYS", () => {
  assert.equal(ttlMs({}), DEFAULT_TTL_MS);
  assert.equal(ttlMs({}), 7 * 24 * 60 * 60 * 1000);
  assert.equal(ttlMs({ SESSION_TTL_DAYS: "1" }), 24 * 60 * 60 * 1000);
  assert.equal(ttlMs({ SESSION_TTL_DAYS: "0" }), DEFAULT_TTL_MS, "0 falls back, never a zero-length session");
  assert.equal(ttlMs({ SESSION_TTL_DAYS: "garbage" }), DEFAULT_TTL_MS);
  assert.equal(ttlMs({ SESSION_TTL_DAYS: "-5" }), DEFAULT_TTL_MS);
});

test("createSession stores the token HASH, never the token", async () => {
  _resetOrgCache();
  const db = fakeDb([[/INSERT INTO sessions/, [{ id: "sess-1", expires_at: new Date() }]]]);
  const { token } = await createSession(db, { staffId: "staff-1", ip: "203.0.113.9", userAgent: "UA/1.0" });

  const insert = db.calls.find((c) => /INSERT INTO sessions/.test(c.sql));
  assert.ok(insert, "session row written");
  assert.ok(insert.params.includes(hashToken(token)), "stores sha256(token)");
  for (const p of insert.params) {
    assert.notEqual(p, token, "the cleartext token must never be a bound parameter");
  }
  assert.ok(!JSON.stringify(insert.params).includes(token), "cleartext token absent from the statement");
});

test("createSession sets expiry from the TTL and normalises the ip", async () => {
  _resetOrgCache();
  const db = fakeDb([[/INSERT INTO sessions/, [{ id: "s", expires_at: new Date() }]]]);
  const before = Date.now();
  await createSession(db, { staffId: "staff-1", ip: "bogus-ip", userAgent: "x".repeat(900) });
  const insert = db.calls.find((c) => /INSERT INTO sessions/.test(c.sql));
  const expiresAt = insert.params[3];
  assert.ok(expiresAt instanceof Date);
  assert.ok(expiresAt.getTime() - before >= DEFAULT_TTL_MS - 1000);
  assert.equal(insert.params[4], null, "unparseable ip becomes NULL rather than breaking the insert");
  assert.equal(insert.params[5].length, 512, "user agent truncated");
});

test("createSession refuses without a staff id", async () => {
  await assert.rejects(() => createSession(fakeDb(), {}), /staffId required/);
});

test("verifySession rejects empty/garbage tokens without touching the db", async () => {
  const db = fakeDb();
  for (const t of [null, undefined, "", 12345, {}]) {
    assert.equal(await verifySession(db, t), null);
  }
  assert.equal(db.calls.length, 0, "no query issued for an obviously invalid token");
});

test("verifySession looks the session up by hash and slides expiry in one statement", async () => {
  const token = newToken();
  const db = fakeDb([[/WITH live AS/, [{
    session_id: "sess-1", expires_at: new Date(), staff_id: "staff-1", org_id: "org-1",
    role: "closer", email: "a@b.com", name: "A", status: "active", active_flag: null
  }]]]);
  const out = await verifySession(db, token);
  const q = db.calls[0];
  assert.match(q.sql, /UPDATE sessions/, "the lookup and the slide are the same statement");
  assert.match(q.sql, /expires_at > now\(\)/, "expired rows cannot match");
  assert.match(q.sql, /revoked_at IS NULL/, "revoked rows cannot match");
  assert.equal(q.params[0], hashToken(token));
  assert.deepEqual(out.staff, {
    id: "staff-1", org_id: "org-1", role: "closer", email: "a@b.com", name: "A", status: "active",
    avatarUrl: null
  });
});

test("verifySession projects a set avatar_key into avatarUrl", async () => {
  const token = newToken();
  const db = fakeDb([[/WITH live AS/, [{
    session_id: "sess-1", expires_at: new Date(), staff_id: "staff-1", org_id: "org-1",
    role: "closer", email: "a@b.com", name: "A", status: "active", active_flag: null,
    avatar_key: "netlify-blob://documents/staff-avatars/org-1/staff-1/deadbeef.png"
  }]]]);
  const out = await verifySession(db, token);
  assert.equal(out.staff.avatarUrl, "/api/staff/avatar", "the frontend gets a path, never the raw storage key");
});

test("verifySession returns null when no live row matches", async () => {
  const db = fakeDb([[/WITH live AS/, []]]);
  assert.equal(await verifySession(db, newToken()), null);
});

test("a suspended staff member loses the session on next use", async () => {
  for (const [status, activeFlag] of [["suspended", null], ["invited", null], ["active", "false"]]) {
    const db = fakeDb([[/WITH live AS/, [{
      session_id: "sess-1", expires_at: new Date(), staff_id: "staff-1", org_id: "org-1",
      role: "closer", email: "a@b.com", name: "A", status, active_flag: activeFlag
    }]]]);
    assert.equal(await verifySession(db, newToken()), null, `status=${status} active=${activeFlag}`);
    assert.ok(db.calls.some((c) => /UPDATE sessions SET revoked_at/.test(c.sql)), "session revoked, not just refused");
  }
});

test("revokeSession is by hash and idempotent", async () => {
  const token = newToken();
  const first = fakeDb([[/UPDATE sessions SET revoked_at/, [{ id: "sess-1" }]]]);
  assert.equal(await revokeSession(first, token), true);
  assert.equal(first.calls[0].params[0], hashToken(token));

  const second = fakeDb([[/UPDATE sessions SET revoked_at/, []]]);
  assert.equal(await revokeSession(second, token), false, "second revoke is a no-op, not an error");
  assert.equal(await revokeSession(fakeDb(), null), false);
});

test("revokeAllForStaff kills every live session, optionally sparing one", async () => {
  const db = fakeDb([[/UPDATE sessions SET revoked_at/, [{ id: "a" }, { id: "b" }, { id: "c" }]]]);
  assert.equal(await revokeAllForStaff(db, "staff-1"), 3);
  assert.equal(db.calls[0].params[1], null);

  const db2 = fakeDb([[/UPDATE sessions SET revoked_at/, [{ id: "a" }]]]);
  await revokeAllForStaff(db2, "staff-1", { exceptSessionId: "keep-me" });
  assert.equal(db2.calls[0].params[1], "keep-me");
  assert.equal(await revokeAllForStaff(fakeDb(), null), 0);
});

test("expireSessions deletes past-expiry and long-revoked rows", async () => {
  const db = fakeDb([[/DELETE FROM sessions/, [{ id: "a" }, { id: "b" }]]]);
  assert.equal(await expireSessions(db), 2);
  assert.match(db.calls[0].sql, /expires_at < now\(\)/);
  assert.equal(db.calls[0].params[0], 30);
  await expireSessions(db, { graceDays: 1 });
  assert.equal(db.calls[1].params[0], 1);
});
