// GET /api/gifts/message-blaster — affiliate + partner only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

test("staff session is refused", async () => {
  const r = res();
  await handler({ method: "GET", headers: {} }, r, deps({
    principal: { kind: "staff", orgId: "org-1", role: "owner" }
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
