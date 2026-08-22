#!/usr/bin/env node
/**
 * Rebuild editable messaging-review canvas from journey-spine + B prompts.
 * Read-only audit deliverable. Writes outside the repo into Cursor canvases/.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templates = JSON.parse(fs.readFileSync(path.join(__dirname, "_templates.json"), "utf8"));
const byKey = new Map(templates.map((t) => [t.key, t]));

const ALIASES = {
  "SMS-F02-ID-PORTAL-NEEDED": ["SMS-F02-ID-PORTAL-NEEDED", "SMS-F02-01-PORTAL-ID"],
  "SMS-F03-ROUND-SUBMITTED": ["SMS-F03-ROUND-SUBMITTED", "SMS-F03-01-ROUND-SUBMITTED"],
  "SMS-F04-ROUND-APPROVALS": ["SMS-F04-ROUND-APPROVALS", "SMS-F04-01-ROUND-MOVEMENT"],
  "SMS-F06-MISSING-DOCS": ["SMS-F06-MISSING-DOCS", "SMS-F06-01-MISSING-DOCS"],
  "SMS-F07-FUNDING-LOCKED": ["SMS-F07-FUNDING-LOCKED", "SMS-F07-01-LOC"],
  "SMS-F10-INBOX-SETUP": ["SMS-F10-INBOX-SETUP", "SMS-F10-01-INBOX-READY"],
  "SMS-AISET03-MSG1": ["SMS-AISET03-MSG1", "SMS-WF-AI-SET-03-NO-ANSWER-SMS-CADENCE-01"],
  "SMS-AISET03-MSG2": ["SMS-AISET03-MSG2", "SMS-WF-AI-SET-03-NO-ANSWER-SMS-CADENCE-02"],
  "SMS-AISET03-MSG3": ["SMS-AISET03-MSG3", "SMS-WF-AI-SET-03-NO-ANSWER-SMS-CADENCE-03"]
};

function resolve(key) {
  const candidates = ALIASES[key] || [key];
  // Prefer exact key first
  const ordered = [key, ...candidates.filter((c) => c !== key)];
  for (const c of ordered) {
    if (byKey.has(c)) return { ...byKey.get(c), requestedKey: key, resolvedFrom: c };
  }
  return {
    key,
    requestedKey: key,
    resolvedFrom: key,
    channel: "?",
    subject: "",
    body: "(missing from live dump)",
    compliance: "?",
    missing: true
  };
}

const spine = fs.readFileSync(path.join(__dirname, "journey-spine.md"), "utf8");
const items = [];
let stage = "";
let beatId = "";
let beatName = "";
let timing = "";
let kind = "";
let notes = "";
let section = "wired";

const lines = spine.split("\n");
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.startsWith("# Appendix A2")) {
    section = "alias";
    stage = "Appendix — duplicate aliases";
    continue;
  }
  if (line.startsWith("# Appendix A3")) {
    section = "skip";
    continue;
  }
  if (line.startsWith("# Appendix A")) {
    section = "orphan";
    stage = "Appendix — orphans";
    continue;
  }
  if (line.startsWith("# Appendix B")) break;
  if (section === "skip") continue;

  if (
    line.startsWith("# ") &&
    !line.startsWith("# Fundhub") &&
    !line.startsWith("# How") &&
    !line.startsWith("# Appendix")
  ) {
    stage = line.slice(2).trim();
    continue;
  }

  if (line.startsWith("## ") && section === "wired") {
    const m = line.match(/^## ([^\s—-]+)\s*[—-]\s*(.+)/);
    if (m) {
      beatId = m[1];
      beatName = m[2].trim();
    } else {
      beatId = line.slice(3);
      beatName = "";
    }
    timing = "";
    kind = "";
    notes = "";
    continue;
  }
  if (line.startsWith("- Kind:")) {
    kind = line.replace(/^- Kind:\s*\*?\*?/, "").replace(/\*?\*?$/, "").trim();
  }
  if (line.startsWith("- Timing:")) timing = line.slice("- Timing:".length).trim();
  if (line.startsWith("- Note:")) notes = line.slice("- Note:".length).trim();

  if (line.startsWith("### Template ")) {
    const key = line.slice("### Template ".length).trim();
    let j = i + 1;
    let subject = "";
    let channel = "";
    let compliance = "";
    let body = "";
    while (j < lines.length && !lines[j].startsWith("###") && !lines[j].startsWith("## ") && !lines[j].startsWith("# ")) {
      if (lines[j].startsWith("Subject:")) subject = lines[j].slice(8).trim();
      if (lines[j].includes("compliance_passed=")) {
        compliance = (lines[j].match(/compliance_passed=(\w+)/) || [])[1] || "";
        channel = (lines[j].match(/\((\w+)\)/) || [])[1] || channel;
      }
      if (lines[j].startsWith("```")) {
        j++;
        const buf = [];
        while (j < lines.length && !lines[j].startsWith("```")) {
          buf.push(lines[j]);
          j++;
        }
        body = buf.join("\n");
        break;
      }
      j++;
    }
    const t = resolve(key);
    items.push({
      id: key,
      section: "wired",
      stage: stage || "—",
      beatId: beatId || "",
      beatName: beatName || "",
      kind: kind || "—",
      timing: timing || "—",
      notes: notes || "",
      key,
      channel: channel || t.channel || "?",
      subject: subject || t.subject || "",
      body: body || t.body || "",
      compliance: compliance || String(t.compliance) || "?"
    });
  }

  if ((section === "orphan" || section === "alias") && line.startsWith("## ") && !line.startsWith("## Decision")) {
    const key = line.slice(3).trim();
    if (key.startsWith("Appendix")) continue;
    let j = i + 1;
    let subject = "";
    let channel = "";
    let compliance = "";
    let body = "";
    let wiredNote = "";
    while (j < lines.length && !lines[j].startsWith("## ") && !lines[j].startsWith("# ")) {
      if (lines[j].startsWith("Subject:")) subject = lines[j].slice(8).trim();
      if (lines[j].includes("compliance_passed=")) {
        compliance = (lines[j].match(/compliance_passed=(\w+)/) || [])[1] || "";
        channel = (lines[j].match(/\((\w+)\)/) || [])[1] || channel;
      }
      if (lines[j].includes("Wired key workflows send:")) wiredNote = lines[j].trim();
      if (lines[j].startsWith("```")) {
        j++;
        const buf = [];
        while (j < lines.length && !lines[j].startsWith("```")) {
          buf.push(lines[j]);
          j++;
        }
        body = buf.join("\n");
        break;
      }
      j++;
    }
    const t = byKey.get(key) || {};
    items.push({
      id: `${section}:${key}`,
      section: section === "alias" ? "alias" : "orphan",
      stage: section === "alias" ? "Appendix — duplicate aliases" : "Appendix — orphans",
      beatId: section === "alias" ? "alias" : "orphan",
      beatName: section === "alias" ? "Duplicate live row (not sent by workflow)" : "Orphan (no workflow caller)",
      kind: "—",
      timing: section === "alias" ? wiredNote || "duplicate of wired key" : "no workflow caller",
      notes: "",
      key,
      channel: channel || t.channel || "?",
      subject: subject || t.subject || "",
      body: body || t.body || "",
      compliance: compliance || String(t.compliance ?? "?")
    });
  }
}

const b = fs.readFileSync(path.join(__dirname, "B-agent-prompts.md"), "utf8");
const promptBlocks = [];
let cur = null;
const blines = b.split("\n");
for (let i = 0; i < blines.length; i++) {
  if (blines[i].startsWith("## ")) {
    if (cur && cur.body) promptBlocks.push(cur);
    cur = { id: "PROMPT:" + blines[i].replace(/^#+\s*/, "").trim().slice(0, 80), title: blines[i].replace(/^#+\s*/, "").trim(), body: "", bodyStarted: false };
  }
  if (!cur) continue;
  if (blines[i].startsWith("```")) {
    if (!cur.bodyStarted) {
      cur.bodyStarted = true;
      continue;
    }
    cur.bodyStarted = false;
    continue;
  }
  if (cur.bodyStarted) cur.body += blines[i] + "\n";
}
if (cur && cur.body) promptBlocks.push(cur);

for (const p of promptBlocks) {
  if (p.body.trim().length < 40) continue;
  items.push({
    id: p.id,
    section: "prompt",
    stage: "Agent prompts",
    beatId: "prompt",
    beatName: p.title,
    kind: "agentic",
    timing: "see B-agent-prompts / Appendix D in Word",
    notes: "",
    key: p.id,
    channel: "prompt",
    subject: p.title,
    body: p.body.trim(),
    compliance: "n/a"
  });
}

const seen = new Set();
const deduped = [];
for (const it of items) {
  if (seen.has(it.id)) continue;
  seen.add(it.id);
  deduped.push(it);
}

const stages = [...new Set(deduped.map((i) => i.stage))];
const dataLiteral = JSON.stringify({ stages, items: deduped });

const counts = {
  wired: deduped.filter((i) => i.section === "wired").length,
  orphan: deduped.filter((i) => i.section === "orphan").length,
  alias: deduped.filter((i) => i.section === "alias").length,
  prompt: deduped.filter((i) => i.section === "prompt").length
};

const canvas = `/** Messaging review — editable copy + decisions (refreshed 2026-08-21) */
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  H1,
  Pill,
  Row,
  Select,
  Spacer,
  Stack,
  Stat,
  Text,
  TextArea,
  TextInput,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";

const DATA = ${dataLiteral} as {
  stages: string[];
  items: Array<{
    id: string;
    section: "wired" | "orphan" | "alias" | "prompt";
    stage: string;
    beatId: string;
    beatName: string;
    kind: string;
    timing: string;
    notes: string;
    key: string;
    channel: string;
    subject: string;
    body: string;
    compliance: string;
  }>;
};

type Decision = "" | "KEEP" | "CHANGE" | "KILL" | "WRONG-TIME";

type Edit = {
  decision: Decision;
  subject: string;
  body: string;
  notes: string;
};

const DECISION_OPTIONS = [
  { value: "", label: "Decide…" },
  { value: "KEEP", label: "KEEP" },
  { value: "CHANGE", label: "CHANGE" },
  { value: "KILL", label: "KILL" },
  { value: "WRONG-TIME", label: "WRONG-TIME" },
];

const SECTION_OPTIONS = [
  { value: "wired", label: "Journey-wired (~93)" },
  { value: "alias", label: "Duplicate aliases" },
  { value: "orphan", label: "Orphans" },
  { value: "prompt", label: "Agent prompts" },
  { value: "all", label: "All" },
];

function defaultEdit(item: (typeof DATA.items)[0]): Edit {
  return {
    decision: "",
    subject: item.subject || "",
    body: item.body || "",
    notes: "",
  };
}

function decisionTone(d: Decision): "neutral" | "success" | "warning" | "deleted" | "info" {
  if (d === "KEEP") return "success";
  if (d === "CHANGE") return "warning";
  if (d === "KILL") return "deleted";
  if (d === "WRONG-TIME") return "info";
  return "neutral";
}

export default function MessagingReviewCanvas() {
  const theme = useHostTheme();
  const [section, setSection] = useCanvasState<string>("section", "wired");
  const [stage, setStage] = useCanvasState<string>("stage", "__ALL__");
  const [index, setIndex] = useCanvasState<number>("index", 0);
  const [edits, setEdits] = useCanvasState<Record<string, Edit>>("edits", {});
  const [filterUndecided, setFilterUndecided] = useCanvasState<boolean>("filterUndecided", false);

  const stageOptions = [
    { value: "__ALL__", label: "All stages" },
    ...DATA.stages.map((s) => ({ value: s, label: s })),
  ];

  const filtered = DATA.items.filter((it) => {
    if (section !== "all" && it.section !== section) return false;
    if (stage && stage !== "__ALL__" && it.stage !== stage) return false;
    const ed = edits[it.id] || defaultEdit(it);
    if (filterUndecided && ed.decision) return false;
    return true;
  });

  const safeIndex = filtered.length === 0 ? 0 : Math.min(Math.max(0, index), filtered.length - 1);
  const item = filtered[safeIndex];

  const decided = DATA.items.filter((it) => (edits[it.id]?.decision || "") !== "").length;
  const keep = DATA.items.filter((it) => edits[it.id]?.decision === "KEEP").length;
  const change = DATA.items.filter((it) => edits[it.id]?.decision === "CHANGE").length;
  const kill = DATA.items.filter((it) => edits[it.id]?.decision === "KILL").length;
  const wrong = DATA.items.filter((it) => edits[it.id]?.decision === "WRONG-TIME").length;
  const wiredTotal = DATA.items.filter((it) => it.section === "wired").length;
  const wiredDecided = DATA.items.filter((it) => it.section === "wired" && (edits[it.id]?.decision || "") !== "").length;

  function getEdit(id: string, fallback: (typeof DATA.items)[0]): Edit {
    return edits[id] || defaultEdit(fallback);
  }

  function patch(id: string, base: (typeof DATA.items)[0], partial: Partial<Edit>) {
    setEdits((prev) => ({
      ...prev,
      [id]: { ...defaultEdit(base), ...(prev[id] || {}), ...partial },
    }));
  }

  function go(delta: number) {
    if (!filtered.length) return;
    setIndex((i) => {
      const cur = Math.min(Math.max(0, i), filtered.length - 1);
      return Math.min(Math.max(0, cur + delta), filtered.length - 1);
    });
  }

  function exportSummary(): string {
    const lines: string[] = ["# Messaging review decisions", ""];
    for (const it of DATA.items) {
      const ed = edits[it.id];
      if (!ed?.decision) continue;
      lines.push(\`## \${it.key}\`);
      lines.push(\`- Section: \${it.section}\`);
      lines.push(\`- Stage: \${it.stage}\`);
      lines.push(\`- Beat: \${it.beatId} — \${it.beatName}\`);
      lines.push(\`- Decision: \${ed.decision}\`);
      if (ed.notes) lines.push(\`- Notes: \${ed.notes}\`);
      if (ed.decision === "CHANGE" || ed.subject !== it.subject || ed.body !== it.body) {
        if (ed.subject) lines.push(\`- Subject: \${ed.subject}\`);
        lines.push("");
        lines.push("\`\`\`");
        lines.push(ed.body);
        lines.push("\`\`\`");
      }
      lines.push("");
    }
    return lines.join("\\n");
  }

  const [exportText, setExportText] = useCanvasState<string>("exportText", "");

  return (
    <Stack gap={16} style={{ padding: 16, maxWidth: 920 }}>
      <Stack gap={6}>
        <H1>Messaging review</H1>
        <Text tone="secondary">
          Audit pack refreshed. Mark journey-wired first (~{String(wiredTotal)}). Skip orphans until after launch unless you want them.
        </Text>
      </Stack>

      <Row gap={12} wrap>
        <Stat value={\`\${wiredDecided}/\${wiredTotal}\`} label="Wired decided" tone="info" />
        <Stat value={String(decided)} label="All decided" />
        <Stat value={String(keep)} label="KEEP" tone="success" />
        <Stat value={String(change)} label="CHANGE" tone="warning" />
        <Stat value={String(kill)} label="KILL" tone="danger" />
        <Stat value={String(wrong)} label="WRONG-TIME" />
      </Row>

      <Callout tone="warning" title="Not done until you mark">
        Agent inventory is ready. Your job: KEEP / CHANGE / KILL / WRONG-TIME on journey-wired items, then Export decisions into chat.
        compliance_passed is shown on each card — false means it will not send today.
      </Callout>

      <Card>
        <CardHeader>Filters</CardHeader>
        <CardBody>
          <Stack gap={10}>
            <Row gap={12} wrap align="center">
              <Stack gap={4} style={{ minWidth: 200 }}>
                <Text size="small" tone="secondary">Section</Text>
                <Select
                  value={section}
                  onChange={(v) => {
                    setSection(v);
                    setIndex(0);
                  }}
                  options={SECTION_OPTIONS}
                />
              </Stack>
              <Stack gap={4} style={{ minWidth: 260, flex: 1 }}>
                <Text size="small" tone="secondary">Stage</Text>
                <Select
                  value={stage || "__ALL__"}
                  onChange={(v) => {
                    setStage(v);
                    setIndex(0);
                  }}
                  options={stageOptions}
                />
              </Stack>
              <Button
                variant={filterUndecided ? "primary" : "secondary"}
                onClick={() => {
                  setFilterUndecided(!filterUndecided);
                  setIndex(0);
                }}
              >
                {filterUndecided ? "Showing undecided only" : "Show undecided only"}
              </Button>
            </Row>
            <Text size="small" tone="tertiary">
              Showing {filtered.length} item{filtered.length === 1 ? "" : "s"}
              {item ? \` · #\${safeIndex + 1}\` : ""}
            </Text>
          </Stack>
        </CardBody>
      </Card>

      {!item ? (
        <Callout tone="warning" title="Nothing in this filter">
          Clear “undecided only” or pick another stage.
        </Callout>
      ) : (
        <Card>
          <CardHeader
            trailing={
              <Row gap={6}>
                <Pill tone={decisionTone(getEdit(item.id, item).decision)} size="sm">
                  {getEdit(item.id, item).decision || "undecided"}
                </Pill>
                <Pill tone="neutral" size="sm">{item.channel}</Pill>
                <Pill
                  tone={item.compliance === "true" ? "success" : item.compliance === "false" ? "warning" : "neutral"}
                  size="sm"
                >
                  compliance {item.compliance}
                </Pill>
              </Row>
            }
          >
            {item.key}
          </CardHeader>
          <CardBody>
            <Stack gap={12}>
              <Stack gap={4}>
                <Text weight="semibold">{item.beatName}</Text>
                <Text size="small" tone="secondary">
                  {item.stage} · beat {item.beatId} · {item.kind}
                </Text>
                <Text size="small">{item.timing}</Text>
                {item.notes ? (
                  <Text size="small" tone="secondary">
                    Note: {item.notes}
                  </Text>
                ) : null}
              </Stack>

              <Divider />

              <Stack gap={4}>
                <Text size="small" tone="secondary">Decision</Text>
                <Select
                  value={getEdit(item.id, item).decision}
                  onChange={(v) => patch(item.id, item, { decision: v as Decision })}
                  options={DECISION_OPTIONS}
                />
              </Stack>

              <Stack gap={4}>
                <Text size="small" tone="secondary">Subject (email) / title</Text>
                <TextInput
                  value={getEdit(item.id, item).subject}
                  onChange={(v) => patch(item.id, item, { subject: v })}
                  placeholder="Subject or title"
                />
              </Stack>

              <Stack gap={4}>
                <Text size="small" tone="secondary">Body / prompt — edit freely</Text>
                <TextArea
                  value={getEdit(item.id, item).body}
                  onChange={(v) => patch(item.id, item, { body: v })}
                  rows={12}
                  placeholder="Message body"
                />
              </Stack>

              <Stack gap={4}>
                <Text size="small" tone="secondary">Your notes (why / new timing)</Text>
                <TextArea
                  value={getEdit(item.id, item).notes}
                  onChange={(v) => patch(item.id, item, { notes: v })}
                  rows={3}
                  placeholder="e.g. move to after deposit; cut day-of duplicate"
                />
              </Stack>

              <Row gap={8} align="center">
                <Button variant="secondary" disabled={safeIndex <= 0} onClick={() => go(-1)}>
                  Previous
                </Button>
                <Button
                  variant="primary"
                  disabled={safeIndex >= filtered.length - 1}
                  onClick={() => go(1)}
                >
                  Next
                </Button>
                <Spacer />
                <Text size="small" tone="tertiary">
                  {safeIndex + 1} / {filtered.length}
                </Text>
              </Row>

              <Row gap={8} wrap>
                {(["KEEP", "CHANGE", "KILL", "WRONG-TIME"] as Decision[]).map((d) => (
                  <Button
                    key={d}
                    variant={getEdit(item.id, item).decision === d ? "primary" : "secondary"}
                    onClick={() => {
                      patch(item.id, item, { decision: d });
                      if (safeIndex < filtered.length - 1) go(1);
                    }}
                  >
                    {d}
                  </Button>
                ))}
              </Row>
            </Stack>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>Export for chat</CardHeader>
        <CardBody>
          <Stack gap={10}>
            <Text size="small" tone="secondary">
              Click Export, then copy the box and paste it in chat so fixes can start.
            </Text>
            <Button variant="primary" onClick={() => setExportText(exportSummary())}>
              Export decisions
            </Button>
            {exportText ? (
              <TextArea value={exportText} onChange={setExportText} rows={10} />
            ) : null}
          </Stack>
        </CardBody>
      </Card>

      <Text size="small" tone="tertiary" style={{ color: theme.text.tertiary }}>
        Source: live dump 2026-08-20 · pack refresh 2026-08-21 · {DATA.items.length} items
      </Text>
    </Stack>
  );
}
`;

const out =
  "/Users/zootimusmaximus/.cursor/projects/Users-zootimusmaximus-fundhub-platform/canvases/messaging-review.canvas.tsx";
fs.writeFileSync(out, canvas);
console.log("wrote", out, "bytes", canvas.length, counts);
