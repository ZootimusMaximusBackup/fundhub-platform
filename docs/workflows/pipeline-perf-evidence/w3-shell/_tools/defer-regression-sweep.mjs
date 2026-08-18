import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT='/Users/zootimusmaximus/fundhub-platform/public';
const srv=http.createServer((req,res)=>{const u=new URL(req.url,'http://x');
  if(u.pathname.startsWith('/api/')){
    const j=(o)=>setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(o));},30);
    if(u.pathname==='/api/auth/session')return j({ok:true,staff:{id:'s1',name:'O',role:'owner',org_id:'o1',email:'o@f.ai'}});
    return j({ok:true,db:'up',stages:[],clients:[],data:{},items:[],rows:[],staff:[],brand:{},demo_mode_enabled:false});}
  try{res.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(u.pathname)]||'text/plain'});res.end(fs.readFileSync(path.join(ROOT,u.pathname)));}
  catch(e){res.writeHead(404);res.end('nf');}});
await new Promise(r=>srv.listen(0,r)); const port=srv.address().port;
const files=fs.readdirSync(ROOT+'/app').filter(f=>f.endsWith('.html'))
  .filter(f=>fs.readFileSync(ROOT+'/app/'+f,'utf8').includes('defer src="data.js"'));
const b=await chromium.launch(); const ctx=await b.newContext();
await ctx.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,body:'',contentType:'text/css'}));
await ctx.route('https://fonts.gstatic.com/**',r=>r.abort());
await ctx.route('https://**',r=>r.abort());
const bad=[];
for(const f of files){
  const pg=await ctx.newPage(); const errs=[];
  pg.on('pageerror',e=>errs.push(e.message));
  await pg.addInitScript(()=>{try{localStorage.setItem('fh_token','t');localStorage.setItem('fh_role','owner');}catch(e){}});
  try{await pg.goto(`http://127.0.0.1:${port}/app/${f}`,{waitUntil:'load',timeout:15000});}catch(e){}
  await pg.waitForTimeout(700);
  const hit=errs.filter(m=>/FHData|FHProxyApply|FHChat|is not defined/.test(m));
  if(hit.length) bad.push(f+'  ->  '+[...new Set(hit)].join(' | '));
  await pg.close();
}
console.log('pages with defer data.js:',files.length);
console.log('--- pages throwing a not-defined error on load ---');
console.log(bad.join('\n')||'(none)');
console.log('--- clean (defer data.js, no load-time throw) ---');
console.log(files.filter(f=>!bad.some(b=>b.split('  ->')[0]===f)).join('\n'));
await b.close();srv.close();
