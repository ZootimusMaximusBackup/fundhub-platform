import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "../../extension");

test("content script is allowed on live fundhub.ai", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
  const matches = manifest.content_scripts?.[0]?.matches || [];
  assert.ok(matches.includes("https://fundhub.ai/*"), "must inject on https://fundhub.ai");
  assert.ok(matches.includes("https://www.fundhub.ai/*"), "must inject on https://www.fundhub.ai");
});

test("ping/ready replies keep page types after the worker payload", () => {
  const src = fs.readFileSync(path.join(EXT, "content.js"), "utf8");
  assert.ok(
    src.includes('{ ...(res || { ok: false }), type: "pong" }'),
    "pong type must win over worker type fh-proxy-pong"
  );
  assert.ok(
    src.includes("{ ...(res || {}), type: \"ready\" }"),
    "ready type must win over worker type fh-proxy-pong"
  );
});
