#!/usr/bin/env node
/**
 * Warn (ask) before shell commands that look like staging/committing .env or credentials/.
 * Fail-open on parse errors. Never prints secret values.
 * Uses .cjs because the repo package.json is "type": "module".
 */
const fs = require("node:fs");

function allow() {
  process.stdout.write(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

function ask(userMessage, agentMessage) {
  process.stdout.write(
    JSON.stringify({
      permission: "ask",
      user_message: userMessage,
      agent_message: agentMessage,
    }),
  );
  process.exit(0);
}

let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  allow();
}

const command = String(input.command || "");
if (!command) allow();

const looksLikeGitWrite =
  /\bgit\s+(-C\s+\S+\s+)?(add|commit|stage|rm|mv)\b/i.test(command);

if (!looksLikeGitWrite) allow();

const secretPath =
  /(^|[\s'"])(\.env\b|\.env\.[^\s'"]+|credentials\/)/i.test(command) ||
  /(^|[\s])(-A|--all)\b/.test(command);

if (!secretPath) allow();

if (
  /\.env\.example\b/.test(command) &&
  !/\bcredentials\//i.test(command) &&
  !/(^|[\s])(-A|--all)\b/.test(command)
) {
  allow();
}

ask(
  "This git command may stage secrets (.env, credentials/, or git add -A). Review before continuing.",
  "Hook: refuse silent staging of .env / credentials / blanket add. Confirm paths are safe, or stage named files only.",
);
