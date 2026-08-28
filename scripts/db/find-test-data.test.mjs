// The promise this tool makes is "it will not delete a row it cannot prove is a
// test row". That promise is worth exactly as much as the test below, so the
// test drives main() through a fake database and asserts on the statements it
// actually issued — not on what the report printed.

import { test } from "node:test";
import assert from "node:assert";
import { parseArgs, MARKERS } from "./find-test-data.mjs";

/* A stand-in for src/db.mjs's `db`. Records every statement, and answers the
   two SELECTs by shape: the marked query filters on the markers, the unmarked
   one negates them and takes a days parameter. */
function fakeDb({ marked = [], unmarked = [] } = {}) {
  const statements = [];
  return {
    statements,
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (/^\s*UPDATE clients SET is_demo/.test(sql)) return { rows: [], rowCount: 1 };
      if (/^\s*DELETE/i.test(sql)) return { rows: [], rowCount: 1 };
      if (/FROM clients c/.test(sql)) {
        return { rows: /NOT \(/.test(sql) ? unmarked : marked };
      }
      return { rows: [] };
    },
  };
}

function client(over = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    org_id: "22222222-2222-2222-2222-222222222222",
    email: "someone@example.com", first_name: "Real", last_name: "Person",
    created_at: new Date("2026-08-20T10:00:00Z"),
    messages: 2, documents: 1, contracts: 1, invoices: 0, why: [],
    ...over,
  };
}

const silent = () => { const lines = []; return { lines, log: (s) => lines.push(String(s)), error: (s) => lines.push(String(s)) }; };

async function run(argv, dbh, out) {
  const prev = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://u:p@localhost:5432/scratch";
  try {
    const { main } = await import("./find-test-data.mjs");
    return await main(argv, { dbh, out });
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prev;
  }
}

test("parseArgs defaults to a dry run", () => {
  assert.equal(parseArgs([]).apply, false);
  assert.equal(parseArgs(["--apply"]).apply, true);
  assert.deepEqual(parseArgs(["--client", "a", "--client", "b"]).clients, ["a", "b"]);
  assert.equal(parseArgs(["--days", "7"]).days, 7);
  assert.throws(() => parseArgs(["--nope"]), /unknown option/);
  assert.throws(() => parseArgs(["--days", "x"]), /must be a number/);
});

test("a dry run issues no write of any kind", async () => {
  const dbh = fakeDb({ marked: [client({ why: ["is_demo flag"] })], unmarked: [client({ id: "33333333-3333-3333-3333-333333333333" })] });
  const out = silent();
  assert.equal(await run([], dbh, out), 0);
  const writes = dbh.statements.filter((s) => /UPDATE|DELETE|INSERT/i.test(s.sql));
  assert.deepEqual(writes, [], "a dry run must issue zero writes");
  assert.ok(out.lines.some((l) => /DRY RUN/.test(l)));
});

test("--apply deletes a marked client", async () => {
  const marked = client({ why: ["e2e_verify tag"] });
  const dbh = fakeDb({ marked: [marked], unmarked: [] });
  assert.equal(await run(["--apply"], dbh, silent()), 0);
  const stamped = dbh.statements.filter((s) => /UPDATE clients SET is_demo/.test(s.sql));
  assert.equal(stamped.length, 1);
  assert.deepEqual(stamped[0].params, [marked.id]);
});

test("--apply NEVER touches an unmarked client", async () => {
  const stranger = client({ id: "44444444-4444-4444-4444-444444444444", first_name: "Paying", last_name: "Customer" });
  const dbh = fakeDb({ marked: [], unmarked: [stranger] });
  const out = silent();
  assert.equal(await run(["--apply"], dbh, out), 0);
  const writes = dbh.statements.filter((s) => /UPDATE|DELETE/i.test(s.sql));
  assert.deepEqual(writes, [], "an unmarked client must survive --apply");
  assert.ok(out.lines.some((l) => l.includes(stranger.id)), "and must still be reported for a human to read");
});

test("an unmarked client is deleted only when named with --client", async () => {
  const named = client({ id: "55555555-5555-5555-5555-555555555555" });
  const bystander = client({ id: "66666666-6666-6666-6666-666666666666" });
  const dbh = fakeDb({ marked: [], unmarked: [named, bystander] });
  assert.equal(await run(["--client", named.id, "--apply"], dbh, silent()), 0);
  const stamped = dbh.statements.filter((s) => /UPDATE clients SET is_demo/.test(s.sql));
  assert.equal(stamped.length, 1, "exactly the one named");
  assert.deepEqual(stamped[0].params, [named.id]);
});

test("refuses to run without DATABASE_URL", async () => {
  const prev = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const { main } = await import("./find-test-data.mjs");
    const out = silent();
    assert.equal(await main([], { dbh: fakeDb(), out }), 2);
    assert.ok(out.lines.some((l) => /DATABASE_URL is not set/.test(l)));
  } finally {
    if (prev !== undefined) process.env.DATABASE_URL = prev;
  }
});

test("every marker is a non-empty SQL predicate with a name", () => {
  assert.ok(MARKERS.length >= 5);
  for (const m of MARKERS) {
    assert.ok(m.name && typeof m.name === "string");
    assert.ok(m.sql && /[a-z]/.test(m.sql));
    assert.ok(!/;/.test(m.sql), "a marker must not be able to end the statement");
  }
});
