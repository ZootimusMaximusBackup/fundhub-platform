// Cron schedule agreement — same pattern as staff-message-sweeper tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SWEEP_CRON } from "../../netlify/functions/social-publish-sweeper.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("social-publish-sweeper: netlify.toml schedule matches SWEEP_CRON", () => {
  const toml = fs.readFileSync(path.resolve(HERE, "../../netlify.toml"), "utf8");
  assert.match(toml, /\[functions\."social-publish-sweeper"\]/);
  const m = /\[functions\."social-publish-sweeper"\][\s\S]{0,200}?schedule\s*=\s*"([^"]+)"/.exec(toml);
  assert.ok(m, "schedule line missing for social-publish-sweeper");
  assert.equal(m[1], SWEEP_CRON);
});
