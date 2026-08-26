// GET /api/gifts/message-blaster — staff, affiliate, and partner. Not clients.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import handler from "../../api/gifts/message-blaster.mjs";

function res() {
  const r = { code: null, headers: {}, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = (b) => { r.body = b; return r; };
  return r;
}

function deps({ principal = null, filePath = null } = {}) {
  const tmp = filePath || path.join(os.tmpdir(), `mb-gift-${Date.now()}.bin`);
  if (!filePath) fs.writeFileSync(tmp, "fake-dmg-bytes");
  return {
    requirePrincipal: async (_req, res, kinds) => {
      if (!principal) {
        res.status(401).json({ ok: false, error: "unauthorized" });
        return null;
      }
      if (!kinds.includes(principal.kind)) {
        res.status(403).json({ ok: false, error: "forbidden" });
        return null;
      }
      return principal;
    },
    resolveMessageBlasterAsset: () => ({
      filename: "MessageBlaster.dmg",
      contentType: "application/x-apple-diskimage",
      path: tmp
    })
  };
}

test("affiliate session may download the gift", async () => {
  const r = res();
  await handler({ method: "GET", headers: {} }, r, deps({
    principal: { kind: "affiliate", orgId: "org-1", affiliateId: "aff-1" }
  }));
  assert.equal(r.code, 200);
  assert.equal(r.headers["content-type"], "application/x-apple-diskimage");
  assert.match(r.headers["content-disposition"], /MessageBlaster\.dmg/);
  assert.equal(String(r.body), "fake-dmg-bytes");
});

test("partner session may download the gift", async () => {
  const r = res();
  await handler({ method: "GET", headers: {} }, r, deps({
    principal: { kind: "partner", orgId: "org-1", partnerId: "p-1" }
  }));
  assert.equal(r.code, 200);
});

test("staff session may download the gift", async () => {
  const r = res();
  await handler({ method: "GET", headers: {} }, r, deps({
    principal: { kind: "staff", orgId: "org-1", role: "owner" }
  }));
  assert.equal(r.code, 200);
  assert.equal(String(r.body), "fake-dmg-bytes");
});

test("client session is refused", async () => {
  const r = res();
  await handler({ method: "GET", headers: {} }, r, deps({
    principal: { kind: "client", orgId: "org-1", clientId: "c-1" }
  }));
  assert.equal(r.code, 403);
});

test("unsigned caller is refused", async () => {
  const r = res();
  await handler({ method: "GET", headers: {} }, r, deps());
  assert.equal(r.code, 401);
});

test("missing file returns gift_unavailable", async () => {
  const r = res();
  const missing = path.join(os.tmpdir(), `mb-missing-${Date.now()}.bin`);
  await handler({ method: "GET", headers: {} }, r, deps({
    principal: { kind: "affiliate", orgId: "org-1", affiliateId: "aff-1" },
    filePath: missing
  }));
  assert.equal(r.code, 503);
  assert.equal(r.body.error, "gift_unavailable");
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HANDLER_SRC = fs.readFileSync(path.resolve(HERE, "../../api/gifts/message-blaster.mjs"), "utf8");
const AFFILIATE_HTML = fs.readFileSync(path.resolve(HERE, "../../public/app/affiliate.html"), "utf8");
const PARTNER_HTML = fs.readFileSync(path.resolve(HERE, "../../public/app/partner-galaxy.html"), "utf8");

test("the gate names staff, affiliate, and partner in the extractable literal", () => {
  assert.match(HANDLER_SRC, /requirePrincipal\(\s*req\s*,\s*res\s*,\s*\["staff", "affiliate", "partner"\]/);
  assert.doesNotMatch(HANDLER_SRC, /not staff, not clients/);
});

test("staff affiliate and partner home both start the locked download", () => {
  assert.match(AFFILIATE_HTML, /fetch\("\/api\/gifts\/message-blaster"/);
  assert.match(PARTNER_HTML, /fetch\("\/api\/gifts\/message-blaster"/);
});

test("partner home download wiring is not inside the galaxy canvas script", () => {
  const scripts = [...PARTNER_HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const canvas = scripts.find((s) => s.includes("FUNDHUB GALAXY"));
  assert.ok(canvas, "galaxy canvas script is gone");
  assert.ok(!canvas.includes("/api/gifts/message-blaster"), "download must not live in the canvas IIFE");
  const download = scripts.find((s) => s.includes("/api/gifts/message-blaster"));
  assert.ok(download, "download script is gone");
  assert.ok(!download.includes("FUNDHUB GALAXY"), "download script must stand alone");
});
