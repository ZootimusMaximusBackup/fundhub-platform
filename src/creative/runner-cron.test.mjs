import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SWEEP_CRON } from "../../netlify/functions/creative-job-runner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("creative-job-runner: netlify.toml schedule matches SWEEP_CRON", () => {
  const toml = fs.readFileSync(path.resolve(HERE, "../../netlify.toml"), "utf8");
  assert.match(toml, /\[functions\."creative-job-runner"\]/);
  const m = /\[functions\."creative-job-runner"\][\s\S]{0,200}?schedule\s*=\s*"([^"]+)"/.exec(toml);
  assert.ok(m, "schedule line missing for creative-job-runner");
  assert.equal(m[1], SWEEP_CRON);
});
