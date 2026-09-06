#!/usr/bin/env node
// scripts/ads/check-script.mjs — the fast pass on an ad script, before a human reads it.
//
//   node scripts/ads/check-script.mjs docs/ads/scripts/2026-09-06.md
//   node scripts/ads/check-script.mjs one.md two.md --rules docs/ads/RULES.md
//   cat draft.md | node scripts/ads/check-script.mjs --stdin
//
// Exits 0 when every script passes and 1 with a plain list of what failed and
// the line it failed on.
//
// WHY THIS IS A SCRIPT AND NOT AN INSTRUCTION IN A SKILL FILE
// A regex cannot lie about having run. An agent told "check the banned words"
// can believe it checked and be wrong, and the same bad line ships again next
// week. So the ban lists live here, in code, and the writing skill has to run
// this and fix what comes back. Same reasoning as .claude/workflows/copy.js,
// which inlines its lists for exactly this reason.
//
// WHAT THIS IS NOT
// This is NOT the compliance screen. The twelve compliance rules (seeded by
// db/migrations/047_compliance_rules.sql) run later and somewhere else: inside
// storeAsset in src/creative/generate.mjs, which calls screen() from
// src/compliance/screen.mjs. That one needs a live database and it fails closed.
// Do not import it here. This checker is the cheap pass that catches the tired
// wording before Chris ever opens the draft; the compliance gate is the
// expensive pass that decides whether an asset may run.
//
// Node built-ins only. No packages. Nothing here talks to a database or a
// network.

import { readFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// THE LISTS
//
// Inlined on purpose, same as .claude/workflows/copy.js. Never paraphrase an
// entry: the scan is a literal match, so a reworded list quietly stops catching
// things. The words and phrases below come from two places and both are named
// so you can go check them:
//   - docs/ads/ASSET-BANK.md section 8 ("Avoid these") — the FundHub list
//   - ~/.claude/skills/humanizer/SKILL.md — the "sounds like a robot" list
// A rules file (--rules) ADDS to these. It never replaces them.
// ---------------------------------------------------------------------------

// Words that make copy read like a machine wrote it.
const BAN_WORDS = [
  "delve", "tapestry", "leverage", "utilize", "robust", "seamless", "realm",
  "testament", "beacon", "underscore", "showcase", "pivotal", "crucial", "foster",
  "elevate", "embark", "unleash", "navigate", "landscape", "boast", "myriad",
  "plethora", "intricate", "vibrant", "enhance", "streamline", "optimize",
  "comprehensive", "empower", "holistic", "cultivate", "resonate", "nestled",
];

// Whole phrases that do the same thing.
const BAN_PHRASES = [
  "in today's fast-paced world", "when it comes to", "it's important to note",
  "plays a crucial role in", "at the end of the day", "the world of",
  "more than just", "unlock the power of", "elevate your",
  "take it to the next level", "supercharge", "move the needle", "deep dive",
  "low-hanging fruit", "circle back", "best-in-class", "in conclusion",
  "a journey", "treasure trove", "the possibilities are endless",
  "fast and easy", "secret sauce",
];

// Openings that announce an AI wrote the thing. Only flagged at the very start
// of a spoken section, which is where they do the damage.
const BAN_OPENERS = [
  "imagine a world where", "have you ever wondered", "picture this",
  "so there you have it", "let's dive in", "here's the thing", "here's the kicker",
  "but here's where it gets interesting", "let that sink in", "plot twist",
  "trust me", "great question", "absolutely", "certainly", "i'd be happy to",
];

// Lines Chris does not say, each with the reason, because "banned" with no
// reason gets argued with. From docs/ads/ASSET-BANK.md section 8 and the
// standing rule in docs/ads/README.md about never naming the tech stack.
const NEVER_SAY = [
  ["lenders compete for you", "sounds like the spam swarm we are the opposite of"],
  ["get matched with", "the market hears \"75 lenders call you\" and runs"],
  ["cash advance", "MCA-tainted. Never use it as a good thing"],
  ["merchant cash advance", "MCA-tainted. Never use it as a good thing"],
  ["unlimited offers", "we do not promise a number we cannot control"],
  ["apply now to get calls from our partners", "implies a pile of people will phone them"],
  ["our partners will call", "implies a pile of people will phone them"],
  ["guaranteed approval", "we cannot guarantee an approval and saying so is a legal problem"],
  ["guarantee approval", "we cannot guarantee an approval and saying so is a legal problem"],
  ["guaranteed funding", "we cannot guarantee funding and saying so is a legal problem"],
  ["erase your bad credit", "a credit-repair claim we do not make"],
  ["remove negative items", "a credit-repair claim we do not make"],
  ["delete bad credit", "a credit-repair claim we do not make"],
  ["fix your credit overnight", "a credit-repair claim we do not make"],
  ["boost your score", "a points promise. We never put a number on a score change"],
  ["raise your score by", "a points promise. We never put a number on a score change"],
  ["no risk", "there is always risk. Say what we actually do instead"],
];

// Vendor and tool names. docs/ads/README.md: never name the tech stack, it is
// "our system". Word-boundary matched so ordinary words are safe.
const NEVER_NAME = [
  "supabase", "netlify", "twilio", "resend", "openai", "anthropic", "claude",
  "inngest", "lendflow", "stripe", "plaid", "zapier", "hubspot", "gohighlevel",
  "clickfunnels", "postgres", "salesforce",
];

// How long a script reads out loud. 150 words a minute is the working rate for
// talking to camera at Chris's pace — 2.5 words a second. Bands come from
// docs/ads/ANGLE-GENERATOR.md. The 10% slack is because nobody reads at exactly
// one speed, and a checker that fails a good script on one word is a checker
// people turn off.
const WORDS_PER_SECOND = 2.5;
const SLACK = 0.1;
const RUNTIME_BANDS = [
  { id: "2min+", test: /2\s*min|120\s*[–—-]\s*\d|two\s*min/i, low: 120, high: 240 },
  { id: "90–120s", test: /90\s*[–—-]\s*120/, low: 90, high: 120 },
  { id: "60–90s", test: /60\s*[–—-]\s*90/, low: 60, high: 90 },
];

// The hook must not ask for anything. docs/ads/ANGLE-GENERATOR.md: the hook
// indicts the alternative, the CTA does the asking. Only unmistakable asks are
// listed — a bare "call" is a normal word and flagging it would be noise.
const HOOK_ASKS = [
  "book a call", "book your", "book the call", "click the", "click below",
  "link in bio", "dm me", "swipe up", "tap the", "schedule a call",
  "get started", "sign up", "apply now", "comment below", "download the",
  "hit the link", "fill out the",
];

// A cause-first hook names what caused the problem in the first three seconds.
// These are the shapes that do it. This is a coarse net on purpose: it catches
// a hook that names nothing, and a human still judges whether the cause named
// is the RIGHT one. Passing this check is not the same as a good hook.
const CAUSE_MARKERS = [
  "because", "that wasn't", "that was", "that's why", "which is why",
  "the reason", "reason why", "caused", "causes", "comes from", "came from",
  "happens when", "happened when", "left you", "left a", "nobody", "no one",
  "they never", "he never", "she never", "it never", "somebody", "someone",
  "what actually", "the problem is", "the issue is", "not bad luck", "wasn't luck",
  "did that to", "put you", "why ",
];

// ---------------------------------------------------------------------------
// THE RULES FILE
//
// Optional and additive. The lists above always run; a rules file only adds
// more terms on top. That is deliberate — a missing or half-written rules file
// must never make the checker weaker than it was.
//
// The parser is tolerant because docs/ads/RULES.md is hand-written prose, not
// config. It walks the headings, works out what each section is banning from
// the heading's own words, and pulls terms out of bullets, "quotes", **bold**
// and lists separated by the middle dot, which is how ASSET-BANK.md already
// writes them.
//
// If a rules file exists and this parser reads nothing out of it, that is
// reported out loud rather than passed over in silence. A checker that quietly
// reads zero rules is worse than no checker, because it prints a green line.
// ---------------------------------------------------------------------------

const DEFAULT_RULES_PATH = "docs/ads/RULES.md";

function termsFromLine(line) {
  const out = [];
  let text = line.replace(/^\s*[-*+]\s+/, "").trim();
  if (/^\|/.test(text)) return out;                 // table row, skip
  if (/\]\(/.test(text)) return out;                // markdown link, skip
  // A line is a list separated by the middle dot, which is how ASSET-BANK.md
  // already writes these. Split first, THEN look inside each part — doing it the
  // other way round drops every plain term on a line that also has a bold one.
  for (const part of text.split("·")) {
    // Drop the explanation that follows a dash: `"foo" — because bar`.
    const head = part.split(/\s+[–—]\s+/)[0];
    const quoted = [...head.matchAll(/[“”"]([^“”"]{2,60})[“”"]|\*\*([^*]{2,60})\*\*/g)]
      .map((m) => m[1] || m[2]);
    if (quoted.length) { out.push(...quoted); continue; }
    const term = head.replace(/[.*_`]/g, "").trim();
    if (term) out.push(term);
  }
  return out;
}

function loadRules(path) {
  const raw = readFileSync(path, "utf8");
  const added = { words: [], phrases: [], openers: [], neverSay: [] };
  let bucket = null;

  for (const line of raw.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      const h = heading[1].toLowerCase();
      if (/never say|do not say|don'?t say|never claim/.test(h)) bucket = "neverSay";
      else if (/opener/.test(h)) bucket = "openers";
      else if (/banned|avoid|forbidden|do not use|never use|kill list/.test(h)) bucket = "phrases";
      else bucket = null;
      continue;
    }
    if (!bucket || !line.trim()) continue;
    if (/^\s*(use these|examples?:)/i.test(line)) continue;
    for (const t of termsFromLine(line)) {
      const term = t.trim().toLowerCase();
      if (term.length < 3 || term.length > 60) continue;
      if (!/[a-z]/.test(term)) continue;
      if (bucket === "phrases" && !/\s/.test(term)) added.words.push(term);
      else added[bucket].push(term);
    }
  }
  return added;
}

// ---------------------------------------------------------------------------
// READING A SCRIPT
//
// The format is the one in docs/ads/ANGLE-GENERATOR.md: a label at the start of
// the line, then the words. Anything that is not spoken out loud (SHOOT, TAG,
// RUNTIME) is metadata and is NOT scanned for banned words — a shoot note
// saying "optimize the light" is not an ad reading like a robot.
// ---------------------------------------------------------------------------

const SPOKEN_LABELS = ["HOOK", "BODY", "CTA", "CLOSE"];
const ALL_LABELS = [...SPOKEN_LABELS, "RUNTIME", "SHOOT", "TAG", "ANGLE", "WHO", "DOOR"];
const LABEL_RE = new RegExp(`^(${ALL_LABELS.join("|")})\\b[\\s:]*(.*)$`);
// Strips the timing that sits between the label and the words, e.g.
// "HOOK 0–3s The guy who..." or "CTA last 10–30s ...".
const TIMING_RE = /^(?:last\s+)?\d+(?:\s*[–—-]\s*\d+)?\s*s(?:ec|econds)?\b[\s:]*/i;

/** Split a file into the scripts inside it. Every script keeps its real line numbers. */
function splitScripts(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let current = { title: null, startLine: 1, lines: [] };
  lines.forEach((line, i) => {
    const heading = line.match(/^#{2,6}\s+(.*)$/);
    if (heading) {
      blocks.push(current);
      current = { title: heading[1].replace(/[*`]/g, "").trim(), startLine: i + 1, lines: [] };
      return;
    }
    current.lines.push({ n: i + 1, text: line });
  });
  blocks.push(current);
  // A block is a script only if it has a HOOK. Everything else in the file
  // (the intro, the notes, the table of contents) is left alone.
  return blocks.filter((b) => b.lines.some((l) => /^HOOK\b/.test(l.text)));
}

/** Pull the labelled sections out of one script, keeping the line number of every line. */
function parseScript(block) {
  const sections = {};
  let label = null;
  for (const line of block.lines) {
    const m = line.text.match(LABEL_RE);
    if (m) {
      label = m[1];
      // Only a spoken section carries a timing token to strip. Do NOT strip it
      // from RUNTIME — on that line the timing IS the value.
      const body = SPOKEN_LABELS.includes(label) ? m[2].replace(TIMING_RE, "").trim() : m[2].trim();
      sections[label] = sections[label] || [];
      if (body) sections[label].push({ n: line.n, text: body });
      continue;
    }
    if (!label) continue;
    if (!line.text.trim()) { label = null; continue; }   // a blank line ends a section
    sections[label].push({ n: line.n, text: line.text.trim() });
  }
  return sections;
}

const joinText = (rows) => (rows || []).map((r) => r.text).join(" ").trim();
const countWords = (s) => (s.match(/[A-Za-z0-9'’$%-]+/g) || []).length;

// ---------------------------------------------------------------------------
// THE CHECKS
// Every failure carries the line it happened on and says what to do about it.
// ---------------------------------------------------------------------------

function checkSpokenLine(row, label, lists, fails) {
  const text = row.text;
  const lower = text.toLowerCase();

  for (const w of lists.words) {
    if (new RegExp(`\\b${escapeRe(w)}(s|d|ed|ing|es)?\\b`, "i").test(text)) {
      fails.push({ n: row.n, msg: `banned word "${w}" in the ${label}. Chris does not talk like that. Use a plainer word.` });
    }
  }
  for (const p of lists.phrases) {
    if (lower.includes(p)) {
      fails.push({ n: row.n, msg: `banned phrase "${p}" in the ${label}. Say it the way a person would.` });
    }
  }
  for (const [term, why] of lists.neverSay) {
    if (lower.includes(term)) {
      fails.push({ n: row.n, msg: `never-say line "${term}" in the ${label}. ${why[0].toUpperCase()}${why.slice(1)}.` });
    }
  }
  for (const v of NEVER_NAME) {
    if (new RegExp(`\\b${escapeRe(v)}\\b`, "i").test(text)) {
      fails.push({ n: row.n, msg: `names the tech we use ("${v}") in the ${label}. In an ad it is always "our system".` });
    }
  }
  if (text.includes("—")) {
    fails.push({ n: row.n, msg: `em dash in the ${label}. Nobody says an em dash out loud. Use a comma, a full stop, or two sentences.` });
  }
  if (/\b(it'?s|this is|that'?s|we'?re|you'?re) not [^.,;!?]{1,60}[,;] (it'?s|this is|that'?s|we'?re|you'?re) /i.test(text)) {
    fails.push({ n: row.n, msg: `the "it's not X, it's Y" shape in the ${label}. It is the most obvious tell that a machine wrote the line. Say the second half only.` });
  }
}

function checkOpener(rows, label, lists, fails) {
  const first = rows && rows[0];
  if (!first) return;
  const lower = first.text.trim().toLowerCase();
  for (const o of lists.openers) {
    if (lower.startsWith(o)) {
      fails.push({ n: first.n, msg: `the ${label} opens with "${o}". Every AI opens that way. Start on the thing itself.` });
    }
  }
}

function checkHook(rows, fails) {
  const text = joinText(rows);
  const line = rows && rows[0] ? rows[0].n : 0;
  if (!text) {
    fails.push({ n: line, msg: "the HOOK is empty." });
    return;
  }
  const lower = text.toLowerCase();
  for (const ask of HOOK_ASKS) {
    if (lower.includes(ask)) {
      fails.push({ n: line, msg: `the HOOK asks for something ("${ask}"). The hook blames the thing that caused the problem. The CTA does the asking.` });
      break;
    }
  }
  if (/\?\s*$/.test(text)) {
    fails.push({ n: line, msg: "the HOOK ends on a question. It should land on a statement that indicts what went wrong, not hand the question back." });
  }
  if (!CAUSE_MARKERS.some((m) => lower.includes(m))) {
    fails.push({
      n: line,
      msg: "the HOOK never names a cause. In the first three seconds say who or what did this to them — \"because\", \"that wasn't luck\", \"somebody\", \"the reason\", \"they never\". Naming the pain is not the same as naming the cause.",
    });
  }
}

function checkRuntime(sections, spokenWords, fails, startLine) {
  const row = (sections.RUNTIME || [])[0];
  if (!row) {
    fails.push({ n: startLine, msg: "no RUNTIME line, so the length cannot be checked. Add \"RUNTIME 60–90s\" (or 90–120s, or 2min+)." });
    return;
  }
  const band = RUNTIME_BANDS.find((b) => b.test.test(row.text));
  if (!band) {
    fails.push({ n: row.n, msg: `RUNTIME says "${row.text}", which is not one of the three bands. Use 60–90s, 90–120s or 2min+.` });
    return;
  }
  const seconds = Math.round(spokenWords / WORDS_PER_SECOND);
  const low = Math.round(band.low * WORDS_PER_SECOND * (1 - SLACK));
  const high = Math.round(band.high * WORDS_PER_SECOND * (1 + SLACK));
  if (spokenWords < low) {
    fails.push({
      n: row.n,
      msg: `too short. ${spokenWords} words reads as about ${seconds} seconds, and RUNTIME says ${band.id}. Add about ${low - spokenWords} more words. Sixty seconds is the floor, no exceptions.`,
    });
  } else if (spokenWords > high) {
    fails.push({
      n: row.n,
      msg: `too long. ${spokenWords} words reads as about ${seconds} seconds, and RUNTIME says ${band.id}. Cut about ${spokenWords - high} words, or move it up a band.`,
    });
  }
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkOneScript(block, lists) {
  const sections = parseScript(block);
  const fails = [];

  for (const label of SPOKEN_LABELS) {
    const rows = sections[label];
    if (!rows || !joinText(rows)) {
      if (label === "HOOK" || label === "BODY") {
        fails.push({ n: block.startLine, msg: `no ${label} section. The format is HOOK, BODY, CTA, CLOSE, RUNTIME.` });
      }
      continue;
    }
    checkOpener(rows, label, lists, fails);
    for (const row of rows) checkSpokenLine(row, label, lists, fails);
  }

  if (sections.HOOK) checkHook(sections.HOOK, fails);

  const spokenWords = SPOKEN_LABELS.reduce((sum, l) => sum + countWords(joinText(sections[l])), 0);
  checkRuntime(sections, spokenWords, fails, block.startLine);

  fails.sort((a, b) => a.n - b.n);
  return { title: block.title, startLine: block.startLine, words: spokenWords, fails };
}

// ---------------------------------------------------------------------------
// COMMAND LINE
// ---------------------------------------------------------------------------

function main(argv) {
  const files = [];
  let rulesPath = null;
  let useStdin = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rules") { rulesPath = argv[++i]; continue; }
    if (a === "--stdin") { useStdin = true; continue; }
    if (a === "-h" || a === "--help") {
      console.log(
        "Check an ad script before a human reads it.\n\n" +
        "  node scripts/ads/check-script.mjs <file.md> [more.md ...] [--rules docs/ads/RULES.md]\n" +
        "  cat draft.md | node scripts/ads/check-script.mjs --stdin\n\n" +
        "Exits 0 when everything passes, 1 with a list of what to fix."
      );
      return 0;
    }
    if (a.startsWith("-")) {
      console.error(`I do not know the option "${a}". Run with --help.`);
      return 1;
    }
    files.push(a);
  }

  const lists = {
    words: [...BAN_WORDS],
    phrases: [...BAN_PHRASES],
    openers: [...BAN_OPENERS],
    neverSay: [...NEVER_SAY],
  };

  // Say out loud which rules are in force. A green result means nothing if you
  // cannot tell whether the rules file was read.
  let rulesNote;
  const resolvedRules = rulesPath || (existsSync(DEFAULT_RULES_PATH) ? DEFAULT_RULES_PATH : null);
  if (resolvedRules) {
    if (!existsSync(resolvedRules)) {
      console.error(`I cannot find the rules file "${resolvedRules}".`);
      return 1;
    }
    const added = loadRules(resolvedRules);
    const count = added.words.length + added.phrases.length + added.openers.length + added.neverSay.length;
    lists.words.push(...added.words);
    lists.phrases.push(...added.phrases);
    lists.openers.push(...added.openers);
    lists.neverSay.push(...added.neverSay.map((t) => [t, "the rules file says never say it"]));
    rulesNote = count > 0
      ? `Rules: the built-in list plus ${count} more from ${resolvedRules}.`
      : `Rules: the built-in list only. WARNING: ${resolvedRules} exists but I read no banned terms out of it. Check its headings say "banned", "avoid" or "never say".`;
  } else {
    rulesNote = `Rules: the built-in list only (no ${DEFAULT_RULES_PATH} yet).`;
  }

  const sources = [];
  if (useStdin) {
    sources.push({ name: "(what you piped in)", text: readFileSync(0, "utf8") });
  }
  for (const f of files) {
    if (!existsSync(f)) {
      console.error(`I cannot find the file "${f}".`);
      return 1;
    }
    sources.push({ name: f, text: readFileSync(f, "utf8") });
  }
  if (!sources.length) {
    console.error("Give me a file to check, or pipe one in with --stdin. Run with --help.");
    return 1;
  }

  console.log(rulesNote);
  let broken = 0;
  let total = 0;

  for (const source of sources) {
    const blocks = splitScripts(source.text);
    if (!blocks.length) {
      console.error(
        `\n${source.name} — I found no scripts in here.\n` +
        "  Every script needs a line starting with HOOK. The format is in docs/ads/ANGLE-GENERATOR.md."
      );
      broken += 1;
      continue;
    }
    const results = blocks.map((b) => checkOneScript(b, lists));
    const bad = results.filter((r) => r.fails.length);
    total += results.length;
    broken += bad.length;

    console.log(
      `\n${source.name} — ${results.length} script${results.length === 1 ? "" : "s"} checked, ` +
      `${bad.length === 0 ? "all clean." : `${bad.length} need${bad.length === 1 ? "s" : ""} work.`}`
    );
    for (const r of bad) {
      console.log(`\n  ${r.title ? `"${r.title}"` : "script"} (starts line ${r.startLine}, ${r.words} words)`);
      for (const f of r.fails) console.log(`    line ${f.n}: ${f.msg}`);
    }
  }

  if (broken === 0) {
    console.log(`\nAll ${total} script${total === 1 ? " passes" : "s pass"}. This is the fast check only — the compliance rules still run before anything can go live.`);
    return 0;
  }
  console.error(`\n${broken} of ${total} script${total === 1 ? "" : "s"} ${broken === 1 ? "needs" : "need"} work. Fix and run this again. Nothing goes to Chris until this exits clean.`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
