// Darwin's Message Blaster — Mac gift for affiliate + white-label partners.
// Served only through GET /api/gifts/message-blaster (never under public/).

import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function resolveMessageBlasterAsset() {
  return Object.freeze({
    filename: "MessageBlaster.dmg",
    contentType: "application/x-apple-diskimage",
    path: path.join(ROOT, "assets/gifts/message-blaster.dmg")
  });
}
