// Workflow-key coverage for the message_templates seeder.
//
// Workflows reference keys like EMAIL-F03-ROUND-SUBMITTED / SMS-F03-ROUND-SUBMITTED.
// The source docs use different IDs (F-03, SMS-F03-01-ROUND-SUBMITTED, SMS-WF-…).
// This module clones doc (or templates-seed) copy under the workflow key names so
// sendTemplated() can resolve them, and emits clearly marked DRAFT rows when no
// source copy exists.
//
// Owner decision (2026-08-04): every seeded row ships compliance_passed=false.
// Human approval happens in the template editor; migration 116 governs turn-on.

import fs from "node:fs";
import path from "node:path";
import { findTemplateKeyRefs, listWorkflowFiles, REPO_ROOT } from "./workflow-audit.mjs";
import { KNOWN_TEMPLATES } from "../../workflows/templates-seed.mjs";

// Workflow key → source template_key already present in the parsed doc set.
// Bodies are copied verbatim; the workflow key is what sendTemplated looks up.
export const WORKFLOW_DOC_ALIASES = {
  "SMS-F02-ID-PORTAL-NEEDED": "SMS-F02-01-PORTAL-ID",
  "SMS-F03-ROUND-SUBMITTED": "SMS-F03-01-ROUND-SUBMITTED",
  "SMS-F04-ROUND-APPROVALS": "SMS-F04-01-ROUND-MOVEMENT",
  "SMS-F06-MISSING-DOCS": "SMS-F06-01-MISSING-DOCS",
  "SMS-F07-FUNDING-LOCKED": "SMS-F07-01-LOC",
  "SMS-F10-INBOX-SETUP": "SMS-F10-01-INBOX-READY",
  "SMS-AISET03-MSG1": "SMS-WF-AI-SET-03-NO-ANSWER-SMS-CADENCE-01",
  "SMS-AISET03-MSG2": "SMS-WF-AI-SET-03-NO-ANSWER-SMS-CADENCE-02",
  "SMS-AISET03-MSG3": "SMS-WF-AI-SET-03-NO-ANSWER-SMS-CADENCE-03",
  "SMS-AISET04-HANDOFF": "SMS-WF-AI-SET-04-3-WAY-TEXT-HANDOFF-01",
  "SMS-ROUND-STARTED-NOTIFY": "SMS-WF-ROUND-STARTED-CLIENT-NOTIFY-01",
  "SMS-DS01-REPAIR-REFERRAL": "SMS-WF-DS-01-REPAIR-REFERRAL-01",

  "EMAIL-F02-ID-PORTAL-NEEDED": "F-02",
  // P2 is the portal/ID follow-up series email closest to this workflow step.
  "EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP": "P2",
  "EMAIL-F03-ROUND-SUBMITTED": "F-03",
  "EMAIL-F04-ROUND-APPROVALS": "F-04",
  "EMAIL-F06-MISSING-DOCS": "F-06",
  // workflows/templates-seed.mjs and f-07 cite FR22 "Total Funding Locked".
  "EMAIL-F07-FUNDING-LOCKED": "FR22",
  "EMAIL-F10-INBOX-SETUP": "F-10",
  "EMAIL-N01-COLD-NURTURE": "N-01",
  "EMAIL-N02-WARM-NURTURE": "N-02",
  "EMAIL-N03-HOT-NURTURE": "N-03",
  "EMAIL-N04-POST-FUNDING": "N-04",
  "EMAIL-N06-RENEWAL": "N-06",
  "EMAIL-S02-FINISH-APPLICATION": "S-02",
  "EMAIL-U02-ANALYZER-FUNDING-DELIVERY": "U-02",
  // collect.mjs disambiguates the second U-02 body as U-02--2.
  "EMAIL-U02-ANALYZER-REPAIR-DELIVERY": "U-02--2",
  "EMAIL-DPC05-NO-PROGRESS-72H": "DPC-05",
  // Single-space header in the email source doc absorbs the name into the key.
  "EMAIL-AX07-FUNDING-PAUSED": "SEND AX-07",
};

// Intent text for DRAFT rows — never invents marketing/credit claims.
export const WORKFLOW_DRAFT_INTENTS = {
  "EMAIL-C06-DECLINE":
    "CRS hard-decline branch: notify the client that this path did not qualify and point them to next steps. Replace before approval.",
  "SMS-C06-DECLINE":
    "CRS hard-decline SMS: short notice that this path did not qualify, with STOP opt-out. Replace before approval.",
  "EMAIL-DS01-REPAIR-REFERRAL":
    "Repair-referral email companion to SMS-DS01: send the partner referral context/link. Replace before approval.",
  "EMAIL-DS02-DIY-LETTERS-READY":
    "DIY letters ready: tell the client their letters are ready and how to access them. Replace before approval.",
  "SMS-N01-COLD-NURTURE":
    "Cold nurture SMS cadence touch. N-series SMS copy is not in the source docs. Replace before approval.",
  "SMS-N02-WARM-NURTURE":
    "Warm nurture SMS cadence touch. N-series SMS copy is not in the source docs. Replace before approval.",
  "SMS-N03-HOT-NURTURE":
    "Hot nurture SMS cadence touch. N-series SMS copy is not in the source docs. Replace before approval.",
  "SMS-N04-POST-FUNDING":
    "Post-funding nurture SMS. N-series SMS copy is not in the source docs. Replace before approval.",
  "SMS-N06-RENEWAL":
    "Renewal / second-wave nurture SMS. N-series SMS copy is not in the source docs. Replace before approval.",
};

const KEY_SHAPE = /^(?:SMS|EMAIL)-[A-Z0-9]/;

function draftBody(templateKey, intent) {
  return (
    `[DRAFT — NO SOURCE COPY IN fundhub-docs]\n` +
    `Workflow key: ${templateKey}\n` +
    `Intent: ${intent}\n` +
    `Replace this body in the template editor before setting compliance_passed=true.`
  );
}

function channelOf(templateKey) {
  return templateKey.startsWith("SMS-") ? "sms" : "email";
}

// Every SMS-* / EMAIL-* string literal in src/workflows (the requirement list).
export function listWorkflowTemplateKeys({ root = REPO_ROOT } = {}) {
  const keys = new Set();
  for (const rel of listWorkflowFiles(root, ["src/workflows"])) {
    const source = fs.readFileSync(path.join(root, rel), "utf8");
    for (const { key } of findTemplateKeyRefs(source)) {
      if (KEY_SHAPE.test(key)) keys.add(key);
    }
  }
  return [...keys].sort();
}

function knownByKey() {
  const map = new Map();
  for (const t of KNOWN_TEMPLATES) map.set(t.template_key, t);
  return map;
}

/**
 * Extend parsed doc templates with one row per workflow-referenced key.
 * Returns { seedable, coverage } where coverage lists how each workflow key was filled.
 */
export function coverWorkflowKeys(docTemplates, { root = REPO_ROOT } = {}) {
  const byKey = new Map(docTemplates.map((t) => [t.templateKey, t]));
  const known = knownByKey();
  const coverage = [];
  const extras = [];

  for (const workflowKey of listWorkflowTemplateKeys({ root })) {
    if (byKey.has(workflowKey)) {
      coverage.push({ templateKey: workflowKey, source: "doc-exact", detail: workflowKey });
      continue;
    }

    const alias = WORKFLOW_DOC_ALIASES[workflowKey];
    if (alias && byKey.has(alias)) {
      const src = byKey.get(alias);
      const row = {
        ...src,
        templateKey: workflowKey,
        label: `${workflowKey} (alias of ${alias})`,
        aliasedFrom: alias,
        origin: "alias",
      };
      extras.push(row);
      byKey.set(workflowKey, row);
      coverage.push({ templateKey: workflowKey, source: "doc-alias", detail: alias });
      continue;
    }

    const kt = known.get(workflowKey);
    if (kt) {
      const row = {
        templateKey: workflowKey,
        channel: kt.channel,
        subject: kt.subject ?? null,
        body: kt.body,
        compliancePassed: false,
        sourceDoc: "src/workflows/templates-seed.mjs",
        label: `${workflowKey} (templates-seed)`,
        origin: "templates-seed",
      };
      extras.push(row);
      byKey.set(workflowKey, row);
      coverage.push({ templateKey: workflowKey, source: "templates-seed", detail: "KNOWN_TEMPLATES" });
      continue;
    }

    const intent =
      WORKFLOW_DRAFT_INTENTS[workflowKey] ||
      `Placeholder for workflow key ${workflowKey}. Replace before approval.`;
    const channel = channelOf(workflowKey);
    const row = {
      templateKey: workflowKey,
      channel,
      subject: channel === "email" ? `[DRAFT] ${workflowKey}` : null,
      body: draftBody(workflowKey, intent),
      compliancePassed: false,
      sourceDoc: "DRAFT — no matching fundhub-docs copy",
      label: `${workflowKey} (DRAFT)`,
      origin: "draft",
    };
    extras.push(row);
    byKey.set(workflowKey, row);
    coverage.push({ templateKey: workflowKey, source: "draft", detail: intent });
  }

  const seedable = [...docTemplates, ...extras].sort(
    (a, b) => a.channel.localeCompare(b.channel) || a.templateKey.localeCompare(b.templateKey)
  );
  return { seedable, coverage, extras };
}

// Owner decision: nothing sends until a human approves in the template editor.
export function forceCompliancePending(templates) {
  return templates.map((t) => ({ ...t, compliancePassed: false }));
}

export function prepareSeedable(docTemplates, opts = {}) {
  const { seedable, coverage, extras } = coverWorkflowKeys(docTemplates, opts);
  return { seedable: forceCompliancePending(seedable), coverage, extras };
}
