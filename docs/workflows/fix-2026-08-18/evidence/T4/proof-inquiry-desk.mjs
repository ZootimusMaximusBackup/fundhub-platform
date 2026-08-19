/* Proof for T4 items 02, 03, 08, 10, 11, X1 — run in a real browser (Chromium).

   FAITHFULNESS: data.js is served as a STUB but keeps the page's own `defer`
   attribute, so window.FHData appears only AFTER the document is parsed —
   exactly the production timing that caused the bug. shell.js and the sidebar
   are stubbed empty only because they bounce to a login page without a session;
   they play no part in the defects under test.

   Usage: node t4-proof.mjs <path-to-inquiry-remover.html> <label>          */
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML = process.argv[2];
const LABEL = process.argv[3] || 'run';
const OUT = '/tmp/wt-T4/docs/workflows/fix-2026-08-18/evidence/T4';

const INQ = [
  { id:'a1', client_id:'c1', client_name:'Ada Test', bureau:'Experian',   inquiry_name:'Lender A', status:'Pending Removal', outcome:null, call_attempts:2, call_state:'completed' },
  { id:'a2', client_id:'c2', client_name:'Ben Test', bureau:'TransUnion', inquiry_name:'Lender B', status:'Removed',         outcome:null, call_attempts:1, call_state:'completed' },
  { id:'a3', client_id:'c3', client_name:'Cy Test',  bureau:'Equifax',    inquiry_name:'Lender C', status:'Pending Removal', outcome:null, call_attempts:0, call_state:'not_started' }
];
const CASES = [{ id:'11111111-1111-4111-8111-111111111111', case_id:'IRC-1', client_id:'c1',
  client_name:'Ada Test', case_status:'Queued', selected_bureaus:['EX'], open_inquiry_count:1,
  call_fired_at:null, created_at:new Date().toISOString() }];

// The stub data.js. Served for the page's own `<script defer src="data.js">` tag,
// so it runs after parsing — the real defer timing.
const DATA_JS = `
window.FHData = {
  inquiries:    function () { (window.__calls=window.__calls||[]).push('inquiries');
    return Promise.resolve({ ok:true, source:'api', data:{ items: ${JSON.stringify(INQ)} } }); },
  inquiryCases: function () { (window.__calls=window.__calls||[]).push('inquiryCases');
    return Promise.resolve({ ok:true, source:'api', data:{ ok:true, cases: ${JSON.stringify(CASES)} } }); },
  banner: function () {}, explain: function () {},
  pill: function (status) { var done = status === 'Removed';
    return { known:true, done:done, cls: done?'confirmed':'pending', text: done?'Removed':'Pending' }; }
};`;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.route('**/*', route => {
  const p = new URL(route.request().url()).pathname;
  if (p.endsWith('inquiry-remover.html')) return route.fulfill({ contentType:'text/html', body: fs.readFileSync(HTML,'utf8') });
  if (p.endsWith('/data.js'))             return route.fulfill({ contentType:'text/javascript', body: DATA_JS });
  if (p.includes('/api/read/inquiry-cases')) return route.fulfill({ contentType:'application/json', body: JSON.stringify({ ok:true, cases: CASES }) });
  if (p.includes('/api/read/repair-cases'))  return route.fulfill({ contentType:'application/json', body: JSON.stringify({ ok:true, files: [], need_me: 0 }) });
  if (p.includes('/api/repair/exceptions'))  return route.fulfill({ contentType:'application/json', body: JSON.stringify({ ok:true, stalled: [], lowConfidenceParses: [] }) });
  return route.fulfill({ status:200, contentType:'text/javascript', body:'' });
});

await page.goto('https://fundhub.test/app/inquiry-remover.html', { waitUntil:'load' });
await page.waitForTimeout(1500);

const r = await page.evaluate(() => {
  const txt = s => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; };
  const wq = document.getElementById('workQueueTable');
  const cq = document.getElementById('caseQueueTable');
  const anonQueue = [...document.querySelectorAll('table.queue')].find(t => !t.id);
  const wqRows = wq ? wq.querySelectorAll('tr[data-row]').length
                    : (anonQueue ? anonQueue.querySelectorAll('tr[data-row]').length : -1);
  // Read the handle the page's OWN Send handler uses, out of its own source, and
  // evaluate that exact expression. Version-agnostic: on the unfixed page this is
  // the bare `VIEW` (undefined at global scope -> "VIEW is not defined", the
  // string the button displayed); on the fixed page it is window.FHInquiryView.
  const src = document.documentElement.outerHTML;
  const m = src.match(/req = ([\w.]+)\.buildCaseSendRequest\(/);
  const handle = m ? m[1] : '(not found)';
  let send;
  try {
    const build = new Function('o', 'return ' + handle + '.buildCaseSendRequest(o);');
    const req = build({ caseId:'11111111-1111-4111-8111-111111111111', mail:true });
    send = { ok:true, handle, method:req.method, path:req.path };
  } catch (e) { send = { ok:false, handle, error:String(e && e.message || e) }; }
  return {
    stillLoadingText:  (document.body.innerText || '').includes('Loading inquiry queue'),
    workQueueRows:     wqRows,
    strayRowsInCases:  cq ? cq.querySelectorAll('tr[data-row]').length : -1,
    tiles: { needMe: txt('[data-stat="left"]'), worked: txt('[data-stat="worked"]'),
             calls: txt('[data-stat="calls"]'), confirmed: txt('[data-stat="confirmed"]') },
    bureauChips: [...document.querySelectorAll('.bc')].map(e => e.textContent.trim()),
    typeofWindowVIEW: typeof window.VIEW,
    typeofFHInquiryView: typeof window.FHInquiryView,
    sendBuilds: send,
    fhDataCalls: window.__calls || []
  };
});

fs.mkdirSync(`${OUT}/${LABEL}`, { recursive:true });
await page.screenshot({ path:`${OUT}/${LABEL}/inquiry-desk.png`, fullPage:true });
fs.writeFileSync(`${OUT}/${LABEL}/walk.json`, JSON.stringify({ label:LABEL, html:HTML, result:r, pageErrors:errors }, null, 2));

const checks = [
  ['Work Queue no longer stuck on "Loading inquiry queue…"', r.stillLoadingText === false],
  ['3 inquiry rows rendered into the Work Queue',            r.workQueueRows === 3],
  ['no inquiry rows leaked into the cases table',            r.strayRowsInCases === 0],
  ['"Need me" tile shows a number, not a dash',              r.tiles.needMe === '2'],
  ['"Worked" tile shows a number',                           r.tiles.worked === '2'],
  ['"Calls" tile shows a number',                            r.tiles.calls === '3'],
  ['"Confirmed" tile shows a number',                        r.tiles.confirmed === '1'],
  ['bureau chips are not all zero',                          r.bureauChips.some(c => c !== '0')],
  ['Send builds a request instead of throwing',              r.sendBuilds.ok === true],
  ['no uncaught page errors',                                errors.length === 0]
];
console.log(JSON.stringify(r, null, 2));
console.log(`\n--- CHECKS (${LABEL}) ---`);
let bad = 0;
for (const [n, ok] of checks) { if (!ok) bad++; console.log((ok?'PASS  ':'FAIL  ') + n); }
console.log(bad ? `\n${bad} FAILING` : '\nALL PASS');
await browser.close();
process.exit(0);
