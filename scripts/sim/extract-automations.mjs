import fs from "node:fs"; import path from "node:path";
const dir = "src/workflows"; const out = [];
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".mjs") && !f.endsWith(".test.mjs") && f !== "index.mjs")) {
  const s = fs.readFileSync(path.join(dir, f), "utf8");
  const registered = fs.readFileSync("src/workflows/index.mjs", "utf8").includes(`./${f}`);
  const header = s.split("\n").slice(0, 40).filter(l => /^\s*(\/\/|\*|\/\*)/.test(l)).map(l => l.replace(/^\s*(\/\/|\/\*+|\*+\/?)\s?/, "").trim()).filter(Boolean).slice(0, 6).join(" ");
  const trig = [...s.matchAll(/\{\s*event:\s*"([^"]+)"\s*\}/g)].map(m => m[1]);
  const cancelOn = [...s.matchAll(/cancelOn[\s\S]{0,200}?event:\s*"([^"]+)"/g)].map(m => m[1]);
  const cron = [...s.matchAll(/cron:\s*"([^"]+)"/g)].map(m => m[1]);
  const templates = [...new Set([...s.matchAll(/"((?:EMAIL|SMS)-[A-Z0-9-]+)"/g)].map(m => m[1]))];
  const roles = [...new Set([...s.matchAll(/assigneeRole:\s*"([a-z_]+)"/g)].map(m => m[1]))];
  const stages = [...new Set([...s.matchAll(/stageKey:\s*"([a-z_]+)"/g)].map(m => m[1]))];
  const pipes = [...new Set([...s.matchAll(/pipelineKey:\s*"([a-z_]+)"/g)].map(m => m[1]))];
  const emits = [...new Set([...s.matchAll(/emit\([^,]+,\s*"([a-z_.]+)"/g)].map(m => m[1]))];
  const sleeps = [...s.matchAll(/step\.sleep(?:Until)?\("([^"]+)"(?:,\s*"([^"]+)")?/g)].map(m => m[2] ? `${m[1]}=${m[2]}` : m[1]);
  const bland = /bland|placeCall|startCall/i.test(s);
  const holds = [...new Set([...s.matchAll(/round_hold_reason[^"]*"([^"]+)"/g)].map(m => m[1]))];
  const tags = [...new Set([...s.matchAll(/addTags\([^,]+,[^,]+,\s*\[([^\]]+)\]/g)].flatMap(m => m[1].split(",").map(x => x.trim().replace(/["']/g, ""))))];
  out.push({ file: f, registered, triggers: trig.filter(t => !cancelOn.includes(t) || trig.filter(x => x === t).length > cancelOn.filter(x => x === t).length), cron, templates, roles, stages, pipes, emits, sleeps, bland, holds, tags, header });
}
fs.writeFileSync(process.env.S + "/automations.json", JSON.stringify(out, null, 1));
const byEvent = {};
for (const w of out) for (const t of w.triggers) (byEvent[t] ||= []).push(w.file);
console.log("workflows:", out.length, "registered:", out.filter(w => w.registered).length);
for (const [e, files] of Object.entries(byEvent).sort()) console.log(e.padEnd(22), files.join(", "));
console.log("cron:", out.filter(w => w.cron.length).map(w => w.file + " " + w.cron.join("|")).join("; "));
console.log("unregistered:", out.filter(w => !w.registered).map(w => w.file).join(", "));
