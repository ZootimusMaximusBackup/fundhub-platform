// POST /api/agents — write half of the Agent Editor
// (public/app/agent-editor.html).
//
//   { action: "save",    code, name, channel, agent_class, owner_label,
//                        prompt, guardrails }
//   { action: "promote", code }          → status = live
//   { action: "demote",  code }          → status = shadow
//   { action: "create",  name, channel?, agent_class?, owner_label? }
//
// POST + action, same shape as message-templates / contracts — FHData.write()
// is POST-only.
//
// THE LIE THIS ENDPOINT EXISTS TO STOP. The Agent Editor's Save button used to
// mutate an in-memory array, paint "SAVED", and write nothing. A reload threw
// the prompt away with no error. Same for Promote / Demote / New.
//
// STATUS RULES match 037_agent_registry.sql:
//   draft | shadow | live | retired
//   live and shadow require runtime NOT NULL
// Promote of an agent with no runtime records runtime='internal' and a note
// so the CHECK can pass; replace that when a real deployment is wired.
// New agents are always draft (shadow without a runtime would fail the CHECK).
//
// requireAuth then requireRole — never roles on requireAuth (CLAUDE.md §12).
// Org from the session only. Nothing here transmits.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireRole, ROLE_SETS } from "../src/http/read-api.mjs";
import { dbDown } from "../src/http/db-down.mjs";

const CHANNELS = new Set(["sms", "email", "voice", "internal"]);
/* Where an agent runs. The list is 037_agent_registry.sql's own column comment
   (`runtime text -- bland | vercel | inngest | netlify | internal`). Save could
   not write this at all until now, so an agent saved in the Agent Editor had no
   way to say which system should run it and could never be pointed at a real
   call. api/agent-call.mjs refuses anything that is not 'bland'. */
const RUNTIMES = new Set(["bland", "vercel", "inngest", "netlify", "internal", "ghl"]);
const CLASSES = new Set(["client_facing", "ops"]);
const ACTIONS = new Set(["save", "promote", "demote", "create"]);

function normChannel(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (CHANNELS.has(s)) return s;
  if (s === "sms" || s === "text") return "sms";
  return null;
}

function normClass(raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (s === "client_facing" || s === "clientfacing") return "client_facing";
  if (s === "ops" || s === "operations") return "ops";
  return null;
}

function normRuntime(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (!t) return "";           // "" = caller sent an empty value on purpose
  return RUNTIMES.has(t) ? t : null;  // null = caller sent something invalid
}

function normCode(raw) {
  return String(raw || "").trim().toUpperCase();
}

function asGuardrails(raw) {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
    return { block: raw };
  }
  return {};
}

async function loadAgent(orgId, code) {
  const r = await db.query(
    `SELECT id, org_id, code, name, agent_class, channel, status, runtime,
            runtime_ref, runtime_notes, prompt, guardrails, owner_label,
            went_live_at, retired_at, sort_order
       FROM agents
      WHERE org_id = $1::uuid AND code = $2
      LIMIT 1`,
    [orgId, code]
  );
  return r.rows[0] || null;
}

function publicAgent(row) {
  return {
    code: row.code,
    name: row.name,
    agent_class: row.agent_class,
    channel: row.channel,
    status: row.status,
    runtime: row.runtime,
    runtime_ref: row.runtime_ref,
    runtime_notes: row.runtime_notes,
    owner_label: row.owner_label,
    prompt: row.prompt,
    guardrails: row.guardrails || {},
    went_live_at: row.went_live_at,
    retired_at: row.retired_at,
    sort_order: row.sort_order,
    prompt_missing: !(row.prompt && String(row.prompt).trim()),
    guardrails_missing: !row.guardrails || Object.keys(row.guardrails).length === 0
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false, error: "method_not_allowed",
      message: "This screen only accepts a save request, not a page load."
    });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = (staff && staff.org_id) || null;
  if (!orgId) {
    return res.status(400).json({
      ok: false, error: "org_required",
      message: "Your sign-in is not attached to a company, so nothing can be filed under it."
    });
  }

  const body = req.body || {};
  const action = String(body.action || "").trim().toLowerCase();
  if (!ACTIONS.has(action)) {
    return res.status(400).json({
      ok: false, error: "unknown_action",
      message: "Unknown action. Use save, promote, demote, or create."
    });
  }

  try {
    /* ── create ─────────────────────────────────────────────────────────── */
    if (action === "create") {
      const name = String(body.name || "").trim() || "New agent";
      const channel = normChannel(body.channel) || "internal";
      const agentClass = normClass(body.agent_class) || "client_facing";
      const ownerLabel = String(body.owner_label || "").trim() || null;

      // Pick the next free AG-NN / OP-NN code in this org.
      const prefix = agentClass === "ops" ? "OP-" : "AG-";
      const existing = await db.query(
        `SELECT code FROM agents WHERE org_id = $1::uuid AND code LIKE $2`,
        [orgId, prefix + "%"]
      );
      const used = new Set(existing.rows.map((r) => r.code));
      let code = null;
      for (let n = 1; n <= 99; n++) {
        const candidate = prefix + String(n).padStart(2, "0");
        if (!used.has(candidate)) { code = candidate; break; }
      }
      if (!code) {
        return res.status(409).json({
          ok: false, error: "code_exhausted",
          message: "Every agent code in this series is already taken."
        });
      }

      const maxSort = await db.query(
        `SELECT COALESCE(MAX(sort_order), 0) AS m FROM agents WHERE org_id = $1::uuid`,
        [orgId]
      );
      const sortOrder = Number(maxSort.rows[0].m) + 10;

      const inserted = await db.query(
        `INSERT INTO agents
           (org_id, code, name, agent_class, channel, status, owner_label, sort_order)
         VALUES ($1::uuid, $2, $3, $4, $5, 'draft', $6, $7)
         RETURNING *`,
        [orgId, code, name, agentClass, channel, ownerLabel, sortOrder]
      );
      return res.status(201).json({
        ok: true, action: "create", agent: publicAgent(inserted.rows[0])
      });
    }

    const code = normCode(body.code);
    if (!code) {
      return res.status(400).json({
        ok: false, error: "code_required",
        message: "Which agent? Send its code (for example AG-04)."
      });
    }

    const current = await loadAgent(orgId, code);
    if (!current) {
      return res.status(404).json({
        ok: false, error: "not_found",
        message: "No agent with that code in your company."
      });
    }
    if (current.status === "retired") {
      return res.status(409).json({
        ok: false, error: "retired",
        message: "This agent is retired. It cannot be edited or promoted here."
      });
    }

    /* ── save ───────────────────────────────────────────────────────────── */
    if (action === "save") {
      const name = String(body.name != null ? body.name : current.name).trim();
      if (!name) {
        return res.status(400).json({
          ok: false, error: "name_required",
          message: "An agent needs a name."
        });
      }
      const channel = body.channel != null
        ? normChannel(body.channel)
        : current.channel;
      if (body.channel != null && !channel) {
        return res.status(400).json({
          ok: false, error: "invalid_channel",
          message: "Channel must be sms, email, voice, or internal."
        });
      }
      const agentClass = body.agent_class != null
        ? normClass(body.agent_class)
        : current.agent_class;
      if (body.agent_class != null && !agentClass) {
        return res.status(400).json({
          ok: false, error: "invalid_class",
          message: "Class must be client_facing or ops."
        });
      }
      const ownerLabel = body.owner_label != null
        ? (String(body.owner_label).trim() || null)
        : current.owner_label;
      const prompt = body.prompt != null ? String(body.prompt) : current.prompt;
      const guardrails = body.guardrails != null
        ? asGuardrails(body.guardrails)
        : (current.guardrails || {});

      /* RUNTIME. Optional on the wire — the Agent Editor does not send it today,
         and an absent key must mean "leave it alone", never "clear it". */
      let runtime = current.runtime;
      if (body.runtime !== undefined) {
        const r = normRuntime(body.runtime);
        if (r === null) {
          return res.status(400).json({
            ok: false, error: "invalid_runtime",
            message: "That is not a system we can run an agent on. Use bland, vercel, inngest, netlify or internal."
          });
        }
        runtime = r || null;
      }
      /* 037's agents_runtime_required_ck refuses a live or shadow agent with no
         runtime: an agent that is running has to say where. Caught here so the
         person gets a sentence instead of a database error. */
      if (!runtime && (current.status === "live" || current.status === "shadow")) {
        return res.status(400).json({
          ok: false, error: "runtime_required",
          message: "This agent is running, so it has to say which system runs it. Return it to shadow first if you want to unset that."
        });
      }
      const runtimeRef = body.runtime_ref !== undefined
        ? (String(body.runtime_ref || "").trim() || null)
        : current.runtime_ref;

      const updated = await db.query(
        `UPDATE agents SET
            name = $3,
            channel = $4,
            agent_class = $5,
            owner_label = $6,
            prompt = $7,
            guardrails = $8::jsonb,
            runtime = $9,
            runtime_ref = $10,
            updated_at = now()
          WHERE org_id = $1::uuid AND code = $2
          RETURNING *`,
        /* runtime/runtime_ref are LAST on purpose. src/http/agents-write.test.mjs
           reads this array positionally and JSON.parse()s index 7; putting a new
           value before guardrails turns that into a parse error pointing at the
           test rather than at the change. */
        [orgId, code, name, channel, agentClass, ownerLabel, prompt,
         JSON.stringify(guardrails), runtime, runtimeRef]
      );
      return res.status(200).json({
        ok: true, action: "save", agent: publicAgent(updated.rows[0])
      });
    }

    /* ── promote → live ─────────────────────────────────────────────────── */
    if (action === "promote") {
      let runtime = current.runtime;
      let runtimeNotes = current.runtime_notes;
      if (!runtime) {
        runtime = "internal";
        runtimeNotes = (runtimeNotes ? runtimeNotes + " · " : "") +
          "Runtime set to internal on promote from Agent Editor; replace when a real deployment is wired.";
      }
      const promptOk = current.prompt && String(current.prompt).trim().length >= 60;
      const guard = current.guardrails || {};
      const guardText = typeof guard.block === "string" ? guard.block
        : (typeof guard.text === "string" ? guard.text : "");
      const guardOk = Object.keys(guard).length > 0 &&
        (guardText.trim().length >= 20 || Object.keys(guard).length > 1);
      if (!promptOk || !guardOk) {
        return res.status(409).json({
          ok: false, error: "promotion_blocked",
          message: "Promotion needs a written prompt (60+ characters) and a non-empty guardrail block. Save those first."
        });
      }

      const updated = await db.query(
        `UPDATE agents SET
            status = 'live',
            runtime = $3,
            runtime_notes = $4,
            went_live_at = COALESCE(went_live_at, now()),
            retired_at = NULL,
            updated_at = now()
          WHERE org_id = $1::uuid AND code = $2
          RETURNING *`,
        [orgId, code, runtime, runtimeNotes]
      );
      return res.status(200).json({
        ok: true, action: "promote", agent: publicAgent(updated.rows[0])
      });
    }

    /* ── demote → shadow ────────────────────────────────────────────────── */
    if (action === "demote") {
      let runtime = current.runtime;
      let runtimeNotes = current.runtime_notes;
      if (!runtime) {
        runtime = "internal";
        runtimeNotes = (runtimeNotes ? runtimeNotes + " · " : "") +
          "Runtime set to internal on demote from Agent Editor.";
      }
      const updated = await db.query(
        `UPDATE agents SET
            status = 'shadow',
            runtime = $3,
            runtime_notes = $4,
            retired_at = NULL,
            updated_at = now()
          WHERE org_id = $1::uuid AND code = $2
          RETURNING *`,
        [orgId, code, runtime, runtimeNotes]
      );
      return res.status(200).json({
        ok: true, action: "demote", agent: publicAgent(updated.rows[0])
      });
    }

    return res.status(400).json({ ok: false, error: "unknown_action" });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
