// Finishes the 2026-08-28 sim-data cleanup. Two jobs, both safe to re-run:
//
//   1. Flags 25 named test clients that the pattern-based purge missed (E2e
//      fixtures, Chris's own plus-tagged signups, joke rows). Flagging only —
//      run `npm run sim:purge` afterwards to actually remove them.
//   2. Corrects one REAL customer's email. Colin Schmidt paid $32 on 2026-08-24
//      (commas payment ORD-N40H-ZZ26-HKNW, buyer "Colin Schmidt"
//      <schmidtco16@gmail.com>) but his CRM row carried a QA plus-tag of Chris's
//      own address, so everything sent to him went to Chris instead.
//
// Every row is listed by id and verified before anything is written. The earlier
// purge matched on name prefixes, which would have caught a real "Simone" or
// "Simmons"; this file cannot touch anyone who is not named in it.
//
//   node scripts/finish-sim-cleanup.mjs
//   npm run sim:purge

import fs from "node:fs";
import pg from "pg";
const url = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("SELECT set_config('fundhub.actor','staff',false)");
await c.query("SELECT set_config('fundhub.partner_id','',false)");

// Named one by one, on purpose. The regex that ran before would have caught a real
// "Simone" or "Simmons"; this cannot catch anybody who is not on this list.
const TEST_ROWS = [
  ["d56838a7-3d62-4dfd-8ed0-ead5dd76cbab", "Chris Full — stanbridgejchris+full"],
  ["54bdc228-d4ca-4192-8811-6cecbaf62ede", "Chris Fpr — stanbridgejchris+fpr"],
  ["dad186ff-9dce-4f59-966c-6e3db2ed503d", "Chris Prem — stanbridgejchris+prem"],
  ["754ab724-6a02-417a-ae7c-deb0c7ad2d3b", "Chris Review — stanbridgejchris+review"],
  ["297065ca-5202-4031-bea8-4710add03027", "Big Boy — bigboy@littleboy.com"],
  ["8556bedc-46e1-4d85-b0cd-a24adfee1521", "John Client Role — stanbridgejchris+e2e-fire"],
  ["f9ae2a44-6a91-48f2-9388-9650b48c34d0", "SMS Consent Check — e2e+sms-optout@fundhub.ai"],
  ["4ab123c6-8da6-4393-948e-d2d811f1828a", "E2e AffU9c"],
  ["f500ddf3-d508-4bf5-8f4b-3cb24ab840e1", "E2e AffU9d"],
  ["ee3582e1-8d20-4a8b-8231-bf1369410cee", "E2e AffU9e"],
  ["edca0767-88e9-4cf4-8837-47382049503a", "E2e Fire"],
  ["9d4126b4-c3a3-4dd7-bfc0-94fdfed545cb", "E2E Aff A2P"],
  ["0bfedb2d-24fd-4bdb-8e63-0cc95b771da7", "E2E Aff A2P (b)"],
  ["af0115cc-c6ba-46ef-9d54-808eb7dda6e5", "E2e Lockship"],
  ["110b53d6-4b6f-4e90-8da0-d2969f7fd7c7", "E2e Aff Part3"],
  ["899bf970-5ab7-4473-a32f-0968fdb32629", "Chris ag04"],
  ["19ce5aa3-b2fb-40ed-81f0-d9d76e82e1f1", "Chris inqcall"],
  ["423f397b-199b-490b-bc43-fce2de2fb316", "test+crs@fundhub.ai"],
  ["5e1c2524-e194-4bdf-9948-3010fbf19b11", "big dick — stanbridgelargecock@gmail.com"],
  ["beafe5e9-0aaf-4d42-9e67-a9fe40d6ff15", "stanbridge stanbridge — bakerskater987@yahoo.com"],
  ["92517f0f-e36a-455a-b264-7d0f2b5bc0b1", "chris mcgee — info@fundhub.ai"],
  ["c2f6b4dd-5159-41dd-9c9c-3eaf0fa19de4", "mcgee mcgee — balls@gmail.com"],
  ["459af021-7881-48b4-a621-b85c7b6e5f1d", "Chris Stanbridge — stanbrdgejchris@gmsial.c.om (typo address)"],
  ["7c888d85-1d86-46d0-918e-cee7eb7cd460", "Ff Walkone"],
  ["0bf376a7-2c51-426a-a749-5206886b3459", "B1 Ghost Book"],
];

// Confirm each id is the row we think it is BEFORE flagging anything.
let ok = 0;
for (const [id, label] of TEST_ROWS) {
  const r = await c.query(`SELECT first_name, last_name, email FROM clients WHERE id=$1`, [id]);
  if (!r.rows[0]) { console.log("MISSING (skipped):", label); continue; }
  ok++;
  console.log(`ok  ${r.rows[0].first_name ?? "-"} ${r.rows[0].last_name ?? "-"} <${r.rows[0].email ?? "-"}>  [${label}]`);
}
console.log(`\nverified ${ok} of ${TEST_ROWS.length} rows`);

const res = await c.query(`UPDATE clients SET is_demo = true WHERE id = ANY($1::uuid[]) AND COALESCE(is_demo,false)=false`,
  [TEST_ROWS.map(r => r[0])]);
console.log("flagged as demo:", res.rowCount);

// Colin Schmidt paid $32 on 2026-08-24 (commas payment ORD-N40H-ZZ26-HKNW, buyer
// "Colin Schmidt" <schmidtco16@gmail.com>). His CRM row carried a QA plus-tag of
// Chris's own address, so everything addressed to him went to Chris instead.
const COLIN = "e42c11e8-ec33-40b7-ac5a-99f733d18a3f";
const before = (await c.query(`SELECT email FROM clients WHERE id=$1`, [COLIN])).rows[0];
console.log("\nColin's email was:", before?.email);
const up = await c.query(
  `UPDATE clients SET email = 'schmidtco16@gmail.com', updated_at = now()
    WHERE id = $1 AND email = 'stanbridgejchris+colin-qa@gmail.com' RETURNING email`, [COLIN]);
console.log("Colin's email now:", up.rows[0]?.email ?? "(unchanged)");
await c.end();
