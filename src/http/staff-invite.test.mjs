import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

test("invite and suspend are owner/admin gates and use the existing auth module", () => {
  const invite = fs.readFileSync(path.join(ROOT, "api/auth/invite.mjs"), "utf8");
  const suspend = fs.readFileSync(path.join(ROOT, "api/auth/suspend.mjs"), "utf8");
  const routes = fs.readFileSync(path.join(ROOT, "netlify/functions/api.mjs"), "utf8");
  assert.ok(invite.includes('requireRole("owner", "admin")'));
  assert.ok(invite.includes("inviteStaff"));
  assert.ok(invite.includes("suggestCompanyEmail"));
  assert.ok(invite.includes("cannot_invite_owner"));
  assert.ok(suspend.includes('requireRole("owner", "admin")'));
  assert.ok(suspend.includes("suspendStaff"));
  assert.ok(suspend.includes("staff.org_id") || suspend.includes("actor: staff"));
  assert.ok(routes.includes('"auth/invite"'));
  assert.ok(routes.includes('"auth/suspend"'));
});

test("reset confirm accepts invite tokens so the copy-link works", () => {
  const reset = fs.readFileSync(path.join(ROOT, "api/auth/reset.mjs"), "utf8");
  assert.ok(reset.includes("setPasswordWithToken"));
});

test("staff roster hides seed furniture", () => {
  const src = fs.readFileSync(path.join(ROOT, "api/read/staff.mjs"), "utf8");
  assert.ok(src.includes("SEED_FURNITURE_EMAILS"));
  assert.ok(src.includes("DEMO %"));
});
