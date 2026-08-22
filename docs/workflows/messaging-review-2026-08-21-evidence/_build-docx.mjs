#!/usr/bin/env node
/**
 * Build Fundhub-Messaging-Review.docx from journey-spine + B + C findings.
 * Uses docx from /tmp/fh-docx (not a repo dependency).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  PageBreak,
  BorderStyle
} from "/tmp/fh-docx/node_modules/docx/dist/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const spine = fs.readFileSync(path.join(__dirname, "journey-spine.md"), "utf8");
const prompts = fs.readFileSync(path.join(__dirname, "B-agent-prompts.md"), "utf8");
const timing = fs.readFileSync(path.join(__dirname, "C-timing-audit.md"), "utf8");

const findingsBlock =
  timing.match(/## Findings[\s\S]*/)?.[0] ||
  "## Findings\n\n(see C-timing-audit.md)\n";

const combined =
  spine.replace(/# Appendix B — Timing findings[\s\S]*$/, "") +
  "\n# Appendix B — Timing findings (audit)\n\n" +
  findingsBlock +
  "\n\n# Appendix C — Full workflow timing table\n\n" +
  timing.replace(/## Findings[\s\S]*$/, "") +
  "\n\n# Appendix D — Agent / voice / LLM prompts\n\n" +
  prompts.replace(/^# B — Agent prompts\n\n/, "");

function parasFromMarkdown(md) {
  const lines = md.split("\n");
  const out = [];
  let inCode = false;
  let codeBuf = [];

  const flushCode = () => {
    if (!codeBuf.length) return;
    const text = codeBuf.join("\n");
    // Word has practical limits; chunk long code
    const chunkSize = 3500;
    for (let i = 0; i < text.length; i += chunkSize) {
      const chunk = text.slice(i, i + chunkSize);
      out.push(
        new Paragraph({
          spacing: { before: 60, after: 60 },
          border: {
            left: { style: BorderStyle.SINGLE, size: 12, color: "CCCCCC", space: 8 }
          },
          children: [
            new TextRun({
              text: chunk,
              font: "Courier New",
              size: 16 // 8pt
            })
          ]
        })
      );
    }
    codeBuf = [];
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    if (line.startsWith("# ")) {
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 360, after: 160 },
          children: [new TextRun({ text: line.slice(2), bold: true })]
        })
      );
      continue;
    }
    if (line.startsWith("## ")) {
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 280, after: 120 },
          children: [new TextRun({ text: line.slice(3), bold: true })]
        })
      );
      continue;
    }
    if (line.startsWith("### ")) {
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 80 },
          children: [new TextRun({ text: line.slice(4), bold: true })]
        })
      );
      continue;
    }
    if (line.trim() === "---") {
      out.push(new Paragraph({ children: [] }));
      continue;
    }
    if (!line.trim()) {
      out.push(new Paragraph({ children: [] }));
      continue;
    }

    // Simple bold **x** and `code` handling
    const children = [];
    let rest = line;
    // strip leading markdown list markers for cleaner Word
    rest = rest.replace(/^[-*]\s+/, "• ");
    const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let last = 0;
    let m;
    while ((m = re.exec(rest))) {
      if (m.index > last) {
        children.push(new TextRun({ text: rest.slice(last, m.index), size: 20 }));
      }
      const tok = m[0];
      if (tok.startsWith("**")) {
        children.push(
          new TextRun({ text: tok.slice(2, -2), bold: true, size: 20 })
        );
      } else {
        children.push(
          new TextRun({ text: tok.slice(1, -1), font: "Courier New", size: 18 })
        );
      }
      last = m.index + tok.length;
    }
    if (last < rest.length) {
      children.push(new TextRun({ text: rest.slice(last), size: 20 }));
    }
    out.push(
      new Paragraph({
        spacing: { after: 60 },
        children: children.length ? children : [new TextRun({ text: rest, size: 20 })]
      })
    );
  }
  flushCode();
  return out;
}

const children = [
  new Paragraph({
    heading: HeadingLevel.TITLE,
    children: [new TextRun({ text: "Fundhub Messaging Review", bold: true, size: 36 })]
  }),
  new Paragraph({
    spacing: { after: 200 },
    children: [
      new TextRun({
        text: "2026-08-21 — SMS + email templates + agent prompts + workflow timing. Mark KEEP / CHANGE / KILL / WRONG-TIME on each beat.",
        size: 20,
        italics: true
      })
    ]
  }),
  ...parasFromMarkdown(combined)
];

const doc = new Document({
  creator: "Fundhub messaging review",
  title: "Fundhub Messaging Review",
  description: "Journey-ordered SMS, email, agent prompts, and timing audit",
  sections: [
    {
      properties: {
        page: {
          margin: { top: 720, right: 720, bottom: 720, left: 720 }
        }
      },
      children
    }
  ]
});

const outPath = path.join(__dirname, "Fundhub-Messaging-Review.docx");
const buf = await Packer.toBuffer(doc);
fs.writeFileSync(outPath, buf);
console.log("Wrote", outPath, "bytes", buf.length);
