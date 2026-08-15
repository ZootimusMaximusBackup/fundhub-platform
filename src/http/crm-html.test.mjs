// public/crm.html must never paint the old sample office or set fh_demo.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CRM = path.resolve(HERE, "../../public/crm.html");

test("crm.html sends people to /app/ and does not turn demo on", () => {
  const html = fs.readFileSync(CRM, "utf8");
  assert.ok(html.includes('location.replace("/app/")'), "must send the browser to /app/");
  assert.ok(html.includes('removeItem("fh_demo")'), "must unstick a leftover demo flag");
  assert.ok(!/setItem\(\s*["']fh_demo["']/.test(html), "must not turn demo mode on");
  assert.ok(!/Bianca Souza|Dana Reyes|Derek Owusu/.test(html), "must not ship sample people");
});
