/**
 * Workflows ONLY — life-moment piles + repair holes (2026-08-21).
 * Marks: TWEAK timing / MOVE trigger / ADD-REPAIR / OK.
 * Not messaging KEEP/KILL. Not template copy.
 * Source: C-timing-audit.md + src/workflows/index.mjs.
 */
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
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

type WfNode = {
  /** Stable mark key */
  key: string;
  /** Inngest function id */
  id: string;
  /** Short plain label */
  label: string;
  /** When it fires relative to the moment */
  when: string;
  /** Optional overlap / risk note */
  note?: string;
};

type Pile = {
  id: string;
  title: string;
  plain: string;
  event: string;
  risk: string;
  nodes: WfNode[];
};

const MARK_OPTIONS = [
  { value: "", label: "Mark…" },
  { value: "OK", label: "OK" },
  { value: "TWEAK", label: "TWEAK timing" },
  { value: "MOVE", label: "MOVE trigger" },
  { value: "ADD-REPAIR", label: "ADD-REPAIR" },
];

/** Four life-moment piles from C-timing-audit findings 2–5. */
const PILES: Pile[] = [
  {
    id: "booked",
    title: "1. Booked call",
    plain: "One booking event wakes a big pile at once.",
    event: "booking.created",
    risk: "Too many workflows before the call",
    nodes: [
      {
        key: "booked-s04",
        id: "s-04-call-booked",
        label: "S-04 Call booked",
        when: "Immediate — pipeline only",
        note: "No client SMS",
      },
      {
        key: "booked-s04b",
        id: "s-04b-booking-reminders",
        label: "S-04B Confirm + reminders",
        when: "Confirm → T−24h → T−2h SMS",
      },
      {
        key: "booked-bs01",
        id: "bs-01-precall-launcher",
        label: "BS-01 Precall launcher",
        when: "3 SMS + BS-FUND / BS-REPAIR email grid",
        note: "Repair path uses BS-REPAIR-* cells",
      },
      {
        key: "booked-aiset01",
        id: "ai-set-01-josh-setter",
        label: "AI-SET-01 Josh setter",
        when: "Immediate dial (agentic)",
      },
      {
        key: "booked-aiset04",
        id: "ai-set-04-3way-handoff",
        label: "AI-SET-04 3-way handoff",
        when: "Sleep until T−15 SMS",
      },
      {
        key: "booked-dpc05",
        id: "dpc-05-no-progress-escalation",
        label: "DPC-05 No-progress",
        when: "Wait 72h",
      },
      {
        key: "booked-dpc02",
        id: "dpc-02-call-outcome-enforcement",
        label: "DPC-02 Outcome gate",
        when: "5 min after call end",
      },
      {
        key: "booked-n03",
        id: "n-03-hot-nurture",
        label: "N-03 Hot nurture",
        when: "Also on booking.created",
        note: "Overlap with precall pile",
      },
    ],
  },
  {
    id: "survey",
    title: "2. Survey done / no book",
    plain: "Warm nurture and book-chase start together.",
    event: "survey.submitted",
    risk: "Nurture + chase can pile up",
    nodes: [
      {
        key: "survey-n02",
        id: "n-02-warm-nurture",
        label: "N-02 Warm nurture",
        when: "Immediate enroll",
      },
      {
        key: "survey-nobook",
        id: "s-nobook-chase",
        label: "S-NOBOOK Chase",
        when: "2h → 24h → 72h SMS",
        note: "Stops when booking.created fires",
      },
    ],
  },
  {
    id: "round",
    title: "3. Round starts",
    plain: "Notify, intake, ID chase, and inbox all wake.",
    event: "round.started",
    risk: "Three client tracks + scoring",
    nodes: [
      {
        key: "round-notify",
        id: "round-started-client-notify",
        label: "Round-started notify",
        when: "Immediate SMS",
      },
      {
        key: "round-f01",
        id: "f-01-funding-intake",
        label: "F-01 Funding intake",
        when: "Immediate",
      },
      {
        key: "round-f02",
        id: "f-02-portal-id-missing",
        label: "F-02 Portal / ID missing",
        when: "Wait 3h → follow-up +2d",
      },
      {
        key: "round-f10",
        id: "f-10-client-funding-inbox-provisioner",
        label: "F-10 Inbox provisioner",
        when: "Immediate",
      },
      {
        key: "round-c05",
        id: "c-05-pre-funding-review",
        label: "C-05 Pre-funding review",
        when: "Immediate",
      },
      {
        key: "round-bc01",
        id: "bc-01-customer-responsiveness",
        label: "BC-01 Responsiveness",
        when: "Score waits 24h / 48h",
      },
      {
        key: "round-bc02",
        id: "bc-02-customer-friction",
        label: "BC-02 Friction",
        when: "Immediate score",
      },
    ],
  },
  {
    id: "t2h",
    title: "4. T−2h collision",
    plain: "Two workflows can text at the same clock time.",
    event: "Waits from booking.created",
    risk: "Double day-of SMS",
    nodes: [
      {
        key: "t2h-bs01",
        id: "bs-01-precall-launcher",
        label: "BS-01 DAYOF SMS",
        when: "SMS-BS01-03-DAYOF at T−2h",
        note: "Same workflow as pile 1 — day-of leg",
      },
      {
        key: "t2h-s04b",
        id: "s-04b-booking-reminders",
        label: "S-04B Remind T−2h",
        when: "SMS-S04-03-REMIND-2H at T−2h",
        note: "Same workflow as pile 1 — last reminder",
      },
      {
        key: "t2h-aiset04",
        id: "ai-set-04-3way-handoff",
        label: "AI-SET-04 nearby",
        when: "T−15 (close to day-of)",
        note: "Not exact T−2h but same window",
      },
    ],
  },
];

/** Missing BS-REPAIR grid slots — Appendix A3 / finding 10. */
const BS_REPAIR_GAPS = [
  "BS-REPAIR-D1-E6-night",
  "BS-REPAIR-D2-E1-morning",
  "BS-REPAIR-D2-E2-midmorning",
  "BS-REPAIR-D2-E3-lunch",
  "BS-REPAIR-D2-E4-afternoon",
  "BS-REPAIR-D2-E5-evening",
];

/** Repair-related workflows that already exist (registered). */
const REPAIR_WIRED = [
  {
    id: "bs-01-precall-launcher",
    label: "BS-01 → BS-REPAIR grid",
    when: "booking.created when repair path",
    hole: "6 grid cells missing in live dump",
  },
  {
    id: "ds-01-repair-referral",
    label: "DS-01 Repair referral",
    when: "call.completed (repair path)",
  },
  {
    id: "ds-02-diy-letters",
    label: "DS-02 DIY letters",
    when: "payment.received (DIY)",
  },
  {
    id: "repair-bureau-response-reader",
    label: "Bureau response reader",
    when: "docs.received (agentic)",
  },
  {
    id: "inquiry-call-sweeper",
    label: "Inquiry call sweeper",
    when: "cron every 15 min (agentic)",
  },
  {
    id: "c-02b-inquiry-removal-requested",
    label: "C-02B Inquiry removal",
    when: "deposit.paid",
  },
  {
    id: "c-03-inquiry-removed-resume-or-hold",
    label: "C-03 Resume or hold",
    when: "inquiry.removed",
  },
];

type Edits = Record<string, { mark: Mark; notes: string }>;

function markTone(m: Mark): "neutral" | "success" | "warning" | "info" | "deleted" {
  if (m === "OK") return "success";
  if (m === "TWEAK") return "warning";
  if (m === "MOVE") return "info";
  if (m === "ADD-REPAIR") return "deleted";
  return "neutral";
}

function FanOutDiagram({ pile }: { pile: Pile }) {
  const theme = useHostTheme();
  const root = `${pile.id}__evt`;
  const nodes = [{ id: root }, ...pile.nodes.map((n) => ({ id: n.key }))];
  const edges = pile.nodes.map((n) => ({ from: root, to: n.key }));
  const layout = computeDAGLayout({
    nodes,
    edges,
    direction: "vertical",
    nodeWidth: 168,
    nodeHeight: 56,
    rankGap: 40,
    nodeGap: 10,
    padding: 6,
  });
  const labelFor = (nid: string) => {
    if (nid === root) return pile.event;
    return pile.nodes.find((n) => n.key === nid)?.label ?? nid;
  };
  const subFor = (nid: string) => {
    if (nid === root) return "trigger";
    const n = pile.nodes.find((x) => x.key === nid);
    return n ? n.id : "";
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: Math.min(layout.height, 420),
        overflow: "auto",
      }}
    >
      <div style={{ position: "relative", width: layout.width, height: layout.height }}>
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
                width: 168,
                height: 56,
                boxSizing: "border-box",
                padding: "6px 8px",
                borderRadius: 6,
                border: `1px solid ${isRoot ? theme.accent.primary : theme.stroke.secondary}`,
                background: isRoot ? theme.fill.tertiary : theme.bg.elevated,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 2,
              }}
            >
              <Text size="small" weight="semibold" style={{ lineHeight: 1.2 }}>
                {labelFor(n.id)}
              </Text>
              <Text size="small" tone="secondary" style={{ lineHeight: 1.15 }}>
                {subFor(n.id)}
              </Text>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function WorkflowsFlowchart() {
  const [edits, setEdits] = useCanvasState<Edits>("wfMarks", {});
  const [exportText, setExportText] = useCanvasState<string>("wfExport", "");
  const [focus, setFocus] = useCanvasState<string>("wfFocus", "booked");

  const pile = PILES.find((p) => p.id === focus) ?? PILES[0];
  const allKeys = [
    ...PILES.flatMap((p) => p.nodes.map((n) => n.key)),
    ...BS_REPAIR_GAPS.map((k) => `gap-${k}`),
    "gap-ax07",
  ];
  const marked = allKeys.filter((k) => (edits[k]?.mark || "") !== "").length;
  const tweaks = allKeys.filter((k) => edits[k]?.mark === "TWEAK").length;
  const moves = allKeys.filter((k) => edits[k]?.mark === "MOVE").length;
  const adds = allKeys.filter((k) => edits[k]?.mark === "ADD-REPAIR").length;

  function patch(key: string, partial: Partial<{ mark: Mark; notes: string }>) {
    setEdits({
      ...edits,
      [key]: {
        mark: edits[key]?.mark ?? "",
        notes: edits[key]?.notes ?? "",
        ...partial,
      },
    });
  }

  function buildExport() {
    const lines: string[] = [
      "# Workflows flowchart marks",
      "",
      "Marks: OK / TWEAK timing / MOVE trigger / ADD-REPAIR",
      "Not messaging KEEP/KILL.",
      "",
    ];
    for (const p of PILES) {
      lines.push(`## ${p.title} (${p.event})`);
      for (const n of p.nodes) {
        const ed = edits[n.key];
        if (!ed?.mark) continue;
        lines.push(`- ${n.id}: ${ed.mark}${ed.notes ? ` — ${ed.notes}` : ""}`);
      }
      lines.push("");
    }
    lines.push("## Missing BS-REPAIR slots");
    for (const slot of BS_REPAIR_GAPS) {
      const ed = edits[`gap-${slot}`];
      if (!ed?.mark) continue;
      lines.push(`- ${slot}: ${ed.mark}${ed.notes ? ` — ${ed.notes}` : ""}`);
    }
    const ax = edits["gap-ax07"];
    if (ax?.mark) {
      lines.push("");
      lines.push(`## Other gap`);
      lines.push(`- AX-07 (no workflow caller): ${ax.mark}${ax.notes ? ` — ${ax.notes}` : ""}`);
    }
    setExportText(lines.join("\n"));
  }

  return (
    <Stack gap={16} style={{ padding: 16, maxWidth: 1100 }}>
      <Stack gap={6}>
        <H1>Workflows — life moments + repair holes</H1>
        <Text tone="secondary">
          Inngest piles only. Real function ids from src/workflows/index.mjs. No template copy. No Josh voice. No KEEP/KILL messaging.
        </Text>
      </Stack>

      <Row gap={12} style={{ flexWrap: "wrap" }}>
        <Stat value="4" label="Life piles" />
        <Stat value={String(marked)} label="Marked" />
        <Stat value={String(tweaks)} label="TWEAK" tone="warning" />
        <Stat value={String(moves)} label="MOVE" tone="info" />
        <Stat value={String(adds)} label="ADD-REPAIR" tone="danger" />
      </Row>

      <Callout tone="info" title="How to mark">
        Pick one pile. Mark each workflow OK, TWEAK timing, MOVE trigger, or ADD-REPAIR. Export when done — Fixer waits for your marks.
      </Callout>

      <H2>All four piles at a glance</H2>
      <Row gap={8} style={{ flexWrap: "wrap" }}>
        {PILES.map((p) => (
          <div key={p.id}>
            <Button
              variant={focus === p.id ? "primary" : "secondary"}
              onClick={() => setFocus(p.id)}
            >
              {p.title}
            </Button>
          </div>
        ))}
      </Row>
      <Grid columns={4} gap={12}>
        {PILES.map((p) => (
          <div key={p.id}>
            <Card>
              <CardHeader trailing={<Pill tone="warning" size="sm">{p.nodes.length}</Pill>}>
                {p.title}
              </CardHeader>
              <CardBody>
                <Stack gap={6}>
                  <Text size="small">{p.plain}</Text>
                  <Pill size="sm">{p.event}</Pill>
                  <Text size="small" tone="secondary">
                    {p.risk}
                  </Text>
                </Stack>
              </CardBody>
            </Card>
          </div>
        ))}
      </Grid>

      <Card>
        <CardHeader trailing={<Pill tone="warning" size="sm">{pile.risk}</Pill>}>
          {pile.title}
        </CardHeader>
        <CardBody>
          <Stack gap={14}>
            <Text>{pile.plain}</Text>
            <Row gap={8} style={{ flexWrap: "wrap" }}>
              <Pill size="sm">Event: {pile.event}</Pill>
              <Pill size="sm" tone="neutral">
                {pile.nodes.length} workflows in pile
              </Pill>
            </Row>

            <H3>Fan-out chart</H3>
            <FanOutDiagram pile={pile} />

            <Divider />
            <H3>Mark this pile</H3>
            {pile.nodes.map((n) => {
              const ed = edits[n.key] ?? { mark: "" as Mark, notes: "" };
              return (
                <div key={n.key}>
                  <Stack gap={6}>
                    <Row gap={8} align="center" style={{ flexWrap: "wrap" }}>
                      <Text weight="semibold">{n.label}</Text>
                      <Pill tone={markTone(ed.mark)} size="sm">
                        {ed.mark || "undecided"}
                      </Pill>
                    </Row>
                    <Text size="small" tone="secondary">
                      id: {n.id} · {n.when}
                    </Text>
                    {n.note ? (
                      <Text size="small" tone="secondary">
                        {n.note}
                      </Text>
                    ) : null}
                    <Row gap={8} style={{ flexWrap: "wrap" }} align="start">
                      <Select
                        value={ed.mark}
                        onChange={(v) => patch(n.key, { mark: v as Mark })}
                        options={MARK_OPTIONS}
                      />
                      <TextArea
                        value={ed.notes}
                        onChange={(v) => patch(n.key, { notes: v })}
                        placeholder="e.g. wait 4h not 2h · drop from this trigger"
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
        <H2>Repair holes</H2>
        <Text tone="secondary">
          BS-01 already picks the BS-REPAIR email grid on the repair path — but six slots are missing from the live dump, so those waits skip with gaps.
        </Text>
        <Grid columns={2} gap={12}>
          <Card>
            <CardHeader>Repair workflows already registered</CardHeader>
            <CardBody>
              <Stack gap={8}>
                {REPAIR_WIRED.map((r) => (
                  <div key={r.id}>
                    <Stack gap={2}>
                      <Text weight="semibold">{r.label}</Text>
                      <Text size="small" tone="secondary">
                        {r.id} · {r.when}
                      </Text>
                      {r.hole ? (
                        <Pill tone="deleted" size="sm">
                          {r.hole}
                        </Pill>
                      ) : null}
                    </Stack>
                  </div>
                ))}
              </Stack>
            </CardBody>
          </Card>
          <Card>
            <CardHeader trailing={<Pill tone="deleted" size="sm">6 gaps</Pill>}>
              Missing BS-REPAIR slots (ADD-REPAIR)
            </CardHeader>
            <CardBody>
              <Stack gap={10}>
                <Text size="small" tone="secondary">
                  Expected 36-slot BS-FUND / BS-REPAIR grid. These six are absent — finding 10 / Appendix A3.
                </Text>
                {BS_REPAIR_GAPS.map((slot) => {
                  const key = `gap-${slot}`;
                  const ed = edits[key] ?? { mark: "" as Mark, notes: "" };
                  return (
                    <div key={slot}>
                      <Stack gap={4}>
                        <Text size="small" weight="semibold">
                          {slot}
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
                <Divider />
                <Stack gap={4}>
                  <Text size="small" weight="semibold">
                    AX-07 — seeded, no workflow caller
                  </Text>
                  <Text size="small" tone="secondary">
                    Finding 7: keys exist; no registered workflow sends them.
                  </Text>
                  <Select
                    value={edits["gap-ax07"]?.mark ?? ""}
                    onChange={(v) => patch("gap-ax07", { mark: v as Mark })}
                    options={MARK_OPTIONS}
                  />
                </Stack>
              </Stack>
            </CardBody>
          </Card>
        </Grid>
      </Stack>

      <Divider />
      <Row gap={8} align="center" style={{ flexWrap: "wrap" }}>
        <Button variant="primary" onClick={buildExport}>
          Export workflow marks
        </Button>
        <Text size="small" tone="secondary">
          Paste into chat when you want Fixer — not tonight unless you say so.
        </Text>
      </Row>
      {exportText ? <TextArea value={exportText} onChange={setExportText} rows={14} /> : null}

      <Spacer />
      <Text size="small" tone="secondary">
        Source: docs/workflows/messaging-review-2026-08-21-evidence/C-timing-audit.md · registry: src/workflows/index.mjs · view only (no code fixes).
      </Text>
    </Stack>
  );
}
