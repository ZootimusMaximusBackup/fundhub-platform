// One-shot prove: live CRS sandbox → engine → full DIY escalation pack → disk + Chris inbox.
// COMPLIANCE REVIEW REQUIRED. Do not mail these to a bureau. Inquiry phone remover stays on hold.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./load-env.mjs";
import { createCrsClient } from "../src/finance/crs-client.mjs";
import {
  BUREAUS,
  SANDBOX_TEST_IDENTITIES,
  identityForBureau
} from "../src/finance/crs-identities.mjs";
import { normalizeFromCrs } from "../src/metro2/normalize.mjs";
import { runReport } from "../src/metro2/checks/index.mjs";
import { packViolationsFromReport } from "../src/metro2/diy/from-engine.mjs";
import { buildDiyPackage } from "../src/metro2/diy/package.mjs";
import { persistDiyPackageFiles } from "../src/metro2/diy/persist.mjs";
import { makeFakeDb } from "../src/documents/fake-db.mjs";
import { createStore, memoryProvider } from "../src/documents/store.mjs";
import { send as sendResend } from "../src/messaging/providers/resend.mjs";

loadEnv();
process.env.ADAPTERS_DRY_RUN = "0";
process.env.MESSAGING_DRY_RUN = "0";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "scripts/tmp-sandbox-escalation-pack");
const TO = "stanbridgejchris@gmail.com";

const BUREAU_NAME = { TU: "TransUnion", EX: "Experian", EQ: "Equifax" };

function titleCase(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function formatName(id) {
  return [id.firstName, id.middleName, id.lastName].filter(Boolean).map(titleCase).join(" ");
}

function letterIdentity(id) {
  const a = id.addresses?.[0] || {};
  const zip = String(a.postalCode || "").replace(/\D/g, "");
  return {
    fullName: formatName(id),
    addressLine1: titleCase(a.addressLine1 || ""),
    city: titleCase(a.city || ""),
    state: String(a.state || "").toUpperCase(),
    zip: zip.length >= 5 ? zip.slice(0, 5) : zip,
    ssn: id.ssn || null
  };
}

function countsByRule(violations) {
  const m = {};
  for (const v of violations || []) {
    m[v.ruleId] = (m[v.ruleId] || 0) + 1;
  }
  return m;
}

function isPdf(buf) {
  return Buffer.isBuffer(buf) && buf.slice(0, 4).toString("utf8") === "%PDF";
}

async function main() {
  const cfgHint = createCrsClient({ env: process.env }).config;
  if (!cfgHint.configured) {
    throw new Error(`CRS not configured: ${cfgHint.missing.join(", ")}`);
  }
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    throw new Error("RESEND_API_KEY / RESEND_FROM missing");
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const client = createCrsClient({ env: process.env });
  const packs = [];
  const attachments = [];

  for (const bureau of BUREAUS) {
    const identity = identityForBureau({ host: client.host, bureau, env: process.env });
    const canned = SANDBOX_TEST_IDENTITIES[bureau];
    if (identity !== canned) throw new Error(`${bureau}: refused non-sandbox identity`);

    const pulled = await client.orderPrequal({ bureau, identity });
    if (!pulled.ok) {
      throw new Error(`${bureau} pull failed: ${pulled.blocked ? "adapters fence" : pulled.error}`);
    }

    const asOf = "2026-08-15";
    const { tradelines, context } = normalizeFromCrs(pulled.report, { asOf });
    const result = runReport(tradelines, context);
    const violations = packViolationsFromReport(result);
    const letterId = letterIdentity(identity);
    const person = letterId.fullName;
    const folder = path.join(OUT_DIR, `${person.replace(/\s+/g, "_")}_${BUREAU_NAME[bureau]}`);
    fs.mkdirSync(folder, { recursive: true });

    const pack = await buildDiyPackage({
      violationsByBureau: { [bureau]: violations },
      identity: letterId,
      seed: `sandbox-prove:${bureau}:${asOf}`
    });

    const pdfFiles = (pack.files || []).filter((f) => f.pdf);
    for (const f of pdfFiles) {
      const dest = path.join(folder, f.path.replace(/\//g, "__"));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.pdf);
      if (!isPdf(f.pdf)) throw new Error(`not a PDF: ${dest}`);
      if (/fundhub/i.test(f.text || "")) throw new Error(`Fundhub mark in ${f.path}`);
      attachments.push({
        filename: `${person.replace(/\s+/g, "_")}_${BUREAU_NAME[bureau]}_${path.basename(f.path)}`,
        content: Buffer.from(f.pdf).toString("base64"),
        contentType: "application/pdf"
      });
    }

    const fake = makeFakeDb();
    const store = createStore({ provider: memoryProvider() });
    const persisted = pack.ok
      ? await persistDiyPackageFiles(fake, store, {
        orgId: "00000000-0000-0000-0000-000000000001",
        clientId: "00000000-0000-0000-0000-000000000002",
        files: pack.files,
        sourceEventId: `sandbox-prove:${bureau}`
      })
      : { stored: [], skipped: pack.reason };

    packs.push({
      bureau,
      person,
      ok: pack.ok,
      reason: pack.reason || null,
      tradelines: tradelines.length,
      engine: countsByRule(result.violations),
      letterCount: pack.letterCount || 0,
      pdfCount: pdfFiles.length,
      persisted: persisted.stored.length,
      files: pdfFiles.map((f) => ({
        path: f.path,
        bytes: f.pdf.byteLength,
        pdf: isPdf(f.pdf)
      }))
    });
  }

  const failed = packs.filter((p) => !p.ok);
  if (failed.length) {
    console.error(JSON.stringify({ ok: false, failed, packs }, null, 2));
    process.exit(1);
  }
  if (!attachments.length) throw new Error("no PDFs produced");

  const cover = [
    "Sandbox escalation pack — prove run",
    "",
    "These PDFs are for your review. Do not mail them to a bureau.",
    "No Fundhub name is on the letters.",
    "Round 1 is not a final notice. CFPB and AG pages say send only after Round 3 failed.",
    "Inquiry phone remover stays on hold. These are mail letters only.",
    "",
    "CRS sandbox is three canned people, not one tri-merge:",
    ...packs.map((s) => {
      const rules = Object.entries(s.engine).map(([k, n]) => `${k}×${n}`).join(", ") || "none";
      const names = s.files.map((f) => f.path).join(", ");
      return `- ${s.person} / ${BUREAU_NAME[s.bureau]} / ${s.tradelines} accounts / engine ${rules} / ${s.pdfCount} PDFs saved, ${s.persisted} stored in the document registry (memory prove): ${names}`;
    }),
    "",
    "Every claim comes from the Metro 2 engine on the live sandbox pull.",
    "PDFs were also written through the same save path a real DIY client uses.",
    "",
    "COMPLIANCE REVIEW REQUIRED before any live letter uses this wording."
  ].join("\n");

  const sent = await sendResend({
    to: TO,
    subject: "Sandbox escalation pack — Round 1–3, collector, CFPB, AG",
    body: cover,
    attachments
  }, {
    env: {
      ...process.env,
      RESEND_FROM: "Fundhub <onboarding@resend.dev>"
    }
  });

  const out = {
    ok: sent.status === "sent",
    to: TO,
    providerStatus: sent.status,
    providerMessageId: sent.providerMessageId || null,
    pdfCount: attachments.length,
    outDir: OUT_DIR,
    packs
  };
  if (sent.error) out.error = String(sent.error).slice(0, 200);
  console.log(JSON.stringify(out, null, 2));
  if (sent.status !== "sent") process.exit(1);
}

main().catch((err) => {
  console.error(String(err && err.message || err));
  process.exit(1);
});
