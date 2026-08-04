import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKFLOW_DOC_ALIASES,
  coverWorkflowKeys,
  forceCompliancePending,
  listWorkflowTemplateKeys,
  prepareSeedable,
} from "./workflow-keys.mjs";

const DOC = [
  {
    templateKey: "SMS-F03-01-ROUND-SUBMITTED",
    channel: "sms",
    subject: null,
    body: "Hey {{contact.first_name}} — round submitted. Reply STOP to opt out.",
    compliancePassed: true,
    sourceDoc: "fundhub-docs/sources/SMS-Compliant-Rewrites.md",
    label: "SMS-F03-01-ROUND-SUBMITTED",
  },
  {
    templateKey: "F-03",
    channel: "email",
    subject: "Round submitted",
    body: "Hey {{contact.first_name}}, submitted.",
    compliancePassed: false,
    sourceDoc: "fundhub-docs/sources/EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md",
    label: "F-03",
  },
  {
    templateKey: "SMS-WF-AI-SET-03-NO-ANSWER-SMS-CADENCE-01",
    channel: "sms",
    subject: null,
    body: "Msg1 body. Reply STOP to opt out.",
    compliancePassed: true,
    sourceDoc: "fundhub-docs/sources/Workflow-SMS-Fixes-Ready-to-Paste.md",
    label: "AI-SET-03 msg1",
  },
];

test("listWorkflowTemplateKeys: finds SMS-/EMAIL- keys under src/workflows", () => {
  const keys = listWorkflowTemplateKeys();
  assert.ok(keys.includes("SMS-F03-ROUND-SUBMITTED"));
  assert.ok(keys.includes("EMAIL-F03-ROUND-SUBMITTED"));
  assert.ok(keys.every((k) => /^(SMS|EMAIL)-/.test(k)));
});

test("coverWorkflowKeys: aliases workflow key to doc copy verbatim", () => {
  const { seedable, coverage } = coverWorkflowKeys(DOC);
  const row = seedable.find((t) => t.templateKey === "SMS-F03-ROUND-SUBMITTED");
  assert.ok(row);
  assert.equal(row.body, DOC[0].body);
  assert.equal(row.aliasedFrom, "SMS-F03-01-ROUND-SUBMITTED");
  assert.equal(
    coverage.find((c) => c.templateKey === "SMS-F03-ROUND-SUBMITTED").source,
    "doc-alias"
  );
});

test("coverWorkflowKeys: DRAFT rows are obvious and do not invent claims", () => {
  const { seedable, coverage } = coverWorkflowKeys(DOC);
  const row = seedable.find((t) => t.templateKey === "SMS-N01-COLD-NURTURE");
  assert.ok(row);
  assert.match(row.body, /\[DRAFT — NO SOURCE COPY/);
  assert.ok(!/guaranteed|improve your credit|approval rate/i.test(row.body));
  assert.equal(coverage.find((c) => c.templateKey === "SMS-N01-COLD-NURTURE").source, "draft");
});

test("coverWorkflowKeys: templates-seed fills DPC04 when docs have no match", () => {
  const { seedable, coverage } = coverWorkflowKeys(DOC);
  const row = seedable.find((t) => t.templateKey === "SMS-DPC04-RESCHEDULE-REBOOKING");
  assert.ok(row);
  assert.match(row.body, /reschedule/i);
  assert.equal(row.sourceDoc, "src/workflows/templates-seed.mjs");
  assert.equal(
    coverage.find((c) => c.templateKey === "SMS-DPC04-RESCHEDULE-REBOOKING").source,
    "templates-seed"
  );
});

test("forceCompliancePending: every row is false", () => {
  const out = forceCompliancePending(DOC);
  assert.ok(out.every((t) => t.compliancePassed === false));
});

test("prepareSeedable: aliases + drafts + compliance_passed false", () => {
  const { seedable, coverage } = prepareSeedable(DOC);
  assert.ok(seedable.every((t) => t.compliancePassed === false));
  assert.ok(coverage.some((c) => c.source === "doc-alias"));
  assert.ok(coverage.some((c) => c.source === "draft"));
  assert.ok(WORKFLOW_DOC_ALIASES["SMS-F03-ROUND-SUBMITTED"]);
  assert.ok(seedable.find((t) => t.templateKey === "EMAIL-F03-ROUND-SUBMITTED"));
});
