#!/usr/bin/env node
/**
 * Temporary: poll prod for CF seam evidence after owner fires a +test lead.
 * Auth: x-cf-seam-token === COMMAS_API_KEY or DASHBOARD_SECRET.
 * Uses MIGRATION_DATABASE_URL.
 * DELETE after seam proof. Never logs secrets.
 */
import pg from "pg";

function redactEmail(e) {
  const s = String(e || "");
  const i = s.indexOf("@");
  return i > 0 ? s.slice(0, Math.min(3, i)) + "…@" + s.slice(i + 1) : "(none)";
}

async function run(sinceIso, emailHint) {
  const logs = [];
  const log = (...a) => logs.push(a.map(String).join(" "));
  const url = process.env.MIGRATION_DATABASE_URL || "";
  if (!url || url.includes("****")) return { ok: false, logs: ["FAIL masked or missing MIGRATION_DATABASE_URL"] };

  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000
  });
  await client.connect();
  log("CONNECTED");

  const since = sinceIso || new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const hint = String(emailHint || "").trim().toLowerCase();

  try {
    const caps = await client.query(
      `SELECT id::text, provider, created_at,
              left(raw_body, 4000) AS raw_body,
              parsed
         FROM webhook_captures
        WHERE provider = 'clickfunnels'
          AND created_at >= $1::timestamptz
        ORDER BY created_at DESC
        LIMIT 20`,
      [since]
    );
    log("CAPTURES", caps.rowCount);
    for (const r of caps.rows) {
      log("CAPTURE", r.id, r.created_at?.toISOString?.() || r.created_at);
    }

    const ev = await client.query(
      `SELECT id::text, name, idempotency_key, created_at,
              payload->>'email' AS email,
              payload->>'source' AS source
         FROM events
        WHERE created_at >= $1::timestamptz
          AND (
            idempotency_key LIKE 'clickfunnels:%'
            OR payload->>'source' = 'clickfunnels'
            OR ($2 <> '' AND lower(payload->>'email') = $2)
          )
        ORDER BY created_at DESC
        LIMIT 40`,
      [since, hint]
    );
    log("EVENTS", ev.rowCount);
    for (const r of ev.rows) {
      log("EVENT", r.name, redactEmail(r.email), r.idempotency_key, r.created_at?.toISOString?.() || r.created_at);
    }

    let clients = { rowCount: 0, rows: [] };
    if (hint) {
      clients = await client.query(
        `SELECT id::text, email, first_name, last_name, created_at, outcome_tier
           FROM clients
          WHERE lower(email) = $1
          ORDER BY created_at DESC
          LIMIT 5`,
        [hint]
      );
      log("CLIENTS", clients.rowCount);
      for (const r of clients.rows) {
        log("CLIENT", r.id, redactEmail(r.email), r.first_name, r.last_name);
      }
    }

    let appts = { rowCount: 0, rows: [] };
    if (clients.rowCount) {
      const ids = clients.rows.map((r) => r.id);
      appts = await client.query(
        `SELECT id::text, client_id::text, title, starts_at, created_at
           FROM appointments
          WHERE client_id = ANY($1::uuid[])
            AND created_at >= $2::timestamptz
          ORDER BY created_at DESC
          LIMIT 10`,
        [ids, since]
      ).catch(async (e) => {
        log("APPOINTMENTS_TABLE_NOTE", String(e.message || e).slice(0, 120));
        // tasks fallback
        return client.query(
          `SELECT id::text, client_id::text, title, due_at AS starts_at, created_at
             FROM tasks
            WHERE client_id = ANY($1::uuid[])
              AND created_at >= $2::timestamptz
            ORDER BY created_at DESC
            LIMIT 10`,
          [ids, since]
        );
      });
      log("APPTS_OR_TASKS", appts.rowCount);
      for (const r of appts.rows) {
        log("APPT", r.id, r.client_id, r.title, r.starts_at);
      }
    }

    return {
      ok: true,
      since,
      captures: caps.rows.map((r) => ({
        id: r.id,
        created_at: r.created_at,
        raw_body: r.raw_body,
        parsed: r.parsed
      })),
      events: ev.rows,
      clients: clients.rows,
      appointments: appts.rows,
      logs
    };
  } finally {
    await client.end().catch(() => {});
  }
}

export async function handler(event) {
  const token = event.headers?.["x-cf-seam-token"] || event.headers?.["X-Cf-Seam-Token"] || "";
  const allowed = [process.env.COMMAS_API_KEY, process.env.DASHBOARD_SECRET].filter(Boolean);
  if (!token || !allowed.includes(token)) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, reason: "unauthorized" }) };
  }
  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }
  try {
    // Runtime sign self-test: prove Netlify CLICKFUNNELS_WEBHOOK_SECRET accepts.
    // Never returns the secret. Safe body has no email → no client emit.
    if (body.action === "cf_sign_selftest") {
      const crypto = await import("node:crypto");
      const secret = process.env.CLICKFUNNELS_WEBHOOK_SECRET || "";
      if (!secret || secret.includes("*")) {
        return {
          statusCode: 500,
          body: JSON.stringify({
            ok: false,
            error: "CLICKFUNNELS_WEBHOOK_SECRET missing or masked in runtime"
          })
        };
      }
      const raw = JSON.stringify({
        event_type: "fundhub.sign_selftest",
        data: { id: `sign-selftest-${Date.now()}`, contact: {} }
      });
      // Match CF 2.0: HMAC(timestamp + "." + body) + official headers.
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = crypto.createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
      const site = process.env.URL || process.env.DEPLOY_PRIME_URL || "https://fundhub.ai";
      const url = `${String(site).replace(/\/$/, "")}/api/webhooks/clickfunnels`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-clickfunnels-signature": sig,
          "x-webhook-clickfunnels-timestamp": ts
        },
        body: raw
      });
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 200) }; }
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: res.status < 500,
          http: res.status,
          secret_len: secret.length,
          secret_last4: secret.slice(-4),
          response: parsed
        })
      };
    }

    if (body.action === "commas_sign_selftest") {
      const crypto = await import("node:crypto");
      const secret = process.env.COMMAS_WEBHOOK_SECRET || "";
      if (!secret || secret.includes("*")) {
        return {
          statusCode: 500,
          body: JSON.stringify({
            ok: false,
            error: "COMMAS_WEBHOOK_SECRET missing or masked in runtime"
          })
        };
      }
      const email = String(body.email || "bakerskater987+test.commas.selftest@gmail.com").toLowerCase();
      if (!email.includes("+test")) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: "test_email_only" }) };
      }
      const raw = JSON.stringify({
        type: "payment.succeeded",
        data: {
          payment_id: `gauntlet-commas-${Date.now()}`,
          fan: { email },
          product: { title: "Business Financial Assessment", price: 32 }
        }
      });
      const sig = crypto.createHmac("sha256", secret).update(raw).digest("hex");
      const site = process.env.URL || process.env.DEPLOY_PRIME_URL || "https://fundhub.ai";
      const url = `${String(site).replace(/\/$/, "")}/api/webhooks/commas`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": sig
        },
        body: raw
      });
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 200) }; }
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: res.status < 500,
          http: res.status,
          secret_len: secret.length,
          secret_last4: secret.slice(-4),
          response: parsed
        })
      };
    }

    if (body.action === "migrate_pending_preview" || body.action === "migrate_apply_pending") {
      const url = process.env.MIGRATION_DATABASE_URL || "";
      if (!url || url.includes("****")) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: "missing MIGRATION_DATABASE_URL" }) };
      }
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      // In Netlify functions bundle, db/ may not ship with the function.
      // Prefer explicit allowlist apply of 163 only when action is apply.
      const client = new pg.Client({
        connectionString: url,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 20000
      });
      await client.connect();
      try {
        const applied = new Set(
          (await client.query(`SELECT key FROM schema_migrations`)).rows.map((r) => r.key)
        );
        const want = "migrations/163_cf_svy_typed_columns.sql";
        const already = applied.has(want);
        if (body.action === "migrate_pending_preview") {
          return {
            statusCode: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ok: true,
              applied_count: applied.size,
              pending_known: already ? [] : [want],
              applied_160: applied.has("migrations/160_metro2_dispute_engine.sql"),
              applied_161: applied.has("migrations/161_optimization_repair_pipeline.sql"),
              applied_163: already
            })
          };
        }
        // migrate_apply_pending — ONLY 163, additive columns. Refuse if 160/161 missing.
        if (!applied.has("migrations/160_metro2_dispute_engine.sql") ||
            !applied.has("migrations/161_optimization_repair_pipeline.sql")) {
          return {
            statusCode: 409,
            body: JSON.stringify({ ok: false, error: "refuse: 160/161 not applied; will not run bare pending drain" })
          };
        }
        if (already) {
          return {
            statusCode: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ok: true, applied: false, reason: "already_applied", key: want })
          };
        }
        const sql = `ALTER TABLE client_custom_fields
  ADD COLUMN IF NOT EXISTS cf_svy_has_business        text,
  ADD COLUMN IF NOT EXISTS cf_svy_business_revenue    text,
  ADD COLUMN IF NOT EXISTS cf_svy_revenue_verifiable  text,
  ADD COLUMN IF NOT EXISTS cf_svy_available_capital   text,
  ADD COLUMN IF NOT EXISTS cf_svy_has_negatives       text;`;
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query(`INSERT INTO schema_migrations (key) VALUES ($1)`, [want]);
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        }
        const cols = await client.query(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema='public' AND table_name='client_custom_fields'
              AND column_name LIKE 'cf_svy_%'
            ORDER BY column_name`
        );
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ok: true,
            applied: true,
            key: want,
            cf_svy_columns: cols.rows.map((r) => r.column_name)
          })
        };
      } finally {
        await client.end().catch(() => {});
      }
    }

    if (body.action === "sql_peek") {
      // Gauntlet-only read helpers. Whitelist queries by name — never raw SQL from client.
      const url = process.env.MIGRATION_DATABASE_URL || "";
      if (!url || url.includes("****")) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: "missing MIGRATION_DATABASE_URL" }) };
      }
      const which = String(body.which || "");
      const client = new pg.Client({
        connectionString: url,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 20000
      });
      await client.connect();
      try {
        if (which === "contract_templates") {
          const r = await client.query(
            `SELECT id::text, template_key, name, created_at
               FROM contract_templates
              ORDER BY created_at DESC LIMIT 20`
          );
          return {
            statusCode: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ok: true, rows: r.rows })
          };
        }
        if (which === "client_docs") {
          const clientId = String(body.client_id || "").trim();
          const r = await client.query(
            `SELECT id::text, client_id::text, kind, title, created_at
               FROM documents WHERE client_id = $1::uuid
               ORDER BY created_at DESC LIMIT 20`,
            [clientId]
          );
          return {
            statusCode: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ok: true, rows: r.rows })
          };
        }
        if (which === "inquiry_for_client") {
          const clientId = String(body.client_id || "").trim();
          const cases = await client.query(
            `SELECT id::text, client_id::text, created_at
               FROM inquiry_removal_cases WHERE client_id = $1::uuid
               ORDER BY created_at DESC LIMIT 20`,
            [clientId]
          );
          return {
            statusCode: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ok: true, cases: cases.rows })
          };
        }
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: "unknown_which" }) };
      } finally {
        await client.end().catch(() => {});
      }
    }

    if (body.action === "emit_inngest_probe") {
      // Fire a real bus.emit so Netlify runtime INNGEST_EVENT_KEY fans out to Inngest.
      const email = String(body.email || "").trim().toLowerCase();
      if (!email.includes("+test")) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: "test_email_only" }) };
      }
      const name = String(body.name || "entry.captured");
      const { emit } = await import("../../src/events/bus.mjs");
      const { registerAll } = await import("../../src/register-all.mjs");
      registerAll();
      const url = process.env.MIGRATION_DATABASE_URL || "";
      if (!url || url.includes("****")) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: "missing MIGRATION_DATABASE_URL" }) };
      }
      const client = new pg.Client({
        connectionString: url,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 20000
      });
      await client.connect();
      try {
        const db = { query: (t, p) => client.query(t, p) };
        const payload = body.payload && typeof body.payload === "object"
          ? body.payload
          : {
              email,
              name: "Chris Seam",
              phone: "(602) 555-0151",
              source: "inngest-probe"
            };
        const idem = `inngest-probe:${name}:${Date.now()}`;
        const res = await emit(db, name, payload, {
          idempotencyKey: idem,
          clientId: body.client_id || undefined,
          // Bus fire-and-forgets Inngest; we await an explicit send below so
          // Netlify does not freeze the isolate before the POST leaves.
          skipInngest: true
        });
        let inngestSend = { ok: false, error: "not_attempted" };
        const eventKey = process.env.INNGEST_EVENT_KEY || "";
        if (eventKey && !eventKey.includes("*") && res.id) {
          try {
            const { inngest } = await import("../../src/workflows/client.mjs");
            const orgId = (await db.query(`SELECT org_id FROM events WHERE id = $1`, [res.id])).rows[0]?.org_id;
            const sendRes = await inngest.send({
              name,
              data: {
                id: res.id,
                payload,
                orgId: orgId || null,
                clientId: body.client_id || null
              }
            });
            inngestSend = { ok: true, ids: sendRes?.ids || sendRes };
          } catch (err) {
            inngestSend = { ok: false, error: String(err?.message || err).slice(0, 200) };
          }
        } else {
          inngestSend = { ok: false, error: "INNGEST_EVENT_KEY missing_or_masked" };
        }
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ok: true,
            event_id: res.id,
            deduped: res.deduped,
            inngest_send: inngestSend,
            inngest_key_present: Boolean(eventKey && !eventKey.includes("*")),
            signing_key_present: Boolean(process.env.INNGEST_SIGNING_KEY && !String(process.env.INNGEST_SIGNING_KEY).includes("*"))
          })
        };
      } finally {
        await client.end().catch(() => {});
      }
    }

    if (body.action === "issue_portal_link") {
      const email = String(body.email || "").trim().toLowerCase();
      // Hard gate: only +test addresses (gauntlet). Never issue for real customers here.
      if (!email.includes("+test")) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: "test_email_only" }) };
      }
      const url = process.env.MIGRATION_DATABASE_URL || "";
      if (!url || url.includes("****")) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: "missing MIGRATION_DATABASE_URL" }) };
      }
      const { requestMagicLink } = await import("../../src/auth/magic-link.mjs");
      const client = new pg.Client({
        connectionString: url,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 20000
      });
      await client.connect();
      try {
        const db = { query: (t, p) => client.query(t, p) };
        const res = await requestMagicLink(db, { email, ip: "127.0.0.1", userAgent: "cf-seam-watch" });
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ok: res.ok === true,
            outcome: res.outcome || null,
            limited: res.limited === true,
            sent: res.sent === true,
            has_token: Boolean(res.token),
            // Token returned only for +test gauntlet portal proof (dry-run window).
            token: res.token || null,
            linkId: res.linkId || null
          })
        };
      } finally {
        await client.end().catch(() => {});
      }
    }

    if (body.action === "peek_portal") {
      const url = process.env.MIGRATION_DATABASE_URL || "";
      if (!url || url.includes("****")) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: "missing MIGRATION_DATABASE_URL" }) };
      }
      const email = String(body.email || "").trim().toLowerCase();
      const clientId = String(body.client_id || "").trim();
      const client = new pg.Client({
        connectionString: url,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 20000
      });
      await client.connect();
      try {
        const accounts = await client.query(
          `SELECT id::text, kind, status, client_id::text, email, created_at
             FROM accounts
            WHERE ($1 = '' OR lower(email) = $1)
              AND ($2 = '' OR client_id::text = $2)
            ORDER BY created_at DESC LIMIT 5`,
          [email, clientId]
        );
        const links = await client.query(
          `SELECT id::text, outcome, account_id::text, client_id::text, created_at,
                  expires_at, used_at IS NOT NULL AS used
             FROM account_magic_links
            WHERE ($1 = '' OR lower(email) = $1)
            ORDER BY created_at DESC LIMIT 10`,
          [email]
        );
        const msgs = await client.query(
          `SELECT id::text, channel, status, template_key, created_at
             FROM messages
            WHERE ($1 = '' OR client_id::text = $1)
              AND (template_key ILIKE '%magic%' OR provider_ref ILIKE 'magic-link:%')
            ORDER BY created_at DESC LIMIT 10`,
          [clientId]
        );
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ok: true,
            accounts: accounts.rows,
            magic_links: links.rows,
            magic_messages: msgs.rows
          })
        };
      } finally {
        await client.end().catch(() => {});
      }
    }

    if (body.action === "link_ghl_contact") {
      // Gauntlet: attach an existing GHL contact id + phone onto a client row.
      const url = process.env.MIGRATION_DATABASE_URL || "";
      if (!url || url.includes("****")) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: "missing MIGRATION_DATABASE_URL" }) };
      }
      const clientId = String(body.client_id || "").trim();
      const ghlContactId = String(body.ghl_contact_id || "").trim();
      const phone = body.phone != null ? String(body.phone).trim() : null;
      if (!clientId || !ghlContactId) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: "client_id and ghl_contact_id required" }) };
      }
      if (/^\+?[0-9][0-9\s().-]{6,}$/.test(ghlContactId)) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: "ghl_contact_id looks like a phone" }) };
      }
      const client = new pg.Client({
        connectionString: url,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 20000
      });
      await client.connect();
      try {
        const r = await client.query(
          `UPDATE clients
              SET ghl_contact_id = $2,
                  phone = COALESCE(NULLIF($3, ''), phone)
            WHERE id = $1::uuid
        RETURNING id::text, email, phone, ghl_contact_id`,
          [clientId, ghlContactId, phone]
        );
        if (!r.rows[0]) {
          return { statusCode: 404, body: JSON.stringify({ ok: false, error: "client_not_found" }) };
        }
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ok: true, client: r.rows[0] })
        };
      } finally {
        await client.end().catch(() => {});
      }
    }

    if (body.action === "place_booked_card") {
      const url = process.env.MIGRATION_DATABASE_URL || "";
      if (!url || url.includes("****")) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: "missing MIGRATION_DATABASE_URL" }) };
      }
      const clientId = String(body.client_id || "").trim();
      if (!clientId) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: "client_id required" }) };
      }
      const { moveCardToStage } = await import("../../src/workflows/cards.mjs");
      const { addTags } = await import("../../src/workflows/tags.mjs");
      const { mergeCustomFields } = await import("../../src/workflows/custom-fields.mjs");
      const client = new pg.Client({
        connectionString: url,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 20000
      });
      await client.connect();
      try {
        const db = { query: (t, p) => client.query(t, p) };
        const row = await client.query(
          `SELECT id, org_id, phone FROM clients WHERE id = $1 LIMIT 1`,
          [clientId]
        );
        if (!row.rows[0]) {
          return { statusCode: 404, body: JSON.stringify({ ok: false, error: "client_not_found" }) };
        }
        const orgId = row.rows[0].org_id;
        if (body.phone && !row.rows[0].phone) {
          await client.query(`UPDATE clients SET phone = $2 WHERE id = $1`, [clientId, String(body.phone)]);
        }
        await addTags(db, clientId, ["lead:new", "call:booked"]);
        await mergeCustomFields(db, clientId, { lifecycle_status: "New Lead", call_outcome: "booked" });
        const card = await moveCardToStage(db, {
          orgId,
          clientId,
          pipelineKey: "sales",
          stageKey: "booked"
        });
        const cards = await client.query(
          `SELECT c.id::text, p.key AS pipeline, ps.key AS stage
             FROM cards c
             JOIN pipelines p ON p.id = c.pipeline_id
             JOIN pipeline_stages ps ON ps.id = c.stage_id
            WHERE c.client_id = $1`,
          [clientId]
        );
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ok: true, card, cards: cards.rows })
        };
      } finally {
        await client.end().catch(() => {});
      }
    }

    if (body.action === "w4_objects") {
      const url = process.env.MIGRATION_DATABASE_URL || "";
      if (!url || url.includes("****")) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: "missing MIGRATION_DATABASE_URL" }) };
      }
      const client = new pg.Client({
        connectionString: url,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 20000
      });
      await client.connect();
      try {
        const tables = await client.query(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema='public' AND table_name LIKE '%dispute%'
            ORDER BY table_name`
        );
        const hidden = await client.query(
          `SELECT key, sort_order FROM pipeline_stages WHERE sort_order >= 900 ORDER BY sort_order, key`
        );
        const byStage = await client.query(
          `SELECT s.key, count(*)::int AS n
             FROM cards c
             JOIN pipeline_stages s ON s.id = c.stage_id
            GROUP BY s.key
            ORDER BY 2 DESC, 1`
        );
        const migKeys = await client.query(
          `SELECT key FROM schema_migrations
            WHERE key LIKE '%160%' OR key LIKE '%161%'
            ORDER BY key`
        );
        const host = (() => {
          try { return new URL(url.replace(/^postgresql:/,'postgres:')).hostname; } catch { return '(parse_fail)'; }
        })();
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ok: true,
            db_host: host,
            source_env: "MIGRATION_DATABASE_URL",
            dispute_tables: tables.rows.map(r => r.table_name),
            stages_sort_ge_900: hidden.rows,
            cards_by_stage_key: byStage.rows,
            schema_migrations_160_161: migKeys.rows.map(r => r.key)
          })
        };
      } finally {
        await client.end().catch(() => {});
      }
    }

    if (body.action === "w4_counts") {
      const url = process.env.MIGRATION_DATABASE_URL || "";
      if (!url || url.includes("****")) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: "missing MIGRATION_DATABASE_URL" }) };
      }
      const client = new pg.Client({
        connectionString: url,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 20000
      });
      await client.connect();
      try {
        const mig = await client.query(`SELECT count(*)::int AS n FROM schema_migrations`);
        const cards = await client.query(`SELECT count(*)::int AS n FROM cards`);
        const applied160 = await client.query(
          `SELECT EXISTS (
             SELECT 1 FROM schema_migrations WHERE key IN (
               'migrations/160_metro2_dispute_engine.sql',
               '160_metro2_dispute_engine.sql'
             )
           ) AS applied`
        );
        const applied161 = await client.query(
          `SELECT EXISTS (
             SELECT 1 FROM schema_migrations WHERE key IN (
               'migrations/161_optimization_repair_pipeline.sql',
               '161_optimization_repair_pipeline.sql'
             )
           ) AS applied`
        );
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ok: true,
            schema_migrations: mig.rows[0].n,
            cards: cards.rows[0].n,
            applied_160: applied160.rows[0].applied,
            applied_161: applied161.rows[0].applied
          })
        };
      } finally {
        await client.end().catch(() => {});
      }
    }
    const result = await run(body.since, body.email);
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result)
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: String(e.message || e).slice(0, 400) })
    };
  }
}
