import { test } from "node:test";
import assert from "node:assert/strict";
import { upcomingCalls } from "./cockpit.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const STAFF = "33333333-3333-4333-8333-333333333333";
const FILE = "614927f7-95a9-4623-86e8-cd85420d9716";

const ON_FILE = {
  task_id: "c2fce4f3-85ff-455d-8b5b-fd2f2e9c43f3",
  client_id: FILE,
  due_at: "2026-08-26T18:12:48.186Z",
  meeting_url: null,
  title: "Strategy session booked",
  name: "Sim Fund Horse"
};

function fakeDb(rows) {
  return {
    async query(sql, params) {
      assert.match(sql, /t\.org_id = \$1/);
      assert.match(sql, /assignee_role = 'closer'/);
      assert.match(sql, /t\.client_id = \$3 AND t\.due_at >= date_trunc\('day'/);
      assert.equal(params[0], ORG);
      assert.equal(params[1], STAFF);
      assert.equal(params[2], FILE);
      return { rows };
    }
  };
}

test("upcomingCalls puts this file's booked call first", async () => {
  const out = await upcomingCalls(fakeDb([ON_FILE]), {
    orgId: ORG, staffId: STAFF, includeClientId: FILE
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].client_id, FILE);
  assert.equal(out[0].title, "Strategy session booked");
});

test("upcomingCalls does not invent a booked call", async () => {
  const out = await upcomingCalls(fakeDb([]), {
    orgId: ORG, staffId: STAFF, includeClientId: FILE
  });
  assert.deepEqual(out, []);
});
