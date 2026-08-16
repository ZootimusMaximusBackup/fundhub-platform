// Named file assets that may ride on outbound messages.
// Resolved at send time in the Mailgun provider — never invent bytes elsewhere.

import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

/** @type {Readonly<Record<string, { filename: string; contentType: string; absPath: string }>>} */
export const MESSAGE_ASSETS = Object.freeze({
  "ebook-placeholder": Object.freeze({
    filename: "fundhub-ebook.pdf",
    contentType: "application/pdf",
    absPath: path.join(ROOT, "assets/ebooks/fundhub-ebook-placeholder.pdf")
  })
});

export function resolveMessageAsset(key) {
  const a = MESSAGE_ASSETS[String(key || "")];
  return a || null;
}
