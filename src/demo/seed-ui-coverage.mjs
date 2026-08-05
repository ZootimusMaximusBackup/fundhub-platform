// Extra Demo Mode rows so CRM screens are populated end-to-end.
// Called from seedPlatformDemo. Idempotent. Failures in one section do not abort others.

import { DEMO_CLIENTS, demoClientEmail, PLATFORM_TAG } from "./roster.mjs";

const q = async (db, sql, params = []) => {
  try { return await db.query(sql, params); }
  catch { return { rows: [], rowCount: 0 }; }
};

async function seedFinanceSurface(db, { orgId, clientIds }) {
  for (const n of [1, 2, 7]) {
    const clientId = clientIds[n];
    if (!clientId) continue;
    let ent = (await q(db, `SELECT id FROM entities WHERE org_id=$1 AND client_id=$2 AND kind='business' LIMIT 1`, [orgId, clientId])).rows[0];
    if (!ent) {
      ent = (await q(db,
        `INSERT INTO entities (org_id, client_id, kind, name, is_demo)
         VALUES ($1,$2,'business',$3,true) RETURNING id`,
        [orgId, clientId, DEMO_CLIENTS.find((c) => c.n === n)?.biz || "Demo Business"])).rows[0];
    } else {
      await q(db, `UPDATE entities SET is_demo=true WHERE id=$1`, [ent.id]);
    }
    let acct = (await q(db, `SELECT id FROM bank_accounts WHERE org_id=$1 AND client_id=$2 AND is_demo LIMIT 1`, [orgId, clientId])).rows[0];
    if (!acct) {
      acct = (await q(db,
        `INSERT INTO bank_accounts (
           org_id, client_id, name, mask, account_type, account_subtype, currency_code,
           current_balance_cents, available_balance_cents, entity_kind, entity_kind_source,
           entity_id, provider, provider_account_id, is_demo, raw
         ) VALUES (
           $1,$2,'DEMO Operating Checking',$3,'depository','checking','USD',
           $4,$4,'business','staff_reviewed',$5,'mock',$6,true,'{"demo":true,"provider":"mock"}'::jsonb
         ) RETURNING id`,
        [orgId, clientId, String(4200 + n), 180000 + n * 25000, ent?.id || null, `demo-ba-${n}`])).rows[0];
    }
    if (acct?.id) {
      for (let t = 0; t < 6; t++) {
        const amt = t % 2 === 0 ? -(12000 + t * 500) : (45000 + t * 1000);
        await q(db,
          `INSERT INTO bank_transactions (
             org_id, bank_account_id, client_id, subject_client_id, amount_cents, posted_on,
             merchant_name, category, provider, provider_transaction_id, is_demo, raw
           ) SELECT $1,$2,$3,$3,$4,(CURRENT_DATE - ($5::int)),$6,$7,'mock',$8,true,'{"demo":true}'::jsonb
           WHERE NOT EXISTS (
             SELECT 1 FROM bank_transactions WHERE org_id=$1 AND provider_transaction_id=$8
           )`,
          [orgId, acct.id, clientId, amt, String(t + 1),
            t % 2 === 0 ? "Harborwick Utilities" : "Quillcrest Client Payment",
            t % 2 === 0 ? "ops" : "income", `demo-btx-${n}-${t}`]);
      }
      await q(db,
        `INSERT INTO recurring_bills (
           org_id, bank_account_id, client_id, merchant_key, merchant_display, cadence,
           typical_amount_cents, next_expected_on, confidence_pct, confidence_label,
           source, entity_id, is_demo, anchor_day_of_month
         ) SELECT $1,$2,$3,'demo-harborwick-util','Harborwick Utilities','monthly',
                  12900, (date_trunc('month', CURRENT_DATE) + interval '1 month' + interval '14 days')::date,
                  85,'high','manual',$4,true,15
         WHERE NOT EXISTS (
           SELECT 1 FROM recurring_bills WHERE bank_account_id=$2 AND merchant_key='demo-harborwick-util'
         )`,
        [orgId, acct.id, clientId, ent?.id || null]);
    }
    const tl = (await q(db, `SELECT id FROM tradelines WHERE org_id=$1 AND client_id=$2 ORDER BY created_at LIMIT 1`, [orgId, clientId])).rows[0];
    if (tl) {
      await q(db,
        `INSERT INTO card_liabilities (
           org_id, client_id, tradeline_id, as_of, statement_balance_cents, current_balance_cents,
           minimum_payment_cents, apr, payment_status, source, entity_id, is_demo, raw
         ) SELECT $1,$2,$3,CURRENT_DATE,210000,195000,4500,0.18990,'current','manual',$4,true,'{"demo":true}'::jsonb
         WHERE NOT EXISTS (SELECT 1 FROM card_liabilities WHERE tradeline_id=$3)`,
        [orgId, clientId, tl.id, ent?.id || null]);
    }
  }
}

async function seedTasksCalendar(db, { orgId, clientIds, closer, advisor }) {
  const titles = [
    { n: 1, title: "DEMO · Funding call — Cobalt Harbor", days: 0, who: closer },
    { n: 2, title: "DEMO · Deposit follow-up — Quillcrest", days: 1, who: closer },
    { n: 5, title: "DEMO · Callback — Lumenbridge", days: 0, who: closer },
    { n: 6, title: "DEMO · Inquiry bureau call — Hollowreed", days: 2, who: advisor },
    { n: 7, title: "DEMO · Closeout review — Valebright", days: -1, who: advisor },
    { n: 8, title: "DEMO · AR collect — Thornfield", days: 3, who: closer }
  ];
  for (const t of titles) {
    const clientId = clientIds[t.n];
    if (!clientId) continue;
    await q(db,
      `INSERT INTO tasks (org_id, client_id, assignee, title, body, due_at, source_workflow, done, is_demo)
       SELECT $1,$2,$3,$4,$5, now() + ($6||' days')::interval, 'platform_demo', $7, true
       WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE org_id=$1 AND title=$4 AND is_demo)`,
      [orgId, clientId, t.who?.name || "DEMO Closer", t.title, "Platform demo calendar item.", String(t.days), t.days < 0]);
  }
}

async function seedDocuments(db, { orgId, clientIds }) {
  for (const n of [1, 2, 7]) {
    const clientId = clientIds[n];
    if (!clientId) continue;
    const key = `authorization|soft_pull|${clientId}`;
    await q(db,
      `INSERT INTO documents (
         org_id, client_id, document_key, kind, subtype, title, storage_key, mime_type,
         byte_size, checksum, generated_by, delivery_status, delivery_channel, delivered_at, metadata, is_demo
       ) SELECT $1,$2,$3,'authorization','soft_pull',$4,$5,'application/pdf',
                2048,'sha256:deadbeef', 'platform_demo','delivered','portal',now(),'{"demo":true}'::jsonb, true
       WHERE NOT EXISTS (SELECT 1 FROM documents WHERE org_id=$1 AND document_key=$3)`,
      [orgId, clientId, key, `DEMO Soft-pull auth — ${demoClientEmail(n)}`, `demo/docs/${clientId}/soft-pull.pdf`]);
    const key2 = `deliverable|metro2|${clientId}`;
    await q(db,
      `INSERT INTO documents (
         org_id, client_id, document_key, kind, subtype, title, storage_key, mime_type,
         byte_size, generated_by, delivery_status, metadata, is_demo
       ) SELECT $1,$2,$3,'deliverable','metro2',$4,$5,'application/pdf',
                4096,'platform_demo','not_delivered','{"demo":true}'::jsonb, true
       WHERE NOT EXISTS (SELECT 1 FROM documents WHERE org_id=$1 AND document_key=$3)`,
      [orgId, clientId, key2, `DEMO Metro2 pack — ${demoClientEmail(n)}`, `demo/docs/${clientId}/metro2.pdf`]);
  }
}

async function seedSubscriptions(db, { orgId, clientIds }) {
  for (const n of [1, 3, 8]) {
    const clientId = clientIds[n];
    if (!clientId) continue;
    let card = (await q(db, `SELECT id FROM client_cards WHERE org_id=$1 AND client_id=$2 AND is_demo LIMIT 1`, [orgId, clientId])).rows[0];
    if (!card) {
      card = (await q(db,
        `INSERT INTO client_cards (org_id, client_id, provider, provider_token, brand, last4, exp_month, exp_year, is_demo)
         VALUES ($1,$2,'demo',$3,'visa',$4,12,2030,true) RETURNING id`,
        [orgId, clientId, `demo-card-tok-${n}`, String(1000 + n).slice(-4)])).rows[0];
    }
    await q(db,
      `INSERT INTO subscriptions (
         org_id, client_id, tier, status, price_cents, currency, card_id, provider, provider_ref,
         current_period_start, current_period_end, is_demo
       ) SELECT $1,$2,$3,$4,$5,'USD',$6,'demo',$7, now()-interval '10 days', now()+interval '20 days', true
       WHERE NOT EXISTS (SELECT 1 FROM subscriptions WHERE org_id=$1 AND client_id=$2 AND is_demo)`,
      [orgId, clientId, n === 8 ? "optimization-lite" : "card-stacking-dfy",
        n === 8 ? "past_due" : "active", n === 8 ? 49700 : 29900, card?.id || null, `demo-sub-${n}`]);
  }
}

async function seedTargetsAndEvents(db, { orgId, clientIds, staffRows, closer }) {
  for (const s of staffRows.filter((x) => ["closer", "sales_manager", "setter"].includes(x.role)).slice(0, 4)) {
    await q(db,
      `INSERT INTO staff_targets (org_id, staff_id, period, metric, target_value, is_demo)
       SELECT $1,$2,'week','deposits',5,true
       WHERE NOT EXISTS (SELECT 1 FROM staff_targets WHERE org_id=$1 AND staff_id=$2 AND period='week' AND metric='deposits')`,
      [orgId, s.id]);
    await q(db,
      `INSERT INTO staff_targets (org_id, staff_id, period, metric, target_value, is_demo)
       SELECT $1,$2,'week','cash_cents',750000,true
       WHERE NOT EXISTS (SELECT 1 FROM staff_targets WHERE org_id=$1 AND staff_id=$2 AND period='week' AND metric='cash_cents')`,
      [orgId, s.id]);
  }
  for (const n of [1, 2, 3, 7]) {
    const clientId = clientIds[n];
    if (!clientId) continue;
    await q(db,
      `INSERT INTO events (org_id, name, version, idempotency_key, client_id, payload, is_demo)
       SELECT $1,'demo.client.touch',1,$2,$3,'{"demo":true,"tag":"${PLATFORM_TAG}"}'::jsonb,true
       WHERE NOT EXISTS (SELECT 1 FROM events WHERE org_id=$1 AND idempotency_key=$2)`,
      [orgId, `demo-evt-touch-${n}`, clientId]);
  }
  await q(db,
    `INSERT INTO events (org_id, name, version, idempotency_key, client_id, payload, is_demo)
     SELECT $1,'sale.closed',1,'demo-evt-sale-1',$2,'{"demo":true,"amount":3000}'::jsonb,true
     WHERE NOT EXISTS (SELECT 1 FROM events WHERE org_id=$1 AND idempotency_key='demo-evt-sale-1')`,
    [orgId, clientIds[1], closer?.id]);
}

async function seedHiring(db, { orgId }) {
  const role = (await q(db, `SELECT id FROM hiring_roles WHERE org_id=$1 ORDER BY created_at LIMIT 1`, [orgId])).rows[0]
    || (await q(db, `SELECT id FROM hiring_roles ORDER BY created_at LIMIT 1`)).rows[0];
  if (!role) return;
  const stages = (await q(db,
    `SELECT ps.id, ps.name, ps.sort_order FROM pipeline_stages ps
       JOIN pipelines p ON p.id = ps.pipeline_id
      WHERE p.org_id=$1 AND p.key='hiring' ORDER BY ps.sort_order`, [orgId])).rows;
  if (!stages.length) return;
  await q(db,
    `INSERT INTO hiring_job_postings (org_id, role_id, channel, external_id, title, description, location, status, posted_at, is_demo)
     SELECT $1,$2,'internal','DEMO-POST-CLOSER','DEMO Closer — Cobalt Harbor Desk','Platform demo posting','Remote','posted',now(),true
     WHERE NOT EXISTS (SELECT 1 FROM hiring_job_postings WHERE org_id=$1 AND external_id='DEMO-POST-CLOSER')`,
    [orgId, role.id]);
  const posting = (await q(db, `SELECT id FROM hiring_job_postings WHERE org_id=$1 AND external_id='DEMO-POST-CLOSER'`, [orgId])).rows[0];
  const names = [
    { email: "demo.hire.01@demo.fundhub.local", full: "DEMO Candidate — Juniper Vale", stage: 0 },
    { email: "demo.hire.02@demo.fundhub.local", full: "DEMO Candidate — Cedar Holt", stage: 1 },
    { email: "demo.hire.03@demo.fundhub.local", full: "DEMO Candidate — Maple Crest", stage: 2 }
  ];
  for (const c of names) {
    await q(db,
      `INSERT INTO candidates (org_id, full_name, email, phone, source, source_detail, notes, is_demo)
       SELECT $1,$2,$3,'+1555700901','inbound','platform_demo','demo',true
       WHERE NOT EXISTS (SELECT 1 FROM candidates WHERE org_id=$1 AND email=$3)`,
      [orgId, c.full, c.email]);
    const cand = (await q(db, `SELECT id FROM candidates WHERE org_id=$1 AND email=$2`, [orgId, c.email])).rows[0];
    const stage = stages[Math.min(c.stage, stages.length - 1)];
    if (!cand || !stage) continue;
    await q(db,
      `INSERT INTO candidate_applications (org_id, candidate_id, role_id, stage_id, job_posting_id, status, answers, external_application_id)
       SELECT $1,$2,$3,$4,$5,'open','{"demo":true}'::jsonb,$6
       WHERE NOT EXISTS (
         SELECT 1 FROM candidate_applications WHERE candidate_id=$2 AND role_id=$3 AND status='open'
       )`,
      [orgId, cand.id, role.id, stage.id, posting?.id || null, `demo-app-${c.email}`]);
  }
}

async function seedJourneys(db, { orgId, owner }) {
  const nodes = JSON.stringify([
    { id: "n1", type: "start", label: "DEMO start" },
    { id: "n2", type: "sms", label: "DEMO welcome SMS", template_key: "DEMO-SMS-WELCOME" },
    { id: "n3", type: "wait", label: "Wait 1 day", days: 1 },
    { id: "n4", type: "end", label: "Done" }
  ]);
  await q(db,
    `INSERT INTO journeys (org_id, key, name, start_when, end_when, description, nodes, updated_by, is_demo)
     SELECT $1,'demo-platform-nurture','DEMO Platform Nurture','lead.created','sale.closed',
            'Platform Demo Mode journey so Journeys screen is populated.', $2::jsonb, $3, true
     WHERE NOT EXISTS (SELECT 1 FROM journeys WHERE org_id=$1 AND key='demo-platform-nurture')`,
    [orgId, nodes, owner?.id || null]);
  await q(db,
    `INSERT INTO journeys (org_id, key, name, start_when, end_when, description, nodes, updated_by, is_demo)
     SELECT $1,'demo-platform-funding','DEMO Funding Follow-up','funding.round.open','funding.funded',
            'Second demo journey for the editor list.', $2::jsonb, $3, true
     WHERE NOT EXISTS (SELECT 1 FROM journeys WHERE org_id=$1 AND key='demo-platform-funding')`,
    [orgId, nodes, owner?.id || null]);
}

/** Seed rows that fill remaining CRM UI surfaces. */
export async function seedUiCoverage(db, ctx) {
  await seedFinanceSurface(db, ctx);
  await seedTasksCalendar(db, ctx);
  await seedDocuments(db, ctx);
  await seedSubscriptions(db, ctx);
  await seedTargetsAndEvents(db, ctx);
  await seedHiring(db, ctx);
  await seedJourneys(db, ctx);
  return { ok: true };
}
