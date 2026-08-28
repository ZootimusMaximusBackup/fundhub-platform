// public/optimize.html is referrals only. Book goes to the phonecall calendar.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.resolve(HERE, "../../public/optimize.html");
const TOML = path.resolve(HERE, "../../netlify.toml");

const html = fs.readFileSync(PAGE, "utf8");
const toml = fs.readFileSync(TOML, "utf8");

test("optimize.html books on schedule/phonecall, not funding-book-call or xyl.in", () => {
  assert.match(
    html,
    /https:\/\/apply\.fundhub\.ai\/schedule\/phonecall/,
    "must reuse the credit-repair phonecall calendar URL"
  );
  assert.doesNotMatch(
    html,
    /funding-book-call/,
    "must not send referrals to the funding survey calendar"
  );
  assert.match(html, /Book a call/, "primary button must say what happens");
  assert.match(
    html,
    /Fundhub Credit Solutions LLC/,
    "public entity must be Fundhub Credit Solutions LLC"
  );
  assert.doesNotMatch(html, /xyl\.in/i, "must not send people to xyl.in");
  assert.doesNotMatch(html, /Identity\s*IQ/i, "must not mention Identity IQ");
  assert.doesNotMatch(html, /\bCRS\b/, "must not mention CRS");
  assert.doesNotMatch(
    html,
    /href="https:\/\/apply\.fundhub\.ai\/"/,
    "must not send people to bare apply.fundhub.ai/"
  );
  assert.doesNotMatch(
    html,
    /your score will go up/i,
    "must not claim a credit outcome"
  );
  assert.match(html, />Audit</, "page copy must stay vague — Audit");
  assert.doesNotMatch(html, /credit repair/i, "must not say credit repair on the page");
  assert.match(html, /\/api\/public\/optimize/, "Audit checkout posts to the public optimize door");
  assert.match(html, /See Audit roadmap/, "roadmap stays on this page");
  assert.match(html, /view=roadmap/, "roadmap calls the existing brain door");
  assert.match(html, /affiliateUrl/, "Pull your file uses their partner affiliate URL when the widget is dark");
});

test("netlify.toml rewrites /optimize.com to the hidden page, not xyl.in", () => {
  assert.match(
    toml,
    /from\s*=\s*"\/optimize\.com"[\s\S]*?to\s*=\s*"\/optimize\.html"/,
    "/optimize.com must rewrite to /optimize.html"
  );
  assert.doesNotMatch(
    toml,
    /from\s*=\s*"\/optimize\.com"[\s\S]*?xyl\.in/,
    "/optimize.com must not 302 to xyl.in"
  );
});
