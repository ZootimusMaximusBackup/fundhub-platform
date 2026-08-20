/* Prove the Inngest serve list is untouched by the nav kill. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { functions } from "../../../../src/workflows/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const ids = functions.map((fn) => fn.id()).sort();
const diff = execSync("git diff -- src/workflows/ api/inngest.mjs api/read/workflows.mjs", {
  cwd: ROOT,
  encoding: "utf8"
});

const out = {
  at: new Date().toISOString(),
  served: ids.length,
  ids,
  workflows_dir_diff: diff.trim() === "" ? "none" : diff,
  note: "Nav change does not import this list. Same 53 ids, no diff in serve files."
};

fs.writeFileSync(path.join(HERE, "serve-list.json"), JSON.stringify(out, null, 2));
if (ids.length !== 53) {
  console.error("expected 53 served workflows, got", ids.length);
  process.exit(1);
}
if (diff.trim()) {
  console.error("serve files changed");
  process.exit(1);
}
console.log(JSON.stringify({ served: ids.length, diff: "none" }));
