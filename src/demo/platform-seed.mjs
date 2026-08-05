// Platform Demo Mode seed
import { ingestCrsResult } from "../tradelines/store.mjs";
import {
  DEMO_CLIENTS, DEMO_LENDERS, DEMO_AFFILIATE, DEMO_PARTNER,
  DEMO_EMAIL_DOMAIN, PLATFORM_TAG, demoClientEmail,
  OUTCOMES, BELIEFS, CALL_STATES
} from "./roster.mjs";

const q = async (db, sql, params = []) => { try { return await db.query(sql, params); } catch { return { rows: [] }; } };

function crsPayload(c) {
  const util = c.tier === "REPAIR_ONLY" ? 72 : c.tier === "PREMIUM_STACK" ? 12 : 28;
  const email = demoClientEmail(c.n);
  return {
    outcome: c.tier,
    reason_codes: ["platform_demo"],
    consumerSignals: { scores: { perBureau: { ...c.scores } }, utilization: { pct: util } },
    crm_payload: { outcome: c.tier, contact: { email, name: c.first + " " + c.last }, scores: { ...c.scores },
      customFields: { total_funding_estimate: c.amount || 50000, business_name: c.biz } },
    tradelines: [
      { creditorName: "Harborwick National Bank", accountType: "revolving", creditLimitAmount: "12000", currentBalanceAmount: String(Math.round(12000*util/100)), accountIdentifier: "DEMO-TL-"+c.n+"-01", accountOpenedDate: "2019-03-15", bureau: "EX" },
      { creditorName: "Quillcrest Capital", accountType: "revolving", creditLimitAmount: "15000", currentBalanceAmount: String(Math.round(15000*util/100)), accountIdentifier: "DEMO-TL-"+c.n+"-02", accountOpenedDate: "2020-07-01", bureau: "EQ" },
      { creditorName: "Lumenbridge Card Co", accountType: "revolving", creditLimitAmount: "10000", currentBalanceAmount: String(Math.round(10000*util/100)), accountIdentifier: "DEMO-TL-"+c.n+"-03", accountOpenedDate: "2021-11-20", bureau: "TU" }
    ]
  };
}

export async function seedPlatformDemo(db, { orgId } = {}) {
  if (!orgId) throw new TypeError("seedPlatformDemo: orgId required");
  const staffRows = (await db.query(`SELECT id,email,name,role FROM staff WHERE org_id=$1 AND is_demo AND status='active'`, [orgId])).rows;
  if (!staffRows.length) throw new Error("demo_seed_requires_demo_staff");
  const byRole = {}; for (const s of staffRows) if (!byRole[s.role]) byRole[s.role] = s;
  const owner = byRole.owner || staffRows[0];
  const closer = byRole.closer || staffRows[0];
  const advisor = byRole.funding_advisor || closer;
  const mgr = byRole.sales_manager || closer;
  const product = (await db.query(`SELECT id,code,name FROM products WHERE org_id=$1 AND active ORDER BY CASE code WHEN 'card-stacking-dfy' THEN 0 ELSE 1 END LIMIT 1`, [orgId])).rows[0];
  if (!product) throw new Error("demo_seed_requires_products");
  const pipes = (await db.query(`SELECT p.id AS pipeline_id,p.key,ps.id AS stage_id FROM pipelines p JOIN pipeline_stages ps ON ps.pipeline_id=p.id WHERE p.org_id=$1 ORDER BY p.key,ps.sort_order`, [orgId])).rows;
  const pipeMap = new Map(); for (const r of pipes) { if (!pipeMap.has(r.key)) pipeMap.set(r.key, []); pipeMap.get(r.key).push(r); }

  await q(db, `INSERT INTO affiliates (org_id,name,status,tracking_id,tier_level,activated_at,partner_license_signed_at,is_demo)
    SELECT $1,$2,'active',$3,'tier1',now(),now(),true WHERE NOT EXISTS (SELECT 1 FROM affiliates WHERE org_id=$1 AND tracking_id=$3)`, [orgId, DEMO_AFFILIATE.name, DEMO_AFFILIATE.tracking_id]);
  await q(db, `INSERT INTO partners (org_id,name,brand_name,slug,status,revenue_share_pct,agreement_signed_at,contact_email,notes,is_demo)
    SELECT $1,$2,$3,$4,'active',45,now(),$5,'Platform demo',true WHERE NOT EXISTS (SELECT 1 FROM partners WHERE org_id=$1 AND slug=$4)`,
    [orgId, DEMO_PARTNER.name, DEMO_PARTNER.brand_name, DEMO_PARTNER.slug, DEMO_PARTNER.contact_email]);
  const affiliateId = (await q(db, `SELECT id FROM affiliates WHERE org_id=$1 AND tracking_id=$2`, [orgId, DEMO_AFFILIATE.tracking_id])).rows[0]?.id;
  const partnerId = (await q(db, `SELECT id FROM partners WHERE org_id=$1 AND slug=$2`, [orgId, DEMO_PARTNER.slug])).rows[0]?.id;

  const lenderIds = {};
  for (const L of DEMO_LENDERS) {
    await q(db, `INSERT INTO lenders (org_id,lender_table,name,product_name,active,priority_tier,typical_approval_range,external_row_id,notes,is_demo)
      SELECT $1,$2::lender_table,$3,$4,true,2,$5,$6,'demo',true WHERE NOT EXISTS (SELECT 1 FROM lenders WHERE org_id=$1 AND external_row_id=$6)`,
      [orgId, L.table, L.name, L.product, L.typical, L.key]);
    const id = (await q(db, `SELECT id FROM lenders WHERE org_id=$1 AND external_row_id=$2`, [orgId, L.key])).rows[0]?.id;
    if (id) lenderIds[L.key] = id;
  }

  const clientIds = {};
  for (const c of DEMO_CLIENTS) {
    const email = demoClientEmail(c.n);
    const cf = JSON.stringify({ business_name: c.biz, total_funding_estimate: c.amount || 50000, crs_paid: true, deposit_paid: c.n <= 8, sale_closed: c.n <= 7, demo_story: c.story });
    await q(db, `INSERT INTO clients (org_id,first_name,last_name,email,phone,funded,funded_amount,days_to_fund,outcome_tier,channel_source,tags,consent_sms,partner_id,is_demo,custom_fields)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,'platform_demo',ARRAY['is_demo',$10,$11],true,$12,true,$13::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM clients WHERE org_id=$1 AND lower(email)=lower($4))`,
      [orgId,c.first,c.last,email,c.phone,c.funded,c.amount,c.funded?30+c.n:null,c.tier,PLATFORM_TAG,c.biz,c.n===11?partnerId:null,cf]);
    await q(db, `UPDATE clients SET first_name=$3,last_name=$4,phone=$5,funded=$6,funded_amount=$7,outcome_tier=$8,is_demo=true,tags=ARRAY['is_demo',$9,$10],custom_fields=custom_fields||$11::jsonb WHERE org_id=$1 AND lower(email)=lower($2)`,
      [orgId,email,c.first,c.last,c.phone,c.funded,c.amount,c.tier,PLATFORM_TAG,c.biz,cf]);
    clientIds[c.n] = (await db.query(`SELECT id FROM clients WHERE org_id=$1 AND lower(email)=lower($2)`, [orgId, email])).rows[0].id;
  }

  for (const c of DEMO_CLIENTS) {
    const clientId = clientIds[c.n];
    if (!(await q(db, `SELECT id FROM crs_results WHERE org_id=$1 AND client_id=$2 AND is_demo LIMIT 1`, [orgId, clientId])).rows[0]) {
      const ins = await db.query(`INSERT INTO crs_results (org_id,client_id,result,outcome_tier,is_demo) VALUES ($1,$2,$3::jsonb,$4,true) RETURNING *`,
        [orgId, clientId, JSON.stringify(crsPayload(c)), c.tier]);
      await ingestCrsResult(db, ins.rows[0]).catch(() => null);
      await q(db, `UPDATE tradelines SET is_demo=true WHERE client_id=$1 AND org_id=$2`, [clientId, orgId]);
    }
    const stages = pipeMap.get(c.pipeline) || pipeMap.get("sales") || [];
    if (stages.length) {
      const stage = stages[c.n % stages.length];
      await q(db, `INSERT INTO cards (org_id,client_id,pipeline_id,stage_id,owner,is_demo)
        SELECT $1,$2,$3,$4,$5,true WHERE NOT EXISTS (SELECT 1 FROM cards WHERE org_id=$1 AND client_id=$2 AND pipeline_id=$3 AND is_demo)`,
        [orgId, clientId, stage.pipeline_id, stage.stage_id, closer.name]);
    }
  }

  const lenderList = Object.entries(lenderIds);
  const statuses = ["Approved","Denied","Action Required","Applied","Missing Docs","Apply"];
  for (const n of [1,2,3,7,8]) {
    const clientId = clientIds[n];
    let round = (await q(db, `SELECT id FROM funding_rounds WHERE org_id=$1 AND client_id=$2 AND is_demo LIMIT 1`, [orgId, clientId])).rows[0];
    const amt = DEMO_CLIENTS.find(x => x.n===n)?.amount || 50000;
    const close = n===1 || n===7;
    if (!round) round = (await db.query(`INSERT INTO funding_rounds (org_id,client_id,round_number,status,product,submitted_amount,approved_amount,funded_amount,is_demo) VALUES ($1,$2,1,$3,'card_stacking',$4,$5,$6,true) RETURNING id`,
      [orgId, clientId, close?"funded":"open", amt, close?amt:null, close?amt:null])).rows[0];
    if (!((await q(db, `SELECT count(*)::int n FROM applications WHERE funding_round_id=$1 AND is_demo`, [round.id])).rows[0]?.n) && lenderList.length) {
      for (let i=0;i<3;i++) {
        const [lKey,lId]=lenderList[i%lenderList.length]; const L=DEMO_LENDERS.find(x=>x.key===lKey);
        const st = close && i<2 ? "Approved" : statuses[(n+i)%statuses.length];
        await q(db, `INSERT INTO applications (org_id,funding_round_id,client_id,lender_id,bank,lender_name,product_name,lender_table,status,approved_amount,requested_amount,is_demo)
          VALUES ($1,$2,$3,$4,$5,$5,$6,$7::lender_table,$8,$9,$10,true)`,
          [orgId,round.id,clientId,lId,L.name,L.product,L.table,st,st==="Approved"?(L.typical||20000):null,L.typical]);
      }
    }
    if (close && !(await q(db, `SELECT id FROM funding_closeout WHERE funding_round_id=$1`, [round.id])).rows[0]) {
      const apps = (await q(db, `SELECT id,approved_amount,lender_name FROM applications WHERE funding_round_id=$1 AND status='Approved' AND is_demo`, [round.id])).rows;
      const total = apps.reduce((s,a)=>s+Number(a.approved_amount||0),0);
      const fee = Math.round(total*0.1*100)/100;
      const co = await db.query(`INSERT INTO funding_closeout (org_id,funding_round_id,total_approved_amount,total_fee,balance_due,fee_percent,status,is_demo) VALUES ($1,$2,$3,$4,$4,0.10,'open',true) RETURNING id`, [orgId,round.id,total,fee]);
      for (const a of apps) await q(db, `INSERT INTO funding_closeout_items (org_id,funding_closeout_id,application_id,approved_amount,fee_amount,lender_name) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [orgId,co.rows[0].id,a.id,Number(a.approved_amount||0),Math.round(Number(a.approved_amount||0)*0.1*100)/100,a.lender_name]);
    }
  }

  for (const n of [1,2,3,7,8,9]) {
    const clientId = clientIds[n]; const price = n===9?497:3000;
    let sale = (await q(db, `SELECT id FROM sales WHERE org_id=$1 AND client_id=$2 AND is_demo LIMIT 1`, [orgId, clientId])).rows[0];
    if (!sale) {
      sale = (await db.query(`INSERT INTO sales (org_id,client_id,product_id,agreed_price,agreed_success_fee_percent,status,external_ref,notes,is_demo,sold_at)
        VALUES ($1,$2,$3,$4,10,'active',$5,'demo',true,now()-($6||' days')::interval) RETURNING id`, [orgId,clientId,product.id,price,`demo-sale-${n}`,String(20-n)])).rows[0];
      await q(db, `INSERT INTO sale_payments (org_id,sale_id,amount,kind,paid_at,is_demo) VALUES ($1,$2,$3,'deposit',now()-interval '10 days',true)`, [orgId,sale.id,Math.min(1500,price)]);
    }
    if (!(await q(db, `SELECT id FROM commission_ledger WHERE org_id=$1 AND client_id=$2 AND is_demo LIMIT 1`, [orgId, clientId])).rows[0]) {
      const amt = Math.round(price*0.1*100)/100;
      await q(db, `INSERT INTO commission_ledger (org_id,staff_id,client_id,sale_id,product_id,product_name_at_earning,basis,role,amount,status,earned_at,source_event,idempotency_key,rule_snapshot,is_demo)
        VALUES ($1,$2,$3,$4,$5,$6,'front_end','closer',$7,$8,now()-interval '8 days','demo.seed',$9,'{"demo":true}',true)`,
        [orgId,closer.id,clientId,sale.id,product.id,product.name,amt,n<=3?"paid":"earned",`demo-comm-fe-${n}`]);
      if (n===1||n===7) await q(db, `INSERT INTO commission_ledger (org_id,staff_id,client_id,sale_id,product_id,product_name_at_earning,basis,role,amount,status,earned_at,source_event,idempotency_key,rule_snapshot,is_demo)
        VALUES ($1,$2,$3,$4,$5,$6,'back_end','funding_advisor',$7,'earned',now()-interval '2 days','demo.seed',$8,'{"demo":true}',true)`,
        [orgId,advisor.id,clientId,sale.id,product.id,product.name,Math.round(price*0.05*100)/100,`demo-comm-be-${n}`]);
    }
    if (!(await q(db, `SELECT id FROM invoices WHERE org_id=$1 AND client_id=$2 AND is_demo LIMIT 1`, [orgId, clientId])).rows[0]) {
      const st=["draft","sent","paid","overdue"][n%4];
      await q(db, `INSERT INTO invoices (org_id,client_id,sale_id,invoice_type,status,amount_due,issued_at,due_at,paid_at,idempotency_key,notes,is_demo)
        VALUES ($1,$2,$3,$4,$5,$6,now()-interval '12 days',now()+interval '18 days',$7,$8,'demo',true)`,
        [orgId,clientId,sale.id,(n===1||n===7)?"success_fee":"deposit",st,(n===1||n===7)?Math.round((DEMO_CLIENTS.find(x=>x.n===n)?.amount||50000)*0.1):price,st==="paid"?new Date():null,`demo-inv-${n}`]);
    }
    if (!(await q(db, `SELECT id FROM payment_links WHERE org_id=$1 AND client_id=$2 AND is_demo LIMIT 1`, [orgId, clientId])).rows[0]) {
      const st=["created","sent","paid","expired","void"][n%5];
      const ref=`demo-plink-${n}-${String(orgId).slice(0,8)}`;
      await q(db, `INSERT INTO payment_links (org_id,client_id,purpose,description,amount_cents,status,link_ref,checkout_url,created_by_staff_id,is_demo,sent_at,paid_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11)`,
        [orgId,clientId,n===9?"diagnostic":"deposit","Demo "+demoClientEmail(n),Math.round(price*100),st,ref,"https://checkout.demo.fundhub.local/pay/"+ref,closer.id,(st==="sent"||st==="paid")?new Date():null,st==="paid"?new Date():null]);
    }
    await q(db, `INSERT INTO entitlements (org_id,client_id,entitlement_code,granted_by,grant_reason,is_demo)
      SELECT $1,$2,'metro2-letter-pack',$3,'demo',true WHERE NOT EXISTS (SELECT 1 FROM entitlements WHERE org_id=$1 AND client_id=$2 AND entitlement_code='metro2-letter-pack' AND is_demo)`, [orgId,clientId,closer.id]);
    await q(db, `INSERT INTO transactions (org_id,client_id,product_name,amount_paid,status,provider,provider_ref,is_demo)
      SELECT $1,$2,$3,$4,'paid','demo',$5,true WHERE NOT EXISTS (SELECT 1 FROM transactions WHERE org_id=$1 AND provider_ref=$5)`,
      [orgId,clientId,product.name,Math.min(1500,price),`demo-tx-${n}`]);
  }

  for (const n of [1,2,5,7]) {
    const clientId = clientIds[n];
    let conv = (await q(db, `SELECT id FROM conversations WHERE org_id=$1 AND client_id=$2 AND channel='sms'`, [orgId, clientId])).rows[0];
    if (!conv) conv = (await db.query(`INSERT INTO conversations (org_id,client_id,channel,summary,sentiment,last_pulse_at,is_demo) VALUES ($1,$2,'sms',$3,'Warm',now(),true) RETURNING id`, [orgId,clientId,"Demo thread "+demoClientEmail(n)])).rows[0];
    else await q(db, `UPDATE conversations SET is_demo=true WHERE id=$1`, [conv.id]);
    if (!((await q(db, `SELECT count(*)::int n FROM messages WHERE conversation_id=$1 AND is_demo`, [conv.id])).rows[0]?.n)) {
      await q(db, `INSERT INTO messages (org_id,client_id,conversation_id,direction,channel,rendered_body,status,compliance_check_passed,provider,is_demo) VALUES
        ($1,$2,$3,'outbound','sms',$4,'delivered',true,'demo',true),($1,$2,$3,'inbound','sms',$5,'received',true,'demo',true),($1,$2,$3,'outbound','sms',$6,'delivered',true,'demo',true)`,
        [orgId,clientId,conv.id,"DEMO: ready for funding call?","Yes Thursday.","Booked with CRS shortlist."]);
    }
  }

  if (((await q(db, `SELECT count(*)::int n FROM call_outcomes WHERE org_id=$1 AND is_demo`, [orgId])).rows[0]?.n || 0) < 35) {
    let i=0; const pool = staffRows.filter(s=>["closer","sales_manager","setter"].includes(s.role));
    const use = pool.length?pool:staffRows;
    for (const c of DEMO_CLIENTS) for (let k=0;k<3;k++) {
      const outcome = OUTCOMES[(c.n+k)%OUTCOMES.length]; const belief = BELIEFS[(c.n+k*2)%BELIEFS.length];
      const cash = outcome==="deposit"?150000+c.n*1000:outcome==="downsell"?49700:0;
      await q(db, `INSERT INTO call_outcomes (org_id,client_id,staff_id,booking_ref,outcome,belief_failed,cash_collected_cents,duration_seconds,notes,logged_at,is_demo)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()-(($10)::text||' days')::interval,true) ON CONFLICT DO NOTHING`,
        [orgId,clientIds[c.n],use[i++%use.length].id,`demo-call-${c.n}-${k}`,outcome,outcome==="no_show"?null:belief,cash,600+c.n*30,"demo",String((c.n+k)%25)]);
    }
    for (let b=0;b<BELIEFS.length;b++) await q(db, `INSERT INTO call_outcomes (org_id,client_id,staff_id,booking_ref,outcome,belief_failed,cash_collected_cents,duration_seconds,notes,logged_at,is_demo)
      VALUES ($1,$2,$3,$4,'callback',$5,0,480,'belief',now()-($6||' hours')::interval,true) ON CONFLICT DO NOTHING`,
      [orgId,clientIds[(b%12)+1],mgr.id,`demo-belief-${b}`,BELIEFS[b],String(b*3)]);
  }

  for (const s of staffRows.slice(0,5)) {
    if (((await q(db, `SELECT count(*)::int n FROM shifts WHERE org_id=$1 AND staff_id=$2 AND is_demo`, [orgId,s.id])).rows[0]?.n||0) >= 2) continue;
    await q(db, `INSERT INTO shifts (org_id,staff_id,started_at,ended_at,is_demo) VALUES ($1,$2,now()-interval '2 days',now()-interval '1 day',true)`, [orgId,s.id]);
    const shift = (await q(db, `SELECT id FROM shifts WHERE org_id=$1 AND staff_id=$2 AND is_demo ORDER BY started_at DESC LIMIT 1`, [orgId,s.id])).rows[0];
    if (shift) await q(db, `INSERT INTO staff_events (org_id,staff_id,shift_id,kind,detail,is_demo) VALUES ($1,$2,$3,'call_made','{"demo":true}',true),($1,$2,$3,'file_touched','{"demo":true}',true)`, [orgId,s.id,shift.id]);
  }

  for (const n of [6,10]) {
    const clientId = clientIds[n]; const caseId = `DEMO-CASE-${String(n).padStart(2,"0")}`;
    await q(db, `INSERT INTO inquiry_removal_cases (org_id,client_id,case_id,case_status,selected_bureaus_raw,request_source,requested_by,open_inquiry_count,master_call_state,remover_notes,is_demo)
      SELECT $1,$2,$3,'In Progress','EX,EQ,TU','platform_demo','DEMO Owner',3,'on_hold','demo',true WHERE NOT EXISTS (SELECT 1 FROM inquiry_removal_cases WHERE org_id=$1 AND case_id=$3)`, [orgId,clientId,caseId]);
    for (let i=0;i<CALL_STATES.length;i++) {
      const inq=`DEMO-INQ-${n}-${i}`;
      if ((await q(db, `SELECT id FROM inquiry_log WHERE org_id=$1 AND client_id=$2 AND inquiry=$3`, [orgId,clientId,inq])).rows[0]) continue;
      await q(db, `INSERT INTO inquiry_log (org_id,client_id,bureau,inquiry,status,call_attempts,outcome,call_state,is_demo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::inquiry_call_state,true)`,
        [orgId,clientId,["EX","EQ","TU"][i%3],inq,i%3===0?"open":i%3===1?"disputed":"cleared",i%4,i%3===2?"removed":null,CALL_STATES[i]]);
    }
  }

  let tpl = (await q(db, `SELECT id,template_key,kind FROM contract_templates WHERE org_id=$1 AND template_key='FUNDING-AGREEMENT' LIMIT 1`, [orgId])).rows[0];
  if (!tpl) tpl = (await db.query(`INSERT INTO contract_templates (org_id,template_key,name,kind,subtype,body,manual_fields,signature_required,created_by,is_demo)
    VALUES ($1,'DEMO-FUNDING-AGREEMENT','Demo Funding Agreement','contract','funding_agreement',E'DEMO\n{{contact.full_name}}','[]'::jsonb,true,$2,true) RETURNING id,template_key,kind`, [orgId,owner.id])).rows[0];
  for (const s of [{n:1,status:"signed"},{n:2,status:"sent"},{n:5,status:"draft"}]) {
    if ((await q(db, `SELECT id FROM contracts WHERE org_id=$1 AND client_id=$2 AND is_demo LIMIT 1`, [orgId,clientIds[s.n]])).rows[0]) continue;
    const c = DEMO_CLIENTS.find(x=>x.n===s.n);
    const rendered = "Rendered DEMO contract for "+demoClientEmail(s.n);
    await q(db, `INSERT INTO contracts (org_id,client_id,template_id,template_key,title,kind,status,created_by,rendered_body,body_sha,is_demo,sent_at,signed_at,signer_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12,$13)`,
      [orgId,clientIds[s.n],tpl.id,tpl.template_key,"Demo "+tpl.template_key,tpl.kind||"contract",s.status,owner.id,
        s.status==="draft"?null:rendered,s.status==="draft"?null:("sha256:"+"ab".repeat(32)),
        s.status!=="draft"?new Date():null,s.status==="signed"?new Date():null,s.status==="signed"?(c.first+" "+c.last):null]);
  }

  if (affiliateId && clientIds[11]) await q(db, `INSERT INTO affiliate_referrals (org_id,affiliate_id,client_id,tier,tracking_id_used,attributed_at,source,converted_at,status,notes)
    SELECT $1,$2,$3,'direct',$4,now()-interval '14 days','manual',now()-interval '7 days','converted','demo'
    WHERE NOT EXISTS (SELECT 1 FROM affiliate_referrals WHERE client_id=$3 AND tier='direct')`, [orgId,affiliateId,clientIds[11],DEMO_AFFILIATE.tracking_id]);

  const counts = (await db.query(`SELECT
    (SELECT count(*)::int FROM clients WHERE org_id=$1 AND is_demo) AS clients,
    (SELECT count(*)::int FROM lenders WHERE org_id=$1 AND is_demo) AS lenders,
    (SELECT count(*)::int FROM call_outcomes WHERE org_id=$1 AND is_demo) AS call_outcomes,
    (SELECT count(*)::int FROM sales WHERE org_id=$1 AND is_demo) AS sales,
    (SELECT count(*)::int FROM funding_rounds WHERE org_id=$1 AND is_demo) AS funding_rounds`, [orgId])).rows[0];
  return { ok: true, seeded: true, counts, domain: DEMO_EMAIL_DOMAIN };
}

export async function setDemoMode(db, { orgId, enabled } = {}) {
  if (!orgId) throw new TypeError("setDemoMode: orgId required");
  if (enabled) {
    const seed = await seedPlatformDemo(db, { orgId });
    await db.query(`UPDATE orgs SET demo_mode_enabled=true, updated_at=now() WHERE id=$1`, [orgId]);
    return { demo_mode_enabled: true, ...seed };
  }
  await db.query(`UPDATE orgs SET demo_mode_enabled=false, updated_at=now() WHERE id=$1`, [orgId]);
  return { demo_mode_enabled: false, seeded: false };
}

export async function getDemoModeStatus(db, { orgId } = {}) {
  if (!orgId) throw new TypeError("getDemoModeStatus: orgId required");
  const org = await db.query(`SELECT demo_mode_enabled FROM orgs WHERE id=$1`, [orgId]);
  const counts = (await db.query(`SELECT
    (SELECT count(*)::int FROM clients WHERE org_id=$1 AND is_demo) AS clients,
    (SELECT count(*)::int FROM lenders WHERE org_id=$1 AND is_demo) AS lenders,
    (SELECT count(*)::int FROM call_outcomes WHERE org_id=$1 AND is_demo) AS call_outcomes,
    (SELECT count(*)::int FROM sales WHERE org_id=$1 AND is_demo) AS sales,
    (SELECT count(*)::int FROM funding_rounds WHERE org_id=$1 AND is_demo) AS funding_rounds`, [orgId])).rows[0];
  return { demo_mode_enabled: org.rows[0]?.demo_mode_enabled === true, counts, domain: DEMO_EMAIL_DOMAIN };
}

/** Run a wipe delete; ignore missing-relation / undefined-column only. */
async function wipeQ(db, sql, params = []) {
  try {
    return await db.query(sql, params);
  } catch (err) {
    const code = err && err.code;
    // 42P01 undefined_table, 42703 undefined_column — schema drift / optional tables
    if (code === "42P01" || code === "42703") return { rows: [], rowCount: 0 };
    throw err;
  }
}

export async function wipeDemoData(db, { orgId } = {}) {
  if (!orgId) throw new TypeError("wipeDemoData: orgId required");
  // fundhub_app cannot DISABLE TRIGGER. Migration 150 lets is_demo rows delete.
  await db.query(`UPDATE orgs SET demo_mode_enabled=false, updated_at=now() WHERE id=$1`, [orgId]);
  const clientIds = (await db.query(`SELECT id FROM clients WHERE org_id=$1 AND is_demo`, [orgId])).rows.map(r => r.id);

  if (clientIds.length) {
    const byOrgDemo = [
      `DELETE FROM call_outcomes WHERE org_id=$1 AND is_demo`,
      `DELETE FROM messages WHERE org_id=$1 AND is_demo`,
      `DELETE FROM conversations WHERE org_id=$1 AND is_demo`,
      `DELETE FROM payment_links WHERE org_id=$1 AND is_demo`,
      `DELETE FROM invoices WHERE org_id=$1 AND is_demo`,
      `DELETE FROM sale_payments WHERE org_id=$1 AND is_demo`,
      `DELETE FROM commission_ledger WHERE org_id=$1 AND is_demo`,
      `DELETE FROM entitlements WHERE org_id=$1 AND is_demo`,
      `DELETE FROM contract_signers WHERE contract_id IN (SELECT id FROM contracts WHERE org_id=$1 AND is_demo)`,
      `DELETE FROM contracts WHERE org_id=$1 AND is_demo`,
      `DELETE FROM inquiry_log WHERE org_id=$1 AND is_demo`,
      `DELETE FROM inquiry_removal_cases WHERE org_id=$1 AND is_demo`,
      `DELETE FROM funding_closeout_items WHERE funding_closeout_id IN (SELECT id FROM funding_closeout WHERE org_id=$1 AND is_demo)`,
      `DELETE FROM funding_closeout WHERE org_id=$1 AND is_demo`,
      `DELETE FROM applications WHERE org_id=$1 AND is_demo`,
      `DELETE FROM funding_rounds WHERE org_id=$1 AND is_demo`,
      `DELETE FROM sales WHERE org_id=$1 AND is_demo`,
      `DELETE FROM transactions WHERE org_id=$1 AND is_demo`,
      `DELETE FROM cards WHERE org_id=$1 AND is_demo`,
      `DELETE FROM tradelines WHERE org_id=$1 AND is_demo`,
      `DELETE FROM crs_results WHERE org_id=$1 AND is_demo`,
      `DELETE FROM bank_accounts WHERE org_id=$1 AND is_demo`,
      `DELETE FROM marketing_flags WHERE org_id=$1 AND is_demo`
    ];
    for (const sql of byOrgDemo) await wipeQ(db, sql, [orgId]);

    // Every non-CASCADE FK to clients must be cleared before DELETE clients.
    const byClient = [
      `DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE client_id=ANY($1))`,
      `UPDATE documents SET current_version_id=NULL WHERE client_id=ANY($1)`,
      `DELETE FROM documents WHERE client_id=ANY($1)`,
      `DELETE FROM events WHERE client_id=ANY($1)`,
      `DELETE FROM bank_inbox WHERE client_id=ANY($1)`,
      `DELETE FROM affiliate_events WHERE client_id=ANY($1)`,
      `DELETE FROM affiliate_payout_lines WHERE client_id=ANY($1)`,
      `DELETE FROM opt_outs WHERE client_id=ANY($1)`,
      `DELETE FROM outbound_calls WHERE client_id=ANY($1)`,
      `DELETE FROM pii_access_log WHERE client_id=ANY($1)`,
      `DELETE FROM snapshots WHERE client_id=ANY($1)`,
      `DELETE FROM tasks WHERE client_id=ANY($1)`,
      `DELETE FROM affiliate_referrals WHERE client_id=ANY($1)`,
      `DELETE FROM contract_signers WHERE client_id=ANY($1)`,
      `DELETE FROM contracts WHERE client_id=ANY($1)`,
      `DELETE FROM soft_pull_requests WHERE client_id=ANY($1)`,
      `DELETE FROM client_custom_fields WHERE client_id=ANY($1)`,
      `DELETE FROM client_consents WHERE client_id=ANY($1)`,
      `DELETE FROM client_cards WHERE client_id=ANY($1)`,
      `DELETE FROM alerts WHERE client_id=ANY($1)`,
      `DELETE FROM entities WHERE client_id=ANY($1)`,
      `DELETE FROM lender_bureau_observations WHERE client_id=ANY($1)`,
      `DELETE FROM inquiry_prep WHERE client_id=ANY($1)`,
      `DELETE FROM business_tradelines WHERE client_id=ANY($1)`,
      `DELETE FROM call_compliance_flags WHERE client_id=ANY($1)`,
      `DELETE FROM cards WHERE client_id=ANY($1)`,
      `DELETE FROM messages WHERE client_id=ANY($1)`,
      `DELETE FROM conversations WHERE client_id=ANY($1)`,
      `DELETE FROM call_outcomes WHERE client_id=ANY($1)`,
      `DELETE FROM payment_links WHERE client_id=ANY($1)`,
      `DELETE FROM invoice_payments WHERE invoice_id IN (SELECT id FROM invoices WHERE client_id=ANY($1))`,
      `DELETE FROM invoices WHERE client_id=ANY($1)`,
      `DELETE FROM commission_ledger WHERE client_id=ANY($1)`,
      `DELETE FROM entitlements WHERE client_id=ANY($1)`,
      `DELETE FROM sales WHERE client_id=ANY($1)`,
      `DELETE FROM transactions WHERE client_id=ANY($1)`,
      `DELETE FROM inquiry_log WHERE client_id=ANY($1)`,
      `DELETE FROM inquiry_removal_cases WHERE client_id=ANY($1)`,
      `DELETE FROM applications WHERE client_id=ANY($1)`,
      `DELETE FROM funding_rounds WHERE client_id=ANY($1)`,
      `DELETE FROM tradelines WHERE client_id=ANY($1)`,
      `DELETE FROM crs_results WHERE client_id=ANY($1)`,
      `DELETE FROM accounts WHERE client_id=ANY($1)`,
      `DELETE FROM clients WHERE id=ANY($1) AND is_demo`
    ];
    for (const sql of byClient) await wipeQ(db, sql, [clientIds]);
  }

  await wipeQ(db, `DELETE FROM staff_events WHERE org_id=$1 AND is_demo`, [orgId]);
  await wipeQ(db, `DELETE FROM shifts WHERE org_id=$1 AND is_demo`, [orgId]);
  await wipeQ(db, `DELETE FROM lenders WHERE org_id=$1 AND is_demo`, [orgId]);
  await wipeQ(db, `DELETE FROM partners WHERE org_id=$1 AND is_demo AND slug=$2`, [orgId, DEMO_PARTNER.slug]);
  await wipeQ(db, `DELETE FROM affiliates WHERE org_id=$1 AND is_demo AND tracking_id=$2`, [orgId, DEMO_AFFILIATE.tracking_id]);
  await wipeQ(db, `DELETE FROM contract_templates WHERE org_id=$1 AND is_demo`, [orgId]);

  return { ok: true, wiped: true, clients_removed: clientIds.length };
}
