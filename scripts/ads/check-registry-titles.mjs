#!/usr/bin/env node
// scripts/ads/check-registry-titles.mjs — every registered ad has a name.
//
//   node scripts/ads/check-registry-titles.mjs
//
// Exits 0 when every ad in docs/ads/registry.json carries a title, and 1 with
// the list of ids when any does not. Nothing is written and nothing is guessed:
// only Chris names an ad, so this script's whole job is to make the gap
// impossible to miss and impossible to ship past.
//
// Why it matters (F7, live walk 2026-09-03): the title is the word after the
// dash in utm_content — 42-ringlights is ad 42 titled "ringlights". An ad with
// no title still tracks correctly, but every report grouped by ad name shows a
// bare digit, and the closer screen prints a number where the ad's name goes.
// 21 of the 24 seeded ads were untitled that day.
//
// To fix one: add "title": "<the slug>" to that ad in docs/ads/registry.json,
// and delete its id from UNTITLED_ALLOW_LIST in src/ads/registry.test.mjs.

import { loadRegistry, untitledAdIds } from "../../src/ads/registry.mjs";

const registry = loadRegistry({ reload: true });
const missing = untitledAdIds({ registry });

if (missing.length === 0) {
  console.log(`docs/ads/registry.json — all ${registry.ads.length} ads have a title.`);
  process.exit(0);
}

console.error(
  `docs/ads/registry.json — ${missing.length} of ${registry.ads.length} ads have no title.\n` +
  `Ad ids needing a name: ${missing.join(", ")}\n` +
  `Only the owner names an ad. Add "title": "<slug>" to each in docs/ads/registry.json.`
);
process.exit(1);
