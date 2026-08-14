// Twilio/TCR crawls fundhub.ai during A2P 10DLC review. These files are
// static and are not imported anywhere else, so a missing robots.txt or a
// noindex on the privacy page would ship silently. Lives under src/ because
// the suite glob is src/** and scripts/** only (CLAUDE.md §12).

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");

describe("Twilio 10DLC crawl surfaces", () => {
  test("robots.txt allows all agents", () => {
    const body = fs.readFileSync(path.join(PUBLIC, "robots.txt"), "utf8");
    assert.match(body, /User-agent:\s*\*/);
    assert.match(body, /Allow:\s*\//);
    assert.doesNotMatch(body, /Disallow:/);
  });

  test("privacy policy is crawlable and has Twilio SMS lines", () => {
    const body = fs.readFileSync(path.join(PUBLIC, "privacy/index.html"), "utf8");
    assert.doesNotMatch(body, /content="noindex"/);
    assert.match(body, /index,follow/);
    assert.match(body, /Mobile information will not be shared with third parties or affiliates for marketing or promotional purposes/);
    assert.match(body, /Message frequency varies/);
    assert.match(body, /Message and data rates may apply/);
  });

  test("terms are crawlable and keep SMS terms", () => {
    const body = fs.readFileSync(path.join(PUBLIC, "terms/index.html"), "utf8");
    assert.doesNotMatch(body, /content="noindex"/);
    assert.match(body, /id="sms"/);
    assert.match(body, /Message and data rates may apply/);
    assert.match(body, /Reply <strong>STOP<\/strong>/);
  });
});
