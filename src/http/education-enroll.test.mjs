// /api/public/education-enroll — parse only (no live Postgres).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEducationEnrollBody } from "../../api/public/education-enroll.mjs";

test("parseEducationEnrollBody stores a US phone as +1 E.164", () => {
  const parsed = parseEducationEnrollBody({
    program: "credit-mastery",
    full_name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "6616054248",
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.phone, "+16616054248");
});
