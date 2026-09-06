#!/usr/bin/env node
// Render the four deliverables as HTML from a simulated credit file, so a human
// can open them in a browser and look.
//
//   node src/deliverables/preview.mjs --profile academy --out /tmp/deliverables
//
// It touches no database and calls no bureau. The profile comes from
// scripts/sim/push-credit.mjs (the manual-walkthrough simulator), goes through
// the REAL tier engine, and then through src/underwrite/black-report-client.mjs
// — the same mapper the live printer uses — so what renders is the shape a real
// client produces, not a hand-written fixture.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILES, buildPayload } from "../../scripts/sim/push-credit.mjs";
import { runTierEngineFromCrsResult } from "../finance/crs-tier.mjs";
import { buildBlackReportClient } from "../underwrite/black-report-client.mjs";
import { renderAllDeliverables } from "./index.mjs";

const PERSON = Object.freeze({
  name: "Academy Sim",
  address: "100 Test Ave\nDenton, TX 76205",
  state: "TX"
});

/** Build the CLIENT dict a simulated profile produces. Exported for the tests. */
export function simulatedClient(profileKey = "academy", personal = PERSON) {
  if (!PROFILES[profileKey]) {
    throw new Error(`unknown sim profile ${profileKey}; one of ${Object.keys(PROFILES).join("|")}`);
  }
  const payload = buildPayload(profileKey, {
    email: null,
    name: personal.name,
    pulledAt: "2026-09-05T00:00:00.000Z"
  });
  const engine = runTierEngineFromCrsResult(payload, {
    submittedName: personal.name,
    submittedAddress: String(personal.address).replace(/\n/g, ", ")
  });
  const client = buildBlackReportClient({ crsResult: engine, personal });
  // The date is the only field the Python defaulted at render time
  // (fundhub_gen.py:1600). Fixed here so two runs of this script match.
  client.date = "September 5, 2026";
  return client;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}

function main() {
  const profile = arg("profile", "academy");
  const out = arg("out", "out");
  const fontsHref = arg("fonts-href", "");
  const client = simulatedClient(profile);
  mkdirSync(out, { recursive: true });
  for (const doc of renderAllDeliverables({ client, includeVariants: true, fontsHref })) {
    const path = join(out, doc.filename);
    writeFileSync(path, doc.html);
    console.log(`wrote ${path} (${doc.html.length} bytes)`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("preview.mjs")) main();
