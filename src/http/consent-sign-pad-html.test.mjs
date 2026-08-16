// The onboarding sign box lives in HTML, not in a JS module. package.json's
// test glob only walks src/ and scripts/, so this file reads the two screens
// as text the same way crm-html.test.mjs does.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CC = path.resolve(HERE, "../../public/app/consent-capture.html");
const PORTAL = path.resolve(HERE, "../../public/app/client-portal.html");

test("consent-capture.html has a canvas sign pad and reads dispute_authorization from ?kind=", () => {
  const html = fs.readFileSync(CC, "utf8");
  assert.ok(/<canvas[^>]*\bid="ccSignPad"/.test(html), "must ship canvas#ccSignPad");
  assert.ok(/id="ccSignClear"/.test(html), "must ship Clear control #ccSignClear");
  assert.ok(html.includes('data-testid="ccSignPad"'), "ccSignPad must be a stable test id");
  assert.ok(html.includes('data-testid="ccSignClear"'), "ccSignClear must be a stable test id");
  assert.ok(html.includes("Draw your signature"), "must tell the client to draw");
  assert.ok(html.includes("dispute_authorization"), "must allow kind=dispute_authorization");
  assert.ok(/param\("kind"\)/.test(html), "must read kind from the query string");
  assert.ok(!/var kind = "soft_pull_consent"/.test(html), "kind must not be hardcoded only");
  assert.ok(/capture_method:\s*method/.test(html), "POST must still send capture_method");
  assert.ok(html.includes("soft_pull_consent"), "default kind remains soft_pull_consent");
  assert.ok(
    html.includes("canvasHasInk") && html.includes('method === "signature"'),
    "signature method must refuse an empty pad"
  );
});

test("client-portal.html embeds a dispute-letter sign box that posts signature capture", () => {
  const html = fs.readFileSync(PORTAL, "utf8");
  assert.ok(html.includes("Sign to authorize dispute letters"), "must show the onboarding sign card");
  assert.ok(/<canvas[^>]*\bid="cpSignPad"/.test(html), "portal must embed a sign canvas");
  assert.ok(html.includes("dispute_authorization"), "must use kind dispute_authorization");
  assert.ok(html.includes("/api/consent/capture"), "must call the existing capture API");
  assert.ok(html.includes('capture_method: "signature"'), "POST must send capture_method signature");
  assert.ok(
    html.includes("I sign to authorize Fundhub to prepare my dispute letters"),
    "must use the locked button copy"
  );
  assert.ok(
    html.includes("consent-capture.html?kind=dispute_authorization"),
    "must still link to the full consent screen"
  );
  const cardStart = html.indexOf("dispute-auth-card");
  const cardEnd = html.indexOf("BEFORE THE CALL");
  assert.ok(cardStart >= 0 && cardEnd > cardStart, "sign card must sit in the onboarding stack");
  const card = html.slice(cardStart, cardEnd).toLowerCase();
  assert.ok(
    !/credit score|improve your score|guaranteed/.test(card),
    "must not promise credit outcomes on this card"
  );
});
