// Read-only inventory of inngest.createFunction in src/workflows/
import fs from "node:fs";
import path from "node:path";

const ROOT = "/Users/zootimusmaximus/fundhub-platform";
const DIR = path.join(ROOT, "src/workflows");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"));

const indexSrc = fs.readFileSync(path.join(DIR, "index.mjs"), "utf8");
const inngestSrc = fs.readFileSync(path.join(ROOT, "api/inngest.mjs"), "utf8");
const apiSrc = fs.readFileSync(path.join(ROOT, "netlify/functions/api.mjs"), "utf8");

const functions = [];
for (const file of files) {
  const src = fs.readFileSync(path.join(DIR, file), "utf8");
  if (!src.includes("inngest.createFunction")) continue;
  const idM = src.match(/inngest\.createFunction\(\s*\{\s*id:\s*"([^"]+)"\s*,\s*name:\s*"([^"]+)"/);
  const eventMs = [...src.matchAll(/\{\s*event:\s*"([^"]+)"\s*\}/g)].map((m) => m[1]);
  const cronM = src.match(/\{\s*cron:\s*([^}]+)\}/);
  const exportM = src.match(/export const (\w+) = inngest\.createFunction/);
  const exportName = exportM ? exportM[1] : null;
  const registered = exportName ? new RegExp(`\\b${exportName}\\b`).test(indexSrc) && /export const functions = \[/.test(indexSrc) : false;
  functions.push({
    file,
    exportName,
    id: idM ? idM[1] : null,
    name: idM ? idM[2] : null,
    listenEvents: [...new Set(eventMs)],
    cron: cronM ? cronM[1].trim() : null,
    registeredInIndex: registered && indexSrc.includes(exportName)
  });
}

functions.sort((a, b) => (a.id || a.file).localeCompare(b.id || b.file));

const registered = functions.filter((f) => f.registeredInIndex);
const definedNotRegistered = functions.filter((f) => !f.registeredInIndex);
const listenEvents = [...new Set(functions.flatMap((f) => f.listenEvents))].sort();

const out = {
  at: new Date().toISOString(),
  createFunctionCount: functions.length,
  registeredInIndexCount: registered.length,
  definedNotRegistered: definedNotRegistered.map((f) => ({ id: f.id, file: f.file, exportName: f.exportName })),
  messageDispatchSweeper: functions.find((f) => f.id === "message-dispatch-sweeper") || null,
  inquiryCallSweeper: functions.find((f) => f.id === "inquiry-call-sweeper") || null,
  s02IncompleteSurveyNudge: functions.find((f) => f.id === "s-02-incomplete-survey-nudge") || null,
  servePath: {
    apiInngestImportsFunctions: /from ["']\.\.\/src\/workflows\/index\.mjs["']/.test(inngestSrc),
    netlifyShortCircuit: /path === ["']inngest["']/.test(apiSrc) && /inngestWeb/.test(apiSrc)
  },
  listenEvents,
  functions
};

fs.writeFileSync(new URL("./inventory.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  createFunctionCount: out.createFunctionCount,
  registeredInIndexCount: out.registeredInIndexCount,
  definedNotRegistered: out.definedNotRegistered,
  listenEvents: out.listenEvents,
  sweeperRegistered: out.messageDispatchSweeper?.registeredInIndex
}, null, 2));
