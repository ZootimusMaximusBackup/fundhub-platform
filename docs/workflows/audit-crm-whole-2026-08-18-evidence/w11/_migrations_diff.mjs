import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../../");
const applied = JSON.parse(fs.readFileSync(path.join(HERE, "schema_migrations.json"), "utf8"));
const appliedKeys = new Set(applied.map((r) => r.key));

function list(dir, prefix) {
  const abs = path.join(ROOT, dir);
  return fs.readdirSync(abs)
    .filter((n) => n.endsWith(".sql"))
    .map((n) => `${prefix}/${n}`)
    .sort();
}

const files = [
  ...list("db/schema", "schema"),
  ...list("db/migrations", "migrations"),
  ...list("db/seed", "seed")
];

const onDiskNotApplied = files.filter((k) => !appliedKeys.has(k));
const appliedNotOnDisk = applied.filter((r) => !files.includes(r.key));

const latest = applied.slice().sort((a, b) => String(a.applied_at).localeCompare(String(b.applied_at))).slice(-8);

const out = {
  files_on_disk: files.length,
  applied_rows: applied.length,
  on_disk_not_applied: onDiskNotApplied,
  applied_not_on_disk: appliedNotOnDisk,
  latest_applied: latest
};
fs.writeFileSync(path.join(HERE, "migrations_diff.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
