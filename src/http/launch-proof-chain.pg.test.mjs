// Real-Postgres launch proof for the protected closer context chain.
//
// One transaction and one database connection carry each marker through:
// Call/Present handler -> call_outcomes -> agent-context handler -> agent runtime
// model request. ROLLBACK removes every fixture row. Never point this test at
// production; CI runs it against its disposable Postgres service.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

import callOutcomesHandler from "../../api/call-outcomes.mjs";
import closerDeckHandler from "../../api/closer-deck.mjs";
import { run as readAgentContext } from "../../api/read/agent-context.mjs";
import { handleInbound } from "../agents/runtime.mjs";
import { createSession } from "../auth/session.mjs";
import { requireAuth } from "./middleware/requireAuth.mjs";

const HAS_DB = Boolean(process.env.DATABASE_URL);

const IDS = Object.freeze({
  org: "8e2e1000-0000-4000-8000-000000000001",
  staff: "8e2e1000-0000-4000-8000-000000000002",
  client: "8e2e1000-0000-4000-8000-000000000003",
  agent: "8e2e1000-0000-4000-8000-000000000004",
  conversation: "8e2e1000-0000-4000-8000-000000000005",
  callMessage: "8e2e1000-0000-4000-8000-000000000006",
  presentMessage: "8e2e1000-0000-4000-8000-000000000007",
  callEvent: "8e2e1000-0000-4000-8000-000000000008",
  presentEvent: "8e2e1000-0000-4000-8000-000000000009"
});

const CALL_MARKER = "LAUNCH-PROOF-CALL-20260820";
const PRESENT_MARKER = "LAUNCH-PROOF-PRESENT-20260820";

function response() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    }
  };
}

describe("protected closer context chain against one real Postgres transaction", {
  skip: !HAS_DB ? "no DATABASE_URL" : false
}, () => {
  let database;
  let token;

  before(async () => {
    database = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await database.connect();
    await database.query("BEGIN");

    await database.query(
      `INSERT INTO orgs (id, slug, name)
       VALUES ($1, 'launch-proof-chain-pgtest', 'Launch Proof Chain Pgtest')`,
      [IDS.org]
    );
    await database.query(
      `INSERT INTO staff (id, org_id, email, name, role, status)
       VALUES ($1, $2, 'launch-proof-chain@example.test', 'Launch Proof Closer', 'owner', 'active')`,
      [IDS.staff, IDS.org]
    );
    await database.query(
      `INSERT INTO clients (
         id, org_id, first_name, last_name, email, custom_fields, tags
       ) VALUES (
         $1, $2, 'Launch', 'Proof', 'launch-proof-chain@example.test',
         '{"fixture":"launch-proof-chain"}'::jsonb, ARRAY['e2e','launch-proof']
       )`,
      [IDS.client, IDS.org]
    );
    await database.query(
      `INSERT INTO agents (
         id, org_id, code, name, agent_class, channel, status, runtime, prompt,
         guardrails, sort_order
       ) VALUES (
         $1, $2, 'LP-01', 'Launch Proof Model Spy', 'client_facing', 'sms',
         'shadow', 'netlify', 'Reply safely. Never send from this proof.',
         '{"authority":{"msgcap":8},"flags":{}}'::jsonb, 1
       )`,
      [IDS.agent, IDS.org]
    );
    await database.query(
      `INSERT INTO conversations (
         id, org_id, client_id, channel, kind, agent_code
       ) VALUES ($1, $2, $3, 'sms', 'client', 'LP-01')`,
      [IDS.conversation, IDS.org, IDS.client]
    );

    token = (await createSession(database, {
      staffId: IDS.staff,
      orgId: IDS.org
    })).token;
  });

  after(async () => {
    if (!database) return;
    await database.query("ROLLBACK");
    await database.end();
  });

  async function insertInbound({ id, providerRef, body }) {
    await database.query(
      `INSERT INTO messages (
         id, org_id, client_id, conversation_id, direction, channel,
         rendered_body, provider, provider_ref, status, sender_kind
       ) VALUES (
         $1, $2, $3, $4, 'inbound', 'sms',
         $5, 'launch-proof', $6, 'received', 'client'
       )`,
      [id, IDS.org, IDS.client, IDS.conversation, body, providerRef]
    );
  }

  async function proveReadAndModel(marker, { messageId, providerRef, eventId }) {
    const contextRes = response();
    await readAgentContext({
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      query: { client_id: IDS.client }
    }, contextRes, { db: database, requireAuth });

    assert.equal(contextRes.statusCode, 200);
    assert.match(contextRes.body.context.as_prompt_block, new RegExp(marker));

    await insertInbound({
      id: messageId,
      providerRef,
      body: "This is an isolated launch-proof model-spy turn."
    });

    let actualModelRequest = null;
    const runtimeResult = await handleInbound({
      id: eventId,
      name: "message.inbound",
      orgId: IDS.org,
      clientId: IDS.client,
      payload: {
        channel: "sms",
        body: "This is an isolated launch-proof model-spy turn.",
        sid: providerRef
      }
    }, database, {
      env: { ANTHROPIC_API_KEY: "test-only-model-spy" },
      now: () => new Date("2026-08-20T18:00:00.000Z"),
      callModelFn: async (request) => {
        actualModelRequest = request;
        return {
          mode: "live",
          text: "This proof reply stays in shadow.",
          request,
          error: null
        };
      }
    });

    assert.equal(runtimeResult.reason, "shadow_status");
    assert.ok(actualModelRequest, "the runtime must call the model boundary");
    assert.match(actualModelRequest.system, new RegExp(marker));

    const shadow = await database.query(
      `SELECT model_request
         FROM agent_shadow_log
        WHERE org_id = $1 AND client_id = $2 AND inbound_message_id = $3`,
      [IDS.org, IDS.client, messageId]
    );
    assert.equal(shadow.rows.length, 1);
    assert.match(shadow.rows[0].model_request.system, new RegExp(marker));
  }

  test("Call and Present markers persist, reach agent-context, and enter the actual model request",
    async (t) => {
      await t.test("Call outcome marker crosses the whole chain", async () => {
        const res = response();
        await callOutcomesHandler({
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: {
            client_id: IDS.client,
            outcome: "callback",
            notes: CALL_MARKER
          }
        }, res, { db: database });

        assert.equal(res.statusCode, 201);
        const stored = await database.query(
          `SELECT outcome, notes
             FROM call_outcomes
            WHERE org_id = $1 AND client_id = $2 AND notes = $3`,
          [IDS.org, IDS.client, CALL_MARKER]
        );
        assert.deepEqual(stored.rows, [{ outcome: "callback", notes: CALL_MARKER }]);

        await proveReadAndModel(CALL_MARKER, {
          messageId: IDS.callMessage,
          providerRef: "launch-proof-call-inbound",
          eventId: IDS.callEvent
        });
      });

      await t.test("Present log_disposition marker crosses the whole chain", async () => {
        const res = response();
        await closerDeckHandler({
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: {
            action: "log_disposition",
            client_id: IDS.client,
            offer_key: "FUNDING_DFY",
            route: "launch-proof",
            temperature: 7,
            beliefs_count: 2,
            cost_of_inaction: PRESENT_MARKER
          }
        }, res, { db: database, requireAuth });

        assert.equal(res.statusCode, 201);
        const stored = await database.query(
          `SELECT outcome, notes
             FROM call_outcomes
            WHERE org_id = $1
              AND client_id = $2
              AND notes LIKE $3
            ORDER BY logged_at DESC
            LIMIT 1`,
          [IDS.org, IDS.client, `%${PRESENT_MARKER}%`]
        );
        assert.equal(stored.rows[0].outcome, "deposit");
        assert.match(stored.rows[0].notes, new RegExp(PRESENT_MARKER));

        await proveReadAndModel(PRESENT_MARKER, {
          messageId: IDS.presentMessage,
          providerRef: "launch-proof-present-inbound",
          eventId: IDS.presentEvent
        });
      });
    });
});
