import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KILL = [
  "finance-os.html", "consent-capture.html", "company-brain.html", "galaxy.html",
  "partner-galaxy.html", "ops-admin.html", "automations.html", "journeys.html",
  "brand-studio.html", "campaign-manager.html", "social-studio.html",
  "creative-factory.html", "hiring.html", "affiliate.html"
];
const KEEP = [
  "pipeline.html", "client-control-panel.html", "closer-dashboard.html",
  "closer-call.html", "my-numbers.html", "sales-floor.html", "calendar.html",
  "messaging.html", "documents.html", "contracts.html", "template-editor.html",
  "inquiry-remover.html", "content-admin.html", "products-commissions.html",
  "staff-teams.html", "agent-editor.html"
];

const before = JSON.parse(fs.readFileSync(path.join(HERE, "before/nav.json"), "utf8"));
const after = JSON.parse(fs.readFileSync(path.join(HERE, "after/nav.json"), "utf8"));
const roles = {};
let ok = true;
for (const role of Object.keys(after.roles)) {
  const a = after.roles[role].hrefs;
  const leftover = KILL.filter((h) => a.includes(h));
  const missing = role === "owner" || role === "admin"
    ? KEEP.filter((h) => {
      if (role === "admin" && h === "content-admin.html") return false;
      return !a.includes(h) && !(role === "admin" && false);
    }).filter((h) => {
      if (role === "admin" && ["closer-call.html", "my-numbers.html", "sales-floor.html"].includes(h)) return false;
      return true;
    })
    : [];
  const ownerMissing = role === "owner" ? KEEP.filter((h) => !a.includes(h)) : [];
  const row = { leftover, ownerMissing: role === "owner" ? ownerMissing : undefined, after: a };
  if (leftover.length) ok = false;
  if (role === "owner" && ownerMissing.length) ok = false;
  roles[role] = row;
}
const report = { ok, kill: KILL, roles };
fs.writeFileSync(path.join(HERE, "compare.json"), JSON.stringify(report, null, 2));
if (!ok) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, ownerAfter: after.roles.owner.labels }));
