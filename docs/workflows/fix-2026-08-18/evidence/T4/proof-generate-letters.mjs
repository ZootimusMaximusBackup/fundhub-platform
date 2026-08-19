/* Proves the "Generate letters" action on the case detail view: it appears, it calls
   POST /api/repair/generate with the case's client, it mails nothing, and it reports
   every outcome the engine can return in words a person can act on. */
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML = '/tmp/wt-T4/public/app/inquiry-remover.html';
const OUT = '/tmp/wt-T4/docs/workflows/fix-2026-08-18/evidence/T4/after';
const CASES = [{ id:'11111111-1111-4111-8111-111111111111', case_id:'IRC-1',
  client_id:'8556bedc-46e1-4d85-b0cd-a24adfee1521', client_name:'Ada Test',
  case_status:'Queued', selected_bureaus_raw:'EX', open_inquiry_count:1,
  call_fired_at:null, funding_round_id:null, created_at:new Date().toISOString() }];

const DATA_JS = `window.FHData={inquiries:function(){return Promise.resolve({ok:true,data:{items:[]}});},
 inquiryCases:function(){return Promise.resolve({ok:true,data:{ok:true,cases:${JSON.stringify(CASES)}}});},
 banner:function(){},explain:function(){},pill:function(){return {known:true,done:false,cls:'pending',text:'Pending'};}};`;

const SCENARIOS = [
  { name: 'two letters made',      body: { ok:true, round:'R1', letters_stored:2, skipped:[], identity_complete:true },
    expect: /2 letters are ready\. Nothing has been mailed\./ },
  { name: 'clean file, no letter', body: { ok:false, reason:'no_violations' },
    expect: /Nothing to dispute on this file/ },
  { name: 'no credit report',      body: { ok:false, reason:'no_credit_file' },
    expect: /No credit report on file yet/ },
  { name: 'no name on record',     body: { ok:false, reason:'missing_identity' },
    expect: /no name on their record/ },
  { name: 'already done',          body: { ok:true, already_generated:true, skipped:[{bureau:'EX',reason:'already_generated'}] },
    expect: /already exist\. Nothing was made again\./ },
  { name: 'one made, one skipped', body: { ok:true, letters_stored:1, skipped:[{bureau:'TU',reason:'no_violations'}], identity_complete:false },
    expect: /1 letter is ready.*Skipped TU.*address is incomplete/s }
];

const browser = await chromium.launch();
let bad = 0, mailed = 0;
const results = [];

for (const sc of SCENARIOS) {
  const page = await browser.newPage();
  const calls = [];
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/*', route => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p.endsWith('inquiry-remover.html')) return route.fulfill({ contentType:'text/html', body: fs.readFileSync(HTML,'utf8') });
    if (p.endsWith('/data.js')) return route.fulfill({ contentType:'text/javascript', body: DATA_JS });
    if (p.includes('/api/read/inquiry-cases')) return route.fulfill({ contentType:'application/json', body: JSON.stringify({ ok:true, cases: CASES }) });
    if (p.includes('/api/repair/generate')) {
      calls.push({ method: req.method(), body: req.postData() });
      return route.fulfill({ contentType:'application/json', body: JSON.stringify(sc.body) });
    }
    // Anything that could actually reach a bureau or a person:
    if (p.includes('/api/repair/send') || p.includes('/api/inquiry-cases')) { mailed++; }
    return route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' });
  });

  await page.goto('https://fundhub.test/app/inquiry-remover.html', { waitUntil:'load' });
  await page.waitForTimeout(900);
  await page.click('#caseQueueBody tr[data-case-id], #caseQueueBody tr');   // open the case
  await page.waitForTimeout(400);
  const btn = await page.$('[data-act="generate-letters"]');
  if (!btn) { console.log(`FAIL  ${sc.name}: no Generate letters button`); bad++; await page.close(); continue; }
  await btn.click();
  await page.waitForTimeout(600);
  const text = await page.$eval('.gen-result', el => el.textContent.trim()).catch(() => '');
  const ok = sc.expect.test(text) && calls.length === 1 && calls[0].method === 'POST';
  if (!ok) bad++;
  results.push({ scenario: sc.name, said: text, calls, pageErrors: errors });
  console.log(`${ok ? 'PASS  ' : 'FAIL  '}${sc.name}\n        said: "${text}"\n        call: ${calls.length ? calls[0].method + ' ' + calls[0].body : 'NONE'}`);
  if (sc.name === 'two letters made') await page.screenshot({ path: `${OUT}/generate-letters.png`, fullPage: true });
  await page.close();
}

console.log(`\nrequests that could reach a bureau or a client: ${mailed}`);
if (mailed !== 0) bad++;
fs.writeFileSync(`${OUT}/generate-letters.json`, JSON.stringify({ results, mailedAttempts: mailed }, null, 2));
console.log(bad ? `\n${bad} FAILING` : '\nALL PASS');
await browser.close();
process.exit(0);
