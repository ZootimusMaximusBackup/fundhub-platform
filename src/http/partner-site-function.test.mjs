import { test } from "node:test";
import assert from "node:assert/strict";
import { handler, parsePath } from "../../netlify/functions/partner-site.mjs";

const PID = "caf277ee-a7f4-4d96-985c-5579908a169b";

test("parsePath reads /sites/:id/:slug and the function rewrite path", () => {
  assert.deepEqual(parsePath(`/sites/${PID}/apply`), {
    mode: "sites",
    partnerId: PID,
    slug: "apply"
  });
  assert.deepEqual(parsePath(`/.netlify/functions/partner-site/${PID}/apply`), {
    mode: "sites",
    partnerId: PID,
    slug: "apply"
  });
});

test("handler returns a Web Response (Netlify v2), not a lambda object", async () => {
  const res = await handler(new Request(`https://fundhub.ai/sites/${PID}/apply`));
  assert.equal(res instanceof Response, true);
  assert.equal(typeof res.status, "number");
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  const body = await res.text();
  assert.match(body, /<!doctype html>/i);
});
