/**
 * Messaging timing — 4 life-moment overlap view (2026-08-21).
 * Marks: TWEAK / MOVE / ADD-REPAIR (not KEEP/KILL).
 * Source: C-timing-audit.md + journey-spine Appendix A3.
 */
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Select,
  Spacer,
  Stack,
  Stat,
  Text,
  TextArea,
  computeDAGLayout,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";

type Mark = "" | "TWEAK" | "MOVE" | "ADD-REPAIR" | "OK";

type FlowItem = {
  id: string;
  label: string;
  timing: string;
  note?: string;
};

type Moment = {
  id: string;
  title: string;
  plain: string;
  trigger: string;
  risk: string;
  items: FlowItem[];
  repairHint?: string;
};

const MARK_OPTIONS = [
  { value: "", label: "Mark…" },
  { value: "OK", label: "OK (fine)" },
  { value: "TWEAK", label: "TWEAK (copy / wait)" },
  { value: "MOVE", label: "MOVE (different step)" },
  { value: "ADD-REPAIR", label: "ADD-REPAIR (missing)" },
];

const MOMENTS: Moment[] = [
  {
    id: "booked",
    title: "1. They booked a call",
    plain: "One book click can wake a whole pile of workflows at once.",
    trigger: "booking.created",
    risk: "Too many texts / emails before the call",
    items: [
      { id: "s-04", label: "S-04 Call booked", timing: "Immediate", note: "Pipeline move" },
      { id: "s-04b", label: "S-04B Reminders", timing: "Confirm + T−24h + T−2h SMS" },
      { id: "bs-01", label: "BS-01 Precall", timing: "3 SMS + fund/repair email grid" },
      { id: "ai-set-01", label: "AI-SET-01 Josh setter", timing: "Immediate dial" },
      { id: "ai-set-04", label: "AI-SET-04 Handoff", timing: "T−15 SMS" },
      { id: "dpc-05", label: "DPC-05 No progress", timing: "Wait 72h" },
      { id: "n-03", label: "N-03 Hot nurture", timing: "May also enroll" },
      { id: "dpc-02", label: "DPC-02 Outcome gate", timing: "5 min after end" },
    ],
    repairHint: "BS-REPAIR grid incomplete — 6 night/day-2 slots missing from live dump.",
  },
  {
    id: "survey",
    title: "2. They finished the survey",
    plain: "Warm nurture and “book a call” chase start together.",
    trigger: "survey.submitted",
    risk: "Nurture + chase can feel like spam if they already plan to book",
    items: [
      { id: "n-02", label: "N-02 Warm nurture", timing: "Immediate enroll" },
      { id: "s-nobook", label: "S-NOBOOK Chase", timing: "2h → 24h → 72h SMS" },
    ],
  },
  {
    id: "round",
    title: "3. Funding round starts",
    plain: "Client gets notified while intake, ID chase, and inbox setup also fire.",
    trigger: "round.started",
    risk: "Three tracks at once — notify + docs + inbox",
    items: [
      { id: "round-sms", label: "Round-started SMS", timing: "Immediate" },
      { id: "f-01", label: "F-01 Funding intake", timing: "Immediate" },
      { id: "f-02", label: "F-02 Portal ID missing", timing: "3h then +2d" },
      { id: "f-10", label: "F-10 Inbox setup", timing: "Immediate" },
      { id: "bc-01", label: "BC-01 Responsiveness", timing: "24h / 48h scores" },
      { id: "bc-02", label: "BC-02 Friction", timing: "Immediate" },
      { id: "c-05", label: "C-05 Pre-funding review", timing: "Immediate" },
    ],
  },
  {
    id: "dayof",
    title: "4. Two hours before the call",
    plain: "Two different workflows can text at the same moment.",
    trigger: "T−2h (from booking.created waits)",
    risk: "Double day-of SMS",
    items: [
      { id: "bs-dayof", label: "BS-01 DAYOF SMS", timing: "T−2h" },
      { id: "s04b-2h", label: "S-04B Remind T−2h", timing: "T−2h" },
    ],
  },
];

const REPAIR_GAPS = [
  "BS-REPAIR-D1-E6-night",
  "BS-REPAIR-D2-E1-morning",
  "BS-REPAIR-D2-E2-midmorning",
  "BS-REPAIR-D2-E3-lunch",
  "BS-REPAIR-D2-E4-afternoon",
  "BS-REPAIR-D2-E5-evening",
];

const EXISTING_REPAIR = [
  { id: "ds-01", label: "DS-01 Repair referral", when: "After call (repair path)" },
  { id: "ds-02", label: "DS-02 DIY letters", when: "DIY payment" },
  { id: "bureau", label: "Bureau response reader", when: "Docs arrive" },
  { id: "inquiry", label: "Inquiry call sweeper", when: "Every 15 min cron" },
  { id: "c-03", label: "Inquiry removed → resume/hold", when: "inquiry.removed" },
];

type Edits = Record<string, { mark: Mark; notes: string }>;

function markTone(m: Mark): "neutral" | "success" | "warning" | "info" | "deleted" {
  if (m === "OK") return "success";
  if (m === "TWEAK") return "warning";
  if (m === "MOVE") return "info";
  if (m === "ADD-REPAIR") return "deleted";
  return "neutral";
}

function MomentFlow({ momentId, items }: { momentId: string; items: FlowItem[] }) {
  const theme = useHostTheme();
  const root = `${momentId}-root`;
  const nodes = [{ id: root }, ...items.map((i) => ({ id: i.id }))];
  const edges = items.map((i) => ({ from: root, to: i.id }));
  const layout = computeDAGLayout({
    nodes,
    edges,
    direction: "horizontal",
    nodeWidth: 148,
    nodeHeight: 52,
    rankGap: 56,
    nodeGap: 12,
    padding: 8,
  });
  const byId = Object.fromEntries(layout.nodes.map((n) => [n.id, n]));
  const labelFor = (id: string) => {
    if (id === root) return "LIFE MOMENT";
    return items.find((i) => i.id === id)?.label ?? id;
  };
  const subFor = (id: string) => {
    if (id === root) return "";
    return items.find((i) => i.id === id)?.timing ?? "";
  };

  return (
    <div style={{ position: "relative", width: layout.width, height: layout.height, maxWidth: "100%", overflowX: "auto" }}>
      <svg width={layout.width} height={layout.height} style={{ position: "absolute", inset: 0 }}>
        {layout.edges.map((e, idx) => (
          <line
            key={idx}
            x1={e.sourceX}
            y1={e.sourceY}
            x2={e.targetX}
            y2={e.targetY}
            stroke={theme.stroke.secondary}
            strokeWidth={1.5}
          />
        ))}
      </svg>
      {layout.nodes.map((n) => {
        const isRoot = n.id === root;
        return (
          <div
            key={n.id}
            style={{
              position: "absolute",
              left: n.x,
              top: n.y,
              width: 148,
              height: 52,
              boxSizing: "border-box",
              padding: "6px 8px",
              borderRadius: 6,
              border: `1px solid ${isRoot ? theme.stroke.primary : theme.stroke.secondary}`,
              background: isRoot ? theme.fill.tertiary : theme.fill.primary,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 2,
            }}
          >
            <Text size="small" weight="semibold" style={{ lineHeight: 1.2 }}>
              {labelFor(n.id)}
            </Text>
            {subFor(n.id) ? (
              <Text size="small" tone="secondary" style={{ lineHeight: 1.15 }}>
                {subFor(n.id)}
              </Text>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function MessagingFourMoments() {
  const [edits, setEdits] = useCanvasState<Edits>("marks", {});
  const [exportText, setExportText] = useCanvasState<string>("exportText", "");
  const [active, setActive] = useCanvasState<string>("activeMoment", "booked");

  const moment = MOMENTS.find((m) => m.id === active) ?? MOMENTS[0];
  const allIds = [
    ...MOMENTS.flatMap((m) => m.items.map((i) => i.id)),
    ...REPAIR_GAPS,
  ];
  const marked = allIds.filter((id) => (edits[id]?.mark || "") !== "").length;
  const tweaks = allIds.filter((id) => edits[id]?.mark === "TWEAK").length;
  const moves = allIds.filter((id) => edits[id]?.mark === "MOVE").length;
  const adds = allIds.filter((id) => edits[id]?.mark === "ADD-REPAIR").length;

  function patch(id: string, partial: Partial<{ mark: Mark; notes: string }>) {
    setEdits({
      ...edits,
      [id]: {
        mark: edits[id]?.mark ?? "",
        notes: edits[id]?.notes ?? "",
        ...partial,
      },
    });
  }

  function buildExport() {
    const lines: string[] = [
      "# Messaging 4-moment marks",
      "",
      "Tonight framing: TWEAK / MOVE / ADD-REPAIR (not KEEP/KILL).",
      "",
    ];
    for (const m of MOMENTS) {
      lines.push(`## ${m.title} (${m.trigger})`);
      for (const item of m.items) {
        const ed = edits[item.id];
        if (!ed?.mark) continue;
        lines.push(`- ${item.label}: ${ed.mark}${ed.notes ? ` — ${ed.notes}` : ""}`);
      }
      lines.push("");
    }
    lines.push("## Missing repair grid slots");
    for (const key of REPAIR_GAPS) {
      const ed = edits[key];
      if (!ed?.mark) continue;
      lines.push(`- ${key}: ${ed.mark}${ed.notes ? ` — ${ed.notes}` : ""}`);
    }
    setExportText(lines.join("\n"));
  }

  return (
    <Stack gap={16} style={{ padding: 16, maxWidth: 960 }}>
      <Stack gap={6}>
        <H1>Messaging — 4 life moments</H1>
        <Text tone="secondary">
          Visual timing overlap from the 2026-08-21 audit. Tonight: slight tweaks + spot missing repair — not kill the system.
        </Text>
      </Stack>

      <Row gap={12} style={{ flexWrap: "wrap" }}>
        <Stat value={String(MOMENTS.length)} label="Life moments" />
        <Stat value={String(marked)} label="Marked" />
        <Stat value={String(tweaks)} label="TWEAK" tone="warning" />
        <Stat value={String(moves)} label="MOVE" tone="info" />
        <Stat value={String(adds)} label="ADD-REPAIR" tone="danger" />
      </Row>

      <Callout tone="info" title="How to mark tonight">
        Use TWEAK (change wait or copy), MOVE (fire at a different step), or ADD-REPAIR (something repair-related is missing). OK means leave it. Skip KEEP/KILL as the main job.
      </Callout>

      <Row gap={8} style={{ flexWrap: "wrap" }}>
        {MOMENTS.map((m) => (
          <div key={m.id}>
            <Button
              variant={active === m.id ? "primary" : "secondary"}
              onClick={() => setActive(m.id)}
            >
              {m.title.replace(/^\d+\.\s*/, "")}
            </Button>
          </div>
        ))}
      </Row>

      <Card>
        <CardHeader trailing={<Pill tone="warning" size="sm">{moment.risk}</Pill>}>
          {moment.title}
        </CardHeader>
        <CardBody>
          <Stack gap={12}>
            <Text>{moment.plain}</Text>
            <Row gap={8} style={{ flexWrap: "wrap" }}>
              <Pill size="sm">Trigger: {moment.trigger}</Pill>
              <Pill size="sm" tone="neutral">
                {moment.items.length} workflows in the pile
              </Pill>
            </Row>
            <MomentFlow momentId={moment.id} items={moment.items} />
            {moment.repairHint ? (
              <Callout tone="warning" title="Repair gap on this pile">
                {moment.repairHint}
              </Callout>
            ) : null}
            <Divider />
            <H3>Mark each piece</H3>
            {moment.items.map((item) => {
              const ed = edits[item.id] ?? { mark: "" as Mark, notes: "" };
              return (
                <div key={item.id}>
                  <Stack gap={6}>
                    <Row gap={8} align="center" style={{ flexWrap: "wrap" }}>
                      <Text weight="semibold" style={{ minWidth: 180 }}>
                        {item.label}
                      </Text>
                      <Pill tone={markTone(ed.mark)} size="sm">
                        {ed.mark || "undecided"}
                      </Pill>
                      <Text size="small" tone="secondary">
                        {item.timing}
                      </Text>
                    </Row>
                    {item.note ? (
                      <Text size="small" tone="secondary">
                        {item.note}
                      </Text>
                    ) : null}
                    <Row gap={8} style={{ flexWrap: "wrap" }} align="start">
                      <Select
                        value={ed.mark}
                        onChange={(v) => patch(item.id, { mark: v as Mark })}
                        options={MARK_OPTIONS}
                      />
                      <TextArea
                        value={ed.notes}
                        onChange={(v) => patch(item.id, { notes: v })}
                        placeholder="Optional note (e.g. wait 24h not 2h)"
                        rows={2}
                        style={{ flex: 1, minWidth: 220 }}
                      />
                    </Row>
                  </Stack>
                </div>
              );
            })}
          </Stack>
        </CardBody>
      </Card>

      <Stack gap={8}>
        <H2>Repair lane — what exists vs missing</H2>
        <Text tone="secondary">
          Existing repair workflows are thin. Missing BS-REPAIR email slots are the clearest “add repair” marks from the audit.
        </Text>
        <Row gap={12} style={{ flexWrap: "wrap", alignItems: "stretch" }}>
          <Card style={{ flex: 1, minWidth: 260 }}>
            <CardHeader>Already wired</CardHeader>
            <CardBody>
              <Stack gap={8}>
                {EXISTING_REPAIR.map((r) => (
                  <div key={r.id}>
                    <Stack gap={2}>
                      <Text weight="semibold">{r.label}</Text>
                      <Text size="small" tone="secondary">
                        {r.when}
                      </Text>
                    </Stack>
                  </div>
                ))}
              </Stack>
            </CardBody>
          </Card>
          <Card style={{ flex: 1, minWidth: 260 }}>
            <CardHeader trailing={<Pill tone="deleted" size="sm">6 gaps</Pill>}>
              Missing BS-REPAIR slots
            </CardHeader>
            <CardBody>
              <Stack gap={10}>
                {REPAIR_GAPS.map((key) => {
                  const ed = edits[key] ?? { mark: "" as Mark, notes: "" };
                  return (
                    <div key={key}>
                      <Stack gap={4}>
                        <Text size="small" weight="semibold">
                          {key}
                        </Text>
                        <Select
                          value={ed.mark}
                          onChange={(v) => patch(key, { mark: v as Mark })}
                          options={MARK_OPTIONS}
                        />
                      </Stack>
                    </div>
                  );
                })}
              </Stack>
            </CardBody>
          </Card>
        </Row>
      </Stack>

      <Divider />
      <Row gap={8} align="center" style={{ flexWrap: "wrap" }}>
        <Button variant="primary" onClick={buildExport}>
          Export marks
        </Button>
        <Text size="small" tone="secondary">
          Paste export into chat when you want Fixer to start.
        </Text>
      </Row>
      {exportText ? (
        <TextArea value={exportText} onChange={setExportText} rows={12} />
      ) : null}
      <Spacer />
      <Text size="small" tone="secondary">
        Source: docs/workflows/messaging-review-2026-08-21-evidence/C-timing-audit.md · Appendix A3 in journey-spine.md. Older canvases still use KEEP/KILL — prefer this view tonight.
      </Text>
    </Stack>
  );
}
