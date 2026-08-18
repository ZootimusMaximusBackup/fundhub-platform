import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT='/Users/zootimusmaximus/fundhub-platform/public';
function stages(){return ['New','Contacted','Booked'].map((n,i)=>({key:'s'+i,name:n,count:3,amount:45000,
  cards:Array.from({length:3},(_,j)=>({id:'c'+i+j,client_id:'cl'+i+j,name:'P'+i+j,amount:15000,entered_at:new Date().toISOString(),owner:'Rep'}))}));}
const srv=http.createServer((req,res)=>{const u=new URL(req.url,'http://x');
  if(u.pathname.startsWith('/api/')){const j=(o,d=200)=>setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(o));},d);
    if(u.pathname==='/api/auth/session')return j({ok:true,staff:{id:'s1',name:'O',role:'owner',org_id:'o1'}},80);
    if(u.pathname==='/api/dashboard/pipeline')return j({ok:true,stages:stages()});
    return j({ok:true,db:'up'},40);}
  try{res.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(u.pathname)]||'text/plain'});res.end(fs.readFileSync(path.join(ROOT,u.pathname)));}catch(e){res.writeHead(404);res.end('nf');}});
await new Promise(r=>srv.listen(0,r)); const port=srv.address().port;
const b=await chromium.launch(); const ctx=await b.newContext();
await ctx.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,body:'',contentType:'text/css'}));
await ctx.route('https://fonts.gstatic.com/**',r=>r.abort());
const pg=await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
await pg.addInitScript(()=>{try{localStorage.setItem('fh_token','t');localStorage.setItem('fh_role','owner');}catch(e){}});
await pg.goto(`http://127.0.0.1:${port}/app/pipeline.html`,{waitUntil:'load'});
await pg.waitForTimeout(1200);
console.log('after load  -> cards:',await pg.evaluate(()=>document.querySelectorAll('.board .card').length),'| status:',await pg.evaluate(()=>document.getElementById('boardStatus').textContent),'| errors:',errs.join('; ')||'none');
await pg.click('.rail-tab[data-rail="R-01"]'); await pg.waitForTimeout(1200);
console.log('after Sales tab click -> cards:',await pg.evaluate(()=>document.querySelectorAll('.board .card').length),'| status:',await pg.evaluate(()=>document.getElementById('boardStatus').textContent));
await b.close();srv.close();
